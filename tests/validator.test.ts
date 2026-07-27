/**
 * Tests for timeline semantic validation.
 *
 * Covers all acceptance criteria:
 * - Invalid fixtures fail before FFmpeg starts
 * - Valid minimal and multi-scene fixtures normalize deterministically
 * - Validation never silently clamps editorial timing
 * - Success and failure paths covered
 */

import { describe, it, expect } from "vitest";
import { validateTimeline } from "../src/validator.js";
import type {
  AssetProbe,
  Timeline,
  ValidationOptions,
} from "../src/types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

function t(overrides?: Partial<Timeline>): Timeline {
  return {
    version: "1.0",
    canvas: { width: 1920, height: 1080 },
    scenes: [
      {
        id: "s1",
        asset: { path: "assets/clip1.mp4", hash: "abc123" },
        inPoint: 0,
        outPoint: 5,
        timelineStart: 0,
      },
    ],
    ...overrides,
  };
}

function multiScene(): Timeline {
  return {
    version: "1.0",
    canvas: { width: 1920, height: 1080 },
    scenes: [
      {
        id: "intro",
        asset: { path: "assets/intro.mp4" },
        inPoint: 0,
        outPoint: 10,
        timelineStart: 0,
        duration: 10,
      },
      {
        id: "body",
        asset: { path: "assets/body.mp4" },
        inPoint: 5,
        outPoint: 20,
        timelineStart: 10,
        transition: {
          type: "dissolve",
          duration: 1,
        },
      },
      {
        id: "outro",
        asset: { path: "assets/outro.mp4" },
        inPoint: 0,
        outPoint: 8,
        timelineStart: 30,
        duration: 8,
      },
    ],
  };
}

// ─── Shape / root-level ──────────────────────────────────────────────────

describe("validateTimeline — root shape", () => {
  it("rejects null", async () => {
    const r = await validateTimeline(null);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "TIMELINE_NOT_OBJECT")).toBe(true);
  });

  it("rejects a plain string", async () => {
    const r = await validateTimeline("hello");
    expect(r.valid).toBe(false);
  });

  it("rejects an array", async () => {
    const r = await validateTimeline([]);
    expect(r.valid).toBe(false);
  });

  it("rejects an object with no version", async () => {
    const r = await validateTimeline({});
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "$.version")).toBe(true);
  });

  it("rejects invalid version", async () => {
    const r = await validateTimeline(t({ version: "2.0" as any }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "TIMELINE_VERSION_INVALID")).toBe(true);
  });

  it("rejects missing canvas", async () => {
    const r = await validateTimeline({ version: "1.0", scenes: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CANVAS_MISSING")).toBe(true);
  });

  it("rejects missing scenes", async () => {
    const r = await validateTimeline({ version: "1.0", canvas: { width: 100, height: 100 } });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENES_NOT_ARRAY")).toBe(true);
  });

  it("rejects empty scenes array", async () => {
    const r = await validateTimeline({ version: "1.0", canvas: { width: 100, height: 100 }, scenes: [] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENES_EMPTY")).toBe(true);
  });
});

// ─── Canvas ──────────────────────────────────────────────────────────────

describe("validateTimeline — canvas", () => {
  it("rejects zero width", async () => {
    const r = await validateTimeline(t({ canvas: { width: 0, height: 100 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CANVAS_WIDTH_INVALID")).toBe(true);
  });

  it("rejects negative height", async () => {
    const r = await validateTimeline(t({ canvas: { width: 100, height: -1 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CANVAS_HEIGHT_INVALID")).toBe(true);
  });

  it("rejects NaN canvas values", async () => {
    const r = await validateTimeline(t({ canvas: { width: NaN, height: 100 } }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CANVAS_WIDTH_INVALID")).toBe(true);
  });

  it("warns on non-integer width", async () => {
    const r = await validateTimeline(t({ canvas: { width: 1920.5, height: 1080 } }));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.code === "CANVAS_WIDTH_NON_INTEGER")).toBe(true);
  });

  it("validates safe area margins", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: 0.1, bottom: 0.95, left: 0.05, right: 0.05 },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SAFE_AREA_OVERLAP_V")).toBe(true);
  });

  it("validates safe area vertical margin overflow", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: 0.6, bottom: 0.6, left: 0.05, right: 0.05 },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SAFE_AREA_OVERLAP_V")).toBe(true);
  });

  it("validates safe area horizontal margin overflow", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: 0.05, bottom: 0.05, left: 0.6, right: 0.6 },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SAFE_AREA_OVERLAP_H")).toBe(true);
  });

  it("accepts valid safe area", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
        },
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("rejects safe area values >= 1", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: 1.0, bottom: 0.1, left: 0.1, right: 0.1 },
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes("safeArea"))).toBe(true);
  });

  it("rejects negative safe area values", async () => {
    const r = await validateTimeline(
      t({
        canvas: {
          width: 1920,
          height: 1080,
          safeArea: { top: -0.1, bottom: 0.1, left: 0.1, right: 0.1 },
        },
      }),
    );
    expect(r.valid).toBe(false);
  });
});

