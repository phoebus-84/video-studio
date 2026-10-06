// Type declarations for output profiles (avg-tk7.4). Self-contained so runtime
// packages can use them; the timeline's copy of a profile has the same shape
// (schemas/v1alpha2/edit-timeline.schema.json, $defs/OutputProfile).

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LoudnessTarget {
  /** Integrated loudness, LUFS. */
  integrated: number;
  /** True peak, dBTP. */
  truePeak: number;
  /** Loudness range, LU. */
  range: number;
}

export interface OutputProfile {
  id: string;
  width: number;
  height: number;
  /** Pixels inset from each edge where kits keep text and graphics. */
  safeZone: SafeZone;
  loudness: LoudnessTarget;
}

export interface OutputProfileProblem {
  code: "profile-safe-zone";
  message: string;
  path: string;
}

export declare const OUTPUT_PROFILES: readonly OutputProfile[];
export declare function outputProfile(id: string): OutputProfile | undefined;
export declare function validateOutputProfile(profile: OutputProfile, base?: string): OutputProfileProblem[];
