// ---------------------------------------------------------------------------
// Review receipts
// ---------------------------------------------------------------------------
// A journal line is plain JSONL, and anything running as the operator's user
// can append one. avg-qr4.3: a human approval has to carry proof of where it
// came from, or the review gate cannot tell a person's decision from a line an
// agent wrote with its file tools. The proof is an HMAC keyed by the operator
// key — a file the browser and CLI hold and Pi is never given.
//
// What this does NOT defend against: a same-user process that deliberately
// reads the key file. That boundary is avg-qr4.8's OS isolation.
// ---------------------------------------------------------------------------

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** The fields a signature covers: everything that says what was decided about what. */
export const SIGNED_FIELDS = Object.freeze(["stageId", "decision", "origin", "binding", "at"]);

/** JSON with object keys sorted at every depth, so equal values hash equally. */
export function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = sortKeys(value[key]);
    }
    return out;
  }
  return value;
}

/** Hash of a stage's resolved definition: what the approval was an approval OF. */
export function planHashOf(definition) {
  return createHash("sha256").update(canonicalJson(definition)).digest("hex");
}

function mac(review, key) {
  const body = {};
  for (const field of SIGNED_FIELDS) body[field] = review[field];
  return createHmac("sha256", key).update(canonicalJson(body)).digest("hex");
}

export function signReceipt(review, key) {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("Cannot sign a receipt without an operator key");
  }
  return { ...review, signature: mac(review, key) };
}

export function verifyReceipt(review, key) {
  if (typeof review?.signature !== "string" || typeof key !== "string" || key.length === 0) return false;
  const expected = Buffer.from(mac(review, key), "hex");
  const actual = Buffer.from(review.signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
