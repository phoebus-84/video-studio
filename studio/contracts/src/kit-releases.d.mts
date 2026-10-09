export declare const KIT_RELEASE_FILE: "kit.json";
export declare const KIT_SOURCE: "kit/index.tsx";
export declare const KIT_BUNDLE: "kit.cjs";
export interface KitRelease {
  apiVersion: "studio.video/v1alpha1";
  kind: "KitRelease";
  name: string;
  version: string;
  bundle: { path: "kit.cjs"; hash: string };
}
export declare function kitReleasePath(root: string, channel: string, series: string | null, name: string, version: string): string;
export declare function validateKitRelease(doc: unknown): { code: string; path: string; message: string }[];
