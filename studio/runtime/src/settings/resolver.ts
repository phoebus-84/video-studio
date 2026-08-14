import type {
  SettingsLayer,
  LayerName,
  ResolvedSettings,
  ResolvedValue,
  ResolutionReport,
} from "./types.js";
import { SYSTEM_DEFAULTS } from "./defaults.js";

/* ── public API ── */

/**
 * Merge settings layers using the inheritance chain:
 * system → channel → series → episode.
 *
 * Each layer can override values or pass `null` to reset
 * a key back to the system default.  `undefined` means "keep
 * whatever the parent layer resolved."
 */
export function resolveSettings(layers: {
  channel?: SettingsLayer | null;
  series?: SettingsLayer | null;
  episode?: SettingsLayer | null;
}): { settings: ResolvedSettings; report: ResolutionReport } {
  const report: ResolutionReport = {
    overrides: [],
    warnings: [],
    hasResets: false,
  };

  let effective = fromDefaults();

  const stack: [LayerName, SettingsLayer | null | undefined][] = [
    ["channel", layers.channel],
    ["series", layers.series],
    ["episode", layers.episode],
  ];

  for (const [source, layer] of stack) {
    if (!layer) continue;
    effective = applyLayer(layer, source, effective, report);
  }

  return { settings: effective, report };
}

/* ── internals ── */

function fromDefaults(): ResolvedSettings {
  return {
    approvalPolicy: {
      value: SYSTEM_DEFAULTS.approvalPolicy as ApprovalPolicy,
      source: "system" as const,
    },
    budget: {
      value: SYSTEM_DEFAULTS.budget as BudgetEnvelope,
      source: "system" as const,
    },
    outputProfile: {
      value: SYSTEM_DEFAULTS.outputProfile as OutputProfileRef,
      source: "system" as const,
    },
    locale: {
      value: SYSTEM_DEFAULTS.locale as string,
      source: "system" as const,
    },
    extensions: {
      value: (SYSTEM_DEFAULTS.extensions ?? {}) as Record<string, unknown>,
      source: "system" as const,
    },
  };
}

/* eslint-disable @typescript-eslint/consistent-type-imports */
type ApprovalPolicy = import("./types.js").ApprovalPolicy;
type BudgetEnvelope = import("./types.js").BudgetEnvelope;
type OutputProfileRef = import("./types.js").OutputProfileRef;

function applyLayer(
  incoming: SettingsLayer,
  source: LayerName,
  base: ResolvedSettings,
  report: ResolutionReport,
): ResolvedSettings {
  return {
    approvalPolicy: applyField(
      "approvalPolicy",
      incoming.approvalPolicy,
      source,
      base.approvalPolicy,
      SYSTEM_DEFAULTS.approvalPolicy as ApprovalPolicy,
      report,
    ),
    budget: applyField(
      "budget",
      incoming.budget,
      source,
      base.budget,
      SYSTEM_DEFAULTS.budget as BudgetEnvelope,
      report,
    ),
    outputProfile: applyField(
      "outputProfile",
      incoming.outputProfile,
      source,
      base.outputProfile,
      SYSTEM_DEFAULTS.outputProfile as OutputProfileRef,
      report,
    ),
    locale: applyField(
      "locale",
      incoming.locale,
      source,
      base.locale,
      SYSTEM_DEFAULTS.locale as string,
      report,
    ),
    extensions: applyField(
      "extensions",
      incoming.extensions,
      source,
      base.extensions,
      (SYSTEM_DEFAULTS.extensions ?? {}) as Record<string, unknown>,
      report,
    ),
  };
}

function applyField<T>(
  key: string,
  incoming: T | null | undefined,
  source: LayerName,
  base: ResolvedValue<T>,
  systemDefault: T,
  report: ResolutionReport,
): ResolvedValue<T> {
  if (incoming === null) {
    report.hasResets = true;
    return { value: systemDefault, source: "system" };
  }

  if (incoming === undefined) {
    return base;
  }

  if (source !== "system") {
    report.overrides.push({ key, value: incoming, source });
  }

  return { value: incoming, source };
}
