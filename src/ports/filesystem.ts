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
