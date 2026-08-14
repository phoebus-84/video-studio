import { describe, it, expect } from "vitest";
import { FakeFileSystem } from "../../fixtures/index.js";
import {
  guardPath,
  validateRootPath,
  resolveGuardedPath,
} from "../../../src/workspace/path-guard.js";
import { isOk, isErr } from "../../../src/result.js";

describe("validateRootPath", () => {
  it("accepts an absolute path", () => {
    const r = validateRootPath("/home/user/videos");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/home/user/videos");
    }
  });

  it("rejects a relative path", () => {
    const r = validateRootPath("./videos");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("not-absolute");
    }
  });

  it("rejects the filesystem root /", () => {
    const r = validateRootPath("/");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("filesystem-root");
    }
  });

  it("normalises the path", () => {
    const r = validateRootPath("/home/user/../user/videos");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/home/user/videos");
    }
  });
});

describe("guardPath (lexical)", () => {
  it("accepts a simple relative path within the root", async () => {
    const r = await guardPath("/root", "subdir/file.txt");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root/subdir/file.txt");
    }
  });

  it("accepts the root itself", async () => {
    const r = await guardPath("/root", ".");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root");
    }
  });

  it("rejects a path with .. traversal that escapes", async () => {
    const r = await guardPath("/root", "../etc/passwd");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_PERMISSION_DENIED");
      expect(r.error.details?.reason).toBe("lexical-escape");
    }
  });

  it("rejects an absolute path to a different root", async () => {
    const r = await guardPath("/root", "/etc/passwd");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("lexical-escape");
    }
  });

  it("accepts .. that stays within the root after resolution", async () => {
    // /root/a/b/../c resolves to /root/a/c which is within /root
    const r = await guardPath("/root", "a/b/../c");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root/a/c");
    }
  });
});

describe("guardPath (symlink-aware with FakeFileSystem)", () => {
  it("passes when candidate exists within root", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir("/root/sub", true);
    await fs.writeText("/root/sub/file.txt", "hello");

    const r = await guardPath("/root", "sub/file.txt", fs);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root/sub/file.txt");
    }
  });

  it("passes for a path that does not exist yet (lexical-only check)", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir("/root", true);

    const r = await guardPath("/root", "new-dir/file.txt", fs);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root/new-dir/file.txt");
    }
  });

  it("rejects a path that exists outside the root", async () => {
    const fs = new FakeFileSystem();
    await fs.mkdir("/root", true);
    await fs.mkdir("/etc", true);
    await fs.writeText("/etc/passwd", "data");

    const r = await guardPath("/root", "../etc/passwd", fs);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("lexical-escape");
    }
  });
});

describe("resolveGuardedPath", () => {
  it("validates root and guards path together", async () => {
    const r = await resolveGuardedPath("/root", "sub/file.txt");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("/root/sub/file.txt");
    }
  });

  it("fails when root is invalid", async () => {
    const r = await resolveGuardedPath("relative/path", "sub");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("not-absolute");
    }
  });

  it("fails when path escapes", async () => {
    const r = await resolveGuardedPath("/root", "../../etc");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_PERMISSION_DENIED");
    }
  });
});