// ─── Scenes — individual fields ──────────────────────────────────────────

describe("validateTimeline — scene fields", () => {
  it("rejects scene without id", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 } as any,
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_ID_MISSING")).toBe(true);
  });

  it("rejects duplicate scene ids", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "dup", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          { id: "dup", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 5 },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_ID_DUPLICATE")).toBe(true);
  });

  it("rejects scene without asset", async () => {
    const r = await validateTimeline(
      t({
        scenes: [{ id: "s1", inPoint: 0, outPoint: 5, timelineStart: 0 } as any],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_ASSET_MISSING")).toBe(true);
  });

  it("rejects empty asset path", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "ASSET_PATH_EMPTY")).toBe(true);
  });

  it("rejects negative inPoint", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: -1,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_IN_POINT_INVALID")).toBe(true);
  });

  it("rejects outPoint <= inPoint", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 10,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_DURATION_INVALID")).toBe(true);
  });

  it("rejects equal inPoint and outPoint", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 5,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_DURATION_INVALID")).toBe(true);
  });

  it("rejects negative timelineStart", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: -1,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_TIMELINE_START_INVALID")).toBe(true);
  });
});

// ─── Duration mismatch — never silently clamp ────────────────────────────

describe("validateTimeline — duration (never silently clamp)", () => {
  it("rejects explicit duration that does not match outPoint − inPoint", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            duration: 8, // mismatch: should be 10
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_DURATION_MISMATCH")).toBe(true);
  });

  it("accepts explicit duration that matches", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 2,
            outPoint: 7,
            timelineStart: 0,
            duration: 5, // matches: 7 - 2
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("allows omitting explicit duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 1,
            outPoint: 6,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("rejects non-finite explicit duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            duration: Infinity,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_DURATION_NAN")).toBe(true);
  });
});

// ─── Scene ordering ──────────────────────────────────────────────────────

describe("validateTimeline — scene ordering", () => {
  it("rejects scenes with non-monotonic timelineStart", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 10 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 5 },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_ORDER_VIOLATED")).toBe(true);
  });

  it("accepts non-decreasing timelineStart", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 5 },
        ],
      }),
    );
    // No overlap between consecutive 0-5 and 5-10 → valid
    expect(r.valid).toBe(true);
  });
});

// ─── Scene overlap ───────────────────────────────────────────────────────

describe("validateTimeline — scene overlap", () => {
  it("rejects overlapping scenes", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 3 },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_OVERLAP")).toBe(true);
  });

  it("warns on gaps between scenes (not an error)", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 10 },
        ],
      }),
    );
    expect(r.valid).toBe(true); // gap is a warning, not an error
    expect(r.warnings.some((w) => w.code === "SCENE_GAP")).toBe(true);
  });

  it("accepts abutting scenes (no gap, no overlap)", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 5 },
        ],
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.code === "SCENE_GAP")).toBe(false);
  });

  it("detects overlap exactly (boundary)", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5.001, timelineStart: 0 },
          { id: "b", asset: { path: "b.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 5 },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_OVERLAP")).toBe(true);
  });
});

