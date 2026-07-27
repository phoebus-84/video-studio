/**
 * Health check model for the gateway.
 *
 * Four independent readiness signals:
 *  - gateway   – the HTTP/WS server is accepting connections
 *  - runtime   – the video pipeline runtime is reachable
 *  - pi        – the Pi RPC process is running and responsive
 *  - adapter   – extension bridge adapters are connected
 *
 * Each is reported as one of: "ready" | "degraded" | "down" | "unknown"
 */
export type ReadinessState = "ready" | "degraded" | "down" | "unknown";

export interface ComponentHealth {
  status: ReadinessState;
  /** Optional human-readable detail (e.g. error reason). */
  detail?: string;
  /** Last time this component was checked (ISO-8601). */
  lastChecked?: string;
}

export interface HealthReport {
  /** Overall health: "healthy" if all components are ready or degraded;
   *  "unhealthy" if any component is down. */
  overall: "healthy" | "unhealthy";
  /** ISO-8601 timestamp of this report. */
  timestamp: string;
  gateway: ComponentHealth;
  runtime: ComponentHealth;
  pi: ComponentHealth;
  adapter: ComponentHealth;
}

// ── Health check function signatures ─────────────────────────────────────────

export type HealthChecker = () => Promise<ComponentHealth> | ComponentHealth;

/**
 * Build a composite health report from individual checkers.
 */
export async function collectHealth(checkers: {
  gateway: HealthChecker;
  runtime: HealthChecker;
  pi: HealthChecker;
  adapter: HealthChecker;
}): Promise<HealthReport> {
  async function safeCheck(checker: HealthChecker): Promise<ComponentHealth> {
    try {
      return await checker();
    } catch (err) {
      return {
        status: "down" as const,
        detail: err instanceof Error ? err.message : String(err),
        lastChecked: new Date().toISOString(),
      };
    }
  }

  const [gateway, runtime, pi, adapter] = await Promise.all([
    safeCheck(checkers.gateway),
    safeCheck(checkers.runtime),
    safeCheck(checkers.pi),
    safeCheck(checkers.adapter),
  ]);

  const allUp = [gateway, runtime, pi, adapter].every(
    (c) => c.status === "ready" || c.status === "degraded" || c.status === "unknown",
  );

  return {
    overall: allUp ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    gateway,
    runtime,
    pi,
    adapter,
  };
}

/** Gateway health: always ready when the server can respond. */
export function gatewayHealth(): ComponentHealth {
  return {
    status: "ready",
    lastChecked: new Date().toISOString(),
  };
}

/** Create a default "unknown" component health for components not yet wired. */
export function unknownHealth(detail?: string): ComponentHealth {
  return {
    status: "unknown",
    detail: detail ?? "Component not yet configured",
    lastChecked: new Date().toISOString(),
  };
}
