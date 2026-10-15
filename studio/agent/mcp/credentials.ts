// ---------------------------------------------------------------------------
// Provider credentials for the extension when Pi is not the host
// ---------------------------------------------------------------------------
// Under Pi, ctx.modelRegistry is Pi's own registry: the login the user did
// with /login, refreshed by Pi. Two tools read it, for the OpenAI Codex
// subscription token that @av/codex-image generates images with.
//
// Outside Pi the same question gets answered from, in order:
//   1. AVG_CODEX_TOKEN, when set (openai-codex only);
//   2. Pi's credential store, through Pi's own ModelRuntime, when Pi is
//      installed — the same login, refreshed the same way;
//   3. the Codex CLI's login (`codex login`), in $CODEX_HOME/auth.json or
//      ~/.codex/auth.json (openai-codex only), while its token is unexpired.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelRegistryLike } from "./host.js";

export const CODEX_PROVIDER = "openai-codex";

type Env = Record<string, string | undefined>;

/** Seconds since the epoch at which a JWT expires, or null when it says nothing. */
export function jwtExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as { exp?: unknown };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/** The Codex CLI's access token, if it is logged in with a ChatGPT plan and the token is current. */
export function codexCliToken(env: Env = process.env, now: number = Date.now()): string | undefined {
  const home = env.CODEX_HOME ?? join(env.HOME ?? homedir(), ".codex");
  let raw: string;
  try {
    raw = readFileSync(join(home, "auth.json"), "utf-8");
  } catch {
    return undefined;
  }
  try {
    const auth = JSON.parse(raw) as { tokens?: { access_token?: unknown } };
    const token = auth.tokens?.access_token;
    if (typeof token !== "string" || !token) return undefined;
    const exp = jwtExpiry(token);
    if (exp !== null && exp * 1000 <= now) return undefined;
    return token;
  } catch {
    return undefined;
  }
}

/** Pi's registry, built the way Pi builds it, or null when Pi is not installed. */
async function loadPiRegistry(): Promise<ModelRegistryLike | null> {
  try {
    const pi = (await import("@earendil-works/pi-coding-agent")) as unknown as {
      ModelRuntime?: { create(): Promise<unknown> };
      ModelRegistry?: new (runtime: unknown) => ModelRegistryLike;
    };
    if (!pi.ModelRuntime || !pi.ModelRegistry) return null;
    return new pi.ModelRegistry(await pi.ModelRuntime.create());
  } catch {
    return null;
  }
}

export interface CredentialSources {
  env?: Env;
  piRegistry?: () => Promise<ModelRegistryLike | null>;
  codexCli?: (env: Env) => string | undefined;
}

export function createModelRegistry(sources: CredentialSources = {}): ModelRegistryLike {
  const env = sources.env ?? process.env;
  const piRegistry = sources.piRegistry ?? loadPiRegistry;
  const codexCli = sources.codexCli ?? ((e: Env) => codexCliToken(e));
  let pi: Promise<ModelRegistryLike | null> | null = null;

  return {
    async getApiKeyForProvider(provider: string) {
      if (provider === CODEX_PROVIDER && env.AVG_CODEX_TOKEN) return env.AVG_CODEX_TOKEN;

      pi ??= piRegistry();
      const registry = await pi;
      if (registry) {
        try {
          const key = await registry.getApiKeyForProvider(provider);
          if (key) return key;
        } catch {
          // A broken Pi store is not a reason to ignore the other logins.
        }
      }

      if (provider === CODEX_PROVIDER) return codexCli(env);
      return undefined;
    },
  };
}
