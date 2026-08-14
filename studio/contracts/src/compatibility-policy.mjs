const RULES = Object.freeze({
  documentation: {
    classification: "patch",
    minimumPackageBump: "patch",
    apiVersionChange: false,
    migrationRequired: false,
  },
  "new-kind": {
    classification: "additive",
    minimumPackageBump: "minor",
    apiVersionChange: false,
    migrationRequired: false,
  },
  "namespaced-extension": {
    classification: "compatible-data",
    minimumPackageBump: "none",
    apiVersionChange: false,
    migrationRequired: false,
  },
  "open-vocabulary-value": {
    classification: "compatible-data",
    minimumPackageBump: "none",
    apiVersionChange: false,
    migrationRequired: false,
  },
  "closed-record-field-addition": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "field-removal": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "field-rename": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "required-field-addition": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "field-type-change": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "closed-enum-change": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
  "unit-or-semantics-change": {
    classification: "breaking",
    minimumPackageBump: "major",
    apiVersionChange: true,
    migrationRequired: true,
  },
});

export function classifyCompatibilityChange(change) {
  const rule = RULES[change];
  if (!rule) throw new Error(`Unknown compatibility change type: ${change}`);
  return { ...rule };
}

export function validateCompatibilityCase(testCase) {
  if (!testCase || typeof testCase !== "object") throw new TypeError("Case must be an object");
  if (typeof testCase.name !== "string" || testCase.name.length === 0) throw new TypeError("Case requires name");
  const actual = classifyCompatibilityChange(testCase.change);
  const mismatches = Object.entries(actual)
    .filter(([key, value]) => testCase.expected?.[key] !== value)
    .map(([key, value]) => `${key}: expected ${JSON.stringify(testCase.expected?.[key])}, policy requires ${JSON.stringify(value)}`);

  if (actual.apiVersionChange) {
    const before = testCase.before?.apiVersion;
    const after = testCase.after?.apiVersion;
    if (!before || !after || before === after) {
      mismatches.push("breaking case must demonstrate a changed apiVersion");
    }
  }

  return { valid: mismatches.length === 0, actual, mismatches };
}

export const compatibilityRules = RULES;