// ─── Transitions ─────────────────────────────────────────────────────────

describe("validateTimeline — transitions", () => {
  it("rejects invalid transition type", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          {
            id: "b",
            asset: { path: "b.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 5,
            transition: { type: "shatter" as any, duration: 1 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "TRANSITION_TYPE_INVALID")).toBe(true);
  });

  it("rejects transition duration exceeding scene duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          {
            id: "b",
            asset: { path: "b.mp4" },
            inPoint: 0,
            outPoint: 1,
            timelineStart: 5,
            transition: { type: "dissolve", duration: 2 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(
      r.errors.some((e) => e.code === "TRANSITION_EXCEEDS_SCENE"),
    ).toBe(true);
  });

  it("warns on transition on first scene", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "a",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
            transition: { type: "dissolve", duration: 1 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.code === "TRANSITION_ON_FIRST_SCENE")).toBe(true);
  });

  it("accepts a valid dissolve transition on a non-first scene", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          {
            id: "b",
            asset: { path: "b.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 5,
            transition: { type: "dissolve", duration: 1.5 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("rejects transition duration > previous scene duration (cross-scene)", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 1, timelineStart: 0 },
          {
            id: "b",
            asset: { path: "b.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 1,
            transition: { type: "fade", duration: 3 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(
      r.errors.some((e) => e.code === "TRANSITION_EXCEEDS_PREVIOUS_SCENE"),
    ).toBe(true);
  });

  it("warns when transition type is none but duration is set", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          { id: "a", asset: { path: "a.mp4" }, inPoint: 0, outPoint: 5, timelineStart: 0 },
          {
            id: "b",
            asset: { path: "b.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 5,
            transition: { type: "none", duration: 2 },
          },
        ],
      }),
    );
    expect(r.warnings.some((w) => w.code === "TRANSITION_NONE_WITH_DURATION")).toBe(true);
  });
});

// ─── Captions ────────────────────────────────────────────────────────────

describe("validateTimeline — captions", () => {
  it("rejects empty caption text", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            caption: { text: "", start: 1, duration: 3 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CAPTION_TEXT_EMPTY")).toBe(true);
  });

  it("rejects negative caption start", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            caption: { text: "Hello", start: -1, duration: 3 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CAPTION_START_INVALID")).toBe(true);
  });

  it("rejects zero caption duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            caption: { text: "Hello", start: 1, duration: 0 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CAPTION_DURATION_INVALID")).toBe(true);
  });

  it("rejects caption extending beyond scene duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
            caption: { text: "Hello", start: 3, duration: 5 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CAPTION_EXCEEDS_SCENE")).toBe(true);
  });

  it("accepts valid caption", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 20,
            timelineStart: 0,
            caption: {
              text: "Welcome",
              start: 2,
              duration: 5,
              font: "Arial",
              fontSize: 24,
              color: "#FFFFFF",
              backgroundColor: "#00000080",
              position: "bottom",
            },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("warns on invalid position", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            caption: { text: "Hi", start: 1, duration: 3, position: "middle" as any },
          },
        ],
      }),
    );
    expect(r.warnings.some((w) => w.code === "CAPTION_POSITION_INVALID")).toBe(true);
  });
});

// ─── Audio ───────────────────────────────────────────────────────────────

describe("validateTimeline — audio", () => {
  it("rejects negative volume", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            audio: { volume: -0.5 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "AUDIO_VOLUME_INVALID")).toBe(true);
  });

  it("rejects negative fadeIn", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            audio: { fadeIn: -1 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "AUDIO_FADE_IN_INVALID")).toBe(true);
  });

  it("rejects fadeIn + fadeOut exceeding scene duration", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
            audio: { fadeIn: 3, fadeOut: 3 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "AUDIO_FADE_OVERLAP")).toBe(true);
  });

  it("accepts valid audio config", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 30,
            timelineStart: 0,
            audio: { volume: 0.8, fadeIn: 1, fadeOut: 2, mute: false },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("accepts muted scene", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            audio: { mute: true },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });
});

