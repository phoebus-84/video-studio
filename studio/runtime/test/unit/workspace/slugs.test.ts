import { describe, it, expect } from "vitest";
import { validateSlug, SLUG_MAX_LENGTH } from "../../../src/workspace/slugs.js";
import { isOk, isErr } from "../../../src/result.js";

describe("validateSlug", () => {
  // -- Success cases -------------------------------------------------------

  it("accepts a simple lowercase slug", () => {
    const r = validateSlug("my-channel");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) {
      expect(r.value).toBe("my-channel");
    }
  });

  it("accepts a single lowercase letter", () => {
    const r = validateSlug("a");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe("a");
  });

  it("accepts a single digit", () => {
    const r = validateSlug("7");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe("7");
  });

  it("accepts alphanumeric with single hyphens", () => {
    const r = validateSlug("season-1-ep-01");
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe("season-1-ep-01");
  });

  it("accepts a slug at maximum length", () => {
    const slug = "a" + "b".repeat(SLUG_MAX_LENGTH - 2) + "c";
    const r = validateSlug(slug);
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value).toBe(slug);
  });

  // -- Failure cases -------------------------------------------------------

  it("rejects an empty string", () => {
    const r = validateSlug("");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT");
      expect(r.error.details?.reason).toBe("empty");
    }
  });

  it("rejects a slug exceeding max length", () => {
    const slug = "a" + "b".repeat(SLUG_MAX_LENGTH);
    const r = validateSlug(slug);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT");
      expect(r.error.details?.reason).toBe("too-long");
      expect(r.error.details?.actualLength).toBe(slug.length);
    }
  });

  it("rejects uppercase letters", () => {
    const r = validateSlug("My-Channel");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("uppercase");
    }
  });

  it("rejects leading hyphen", () => {
    const r = validateSlug("-bad");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("leading-trailing-hyphen");
    }
  });

  it("rejects trailing hyphen", () => {
    const r = validateSlug("bad-");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("leading-trailing-hyphen");
    }
  });

  it("rejects consecutive hyphens", () => {
    const r = validateSlug("bad--slug");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("consecutive-hyphens");
    }
  });

  it("rejects special characters", () => {
    const r = validateSlug("bad_slug");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("invalid-char");
      expect(r.error.details?.hint).toContain("_");
    }
  });

  it("rejects spaces", () => {
    const r = validateSlug("bad slug");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("invalid-char");
    }
  });

  it("rejects a single hyphen", () => {
    const r = validateSlug("-");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.code).toBe("E_INVALID_ARGUMENT");
    }
  });

  it("rejects a slug starting with a digit-hyphen pattern (edge case)", () => {
    // "1--abc" has consecutive hyphens
    const r = validateSlug("1--abc");
    expect(isErr(r)).toBe(true);
    if (isErr(r)) {
      expect(r.error.details?.reason).toBe("consecutive-hyphens");
    }
  });
});
