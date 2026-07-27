import { describe, it, expect } from "vitest";
import { FakeFileSystem } from "../../fixtures/index.js";
import { isOk, isErr } from "../../../src/result.js";

describe("FileSystem port via FakeFileSystem", () => {
  describe("readText", () => {
    it("returns content for an existing file", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "hello.txt": "world" });
      const r = await fs.readText("hello.txt");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe("world");
      }
    });

    it("returns ENOENT for a missing file", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.readText("nope.txt");
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("ENOENT");
      }
    });
  });

  describe("writeText", () => {
    it("writes content and makes it readable", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "dir/.keep": "" });
      await fs.writeText("dir/out.txt", "hello");
      const r = await fs.readText("dir/out.txt");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe("hello");
      }
    });

    it("fails when parent directory does not exist", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.writeText("missing-dir/file.txt", "data");
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("ENOENT");
      }
    });
  });

  describe("mkdir", () => {
    it("creates a directory", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ ".keep": "" });
      const r = await fs.mkdir("new-dir");
      expect(isOk(r)).toBe(true);
      const e = await fs.exists("new-dir");
      expect(isOk(e)).toBe(true);
      if (isOk(e)) {
        expect(e.value).toBe(true);
      }
    });

    it("recursive:true creates parent directories", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.mkdir("a/b/c", true);
      expect(isOk(r)).toBe(true);
      const ec = await fs.exists("a/b/c");
      expect(isOk(ec)).toBe(true);
      if (isOk(ec)) {
        expect(ec.value).toBe(true);
      }
    });

    it("fails without recursive when parent is missing", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.mkdir("a/b");
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("ENOENT");
      }
    });
  });

  describe("exists", () => {
    it("returns true for an existing file", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "f.txt": "" });
      const r = await fs.exists("f.txt");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(true);
      }
    });

    it("returns false for a missing path", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.exists("missing");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe(false);
      }
    });
  });

  describe("readDir", () => {
    it("lists children", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "dir/a.txt": "", "dir/b.txt": "" });
      const r = await fs.readDir("dir");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual(["a.txt", "b.txt"]);
      }
    });

    it("includes subdirectories", async () => {
      const fs = new FakeFileSystem();
      await fs.mkdir("dir/sub", true);
      await fs.writeText("dir/f.txt", "x");
      const r = await fs.readDir("dir");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toEqual(["f.txt", "sub"]);
      }
    });

    it("returns ENOENT for missing directory", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.readDir("nope");
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("ENOENT");
      }
    });
  });

  describe("remove", () => {
    it("deletes a file", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "gone.txt": "bye" });
      const r = await fs.remove("gone.txt");
      expect(isOk(r)).toBe(true);
      const e = await fs.exists("gone.txt");
      expect(isOk(e)).toBe(true);
      if (isOk(e)) {
        expect(e.value).toBe(false);
      }
    });

    it("is idempotent for missing files", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.remove("nowhere");
      expect(isOk(r)).toBe(true);
    });
  });

  describe("removeDir", () => {
    it("recursively removes directory and contents", async () => {
      const fs = new FakeFileSystem();
      await fs.mkdir("d/sub", true);
      await fs.writeText("d/a.txt", "a");
      await fs.writeText("d/sub/b.txt", "b");
      await fs.removeDir("d");
      const e = await fs.exists("d");
      expect(isOk(e)).toBe(true);
      if (isOk(e)) {
        expect(e.value).toBe(false);
      }
    });
  });

  describe("atomicWrite", () => {
    it("writes content atomically", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "dir/.keep": "" });
      await fs.atomicWrite("dir/data.txt", "safe");
      const r = await fs.readText("dir/data.txt");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toBe("safe");
      }
    });
  });

  describe("stat", () => {
    it("returns file metadata", async () => {
      const fs = new FakeFileSystem();
      fs.seed({ "f.txt": "hello" });
      const r = await fs.stat("f.txt");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.isDirectory).toBe(false);
        expect(r.value.size).toBe(5);
      }
    });

    it("returns directory metadata", async () => {
      const fs = new FakeFileSystem();
      await fs.mkdir("mydir", true);
      const r = await fs.stat("mydir");
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.isDirectory).toBe(true);
      }
    });

    it("returns ENOENT for missing path", async () => {
      const fs = new FakeFileSystem();
      const r = await fs.stat("nope");
      expect(isErr(r)).toBe(true);
      if (isErr(r)) {
        expect(r.error.code).toBe("ENOENT");
      }
    });
  });
});