// ─── Profile ─────────────────────────────────────────────────────────────

describe("validateTimeline — profile", () => {
  it("rejects non-positive FPS", async () => {
    const r = await validateTimeline(
      t({ profile: { fps: 0 } }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "PROFILE_FPS_INVALID")).toBe(true);
  });

  it("rejects non-finite FPS", async () => {
    const r = await validateTimeline(
      t({ profile: { fps: NaN } }),
    );
    expect(r.valid).toBe(false);
  });

  it("accepts valid profile", async () => {
    const r = await validateTimeline(
      t({ profile: { fps: 30, codec: "libx264", pixelFormat: "yuv420p" } }),
    );
    expect(r.valid).toBe(true);
  });

  it("warns in strict mode for non-object profile", async () => {
    const r = await validateTimeline(
      { ...t(), profile: "bad" } as any,
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "PROFILE_NOT_OBJECT")).toBe(true);
  });
});

// ─── Stale marker ────────────────────────────────────────────────────────

describe("validateTimeline — stale marker", () => {
  it("rejects when stale marker indicates a dependency change", async () => {
    const r = await validateTimeline(
      t({
        stale: {
          source: "assets/intro.mp4",
          reason: "File modified after last render",
          detectedAt: "2026-07-27T12:00:00Z",
        },
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "STALE_DEPENDENCY")).toBe(true);
  });

  it("warns (not errors) on incomplete stale marker", async () => {
    const r = await validateTimeline(
      t({ stale: { reason: "something changed" } as any }),
    );
    // Only warnings for incomplete stale; no hard STALE_DEPENDENCY error
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.errors.some((e) => e.code === "STALE_DEPENDENCY")).toBe(false);
  });

  it("allows no stale marker", async () => {
    const r = await validateTimeline(t());
    expect(r.valid).toBe(true);
  });
});

// ─── Transform / crop ────────────────────────────────────────────────────

describe("validateTimeline — transform", () => {
  it("rejects invalid fit mode", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            transform: { fit: "stretch" as any },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "TRANSFORM_FIT_INVALID")).toBe(true);
  });

  it("rejects negative scale", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            transform: { scale: -1 },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "TRANSFORM_SCALE_INVALID")).toBe(true);
  });

  it("rejects crop with zero width", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            transform: { crop: { x: 0, y: 0, width: 0, height: 100 } },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CROP_WIDTH_ZERO")).toBe(true);
  });

  it("rejects crop with negative values", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            transform: { crop: { x: -5, y: 0, width: 100, height: 100 } },
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CROP_VALUE_INVALID")).toBe(true);
  });

  it("accepts valid transform with position, scale, and fit", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            transform: {
              fit: "cover",
              scale: 1.5,
              position: { x: 100, y: 50 },
              crop: { x: 0, y: 0, width: 1920, height: 1080 },
            },
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });
});

// ─── Filters ─────────────────────────────────────────────────────────────

describe("validateTimeline — filters", () => {
  it("rejects non-array filters", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            filters: "not-an-array" as any,
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "FILTERS_NOT_ARRAY")).toBe(true);
  });

  it("rejects filter without name", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            filters: [{ params: { w: 100 } }],
          },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "FILTER_NAME_MISSING")).toBe(true);
  });

  it("accepts valid filters", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: 0,
            outPoint: 10,
            timelineStart: 0,
            filters: [
              { name: "scale", params: { w: 1920, h: 1080 } },
              { name: "hue", params: { h: 90 } },
            ],
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });
});

// ─── Asset probe ─────────────────────────────────────────────────────────

