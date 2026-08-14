import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  VIEWERS,
  ACTIONS,
  isViewer,
  viewerForContentType,
  isEditableViewer,
  resolvePresentation,
} from "../src/presentation.mjs";

/**
 * The presentation contract exists so the studio resolves a viewer by name
 * instead of branching on content type. These assert the properties the studio
 * relies on when it does that.
 */
describe("presentation", () => {
  it("maps media types to their obvious viewer", () => {
    assert.equal(viewerForContentType("text/markdown"), "markdown");
    assert.equal(viewerForContentType("text/yaml"), "text");
    assert.equal(viewerForContentType("application/json"), "text");
    assert.equal(viewerForContentType("image/png"), "image");
    assert.equal(viewerForContentType("video/mp4"), "video");
    assert.equal(viewerForContentType("audio/wav"), "audio");
    assert.equal(viewerForContentType("model/gltf-binary"), "model-3d");
    assert.equal(viewerForContentType("text/csv"), "data-table");
  });

  it("falls back to download rather than guessing", () => {
    assert.equal(viewerForContentType("application/x-unheard-of"), "download");
    assert.equal(viewerForContentType(null), "download");
  });

  it("only ever names a viewer the registry could know", () => {
    for (const type of [
      "text/markdown", "image/png", "video/mp4", "audio/wav",
      "model/gltf-binary", "text/csv", null, "application/x-weird",
    ]) {
      assert.ok(isViewer(viewerForContentType(type)), `${type} produced an unknown viewer`);
    }
  });

  it("lets a declaration win over the content type", () => {
    const p = resolvePresentation("video/mp4", { viewer: "timeline" });
    assert.equal(p.viewer, "timeline");
  });

  it("ignores a declaration naming a viewer that is not in the vocabulary", () => {
    // A typo must not blank the view; the content type still applies.
    const p = resolvePresentation("image/png", { viewer: "imag" });
    assert.equal(p.viewer, "image");
  });

  it("keeps only declared actions that exist", () => {
    const p = resolvePresentation("video/mp4", {
      viewer: "video",
      actions: ["regenerate", "teleport", "select"],
    });
    assert.deepEqual(p.actions, ["regenerate", "select"]);
  });

  it("infers edit only for text-shaped viewers", () => {
    assert.ok(resolvePresentation("text/markdown").actions.includes("edit"));
    assert.ok(!resolvePresentation("video/mp4").actions.includes("edit"));
    assert.ok(isEditableViewer("markdown"));
    assert.ok(!isEditableViewer("model-3d"));
  });

  it("declares a vocabulary the studio can enumerate", () => {
    assert.ok(VIEWERS.includes("model-3d"), "3D must be describable before it is renderable");
    assert.ok(ACTIONS.includes("regenerate"));
    assert.ok(Object.isFrozen(VIEWERS));
  });
});
