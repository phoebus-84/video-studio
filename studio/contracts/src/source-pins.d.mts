// Type declarations for channel sources and source pins (avg-7zp.5, ADR-0035).
// Self-contained so runtime packages (NodeNext, no .ts imports) can use them;
// they mirror schemas/v1alpha1/source-pin.schema.json, whose generated binding
// is bindings/ts/source-pin.ts.

export declare const PINS_DIR: "source/pins";

export type SourceRef =
  | { kind: "channel-source"; name: string }
  | { kind: "episode"; series: string; episode: string };

export interface InventoryEntry {
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface SourcePin {
  apiVersion: "studio.video/v1alpha1";
  kind: "SourcePin";
  id: string;
  source: SourceRef;
  paths?: string[];
  usedBy: string[];
  pinnedAt: string;
  files: Record<string, InventoryEntry>;
}

export interface SourcePinProblem {
  code: "schema";
  message: string;
  path: string;
}

export type PinChange = { path: string; change: "modified" | "added" | "removed" };

export declare function validateSourcePin(doc: unknown): SourcePinProblem[];
export declare function sourceDir(root: string, channel: string, source: SourceRef): string;
export declare function hashFile(file: string): Promise<string>;
/** Source-relative POSIX path → entry, sorted. Throws on a symlink. */
export declare function inventory(
  dir: string,
  paths?: string[],
  options?: { hash?: (file: string) => Promise<string> },
): Promise<Record<string, InventoryEntry>>;
/** Only files whose size or mtime moved are hashed. */
export declare function verifyPin(
  pin: SourcePin,
  dir: string,
  options?: { hash?: (file: string) => Promise<string> },
): Promise<{ changed: PinChange[] }>;
export declare function describeChanges(changed: PinChange[], limit?: number): string;