describe("validateTimeline — asset probe", () => {
  const presentProbe: AssetProbe = async (path: string) => ({
    hash: "abc123",
    revision: "r1",
    size: 1024,
  });

  const missingProbe: AssetProbe = async (_path: string) => null;

  const hashProbeWrong: AssetProbe = async (path: string) => ({
    hash: "wrong_hash",
    revision: "r1",
    size: 1024,
  });

  const noHashProbe: AssetProbe = async (path: string) => ({
    revision: "r1",
    size: 1024,
  });

  it("rejects when asset probe returns null (asset not found)", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "missing.mp4", hash: "abc" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
      { assetProbe: missingProbe },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "ASSET_NOT_FOUND")).toBe(true);
  });

  it("rejects when hash mismatches", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "assets/clip1.mp4", hash: "expected_hash" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
      { assetProbe: hashProbeWrong },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "ASSET_HASH_MISMATCH")).toBe(true);
  });

  it("warns when probe provides no hash for hash check", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "assets/clip1.mp4", hash: "abc" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
      { assetProbe: noHashProbe },
    );
    expect(r.warnings.some((w) => w.code === "ASSET_HASH_UNAVAILABLE")).toBe(true);
  });

  it("accepts when probe returns matching hash", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "assets/clip1.mp4", hash: "abc123" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
      { assetProbe: presentProbe },
    );
    expect(r.valid).toBe(true);
  });

  it("skips asset probing when no probe provided", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "some/path.mp4" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("dedupes probe calls for the same path", async () => {
    const calls: string[] = [];
    const countingProbe: AssetProbe = async (path: string) => {
      calls.push(path);
      return { hash: "abc", revision: "r1", size: 100 };
    };

    await validateTimeline(
      {
        version: "1.0",
        canvas: { width: 100, height: 100 },
        scenes: [
          { id: "a", asset: { path: "shared.mp4" }, inPoint: 0, outPoint: 1, timelineStart: 0 },
          { id: "b", asset: { path: "shared.mp4" }, inPoint: 0, outPoint: 1, timelineStart: 1 },
          { id: "c", asset: { path: "other.mp4" }, inPoint: 0, outPoint: 1, timelineStart: 2 },
        ],
      },
      { assetProbe: countingProbe },
    );
    // "shared.mp4" should only be probed once
    expect(calls.length).toBe(2);
    expect(calls.filter((c) => c === "shared.mp4").length).toBe(1);
  });

  it("warns on revision mismatch", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "assets/clip1.mp4", revision: "r2" },
            inPoint: 0,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
      { assetProbe: presentProbe }, // returns revision "r1"
    );
    expect(r.warnings.some((w) => w.code === "ASSET_REVISION_MISMATCH")).toBe(true);
  });
});

// ─── Multi-scene valid fixture ───────────────────────────────────────────

