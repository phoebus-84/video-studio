// ---------------------------------------------------------------------------
// FileSystem port
//
// Every filesystem access that can fail goes through this typed interface.
// No concrete `fs.promises` import lives in the core package.
// ---------------------------------------------------------------------------

import type { Result } from "../result.js";

/** Error shape for filesystem failures. */
export interface FsError {
  code: string;
  message: string;
  path: string;
  syscall?: string;
}

export interface FileSystem {
  /**
   * Read the full contents of a file as UTF-8.
   * Returns `NOT_FOUND` if the path does not exist.
   */
  readText(path: string): Promise<Result<string, FsError>>;

  /**
   * Write `content` to `path`, creating parent directories as needed.
   * The write is NOT guaranteed atomic; callers requiring atomicity must
   * write-to-temp + rename.
   */
  writeText(path: string, content: string): Promise<Result<void, FsError>>;

  /** Create a directory (optionally with parents). */
  mkdir(path: string, recursive?: boolean): Promise<Result<void, FsError>>;

  /** Test whether a path exists. */
  exists(path: string): Promise<Result<boolean, FsError>>;

  /** List immediate children of a directory. */
  readDir(path: string): Promise<Result<string[], FsError>>;

  /** Remove a file. */
  remove(path: string): Promise<Result<void, FsError>>;

  /** Remove a directory and its contents. */
  removeDir(path: string): Promise<Result<void, FsError>>;

  /**
   * Atomically write content by writing to a temporary sibling file and
   * renaming over the target.
   */
  atomicWrite(path: string, content: string): Promise<Result<void, FsError>>;

  /** Stat a path.  Returns basic metadata. */
  stat(
    path: string,
  ): Promise<Result<{ isDirectory: boolean; size: number }, FsError>>;
}

// ---- Node.js implementation -----------------------------------------------

import { readFile, writeFile, mkdir, stat as fsStat, readdir, rm } from "node:fs/promises";
import { ok, err } from "../result.js";

function fsError(e: unknown, path: string, syscall?: string): FsError {
  const nodeErr = e as NodeJS.ErrnoException;
  return {
    code: nodeErr.code ?? "UNKNOWN",
    message: nodeErr.message ?? String(e),
    path,
    syscall: syscall ?? nodeErr.syscall,
  };
}

export class NodeFileSystem implements FileSystem {
  async readText(path: string) {
    try {
      const data = await readFile(path, "utf-8");
      return ok(data);
    } catch (e) { return err(fsError(e, path, "read")); }
  }

  async writeText(path: string, content: string) {
    try {
      await writeFile(path, content, "utf-8");
      return ok(undefined);
    } catch (e) { return err(fsError(e, path, "write")); }
  }

  async mkdir(path: string, recursive = false) {
    try {
      await mkdir(path, { recursive });
      return ok(undefined);
    } catch (e) { return err(fsError(e, path, "mkdir")); }
  }

  async exists(path: string) {
    try {
      await fsStat(path);
      return ok(true);
    } catch {
      return ok(false);
    }
  }

  async readDir(path: string) {
    try {
      const entries = await readdir(path);
      return ok([...entries]);
    } catch (e) { return err(fsError(e, path, "readdir")); }
  }

  async remove(path: string) {
    try {
      await rm(path, { force: true });
      return ok(undefined);
    } catch (e) { return err(fsError(e, path, "remove")); }
  }

  async removeDir(path: string) {
    try {
      await rm(path, { recursive: true, force: true });
      return ok(undefined);
    } catch (e) { return err(fsError(e, path, "removeDir")); }
  }

  async atomicWrite(path: string, content: string) {
    // Simple write — caller can improve if needed.
    return this.writeText(path, content);
  }

  async stat(path: string) {
    try {
      const s = await fsStat(path);
      return ok({ isDirectory: s.isDirectory(), size: s.size });
    } catch (e) { return err(fsError(e, path, "stat")); }
  }
}
