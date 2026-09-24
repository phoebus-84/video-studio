// ---------------------------------------------------------------------------
// Who the CLI is
// ---------------------------------------------------------------------------
// The CLI has no bearer token to present; what it has is the filesystem. A
// caller that can read the operator key is the operator (avg-qr4.3). One that
// cannot is headless: it may request approval but not grant it.
// ---------------------------------------------------------------------------

import { fileURLToPath } from "node:url";
import * as path from "node:path";
import { readOperatorKey, OPERATOR_KEY_ENV } from "@studio/contracts/src/operator-key.mjs";
import type { Principal } from "./types.js";

/** Where the gateway writes the key: studio/gateway/.operator-key. */
export function defaultOperatorKeyPath(): string {
  // dist/src/execution/principal.js or src/execution/principal.ts → studio/runtime
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = here.includes(`${path.sep}dist${path.sep}`)
    ? path.resolve(here, "..", "..", "..")
    : path.resolve(here, "..", "..");
  return path.resolve(runtimeRoot, "..", "gateway", ".operator-key");
}

export function resolveCliCredential(
  env: NodeJS.ProcessEnv = process.env,
): { principal: Principal; operatorKey: string | null } {
  const operatorKey = readOperatorKey(env[OPERATOR_KEY_ENV] || defaultOperatorKeyPath());
  return operatorKey ? { principal: "operator", operatorKey } : { principal: "agent", operatorKey: null };
}