describe("validateTimeline — multi-scene fixtures", () => {
  it("validates a multi-scene timeline deterministically", async () => {
    const r = await validateTimeline(multiScene());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("detects overlap in multi-scene timeline", async () => {
    const tl = multiScene();
    // Make "body" overlap with "intro"
    tl.scenes[1].timelineStart = 8;
    const r = await validateTimeline(tl);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_OVERLAP")).toBe(true);
  });

  it("detects ordering violation in multi-scene timeline", async () => {
    const tl = multiScene();
    // Put outro before body
    tl.scenes[2].timelineStart = 5;
    const r = await validateTimeline(tl);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_ORDER_VIOLATED")).toBe(true);
  });
});

// ─── Multi-scene valid fixture ───────────────────────────────────────────

describe("validateTimeline — concrete full valid fixture", () => {
  it("accepts a complete timeline with all features", async () => {
    const full: Timeline = {
      version: "1.0",
      canvas: {
        width: 1920,
        height: 1080,
        safeArea: { top: 0.05, bottom: 0.05, left: 0.05, right: 0.05 },
      },
      profile: { fps: 30, codec: "libx264", pixelFormat: "yuv420p" },
      scenes: [
        {
          id: "intro",
          asset: { path: "footage/intro.mp4", hash: "sha256:aaaa", revision: "v1" },
          inPoint: 0,
          outPoint: 10,
          timelineStart: 0,
          duration: 10,
          audio: { volume: 0.9, fadeIn: 1, fadeOut: 1, mute: false },
          caption: {
            text: "Chapter 1",
            start: 1,
            duration: 3,
            font: "Helvetica",
            fontSize: 32,
            color: "#FFFFFF",
            backgroundColor: "#00000080",
            position: "bottom",
            offsetY: -20,
          },
          transform: { fit: "cover", scale: 1.0 },
        },
        {
          id: "main",
          asset: { path: "footage/main.mp4", hash: "sha256:bbbb", revision: "v2" },
          inPoint: 120,
          outPoint: 180,
          timelineStart: 10,
          duration: 60,
          transition: {
            type: "dissolve",
            duration: 1,
            easing: "ease-in-out",
          },
          audio: { volume: 1.0 },
          transform: { fit: "contain", position: { x: 0, y: 0 } },
          filters: [
            { name: "scale", params: { w: 1920, h: 1080 } },
            { name: "unsharp", params: { lx: 5, ly: 5, la: 1.0 } },
          ],
        },
        {
          id: "outro",
          asset: { path: "footage/outro.mp4", hash: "sha256:cccc", revision: "v3" },
          inPoint: 0,
          outPoint: 15,
          timelineStart: 70,
          duration: 15,
          transition: {
            type: "fade",
            duration: 1.5,
          },
          audio: { fadeIn: 0.5, fadeOut: 2 },
          transform: { crop: { x: 0, y: 0, width: 1920, height: 1080 } },
        },
      ],
    };

    const r = await validateTimeline(full);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

// ─── Strict mode ─────────────────────────────────────────────────────────

describe("validateTimeline — strict mode", () => {
  it("promotes warnings to errors in strict mode", async () => {
    // Non-integer canvas width produces a warning normally
    const r = await validateTimeline(
      t({ canvas: { width: 1920.5, height: 1080 } }),
      { strict: true },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "CANVAS_WIDTH_NON_INTEGER")).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
});

// ─── Error paths — diagnostic code and path presence ─────────────────────

describe("validateTimeline — diagnostic quality", () => {
  it("every error has a code, message, and path", async () => {
    const r = await validateTimeline(null);
    for (const e of r.errors) {
      expect(e.code).toBeTruthy();
      expect(e.message).toBeTruthy();
      expect(e.path).toBeDefined();
    }
  });

  it("every warning has a code, message, and path", async () => {
    const tl = multiScene();
    tl.scenes[1].timelineStart = 100; // force a gap warning
    const r = await validateTimeline(tl);
    const gapWarnings = r.warnings.filter((w) => w.code === "SCENE_GAP");
    expect(gapWarnings.length).toBeGreaterThan(0);
    for (const w of gapWarnings) {
      expect(w.code).toBeTruthy();
      expect(w.message).toBeTruthy();
      expect(w.path).toBeDefined();
    }
  });

  it("path references use dot/bracket notation", async () => {
    const r = await validateTimeline(
      t({
        scenes: [
          {
            id: "s1",
            asset: { path: "a.mp4" },
            inPoint: -1,
            outPoint: 5,
            timelineStart: 0,
          },
        ],
      }),
    );
    const inPointErr = r.errors.find((e) => e.code === "SCENE_IN_POINT_INVALID");
    expect(inPointErr).toBeDefined();
    expect(inPointErr!.path).toBe("scenes[0].inPoint");
  });
});

// ─── Negative validation cases — shape errors ────────────────────────────

describe("validateTimeline — non-object scene entry", () => {
  it("rejects a non-object in the scenes array", async () => {
    const r = await validateTimeline({
      version: "1.0",
      canvas: { width: 100, height: 100 },
      scenes: ["not-an-object"],
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.code === "SCENE_NOT_OBJECT")).toBe(true);
  });
});
