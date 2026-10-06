// ---------------------------------------------------------------------------
// Output profiles (avg-tk7.4)
// ---------------------------------------------------------------------------
// What a rendered episode is: its size, the safe zone kits keep their text and
// graphics in, and the loudness the finished file is normalised to. The
// catalog is data (output-profiles.json) so packages' tests can read it by
// path; a timeline carries a whole copy of its profile, so a delivered episode
// re-renders as it was even if the catalog changes later.
// ---------------------------------------------------------------------------

import catalog from "./output-profiles.json" with { type: "json" };

const deepFreeze = (value) => {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

/** Every profile a series can choose. */
export const OUTPUT_PROFILES = deepFreeze(structuredClone(catalog));

/** The catalog profile with this id, or undefined. */
export function outputProfile(id) {
  return OUTPUT_PROFILES.find((p) => p.id === id);
}

/**
 * Rules a profile must keep beyond its shape: the safe zone must leave a
 * usable area.
 * @param {object} profile a profile of the shape the schemas describe
 * @param {string} [base] the JSON path of the profile, for the problems' paths
 * @returns {{code: string, message: string, path: string}[]}
 */
export function validateOutputProfile(profile, base = "$") {
  const { width, height, safeZone: z } = profile;
  const out = [];
  if (z.top + z.bottom >= height) {
    out.push({
      code: "profile-safe-zone",
      path: `${base}.safeZone`,
      message: `profile "${profile.id}": safe zone top ${z.top} + bottom ${z.bottom} leaves nothing of height ${height}`,
    });
  }
  if (z.left + z.right >= width) {
    out.push({
      code: "profile-safe-zone",
      path: `${base}.safeZone`,
      message: `profile "${profile.id}": safe zone left ${z.left} + right ${z.right} leaves nothing of width ${width}`,
    });
  }
  return out;
}
