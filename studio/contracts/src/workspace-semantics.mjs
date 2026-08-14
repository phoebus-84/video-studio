const POLICY_ACTION_FIELDS = Object.freeze([
  "onPaidAction",
  "onBudgetExceeded",
  "onMaterialDowngrade",
  "onCapabilityUnavailable",
  "onValidationFailure",
  "onConflict",
  "onLicenseOrSafetyBlocker",
]);

/**
 * Validate relationships and numeric invariants that JSON Schema cannot
 * express across workspace documents. The runtime calls equivalent logic at
 * its filesystem trust boundary; this module keeps contract fixtures honest.
 */
export function validateWorkspaceSemantics(workspace) {
  const errors = [];
  const add = (path, code, message) => errors.push({ path, code, message });
  const { channel, channelSettings, series, seriesSettings, episode, sourceSnapshot, currentDeliverable } = workspace ?? {};

  if (series?.channelId !== channel?.channelId) {
    add("/series/channelId", "workspace.channel-mismatch", "Series channelId must identify the containing channel");
  }
  if (episode?.seriesId !== series?.seriesId) {
    add("/episode/seriesId", "workspace.series-mismatch", "Episode seriesId must identify the containing series");
  }
  if (channelSettings?.channelId !== channel?.channelId) {
    add("/channelSettings/channelId", "workspace.channel-settings-mismatch", "Channel settings must identify the containing channel");
  }
  if (seriesSettings?.seriesId !== series?.seriesId) {
    add("/seriesSettings/seriesId", "workspace.series-settings-mismatch", "Series settings must identify the containing series");
  }
  if (currentDeliverable?.episodeId !== undefined && currentDeliverable.episodeId !== episode?.episodeId) {
    add("/currentDeliverable/episodeId", "workspace.deliverable-episode-mismatch", "Current deliverable must point to its containing episode");
  }

  const settingsByScope = {
    channelSettings: channelSettings?.values,
    seriesSettings: seriesSettings?.values,
    episode: episode?.settings,
  };
  for (const [scope, settings] of Object.entries(settingsByScope)) {
    const policy = settings?.approvalPolicy;
    const budget = settings?.budget;
    for (const field of POLICY_ACTION_FIELDS) {
      if (policy?.[field] === undefined) {
        add(`/${scope}/approvalPolicy/${field}`, "policy.implicit-action", "Every policy decision must be explicit");
      }
    }
    for (const blockingField of ["onBudgetExceeded", "onMaterialDowngrade", "onCapabilityUnavailable", "onValidationFailure", "onConflict", "onLicenseOrSafetyBlocker"]) {
      if (policy?.[blockingField] !== undefined && policy[blockingField] !== "requireApproval") {
        add(`/${scope}/approvalPolicy/${blockingField}`, "policy.blocker-must-pause", `${blockingField} must require approval`);
      }
    }
    if (Number.isInteger(budget?.warnAtMicros) && Number.isInteger(budget?.limitMicros) && budget.warnAtMicros > budget.limitMicros) {
      add(`/${scope}/budget/warnAtMicros`, "budget.warning-exceeds-limit", "warnAtMicros must not exceed limitMicros");
    }
  }

  const sourceId = sourceSnapshot?.artifactId;
  for (const [index, reference] of (episode?.sourceSnapshotRefs ?? []).entries()) {
    if (reference.id !== sourceId) {
      add(`/episode/sourceSnapshotRefs/${index}/id`, "workspace.source-reference-mismatch", "Fixture source reference must identify the pinned snapshot");
    }
  }

  return errors;
}

export const policyActionFields = POLICY_ACTION_FIELDS;
