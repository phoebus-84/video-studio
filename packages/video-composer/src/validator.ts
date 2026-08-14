/**
 * Timeline semantic validator.
 *
 * Validates a typed edit timeline against editorial rules before any
 * FFmpeg invocation. Every rejection is a typed, actionable diagnostic.
 * The validator never silently clamps, reorders, or repairs editorial timing.
 *
 * Asset checks are performed through an injectable {@link AssetProbe}
 * rather than shell calls, keeping the validator deterministic and testable.
 */

import type {
  AssetProbeResult,
  TimelineVersion,
  ValidationMessage,
  ValidationOptions,
  ValidationResult,
} from "./types.js";

// ═══════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate a timeline against editorial semantics.
 *
 * Returns a {@link ValidationResult}. When `options.strict` is true, every
 * warning is promoted to an error and `result.valid` will be false if any
 * diagnostic is present.
 *
 * Asset-level checks (existence, hash, revision) are skipped when no
 * `assetProbe` is provided.
 */
export async function validateTimeline(
  timeline: unknown,
  options: ValidationOptions = {},
): Promise<ValidationResult> {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const ctx = new ValidationCtx(errors, warnings, options);

  // ─── Root shape ───────────────────────────────────────────────────────
  if (!isObject(timeline)) {
    ctx.error("$", "TIMELINE_NOT_OBJECT", "Timeline must be a plain object");
    return finish(ctx);
  }

  const t = timeline as Record<string, unknown>;

  // version
  if (!isValidVersion(t.version)) {
    ctx.error(
      "$.version",
      "TIMELINE_VERSION_INVALID",
      `Timeline version must be "1.0", got ${JSON.stringify(t.version)}`,
      { received: t.version },
    );
  }

  // canvas
  const canvas = t.canvas;
  if (!isObject(canvas)) {
    ctx.error(
      "$.canvas",
      "CANVAS_MISSING",
      "Canvas is required and must be an object",
    );
  } else {
    validateCanvas(canvas as Record<string, unknown>, ctx.at("canvas"));
  }

  // scenes
  const scenes = t.scenes;
  if (!Array.isArray(scenes)) {
    ctx.error(
      "$.scenes",
      "SCENES_NOT_ARRAY",
      "Scenes must be a non-empty array",
    );
  } else if (scenes.length === 0) {
    ctx.error(
      "$.scenes",
      "SCENES_EMPTY",
      "Timeline must contain at least one scene",
    );
  } else {
    validateScenes(scenes as Record<string, unknown>[], ctx.at("scenes"));
  }

  // profile
  if (t.profile !== undefined) {
    if (!isObject(t.profile)) {
      ctx.error(
        "$.profile",
        "PROFILE_NOT_OBJECT",
        "profile must be an object when provided",
      );
    } else {
      validateProfile(
        t.profile as Record<string, unknown>,
        ctx.at("profile"),
      );
    }
  }

  // stale marker
  if (t.stale !== undefined) {
    if (!isObject(t.stale)) {
      ctx.warning(
        "$.stale",
        "STALE_NOT_OBJECT",
        "stale marker should be an object, ignoring",
      );
    } else {
      validateStaleMarker(
        t.stale as Record<string, unknown>,
        ctx.at("stale"),
      );
    }
  }

  // Asset-level checks (injectable probe)
  if (options.assetProbe && Array.isArray(scenes)) {
    await validateAssets(
      scenes as Record<string, unknown>[],
      options.assetProbe,
      ctx,
    );
  }

  return finish(ctx);
}

// ═══════════════════════════════════════════════════════════════════════════
// Validation context helpers
// ═══════════════════════════════════════════════════════════════════════════

class ValidationCtx {
  constructor(
    public errors: ValidationMessage[],
    public warnings: ValidationMessage[],
    public options: ValidationOptions,
  ) {}

  error(path: string, code: string, message: string, context?: Record<string, unknown>) {
    this.errors.push({ code, message, path, context });
  }

  warning(path: string, code: string, message: string, context?: Record<string, unknown>) {
    this.warnings.push({ code, message, path, context });
  }

