// ---------------------------------------------------------------------------
// Keeping candidates and putting a take in place (avg-qr4.6)
// ---------------------------------------------------------------------------
// Performers write canonical paths — `artifacts/script.md`, `output/output.mp4`
// — and nothing kept what they replaced. The service now copies an accepted
// attempt's files into `attempts/<stageId>/<attemptNumber>/` before recording
// it, and selecting a take copies them back. The journal says which take is
// selected; this module only moves bytes and says whether they are intact.
//
// Every path here comes from a performer or from the journal, so every one is
// checked to stay inside the episode before it is read or written.
// ---------------------------------------------------------------------------

import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, constants } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import * as path from "node:path";
import { candidatePath } from "@studio/contracts/src/takes.mjs";
import type { ArtifactHash } from "@studio/contracts/src/gate-review.mjs";

/** The absolute path of `relative`, or a throw if it is not inside the episode. */
function inside(episodeDir: string, relative: string): string {
  if (path.isAbsolute(relative) || path.normalize(relative).split(/[\\/]/).includes("..")) {
    throw new Error(`"${relative}" is not a path inside the episode`);
  }
  return path.join(episodeDir, relative);
}

/** sha256 of a file, streamed: a take can be a rendered video. */
export function digestFile(absolute: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(absolute)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * The files an attempt's outputs name, relative to the episode and sorted.
 *
 * A performer may report a directory (`illustrations/` is a contract that is
 * one); a candidate is the files inside it, because a directory has no bytes
 * to hash and no single file to restore.
 */
export async function expandOutputs(episodeDir: string, outputs: string[]): Promise<string[]> {
  const files = new Set<string>();
  const walk = async (relative: string): Promise<void> => {
    const absolute = inside(episodeDir, relative);
    const info = await stat(absolute);
    if (!info.isDirectory()) {
      files.add(path.normalize(relative));
      return;
    }
    for (const entry of await readdir(absolute)) {
      await walk(path.join(relative, entry));
    }
  };
  for (const output of outputs) await walk(output);
  if (files.size === 0) throw new Error("the outputs name no files");
  return [...files].sort();
}

/**
 * Copy an attempt's files into its candidate directory, read-only, and hash
 * the copies.
 *
 * The hashes are of the COPIES, so they describe exactly the bytes that were
 * kept even if a performer is still touching the originals. The copies land in
 * a temporary directory renamed into place, so a candidate is whole or absent.
 * A directory already at the destination was left by an attempt the journal
 * never recorded — this attempt number was just leased — and is replaced.
 */
export async function preserveCandidate(
  episodeDir: string, stageId: string, attemptNumber: number, files: string[],
): Promise<ArtifactHash[]> {
  const final = path.join(episodeDir, candidatePath(stageId, attemptNumber));
  const staging = path.join(path.dirname(final), `.${attemptNumber}.${randomUUID()}.tmp`);
  const digests: ArtifactHash[] = [];
  try {
    for (const relative of files) {
      const target = path.join(staging, relative);
      await mkdir(path.dirname(target), { recursive: true });
      // A reflink where the filesystem has one; a plain copy where it does not.
      await copyFile(inside(episodeDir, relative), target, constants.COPYFILE_FICLONE);
      await chmod(target, 0o444);
      digests.push({ path: relative, sha256: await digestFile(target) });
    }
    await rm(final, { recursive: true, force: true });
    await rename(staging, final);
  } catch (e) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw e;
  }
  return digests;
}

/** Why a candidate's kept files are not what its record says, or null. */
export async function verifyCandidate(
  episodeDir: string, stageId: string, attemptNumber: number, outputs: ArtifactHash[],
): Promise<string | null> {
  for (const { path: relative, sha256 } of outputs) {
    let absolute: string;
    try {
      absolute = inside(episodeDir, candidatePath(stageId, attemptNumber, relative));
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    let actual: string;
    try {
      actual = await digestFile(absolute);
    } catch {
      return `the kept copy of "${relative}" from attempt ${attemptNumber} is missing`;
    }
    if (actual !== sha256) {
      return `the kept copy of "${relative}" from attempt ${attemptNumber} has changed since it was recorded`;
    }
  }
  return null;
}

/**
 * Put a candidate's files at their canonical paths, and remove the files of
 * the take it displaces that it does not have itself.
 *
 * Each file is copied next to its destination and renamed over it, so a
 * reader sees the old file or the new one, never half of either. The set as a
 * whole is not atomic — no filesystem offers that — which is why the journal
 * append that follows is the commit point, and `driftOf` is how a crash in
 * between is noticed. Callers verify the candidate first.
 */
export async function materialize(
  episodeDir: string, stageId: string, attemptNumber: number, outputs: ArtifactHash[], displaced: string[] = [],
): Promise<void> {
  for (const { path: relative } of outputs) {
    const destination = inside(episodeDir, relative);
    const source = inside(episodeDir, candidatePath(stageId, attemptNumber, relative));
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await copyFile(source, temporary, constants.COPYFILE_FICLONE);
      await chmod(temporary, 0o644);
      await rename(temporary, destination);
    } catch (e) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw e;
    }
  }
  await removeDisplaced(episodeDir, outputs.map((o) => o.path), displaced);
}

/**
 * Remove the files of a displaced take that the incoming take does not have.
 *
 * A stage whose output is a directory — frames, say — can produce fewer
 * files on one attempt than on another, and a reader that lists the
 * directory would otherwise build on frames nobody selected. The displaced
 * files are not lost: their take keeps its own copy under `attempts/`.
 */
export async function removeDisplaced(episodeDir: string, incoming: string[], displaced: string[]): Promise<void> {
  const keep = new Set(incoming.map((p) => path.normalize(p)));
  for (const relative of displaced) {
    if (keep.has(path.normalize(relative))) continue;
    await rm(inside(episodeDir, relative), { force: true });
  }
}

/** The files of a take whose canonical copy is missing or differs from the record. */
export async function driftOf(episodeDir: string, outputs: ArtifactHash[]): Promise<string[]> {
  const drifted: string[] = [];
  for (const { path: relative, sha256 } of outputs) {
    try {
      if (await digestFile(inside(episodeDir, relative)) !== sha256) drifted.push(relative);
    } catch {
      drifted.push(relative);
    }
  }
  return drifted;
}
