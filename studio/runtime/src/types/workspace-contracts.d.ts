declare module "@video-studio/workspace-contracts/src/vocabulary.mjs" {
  export const CAPABILITIES: readonly string[];
  export const ARTIFACT_KINDS: readonly string[];
  export function isCapability(name: string): boolean;
  export function isArtifactKind(kind: string): boolean;
}
