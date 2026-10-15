// ─── Public API surface ───────────────────────────────────────────────
// Everything a consumer is expected to import from this package.

// Types
export type {
  EndpointBinding,
  GenerationInput,
  GenerationResult,
  JobStatus,
  OutputAsset,
  CostBreakdown,
  Transport,
  HttpRequest,
  HttpResponse,
  Clock,
  Sleeper,
  Downloader,
  DownloadResult,
  FalAdapterConfig,
  // Profile types
  EndpointProfile,
  ParameterField,
  EndpointCapabilities,
  PricingMetadata,
  DeprecationInfo,
  ProfileOperation,
} from "./types.js";

// Errors
export {
  FalAdapterError,
  FalUnavailableError,
  FalHttpError,
  FalNetworkError,
  FalCancelledError,
  FalTimeoutError,
  FalContractError,
  FalValidationError,
  FalDeprecatedProfileError,
  FalDownloadError,
} from "./errors.js";

// Configuration
export { resolveConfig, requireConfig, redactKey } from "./config.js";

// Logger
export { createLogger, redactRecord, redactHeaders } from "./logger.js";
export type { Logger, LogEntry, LogLevel } from "./logger.js";

// Transport
export { FetchTransport } from "./transport.js";

// Clock
export { SystemClock, ManualClock } from "./clock.js";

// Sleeper
export { SystemSleeper, NoopSleeper } from "./sleeper.js";

// Downloader
export { HttpDownloader } from "./downloader.js";

// Contracts
export type { EndpointContract } from "./contracts/v1.js";
export { createFalServer } from "./server.js";
export type { FalServerHandle } from "./server.js";
export { V1BaseContract, ProfileContract } from "./contracts/v1.js";

// Profiles
export {
  getProfile,
  listProfiles,
  computeSchemaFingerprint,
  validateParameters,
  requireValidParameters,
  deprecationDiagnostic,
  fluxDevV1,
  fluxFillV1,
  wan22TurboImageToVideo,
  WAN_22_TURBO_PRICES_USD,
} from "./profiles.js";

// Client
export { FalClientImpl, createFalClient } from "./client.js";
export type { FalClient } from "./client.js";
