// ---------------------------------------------------------------------------
// Workspace module – public API
// ---------------------------------------------------------------------------

// Types
export type {
  WorkspaceKind,
  WorkspaceDescriptor,
  WorkspaceMeta,
} from "./types.js";
export { WORKSPACE_DIR, CONTRACT_FILE, METADATA_FILE } from "./types.js";

// Slugs
export { validateSlug, SLUG_MAX_LENGTH } from "./slugs.js";

// Path guard
export {
  guardPath,
  guardWritePath,
  validateRootPath,
  resolveGuardedPath,
} from "./path-guard.js";

// Contracts (adapter boundary)
export type {
  WorkspaceContract,
  ContractValidationResult,
  ContractValidator,
} from "./contracts.js";
export {
  DEFAULT_CONTRACT_SCHEMA,
  DEFAULT_CONTRACT_VERSION,
  createContract,
  validateContractStructure,
  parseContractJson,
  serialiseContract,
} from "./contracts.js";

// Init
export type { InitOptions, InitResult } from "./init.js";
export {
  initChannel,
  initSeries,
  initEpisode,
  ensureDefaultChannel,
  DEFAULT_CHANNEL_SLUG,
} from "./init.js";

// Discovery
export type {
  DiscoveryResult,
  DiscoveryDiagnostic,
  DiscoveryDiagnosticCode,
} from "./discover.js";
export {
  discoverChannels,
  discoverSeries,
  discoverEpisodes,
} from "./discover.js";
