/**
 * Settings types mirroring the video-workspace-contracts v1alpha1 schemas.
 *
 * Inheritance order: system defaults → channel → series → episode.
 * Lower layers override higher layers. Explicit `null` means "reset to
 * system default" (unset the channel/series/episode value).
 */

/* ── approval policy ── */

export type ApprovalMode = "autopilot" | "guided" | "manual";
export type GateBehaviour = "continue" | "pause" | "block";

export interface ApprovalPolicy {
  mode: ApprovalMode;
  onPaidAction: GateBehaviour;
  onBudgetExceeded: GateBehaviour;
  onMaterialDowngrade: GateBehaviour;
  onCapabilityUnavailable: GateBehaviour;
  onValidationFailure: GateBehaviour;
  onConflict: GateBehaviour;
  onLicenseOrSafetyBlocker: GateBehaviour;
}

/* ── budget ── */

export interface BudgetEnvelope {
  currency: string; /* ISO 4217 */
  limitMicros: number; /* micro-USD (1e-6 USD) */
  warnAtMicros: number;
  reservationRequired: boolean;
}

/* ── output profile ── */

export interface OutputProfileRef {
  profileId: string;
  /** Semantic version range, e.g. "^1" or "1.2.x". */
  version: string;
}

/* ── settings layer ── */

export interface SettingsLayer {
  approvalPolicy: ApprovalPolicy | null | undefined;
  budget: BudgetEnvelope | null | undefined;
  outputProfile: OutputProfileRef | null | undefined;
  locale: string | null | undefined; /* BCP 47, e.g. "en-US" */
  /** Arbitrary extension values keyed by namespace. */
  extensions: Record<string, unknown> | null | undefined;
}

/** Named layer used during resolution. */
export type LayerName = "system" | "channel" | "series" | "episode";

/** A resolved value with its provenance. */
export interface ResolvedValue<T> {
  value: T;
  source: LayerName;
}

/** Fully resolved settings. */
export interface ResolvedSettings {
  approvalPolicy: ResolvedValue<ApprovalPolicy>;
  budget: ResolvedValue<BudgetEnvelope>;
  outputProfile: ResolvedValue<OutputProfileRef>;
  locale: ResolvedValue<string>;
  extensions: ResolvedValue<Record<string, unknown>>;
}

/** Report produced alongside resolved settings. */
export interface ResolutionReport {
  /** List of non-default overrides. */
  overrides: ResolutionEntry[];
  /** Warnings about deprecated or unrecognised keys. */
  warnings: ResolutionWarning[];
  /** Whether any layer had an unset (null) that reverted to default. */
  hasResets: boolean;
}

export interface ResolutionEntry {
  key: string;
  value: unknown;
  source: LayerName;
}

export interface ResolutionWarning {
  key: string;
  message: string;
  source: LayerName;
}
