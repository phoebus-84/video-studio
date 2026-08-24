import { describe, expect, it } from "vitest";
import { describeLibraryVisibility } from "../src/config.js";

// The agent and the gateway resolve their libraries independently, and nothing
// compared them. Starting Pi from the wrong directory produced a complete
// episode into a library the studio does not serve, and neither side reported
// anything wrong: the workspace simply looked empty.
describe("library visibility", () => {
  it("accepts a root the gateway serves exactly", () => {
    const v = describeLibraryVisibility("/repo/library", ["/repo/library"]);
    expect(v.visible).toBe(true);
  });

  it("accepts a root nested inside one the gateway serves", () => {
    const v = describeLibraryVisibility("/repo/library/childrens", ["/repo/library"]);
    expect(v.visible).toBe(true);
  });

  it("rejects the real mismatch, naming both sides", () => {
    const v = describeLibraryVisibility("/Users/x/avg/library", ["/Users/x/video-studio/library"]);
    expect(v.visible).toBe(false);
    expect(v.message).toContain("/Users/x/avg/library");
    expect(v.message).toContain("/Users/x/video-studio/library");
    // The consequence, not just the discrepancy.
    expect(v.message).toContain("will not appear");
  });

  it("does not treat a sibling with a shared prefix as served", () => {
    // `/repo/library-old` starts with `/repo/library` as a string but is a
    // different directory; a prefix test without the separator says yes.
    const v = describeLibraryVisibility("/repo/library-old", ["/repo/library"]);
    expect(v.visible).toBe(false);
  });

  it("reports a gateway that serves nothing", () => {
    const v = describeLibraryVisibility("/repo/library", []);
    expect(v.visible).toBe(false);
    expect(v.message).toContain("no library roots");
  });

  it("accepts a match against any one of several roots", () => {
    const v = describeLibraryVisibility("/b/library", ["/a/library", "/b/library"]);
    expect(v.visible).toBe(true);
  });
});
