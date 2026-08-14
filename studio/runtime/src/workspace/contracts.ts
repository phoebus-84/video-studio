// ---------------------------------------------------------------------------
// Contract adapter boundary
//
// This module defines the contract document format used by workspace
// scaffolding and discovery.  Contract schema ownership lives in
// `video-workspace-contracts`; this runtime treats contract documents as
// opaque, schema-versioned inputs and performs only structural validation.
//
// When the contracts module is wired at the process boundary, a
// `ContractValidator` implementation can be injected for full schema
// validation.
// ---------------------------------------------------------------------------

import type { WorkspaceKind } from "./types.js";

// ---- Contract document type ------------------------------------------------

/**
 * A workspace contract document stored in `.workspace/contract.json`.
 *
 * The `schema` field references a schema owned by video-workspace-contracts.
 * The runtime consumes `type` and `version` to validate workspace structure
 * but does not own the schema definition.
 */
export interface WorkspaceContract {
  /** Schema identifier (e.g. "video-workspace-contracts/workspace-v1"). */
  schema: string;
  /** Schema version string (e.g. "0.1.0"). */
  version: string;
  /** Workspace kind: "channel", "series", or "episode". */
  type: WorkspaceKind;
  /** ISO-8601 timestamp of initial creation. */
  createdAt: string;
  /** ISO-8601 timestamp of last contract update. */
  updatedAt: string;
}

// ---- Validation ------------------------------------------------------------

/**
 * Result of contract validation at the adapter boundary.
 */
export interface ContractValidationResult {
  /** Whether the contract is structurally valid. */
  valid: boolean;
  /** Parsed contract (populated when `valid` is true). */
  contract?: WorkspaceContract;
  /** Human- and machine-readable diagnostics for invalid documents. */
  diagnostics: string[];
}

/**
 * Adapter interface for cross-module schema validation.
 *
 * The runtime performs structural checks (required fields, correct types).
 * Full JSON Schema / contract validation is deferred to the contracts
 * module via this interface.  Wire a concrete `ContractValidator` at the
 * process boundary when `video-workspace-contracts` is available.
 */
export interface ContractValidator {
  /**
   * Validate a parsed contract document against the schema referenced by
   * its `schema` and `version` fields.
   *
   * The runtime guarantees that `raw` has already passed structural checks.
   */
  validate(contract: WorkspaceContract): ContractValidationResult;
}

// ---- Canonical constants ---------------------------------------------------

/**
 * Current contract schema identifier.
 *
 * Matches the schema exported by `video-workspace-contracts` for workspace
 * documents.  Kept in sync by convention.
 */
export const DEFAULT_CONTRACT_SCHEMA = "video-workspace-contracts/workspace-v1";

/** Current contract schema version. */
export const DEFAULT_CONTRACT_VERSION = "0.1.0";

// ---- Factory ---------------------------------------------------------------

/**
 * Create a fresh contract document for a new workspace.
 */
export function createContract(
  type: WorkspaceKind,
  now: string,
): WorkspaceContract {
  return {
    schema: DEFAULT_CONTRACT_SCHEMA,
    version: DEFAULT_CONTRACT_VERSION,
    type,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Structural (pre-schema) validation of a contract document.
 *
 * Checks that the parsed JSON has the required fields with correct types.
 * This is the minimal guard applied by the runtime before deferring to
 * the contracts module.
 */
export function validateContractStructure(
  raw: unknown,
): ContractValidationResult {
  const diagnostics: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== "object") {
    return { valid: false, diagnostics: ["contract must be a JSON object"] };
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.schema !== "string") {
    diagnostics.push("contract.schema must be a string");
  }
  if (typeof obj.version !== "string") {
    diagnostics.push("contract.version must be a string");
  }
  if (typeof obj.type !== "string") {
    diagnostics.push("contract.type must be a string");
  } else {
    const validTypes = ["channel", "series", "episode"];
    if (!validTypes.includes(obj.type)) {
      diagnostics.push(
        `contract.type must be one of: ${validTypes.join(", ")}`,
      );
    }
  }
  if (typeof obj.createdAt !== "string") {
    diagnostics.push("contract.createdAt must be a string");
  }
  if (typeof obj.updatedAt !== "string") {
    diagnostics.push("contract.updatedAt must be a string");
  }

  if (diagnostics.length > 0) {
    return { valid: false, diagnostics };
  }

  return {
    valid: true,
    contract: obj as unknown as WorkspaceContract,
    diagnostics: [],
  };
}

// ---- JSON helpers ----------------------------------------------------------

/**
 * Parse a JSON string into an unknown value.
 *
 * Returns diagnostics on parse failure so callers receive an actionable
 * error rather than a silent null.
 */
export function parseContractJson(
  raw: string,
): { value: unknown } | { parseError: string } {
  try {
    return { value: JSON.parse(raw) };
  } catch (e) {
    return {
      parseError: `Invalid JSON in contract document: ${String(e)}`,
    };
  }
}

/**
 * Serialise a contract document to indented JSON.
 */
export function serialiseContract(contract: WorkspaceContract): string {
  return JSON.stringify(contract, null, 2) + "\n";
}