  at(segment: string): ValidationCtx {
    return new PrefixCtx(this.errors, this.warnings, this.options, segment);
  }

  idx(index: number): ValidationCtx {
    return new PrefixCtx(this.errors, this.warnings, this.options, `[${index}]`);
  }
}

class PrefixCtx extends ValidationCtx {
  constructor(
    errors: ValidationMessage[],
    warnings: ValidationMessage[],
    options: ValidationOptions,
    private prefix: string,
  ) {
    super(errors, warnings, options);
  }

  override error(path: string, code: string, message: string, context?: Record<string, unknown>) {
    super.error(`${this.prefix}.${path}`.replace(/\.\[/g, "["), code, message, context);
  }

  override warning(path: string, code: string, message: string, context?: Record<string, unknown>) {
    super.warning(`${this.prefix}.${path}`.replace(/\.\[/g, "["), code, message, context);
  }

  override at(segment: string): ValidationCtx {
    return new PrefixCtx(this.errors, this.warnings, this.options, `${this.prefix}.${segment}`);
  }

  override idx(index: number): ValidationCtx {
    return new PrefixCtx(this.errors, this.warnings, this.options, `${this.prefix}[${index}]`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Canvas
// ═══════════════════════════════════════════════════════════════════════════

function validateCanvas(c: Record<string, unknown>, ctx: ValidationCtx): void {
  // width
  if (typeof c.width !== "number" || !Number.isFinite(c.width) || c.width <= 0) {
    ctx.error("width", "CANVAS_WIDTH_INVALID", "Canvas width must be a positive finite number", {
      received: c.width,
    });
  } else if (!Number.isInteger(c.width)) {
    ctx.warning("width", "CANVAS_WIDTH_NON_INTEGER", "Canvas width should be an integer", {
      received: c.width,
    });
  }

  // height
  if (typeof c.height !== "number" || !Number.isFinite(c.height) || c.height <= 0) {
    ctx.error("height", "CANVAS_HEIGHT_INVALID", "Canvas height must be a positive finite number", {
      received: c.height,
    });
  } else if (!Number.isInteger(c.height)) {
    ctx.warning("height", "CANVAS_HEIGHT_NON_INTEGER", "Canvas height should be an integer", {
      received: c.height,
    });
  }

  // safeArea
  if (c.safeArea !== undefined) {
    if (!isObject(c.safeArea)) {
      ctx.error("safeArea", "SAFE_AREA_NOT_OBJECT", "safeArea must be an object");
    } else {
      validateSafeArea(c.safeArea as Record<string, unknown>, ctx.at("safeArea"));
    }
  }
}

function validateSafeArea(sa: Record<string, unknown>, ctx: ValidationCtx): void {
  const fields = ["top", "bottom", "left", "right"] as const;
  let top = 0, bottom = 0, left = 0, right = 0;
  let allPresent = true;

  for (const f of fields) {
    const v = sa[f];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v >= 1) {
      ctx.error(f, "SAFE_AREA_INVALID", `safeArea.${f} must be in [0, 1)`, { received: v });
      allPresent = false;
    } else {
      (sa as any)[`_${f}`] = v; // store for overlap check
      if (f === "top") top = v;
      if (f === "bottom") bottom = v;
      if (f === "left") left = v;
      if (f === "right") right = v;
    }
  }

  if (allPresent) {
    if (top + bottom >= 1) {
      ctx.error("top", "SAFE_AREA_OVERLAP_V", `safeArea top+top margin (${top + bottom}) must be < 1`);
    }
    if (left + right >= 1) {
      ctx.error("left", "SAFE_AREA_OVERLAP_H", `safeArea left+right margin (${left + right}) must be < 1`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Profile
// ═══════════════════════════════════════════════════════════════════════════

function validateProfile(p: Record<string, unknown>, ctx: ValidationCtx): void {
  if (typeof p.fps !== "number" || !Number.isFinite(p.fps) || p.fps <= 0) {
    ctx.error("fps", "PROFILE_FPS_INVALID", "profile.fps must be a positive number", {
      received: p.fps,
    });
  }

  if (p.codec !== undefined && typeof p.codec !== "string") {
    ctx.error("codec", "PROFILE_CODEC_INVALID", "profile.codec must be a string", {
      received: typeof p.codec,
    });
  }

  if (p.pixelFormat !== undefined && typeof p.pixelFormat !== "string") {
    ctx.error("pixelFormat", "PROFILE_PIXEL_FORMAT_INVALID", "profile.pixelFormat must be a string", {
      received: typeof p.pixelFormat,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Stale marker
// ═══════════════════════════════════════════════════════════════════════════

function validateStaleMarker(s: Record<string, unknown>, ctx: ValidationCtx): void {
  if (typeof s.source !== "string" || s.source.length === 0) {
    ctx.warning("source", "STALE_SOURCE_INVALID", "stale.source should be a non-empty string");
  }
  if (typeof s.reason !== "string" || s.reason.length === 0) {
    ctx.warning("reason", "STALE_REASON_EMPTY", "stale.reason should describe the change");
  }
  if (typeof s.detectedAt !== "string" || s.detectedAt.length === 0) {
    ctx.warning("detectedAt", "STALE_TIMESTAMP_INVALID", "stale.detectedAt should be an ISO-8601 timestamp");
  }

  // Stale marker with valid fields → hard error: reject before rendering
  if (
    typeof s.source === "string" && s.source.length > 0 &&
    typeof s.reason === "string" && s.reason.length > 0
  ) {
    ctx.error("stale", "STALE_DEPENDENCY", `Stale dependency detected: ${s.source} — ${s.reason}`, {
      source: s.source,
      reason: s.reason,
      detectedAt: s.detectedAt,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenes
// ═══════════════════════════════════════════════════════════════════════════

interface ParsedScene {
  index: number;
  id: string;
  inPoint: number;
  outPoint: number;
  timelineStart: number;
  duration: number; // computed from in/out
  explicitDuration?: number;
  raw: Record<string, unknown>;
}

function validateScenes(scenes: Record<string, unknown>[], ctx: ValidationCtx): void {
  const parsed: ParsedScene[] = [];
  const ids = new Set<string>();

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const sctx = ctx.idx(i);

    if (!isObject(s)) {
      sctx.error("", "SCENE_NOT_OBJECT", `Scene at index ${i} must be an object`);
      continue;
    }

    // id
    if (typeof s.id !== "string" || s.id.length === 0) {
      sctx.error("id", "SCENE_ID_MISSING", "Scene must have a non-empty string id", {
        index: i,
      });
    } else if (ids.has(s.id)) {
      sctx.error("id", "SCENE_ID_DUPLICATE", `Duplicate scene id "${s.id}"`, { id: s.id });
    } else {
      ids.add(s.id);
    }

    // asset
    if (!isObject(s.asset)) {
      sctx.error("asset", "SCENE_ASSET_MISSING", "Scene must have an asset reference");
    } else {
      validateAssetRef(s.asset as Record<string, unknown>, sctx.at("asset"));
    }

    // inPoint
    if (typeof s.inPoint !== "number" || !Number.isFinite(s.inPoint) || s.inPoint < 0) {
      sctx.error("inPoint", "SCENE_IN_POINT_INVALID", "inPoint must be a non-negative finite number", {
        received: s.inPoint,
      });
    }

    // outPoint
    if (typeof s.outPoint !== "number" || !Number.isFinite(s.outPoint)) {
      sctx.error("outPoint", "SCENE_OUT_POINT_INVALID", "outPoint must be a finite number", {
        received: s.outPoint,
      });
    }

    // timelineStart
    if (typeof s.timelineStart !== "number" || !Number.isFinite(s.timelineStart) || s.timelineStart < 0) {
      sctx.error("timelineStart", "SCENE_TIMELINE_START_INVALID", "timelineStart must be a non-negative finite number", {
        received: s.timelineStart,
      });
    }

    // duration consistency
    const inP = s.inPoint as number;
    const outP = s.outPoint as number;
    let computedDuration = 0;

    if (typeof inP === "number" && Number.isFinite(inP) && typeof outP === "number" && Number.isFinite(outP)) {
      if (outP <= inP) {
        sctx.error("outPoint", "SCENE_DURATION_INVALID", `outPoint (${outP}) must be greater than inPoint (${inP})`, {
          inPoint: inP,
          outPoint: outP,
        });
      } else {
        computedDuration = outP - inP;
      }
    }

    const explicitDuration = s.duration;
    if (explicitDuration !== undefined) {
      if (typeof explicitDuration !== "number" || !Number.isFinite(explicitDuration) || explicitDuration <= 0) {
        sctx.error("duration", "SCENE_DURATION_NAN", "duration must be a positive finite number when provided", {
          received: explicitDuration,
        });
      } else if (computedDuration > 0 && explicitDuration !== computedDuration) {
        // NEVER silently clamp — reject the mismatch
        sctx.error(
          "duration",
          "SCENE_DURATION_MISMATCH",
          `Explicit duration (${explicitDuration}) does not match outPoint − inPoint (${computedDuration}). ` +
          `The validator never adjusts editorial timing silently. Fix the values so they agree.`,
          { explicitDuration, computedDuration, inPoint: inP, outPoint: outP },
        );
      }
    }

    // Sub-objects
    if (s.transition !== undefined) {
      if (!isObject(s.transition)) {
        sctx.error("transition", "TRANSITION_NOT_OBJECT", "transition must be an object");
      } else {
        validateTransition(s.transition as Record<string, unknown>, sctx.at("transition"), {
          sceneDuration: explicitDuration as number ?? computedDuration,
          isFirst: i === 0,
        });
      }
    }

    if (s.caption !== undefined) {
      if (!isObject(s.caption)) {
        sctx.error("caption", "CAPTION_NOT_OBJECT", "caption must be an object");
      } else {
        validateCaption(
          s.caption as Record<string, unknown>,
          sctx.at("caption"),
          explicitDuration as number ?? computedDuration,
        );
      }
    }

    if (s.audio !== undefined) {
      if (!isObject(s.audio)) {
        sctx.error("audio", "AUDIO_NOT_OBJECT", "audio must be an object");
      } else {
        validateAudio(
          s.audio as Record<string, unknown>,
          sctx.at("audio"),
          explicitDuration as number ?? computedDuration,
        );
      }
    }

    if (s.transform !== undefined) {
      if (!isObject(s.transform)) {
        sctx.error("transform", "TRANSFORM_NOT_OBJECT", "transform must be an object");
      } else {
        validateTransform(s.transform as Record<string, unknown>, sctx.at("transform"));
      }
    }

    if (s.filters !== undefined) {
      validateFilters(s.filters, sctx.at("filters"));
    }

    parsed.push({
      index: i,
      id: (s.id as string) ?? `_index_${i}`,
      inPoint: inP as number,
      outPoint: outP as number,
      timelineStart: s.timelineStart as number,
      duration: computedDuration,
      explicitDuration: explicitDuration as number | undefined,
      raw: s,
    });
  }

  // ─── Cross-scene checks (ordering, overlap) ────────────────────────────
  validateSceneOrdering(parsed, ctx);
}

function validateAssetRef(a: Record<string, unknown>, ctx: ValidationCtx): void {
  if (typeof a.path !== "string" || a.path.length === 0) {
    ctx.error("path", "ASSET_PATH_EMPTY", "asset.path must be a non-empty string");
  }

  if (a.hash !== undefined && typeof a.hash !== "string") {
    ctx.error("hash", "ASSET_HASH_INVALID", "asset.hash must be a string", { received: typeof a.hash });
  }

  if (a.revision !== undefined && typeof a.revision !== "string") {
    ctx.error("revision", "ASSET_REVISION_INVALID", "asset.revision must be a string", { received: typeof a.revision });
  }
}

function validateTransition(
  t: Record<string, unknown>,
  ctx: ValidationCtx,
  sceneInfo: { sceneDuration: number; isFirst: boolean },
): void {
  const validTypes = new Set(["dissolve", "fade", "wipe", "none"]);

  if (typeof t.type !== "string" || !validTypes.has(t.type)) {
    ctx.error("type", "TRANSITION_TYPE_INVALID", `transition.type must be one of: ${[...validTypes].join(", ")}`, {
      received: t.type,
    });
  }

  if (typeof t.duration !== "number" || !Number.isFinite(t.duration) || t.duration <= 0) {
    ctx.error("duration", "TRANSITION_DURATION_INVALID", "transition.duration must be a positive finite number", {
      received: t.duration,
    });
  } else if (sceneInfo.sceneDuration > 0 && t.duration > sceneInfo.sceneDuration) {
    ctx.error(
      "duration",
      "TRANSITION_EXCEEDS_SCENE",
      `Transition duration (${t.duration}s) exceeds scene duration (${sceneInfo.sceneDuration}s)`,
      { transitionDuration: t.duration, sceneDuration: sceneInfo.sceneDuration },
    );
  }

  if (t.duration !== undefined && t.type === "none") {
    ctx.warning("type", "TRANSITION_NONE_WITH_DURATION", "Transition type is 'none' but duration is set; duration will be ignored");
  }

  if (t.easing !== undefined && typeof t.easing !== "string") {
    ctx.warning("easing", "TRANSITION_EASING_INVALID", "transition.easing should be a string", {
      received: typeof t.easing,
    });
  }

  // Transitions apply between scenes; the first scene's transition is meaningless
  if (sceneInfo.isFirst && t.type !== "none") {
    ctx.warning("type", "TRANSITION_ON_FIRST_SCENE", "Transition on the first scene has no preceding scene to transition from; it will be ignored");
  }
}

function validateCaption(
  c: Record<string, unknown>,
  ctx: ValidationCtx,
  sceneDuration: number,
): void {
  if (typeof c.text !== "string" || c.text.length === 0) {
    ctx.error("text", "CAPTION_TEXT_EMPTY", "caption.text must be a non-empty string");
  }

  // start
  if (typeof c.start !== "number" || !Number.isFinite(c.start) || c.start < 0) {
    ctx.error("start", "CAPTION_START_INVALID", "caption.start must be a non-negative number", {
      received: c.start,
    });
  }

  // duration
  if (typeof c.duration !== "number" || !Number.isFinite(c.duration) || c.duration <= 0) {
    ctx.error("duration", "CAPTION_DURATION_INVALID", "caption.duration must be a positive number", {
      received: c.duration,
    });
  }

  // Bounds check
  if (
    typeof c.start === "number" && Number.isFinite(c.start) &&
    typeof c.duration === "number" && Number.isFinite(c.duration) &&
    sceneDuration > 0
  ) {
    const end = c.start + c.duration;
    if (end > sceneDuration) {
      ctx.error(
        "start",
        "CAPTION_EXCEEDS_SCENE",
        `Caption ends at ${end}s but scene is only ${sceneDuration}s long`,
        { captionStart: c.start, captionDuration: c.duration, sceneDuration },
      );
    }
  }

  // Optional fields
  if (c.font !== undefined && typeof c.font !== "string") {
    ctx.warning("font", "CAPTION_FONT_INVALID", "caption.font must be a string");
  }
  if (c.fontSize !== undefined) {
    if (typeof c.fontSize !== "number" || !Number.isFinite(c.fontSize) || c.fontSize <= 0) {
      ctx.error("fontSize", "CAPTION_FONT_SIZE_INVALID", "caption.fontSize must be a positive number", {
        received: c.fontSize,
      });
    }
  }
  if (c.color !== undefined && typeof c.color !== "string") {
    ctx.warning("color", "CAPTION_COLOR_INVALID", "caption.color must be a string");
  }
  if (c.backgroundColor !== undefined && typeof c.backgroundColor !== "string") {
    ctx.warning("backgroundColor", "CAPTION_BG_COLOR_INVALID", "caption.backgroundColor must be a string");
  }
  const validPositions = ["top", "bottom", "center"];
  if (c.position !== undefined && (typeof c.position !== "string" || !validPositions.includes(c.position))) {
    ctx.warning("position", "CAPTION_POSITION_INVALID", `caption.position must be one of: ${validPositions.join(", ")}`);
  }
  if (c.offsetY !== undefined && (typeof c.offsetY !== "number" || !Number.isFinite(c.offsetY))) {
    ctx.warning("offsetY", "CAPTION_OFFSET_INVALID", "caption.offsetY must be a number");
  }
}

function validateAudio(
  a: Record<string, unknown>,
  ctx: ValidationCtx,
  sceneDuration: number,
): void {
  if (a.volume !== undefined) {
    if (typeof a.volume !== "number" || !Number.isFinite(a.volume) || a.volume < 0) {
      ctx.error("volume", "AUDIO_VOLUME_INVALID", "audio.volume must be a non-negative number", {
        received: a.volume,
      });
    }
  }

  if (a.fadeIn !== undefined) {
    if (typeof a.fadeIn !== "number" || !Number.isFinite(a.fadeIn) || a.fadeIn < 0) {
      ctx.error("fadeIn", "AUDIO_FADE_IN_INVALID", "audio.fadeIn must be a non-negative number", {
        received: a.fadeIn,
      });
    }
  }

  if (a.fadeOut !== undefined) {
    if (typeof a.fadeOut !== "number" || !Number.isFinite(a.fadeOut) || a.fadeOut < 0) {
      ctx.error("fadeOut", "AUDIO_FADE_OUT_INVALID", "audio.fadeOut must be a non-negative number", {
        received: a.fadeOut,
      });
    }
  }

  // fade overlap check
  if (
    typeof a.fadeIn === "number" && Number.isFinite(a.fadeIn) &&
    typeof a.fadeOut === "number" && Number.isFinite(a.fadeOut) &&
    sceneDuration > 0
  ) {
    if (a.fadeIn + a.fadeOut > sceneDuration) {
      ctx.error(
        "fadeIn",
        "AUDIO_FADE_OVERLAP",
        `fadeIn (${a.fadeIn}s) + fadeOut (${a.fadeOut}s) exceeds scene duration (${sceneDuration}s)`,
        { fadeIn: a.fadeIn, fadeOut: a.fadeOut, sceneDuration },
      );
    }
  }

  if (a.mute !== undefined && typeof a.mute !== "boolean") {
    ctx.warning("mute", "AUDIO_MUTE_NOT_BOOL", "audio.mute must be a boolean", { received: typeof a.mute });
  }
}

function validateTransform(t: Record<string, unknown>, ctx: ValidationCtx): void {
  if (t.crop !== undefined) {
    if (!isObject(t.crop)) {
      ctx.error("crop", "CROP_NOT_OBJECT", "transform.crop must be an object");
    } else {
      validateCrop(t.crop as Record<string, unknown>, ctx.at("crop"));
    }
  }

  const validFits = ["contain", "cover", "fill", "none"];
  if (t.fit !== undefined && (typeof t.fit !== "string" || !validFits.includes(t.fit))) {
    ctx.error("fit", "TRANSFORM_FIT_INVALID", `transform.fit must be one of: ${validFits.join(", ")}`, {
      received: t.fit,
    });
  }

  if (t.scale !== undefined) {
    if (typeof t.scale !== "number" || !Number.isFinite(t.scale) || t.scale <= 0) {
      ctx.error("scale", "TRANSFORM_SCALE_INVALID", "transform.scale must be a positive number", {
        received: t.scale,
      });
    }
  }

  if (t.position !== undefined) {
    if (!isObject(t.position)) {
      ctx.error("position", "TRANSFORM_POSITION_NOT_OBJECT", "transform.position must be an object with x and y");
    } else {
      const pos = t.position as Record<string, unknown>;
      if (typeof pos.x !== "number" || !Number.isFinite(pos.x)) {
        ctx.error("position.x", "TRANSFORM_POSITION_X_INVALID", "transform.position.x must be a finite number", {
          received: pos.x,
        });
      }
      if (typeof pos.y !== "number" || !Number.isFinite(pos.y)) {
        ctx.error("position.y", "TRANSFORM_POSITION_Y_INVALID", "transform.position.y must be a finite number", {
          received: pos.y,
        });
      }
    }
  }
}

function validateCrop(cr: Record<string, unknown>, ctx: ValidationCtx): void {
  for (const f of ["x", "y", "width", "height"] as const) {
    if (typeof cr[f] !== "number" || !Number.isFinite(cr[f]) || cr[f]! < 0) {
      ctx.error(f, "CROP_VALUE_INVALID", `crop.${f} must be a non-negative finite number`, {
        received: cr[f],
      });
    }
  }
  if (typeof cr.width === "number" && cr.width === 0) {
    ctx.error("width", "CROP_WIDTH_ZERO", "crop.width must be greater than 0");
  }
  if (typeof cr.height === "number" && cr.height === 0) {
    ctx.error("height", "CROP_HEIGHT_ZERO", "crop.height must be greater than 0");
  }
}

function validateFilters(f: unknown, ctx: ValidationCtx): void {
  if (!Array.isArray(f)) {
    ctx.error("", "FILTERS_NOT_ARRAY", "filters must be an array");
    return;
  }

  for (let i = 0; i < (f as unknown[]).length; i++) {
    const fi = (f as unknown[])[i];
    const fictx = ctx.idx(i);

    if (!isObject(fi)) {
      fictx.error("", "FILTER_NOT_OBJECT", `Filter at index ${i} must be an object`);
      continue;
    }

    const fo = fi as Record<string, unknown>;
    if (typeof fo.name !== "string" || fo.name.length === 0) {
      fictx.error("name", "FILTER_NAME_MISSING", "filter.name must be a non-empty string");
    }

    if (fo.params !== undefined) {
      if (!isObject(fo.params)) {
        fictx.error("params", "FILTER_PARAMS_INVALID", "filter.params must be an object", {
          received: typeof fo.params,
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cross-scene checks
// ═══════════════════════════════════════════════════════════════════════════

function validateSceneOrdering(parsed: ParsedScene[], ctx: ValidationCtx): void {
  const base = ctx.at("scenes");

  // Check non-decreasing timelineStart
  let prevTimelineStart = -1;
  for (const s of parsed) {
    if (typeof s.timelineStart === "number" && Number.isFinite(s.timelineStart)) {
      if (s.timelineStart < prevTimelineStart) {
        base.error(
          `[${s.index}].timelineStart`,
          "SCENE_ORDER_VIOLATED",
          `Scene "${s.id}" timelineStart (${s.timelineStart}) is before previous scene's (${prevTimelineStart}). ` +
          `Scenes must be in non-decreasing timelineStart order.`,
          { sceneId: s.id, timelineStart: s.timelineStart, previousTimelineStart: prevTimelineStart },
        );
      }
      prevTimelineStart = s.timelineStart;
    }
  }

  // Check overlap: scene[i].timelineStart + scene[i].duration > scene[i+1].timelineStart
  for (let i = 0; i < parsed.length - 1; i++) {
    const cur = parsed[i];
    const next = parsed[i + 1];

    if (cur.duration > 0 && typeof cur.timelineStart === "number" && typeof next.timelineStart === "number") {
      const curEnd = cur.timelineStart + cur.duration;
      const gap = next.timelineStart - curEnd;

      if (gap < 0) {
        // Overlap — hard error: never silently reorder
        base.error(
          `[${i}].timelineStart`,
          "SCENE_OVERLAP",
          `Scene "${cur.id}" ends at ${curEnd}s but scene "${next.id}" starts at ${next.timelineStart}s ` +
          `(overlap of ${-gap}s). Overlapping scenes are not supported.`,
          {
            sceneA: cur.id,
            sceneB: next.id,
            endA: curEnd,
            startB: next.timelineStart,
            overlap: -gap,
          },
        );
      } else if (gap > 0) {
        // Gap — warn (editorial intent may want silence)
        base.warning(
          `[${i}].timelineStart`,
          "SCENE_GAP",
          `Gap of ${gap}s between scene "${cur.id}" (ends ${curEnd}s) and scene "${next.id}" (starts ${next.timelineStart}s)`,
          {
            sceneA: cur.id,
            sceneB: next.id,
            endA: curEnd,
            startB: next.timelineStart,
            gap,
          },
        );
      }
    }
  }

  // Check transition durations don't exceed adjacent scene durations
  for (let i = 0; i < parsed.length; i++) {
    const s = parsed[i];
    const tr = s.raw.transition as Record<string, unknown> | undefined;
    if (!tr) continue;

    const trDuration = tr.duration as number;
    if (typeof trDuration !== "number" || !Number.isFinite(trDuration) || trDuration <= 0) continue;

    if (i === 0) {
      // First scene with transition: warn only (already done in validateTransition)
      continue;
    }

    const prev = parsed[i - 1];
    if (trDuration > s.duration) {
      base.error(
        `[${i}].transition.duration`,
        "TRANSITION_EXCEEDS_CURRENT_SCENE",
        `Transition duration (${trDuration}s) exceeds current scene "${s.id}" duration (${s.duration}s)`,
        { transitionDuration: trDuration, sceneDuration: s.duration, sceneId: s.id },
      );
    }
    if (prev.duration > 0 && trDuration > prev.duration) {
      base.error(
        `[${i}].transition.duration`,
        "TRANSITION_EXCEEDS_PREVIOUS_SCENE",
        `Transition duration (${trDuration}s) exceeds previous scene "${prev.id}" duration (${prev.duration}s)`,
        { transitionDuration: trDuration, prevSceneDuration: prev.duration, prevSceneId: prev.id },
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Asset validation (injectable probe)
// ═══════════════════════════════════════════════════════════════════════════

async function validateAssets(
  scenes: Record<string, unknown>[],
  probe: import("./types.js").AssetProbe,
  ctx: ValidationCtx,
): Promise<void> {
  const probed = new Map<string, AssetProbeResult | null>();

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!isObject(s)) continue;

    const asset = s.asset as Record<string, unknown> | undefined;
    if (!isObject(asset) || typeof asset.path !== "string" || asset.path.length === 0) continue;

    const path = asset.path as string;
    const sctx = ctx.idx(i).at("asset");

    // Probe (deduped by path)
    let result: AssetProbeResult | null;
    if (probed.has(path)) {
      result = probed.get(path)!;
    } else {
      try {
        result = await probe(path);
      } catch (err) {
        result = null;
      }
      probed.set(path, result);
    }

    if (!result) {
      sctx.error("path", "ASSET_NOT_FOUND", `Asset not found or unreadable: ${path}`, { path });
      continue;
    }

    // Hash check
    if (typeof asset.hash === "string" && asset.hash.length > 0) {
      if (result.hash && result.hash !== asset.hash) {
        sctx.error("hash", "ASSET_HASH_MISMATCH", `Asset hash mismatch for ${path}: expected ${asset.hash}, got ${result.hash}`, {
          path,
          expected: asset.hash,
          actual: result.hash,
        });
      } else if (!result.hash) {
        sctx.warning("hash", "ASSET_HASH_UNAVAILABLE", `Cannot verify hash for ${path}: probe returned no hash`, {
          path,
        });
      }
    }

    // Revision check
    if (typeof asset.revision === "string" && asset.revision.length > 0) {
      if (result.revision && result.revision !== asset.revision) {
        sctx.warning("revision", "ASSET_REVISION_MISMATCH", `Asset revision mismatch for ${path}: expected ${asset.revision}, got ${result.revision}`, {
          path,
          expected: asset.revision,
          actual: result.revision,
        });
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidVersion(v: unknown): v is TimelineVersion {
  return v === "1.0";
}

function finish(ctx: ValidationCtx): ValidationResult {
  const errors = [...ctx.errors];
  const warnings = [...ctx.warnings];

  // In strict mode, warnings become errors
  if (ctx.options.strict) {
    for (const w of warnings) {
      errors.push({ ...w });
    }
    warnings.length = 0;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
