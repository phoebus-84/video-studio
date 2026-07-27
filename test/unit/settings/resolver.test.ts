import { expect, test } from "vitest";
import { resolveSettings } from "../../../src/settings/index.js";
import type { SettingsLayer } from "../../../src/settings/index.js";

test("system defaults resolve when no layers provided", () => {
  const { settings, report } = resolveSettings({});
  expect(settings.approvalPolicy.source).toBe("system");
  expect(settings.approvalPolicy.value.mode).toBe("autopilot");
  expect(settings.budget.value.currency).toBe("USD");
  expect(settings.locale.value).toBe("en-US");
  expect(report.overrides).toEqual([]);
});

test("channel layer overrides system", () => {
  const channel: SettingsLayer = {
    approvalPolicy: {
      mode: "manual",
      onPaidAction: "pause",
      onBudgetExceeded: "block",
      onMaterialDowngrade: "block",
      onCapabilityUnavailable: "block",
      onValidationFailure: "block",
      onConflict: "block",
      onLicenseOrSafetyBlocker: "block",
    },
    budget: null,
    outputProfile: null,
    locale: "de-DE",
    extensions: null,
  };

  const { settings, report } = resolveSettings({ channel });

  expect(settings.approvalPolicy.value.mode).toBe("manual");
  expect(settings.approvalPolicy.source).toBe("channel");
  expect(settings.locale.value).toBe("de-DE");
  expect(settings.locale.source).toBe("channel");
  /* budget was null = reset to system default. */
  expect(settings.budget.source).toBe("system");
  expect(settings.budget.value.currency).toBe("USD");
  expect(report.hasResets).toBe(true);
  expect(report.overrides).toHaveLength(2);
});

test("series overrides channel", () => {
  const channel: SettingsLayer = {
    approvalPolicy: null,
    budget: null,
    outputProfile: null,
    locale: "fr-FR",
    extensions: null,
  };
  const series: SettingsLayer = {
    approvalPolicy: null,
    budget: null,
    outputProfile: null,
    locale: "ja-JP",
    extensions: null,
  };

  const { settings } = resolveSettings({ channel, series });

  expect(settings.locale.value).toBe("ja-JP");
  expect(settings.locale.source).toBe("series");
});

test("episode overrides series and channel", () => {
  const channel: SettingsLayer = {
    approvalPolicy: null,
    budget: null,
    outputProfile: { profileId: "instagram-reel", version: "^1" },
    locale: null,
    extensions: null,
  };
  const episode: SettingsLayer = {
    approvalPolicy: null,
    budget: null,
    outputProfile: { profileId: "youtube-4k", version: "^1" },
    locale: null,
    extensions: null,
  };

  const { settings } = resolveSettings({ channel, episode });

  expect(settings.outputProfile.value.profileId).toBe("youtube-4k");
  expect(settings.outputProfile.source).toBe("episode");
});

test("resolution is deterministic", () => {
  const layer: SettingsLayer = {
    approvalPolicy: null,
    budget: { currency: "EUR", limitMicros: 10_000_000, warnAtMicros: 8_000_000, reservationRequired: true },
    outputProfile: null,
    locale: "it-IT",
    extensions: null,
  };

  const a = resolveSettings({ channel: layer });
  const b = resolveSettings({ channel: layer });

  expect(a.settings).toEqual(b.settings);
  expect(a.report).toEqual(b.report);
});

test("golden fixture: full chain", () => {
  const channel: SettingsLayer = {
    approvalPolicy: null,
    budget: { currency: "USD", limitMicros: 10_000_000, warnAtMicros: 8_000_000, reservationRequired: false },
    outputProfile: null,
    locale: null,
    extensions: null,
  };
  const series: SettingsLayer = {
    approvalPolicy: { mode: "guided", onPaidAction: "pause", onBudgetExceeded: "pause", onMaterialDowngrade: "pause", onCapabilityUnavailable: "pause", onValidationFailure: "pause", onConflict: "pause", onLicenseOrSafetyBlocker: "block" },
    budget: undefined,
    outputProfile: undefined,
    locale: "ko-KR",
    extensions: undefined,
  };
  const episode: SettingsLayer = {
    approvalPolicy: undefined,
    budget: undefined,
    outputProfile: { profileId: "youtube-1080p-hdr", version: "^1" },
    locale: undefined,
    extensions: undefined,
  };

  const { settings, report } = resolveSettings({ channel, series, episode });

  /* approval: series overrides system */
  expect(settings.approvalPolicy.value.mode).toBe("guided");
  expect(settings.approvalPolicy.source).toBe("series");

  /* budget: channel overrides system */
  expect(settings.budget.value.limitMicros).toBe(10_000_000);
  expect(settings.budget.source).toBe("channel");

  /* outputProfile: episode overrides system */
  expect(settings.outputProfile.value.profileId).toBe("youtube-1080p-hdr");
  expect(settings.outputProfile.source).toBe("episode");

  /* locale: series overrides system */
  expect(settings.locale.value).toBe("ko-KR");
  expect(settings.locale.source).toBe("series");

  /* report */
  expect(report.overrides).toHaveLength(4);
  expect(report.hasResets).toBe(true); /* channel has explicit null resets */

  /* Extensions should be system default (empty). */
  expect(settings.extensions.value).toEqual({});
  expect(settings.extensions.source).toBe("system");
});
