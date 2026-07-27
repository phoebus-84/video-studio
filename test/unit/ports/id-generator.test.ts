import { describe, it, expect } from "vitest";
import { FakeIdGenerator } from "../../fixtures/index.js";

describe("IdGenerator port via FakeIdGenerator", () => {
  it("generates unique, sequential ids", () => {
    const gen = new FakeIdGenerator("test");
    const ids = Array.from({ length: 5 }, () => gen.generate());
    expect(ids).toEqual([
      "test_000000",
      "test_000001",
      "test_000002",
      "test_000003",
      "test_000004",
    ]);
  });

  it("generates short ids", () => {
    const gen = new FakeIdGenerator("ep");
    expect(gen.generateShort()).toBe("ep_00000");
  });

  it("uses default prefix 'id'", () => {
    const gen = new FakeIdGenerator();
    expect(gen.generate()).toBe("id_000000");
  });

  it("two generators produce independent sequences", () => {
    const a = new FakeIdGenerator("a");
    const b = new FakeIdGenerator("b");
    expect(a.generate()).toBe("a_000000");
    expect(b.generate()).toBe("b_000000");
    expect(a.generate()).toBe("a_000001");
  });
});
