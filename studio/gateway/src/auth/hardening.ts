// ---------------------------------------------------------------------------
// Gateway auth hardening
// ---------------------------------------------------------------------------
// Middleware for CSRF/origin checks, secure headers, rate limiting,
// content-disposition sanitization, and audit logging.
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyRequest } from "fastify";

// ── Rate limiter (simple in-memory, per-IP) ─────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private store = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(windowMs = 60_000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.cleanupTimer = setInterval(() => this.cleanup(), windowMs);
  }

  /** Check if request should be rate-limited. Returns true if allowed. */
  allow(ip: string): boolean {
    const now = Date.now();
    const entry = this.store.get(ip);

    if (!entry || now > entry.resetAt) {
      this.store.set(ip, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (entry.count >= this.maxRequests) return false;

    entry.count++;
    return true;
  }

  /** Get remaining requests for an IP. */
  remaining(ip: string): number {
    const entry = this.store.get(ip);
    if (!entry) return this.maxRequests;
    return Math.max(0, this.maxRequests - entry.count);
  }

  /** Retry-after timestamp in seconds. */
  retryAfter(ip: string): number {
    const entry = this.store.get(ip);
    if (!entry) return 0;
    return Math.ceil((entry.resetAt - Date.now()) / 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(ip);
    }
  }

  stop(): void { clearInterval(this.cleanupTimer); }
}

// ── Secure headers middleware ───────────────────────────────────────────────

const SECURE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
};

/**
 * Register secure headers on all responses.
 */
export function registerSecureHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    for (const [header, value] of Object.entries(SECURE_HEADERS)) {
      reply.header(header, value);
    }
    return payload;
  });
}

// ── Content-Disposition sanitization ───────────────────────────────────────

const SAFE_MIME_TYPES = new Set([
  "text/plain", "text/markdown", "text/html", "text/css",
  "text/csv", "text/yaml", "text/vtt",
  "application/json", "application/javascript", "application/xml",
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
  "audio/wav", "audio/mpeg", "audio/ogg",
  "video/mp4", "video/webm",
]);

/**
 * Sanitize Content-Disposition header based on MIME type.
 * Text-based types use "inline", binary types use "attachment".
 */
export function sanitizeDisposition(mimeType: string, filename: string): string {
  const safeType = mimeType.split(";")[0]!.trim().toLowerCase();

  if (SAFE_MIME_TYPES.has(safeType)) {
    return `inline; filename="${sanitizeFilename(filename)}"`;
  }
  return `attachment; filename="${sanitizeFilename(filename)}"`;
}

function sanitizeFilename(name: string): string {
  // Remove path separators and dangerous characters
  return name.replace(/[/\\:*?"<>|]/g, "_").slice(0, 255);
}

// ── CSRF / Origin validation ────────────────────────────────────────────────

/**
 * Validate the Origin header against allowed origins.
 * Used for state-changing requests (POST, PUT, PATCH, DELETE).
 */
export function validateOrigin(
  request: FastifyRequest,
  allowedOrigins: string[],
): boolean {
  // GET and HEAD are considered safe — no CSRF check needed
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return true;
  }

  const origin = request.headers.origin;
  if (!origin) {
    // No Origin header on non-browser requests — allow
    // (CLI/tool clients don't send Origin)
    return true;
  }

  return allowedOrigins.some((allowed) => {
    if (allowed === "*") return true;
    if (allowed === origin) return true;
    // Pattern matching for localhost variants
    if (allowed.includes("localhost") && origin.includes("localhost")) return true;
    if (allowed.includes("127.0.0.1") && origin.includes("127.0.0.1")) return true;
    return false;
  });
}

// ── Audit logging ───────────────────────────────────────────────────────────

export interface AuditEntry {
  timestamp: string;
  method: string;
  path: string;
  ip: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  authProvided: boolean;
}

export class AuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = 10_000) {
    this.maxEntries = maxEntries;
  }

  log(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries / 2);
    }
  }

  /** Get recent entries (last N). */
  recent(n = 100): AuditEntry[] {
    return this.entries.slice(-n);
  }

  /** Get entries filtered by status code range. */
  byStatus(min: number, max: number): AuditEntry[] {
    return this.entries.filter((e) => e.statusCode >= min && e.statusCode <= max);
  }

  /** Total entries logged. */
  get totalEntries(): number {
    return this.entries.length;
  }

  /** Clear all entries. */
  clear(): void {
    this.entries = [];
  }
}

// ── Register all hardening middleware ────────────────────────────────────────

export interface HardeningOptions {
  allowedOrigins: string[];
  rateLimiter: RateLimiter;
  auditLogger: AuditLogger;
}

export function registerHardening(
  app: FastifyInstance,
  options: HardeningOptions,
): void {
  const { allowedOrigins, rateLimiter, auditLogger } = options;

  // Secure headers
  registerSecureHeaders(app);

  // Rate limiting + audit + origin check
  app.addHook("preHandler", async (request, reply) => {
    const ip = request.ip;

    // Rate limit
    if (!rateLimiter.allow(ip)) {
      reply.status(429).header("Retry-After", String(rateLimiter.retryAfter(ip)));
      throw Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    }

    // Rate limit headers
    reply.header("X-RateLimit-Remaining", rateLimiter.remaining(ip));
    reply.header("X-RateLimit-Limit", 100);

    // CSRF / Origin check for state-changing requests
    if (!validateOrigin(request, allowedOrigins)) {
      reply.status(403);
      throw Object.assign(
        new Error(`Origin ${request.headers.origin} not allowed`),
        { statusCode: 403 },
      );
    }

    // Audit logging on response
    const startTime = Date.now();
    reply.header("X-Request-Start", String(startTime));
  });

  // Audit log on response
  app.addHook("onResponse", (request, reply, done) => {
    const durationMs = Date.now() - Number(request.headers["x-request-start"] ?? 0);
    auditLogger.log({
      timestamp: new Date().toISOString(),
      method: request.method,
      path: request.url,
      ip: request.ip,
      userAgent: request.headers["user-agent"] ?? "unknown",
      statusCode: reply.statusCode,
      durationMs,
      authProvided: !!request.headers.authorization,
    });
    done();
  });
}
