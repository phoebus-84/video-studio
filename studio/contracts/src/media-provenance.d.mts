export declare const PROVENANCE_SUFFIX: ".source.json";
export declare const EVIDENCE_DIR: "artifacts/provenance";
export declare const ATTRIBUTIONS_FILE: "ATTRIBUTIONS.md";
export interface MediaProvenance {
  apiVersion: "studio.video/v1alpha1";
  kind: "MediaProvenance";
  file: { path: string; hash: string; bytes: number; mime: string; width?: number; height?: number; durationSeconds?: number };
  provider: { id: string; label: string };
  item: { id: string; title: string; creator?: string; date?: string; institution?: string; landingUrl: string; fileUrl: string; rendition?: string };
  licence: { id: string; basis?: string; url?: string; attributionRequired: boolean; statement: string };
  attribution: string;
  retrievedAt: string;
  evidence: { path: string; hash: string };
}
export declare function validateMediaProvenance(doc: unknown): { code: string; path: string; message: string }[];
export declare function renderAttributions(records: MediaProvenance[]): string;
