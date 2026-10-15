// ---------------------------------------------------------------------------
// The operator key
// ---------------------------------------------------------------------------
// Whoever can read this file is the operator (avg-qr4.3). The gateway
// generates it next to its bearer token; the CLI reads it; Pi is handed the
// agent token only. Absence is a headless caller, not an error — the caller
// may still REQUEST approval. A key other users can read is refused outright,
// the same rule the gateway applies to its token.
// ---------------------------------------------------------------------------

import { readFileSync, statSync } from "node:fs";

export const OPERATOR_KEY_ENV = "AVG_OPERATOR_KEY_FILE";

/**
 * Set by the gateway in Pi's environment; the CLI then resolves as an agent
 * without reading the key (avg-qr4.3 final review). A guard against Pi's
 * shell becoming the operator by accident, not against a process that
 * unsets it — that boundary is avg-qr4.8.
 */
export const HEADLESS_ENV = "AVG_HEADLESS";

export function readOperatorKey(file) {
  let info;
  try {
    info = statSync(file);
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(
      `Operator key "${file}" is readable by other users (mode ${(info.mode & 0o777).toString(8)}); ` +
      `it must be 0600. Run: chmod 600 "${file}"`,
    );
  }
  const key = readFileSync(file, "utf-8").trim();
  if (!key) throw new Error(`Operator key "${file}" is empty. Delete it and restart the gateway to regenerate it.`);
  return key;
}
