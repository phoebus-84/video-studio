import type { SettingsLayer } from "./types.js";

/** System-wide defaults applied before channel/series/episode layers. */
export const SYSTEM_DEFAULTS: SettingsLayer = {
  approvalPolicy: {
    mode: "autopilot",
    onPaidAction: "continue",
    onBudgetExceeded: "block",
    onMaterialDowngrade: "pause",
    onCapabilityUnavailable: "pause",
    onValidationFailure: "pause",
    onConflict: "pause",
    onLicenseOrSafetyBlocker: "block",
  },
  budget: {
    currency: "USD",
    limitMicros: 5_000_000, /* $5.00 */
    warnAtMicros: 4_000_000, /* $4.00 */
    reservationRequired: false,
  },
  outputProfile: {
    profileId: "youtube-1080p",
    version: "^1",
  },
  locale: "en-US",
  extensions: {},
};
