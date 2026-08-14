// ── Snapshot test harness ──
// Provides deterministic snapshot comparison for SVG output.
// Snapshots are stored as .svg files alongside test files.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeContentHash } from '../../src/hashing/content-hash.js';

export interface SnapshotResult {
  /** Whether the actual output matches the stored snapshot */
  matches: boolean;
  /** Path to the snapshot file */
  snapshotPath: string;
  /** Content hash of the actual output */
  actualHash: string;
  /** Content hash of the stored snapshot (empty string if none) */
  snapshotHash: string;
  /** The actual SVG content */
  actualContent: string;
  /** The stored snapshot content (empty string if none) */
  snapshotContent: string;
}

export interface SnapshotOptions {
  /** Directory for snapshot files (default: test file directory) */
  snapshotDir?: string;
  /** If true, update snapshots instead of comparing (default: false) */
  update?: boolean;
}

/**
 * Compare actual SVG output against a named snapshot.
 *
 * On first run, writes the snapshot and reports a match.
 * On subsequent runs, compares content hashes.
 *
 * @param testFileUrl - `import.meta.url` of the calling test file
 * @param snapshotName - Unique name for this snapshot within the test file
 * @param actualSvg - The actual SVG output to compare
 * @param options - Snapshot configuration
 */
export function assertSnapshot(
  testFileUrl: string,
  snapshotName: string,
  actualSvg: string,
  options: SnapshotOptions = {},
): SnapshotResult {
  const testFilePath = path.dirname(fileURLToPath(testFileUrl));
  const snapDir = options.snapshotDir ?? path.join(testFilePath, '__snapshots__');
  const safeName = snapshotName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapshotPath = path.join(snapDir, `${safeName}.svg`);

  const actualHash = computeContentHash(actualSvg);

  // Ensure snapshot directory exists
  fs.mkdirSync(snapDir, { recursive: true });

  let snapshotContent = '';
  let snapshotHash = '';

  if (fs.existsSync(snapshotPath)) {
    snapshotContent = fs.readFileSync(snapshotPath, 'utf8');
    snapshotHash = computeContentHash(snapshotContent);
  }

  if (options.update || !fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, actualSvg, 'utf8');
    return {
      matches: true,
      snapshotPath,
      actualHash,
      snapshotHash: actualHash,
      actualContent: actualSvg,
      snapshotContent: actualSvg,
    };
  }

  return {
    matches: actualHash === snapshotHash,
    snapshotPath,
    actualHash,
    snapshotHash,
    actualContent: actualSvg,
    snapshotContent,
  };
}

/**
 * Write snapshot directly (bypass comparison).
 */
export function writeSnapshot(
  testFileUrl: string,
  snapshotName: string,
  svg: string,
  options: SnapshotOptions = {},
): string {
  const testFilePath = path.dirname(fileURLToPath(testFileUrl));
  const snapDir = options.snapshotDir ?? path.join(testFilePath, '__snapshots__');
  const safeName = snapshotName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const snapshotPath = path.join(snapDir, `${safeName}.svg`);
  fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(snapshotPath, svg, 'utf8');
  return snapshotPath;
}

// ── Helpers ──

function fileURLToPath(url: string): string {
  // Node.js 20+ supports import.meta.url → path conversion
  if (url.startsWith('file://')) {
    return url.slice('file://'.length);
  }
  return url;
}
