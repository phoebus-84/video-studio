// ---------------------------------------------------------------------------
// The edit timeline, v1alpha2 (ADR-0034)
// ---------------------------------------------------------------------------
// A layered, kit-based account of an episode: tracks as in an NLE, visual
// items that are versioned kit instances, audio items that name an asset,
// sections that map spans back to the spec they were compiled from. Every
// time is an integer frame.
//
// The JSON Schema says what each record looks like. What a schema cannot say
// — overlaps on a track, references that must resolve, spans that must fit —
// is checked here, so the series compiler, the composer and the web all run
// the same rules through one function. Kit props are NOT checked here: only
// the composer knows a kit's schema.
//
// Every problem is reported, not just the first, as { code, message, path }
// with a JSON path such as $.tracks[2].items[5].from.
// ---------------------------------------------------------------------------

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/v1alpha2/edit-timeline.schema.json" with { type: "json" };

export const EDIT_TIMELINE_API_VERSION = "studio.video/v1alpha2";

/** Asset kinds an audio item may play: audio files, and the sound of a video. */
const AUDIBLE_KINDS = new Set(["audio", "video"]);

let compiled = null;

function schemaValidator() {
  if (!compiled) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(schema);
    compiled = ajv.getSchema(`${schema.$id}#/$defs/EditTimeline`);
  }
  return compiled;
}

/** "/tracks/2/items/0/from" → "$.tracks[2].items[0].from". */
export function jsonPath(pointer) {
  let out = "$";
  for (const raw of pointer.split("/").slice(1)) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(key) ? `[${key}]` : member(key);
  }
  return out;
}

function member(key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function issue(code, path, message) {
  return { code, message, path };
}

const trackPath = (ti) => `$.tracks[${ti}]`;
const itemPath = (ti, ii) => `$.tracks[${ti}].items[${ii}]`;
const isAudioItem = (item) => Object.hasOwn(item, "asset");

/**
 * Validate a v1alpha2 edit timeline.
 * @returns {{code: string, message: string, path: string}[]} every problem; empty when valid.
 */
export function validateEditTimeline(doc) {
  const validate = schemaValidator();
  if (!validate(doc)) {
    // Semantic checks assume the shape the schema guarantees; report shape first.
    return validate.errors.map((e) =>
      issue("schema", jsonPath(e.instancePath), `${e.instancePath || "/"} ${e.message}`),
    );
  }
  return [
    ...checkIds(doc),
    ...checkRanges(doc),
    ...checkTracks(doc),
    ...checkAssets(doc),
    ...checkOverlaps(doc),
    ...checkSections(doc),
    ...checkFades(doc),
  ];
}

function checkIds(doc) {
  const out = [];
  const registry = (kind) => {
    const seen = new Map();
    return (id, path) => {
      if (seen.has(id)) out.push(issue("duplicate-id", path, `${kind} id "${id}" is already used at ${seen.get(id)}`));
      else seen.set(id, path);
    };
  };
  const track = registry("track");
  const item = registry("item");
  const section = registry("section");
  doc.tracks.forEach((t, ti) => {
    track(t.id, `${trackPath(ti)}.id`);
    t.items.forEach((it, ii) => item(it.id, `${itemPath(ti, ii)}.id`));
  });
  (doc.sections ?? []).forEach((s, si) => section(s.id, `$.sections[${si}].id`));
  return out;
}

function checkRanges(doc) {
  const out = [];
  const end = doc.durationInFrames;
  const check = (span, path, what) => {
    if (span.from + span.duration > end) {
      out.push(issue("out-of-range", `${path}.duration`, `${what} ends at frame ${span.from + span.duration}, after the timeline ends at ${end}`));
    }
  };
  doc.tracks.forEach((t, ti) => t.items.forEach((it, ii) => check(it, itemPath(ti, ii), `item "${it.id}"`)));
  (doc.sections ?? []).forEach((s, si) => check(s, `$.sections[${si}]`, `section "${s.id}"`));
  return out;
}

function checkTracks(doc) {
  const out = [];
  const byId = new Map(doc.tracks.map((t) => [t.id, t]));
  doc.tracks.forEach((t, ti) => {
    const p = trackPath(ti);
    if (t.type === "visual" && t.z === undefined) {
      out.push(issue("missing-z", p, `visual track "${t.id}" needs a z`));
    }
    if (t.type === "audio" && t.z !== undefined) {
      out.push(issue("z-on-audio", `${p}.z`, `audio track "${t.id}" cannot have a z`));
    }
    if (t.duck) {
      if (t.type !== "audio") {
        out.push(issue("bad-duck", `${p}.duck`, `only an audio track can duck; "${t.id}" is ${t.type}`));
      }
      t.duck.under.forEach((id, ui) => {
        const target = byId.get(id);
        if (id === t.id || !target || target.type !== "audio") {
          const why = id === t.id ? "itself" : !target ? "a track that does not exist" : `a ${target.type} track`;
          out.push(issue("bad-duck", `${p}.duck.under[${ui}]`, `track "${t.id}" ducks under ${why} ("${id}")`));
        }
      });
    }
    t.items.forEach((it, ii) => {
      const audio = isAudioItem(it);
      if ((t.type === "audio") !== audio) {
        out.push(issue("item-type", itemPath(ti, ii), `${t.type} track "${t.id}" holds ${audio ? "an audio" : "a visual"} item`));
      }
    });
  });
  return out;
}

/** Every object with a string `$asset` key inside `value`, with its JSON path. */
function assetRefs(value, path, out = []) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => assetRefs(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    if (typeof value.$asset === "string") out.push({ id: value.$asset, path: `${path}.$asset` });
    for (const [k, v] of Object.entries(value)) {
      if (k !== "$asset") assetRefs(v, `${path}${member(k)}`, out);
    }
  }
  return out;
}

function checkAssets(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) =>
    t.items.forEach((it, ii) => {
      const p = itemPath(ti, ii);
      if (isAudioItem(it)) {
        const asset = Object.hasOwn(doc.assets, it.asset) ? doc.assets[it.asset] : null;
        if (!asset) out.push(issue("unknown-asset", `${p}.asset`, `asset "${it.asset}" is not declared in assets`));
        else if (!AUDIBLE_KINDS.has(asset.kind)) {
          out.push(issue("asset-kind", `${p}.asset`, `audio item "${it.id}" plays asset "${it.asset}" of kind ${asset.kind}`));
        }
      } else {
        for (const ref of assetRefs(it.props, `${p}.props`)) {
          if (!Object.hasOwn(doc.assets, ref.id)) {
            out.push(issue("unknown-asset", ref.path, `asset "${ref.id}" is not declared in assets`));
          }
        }
      }
    }),
  );
  return out;
}

function checkOverlaps(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) => {
    const order = t.items.map((it, ii) => ({ it, ii })).sort((a, b) => a.it.from - b.it.from || a.ii - b.ii);
    // `previous` is the earlier item that ends last; `before` is the latest end
    // among all the others. A crossfade may overlap `previous` only: if it also
    // reaches back into `before`, three items would be on screen at once.
    let previous = null;
    let before = -Infinity;
    for (const { it, ii } of order) {
      const p = itemPath(ti, ii);
      const end = it.from + it.duration;
      const lastEnd = previous ? previous.end : null;
      const crossfade = it.transitionIn?.type === "crossfade" ? it.transitionIn.duration : null;
      if (lastEnd === null || it.from >= lastEnd) {
        if (crossfade !== null) {
          const why = lastEnd === null ? "it is the first item on its track" : "it does not overlap the previous item";
          out.push(issue("bad-crossfade", `${p}.transitionIn`, `item "${it.id}" crossfades but ${why}`));
        }
      } else if (crossfade !== null) {
        const overlap = lastEnd - it.from;
        const problems = [];
        if (overlap !== crossfade) problems.push(`overlaps the previous item by ${overlap}`);
        if (end <= lastEnd) problems.push("ends inside it");
        if (it.from <= previous.from) problems.push("starts no later than it");
        if (it.from < before) problems.push(`also overlaps an earlier item that ends at ${before}`);
        if (problems.length > 0) {
          out.push(issue("bad-crossfade", `${p}.transitionIn`,
            `item "${it.id}" crossfades over ${crossfade} frames but ${problems.join(", ")}`));
        }
      } else {
        out.push(issue("overlap", `${p}.from`, `item "${it.id}" starts at ${it.from}, before the previous item on track "${t.id}" ends at ${lastEnd}`));
      }
      if (!previous || end > previous.end) {
        if (previous) before = Math.max(before, previous.end);
        previous = { from: it.from, end };
      } else {
        before = Math.max(before, end);
      }
    }
  });
  return out;
}

function checkSections(doc) {
  const out = [];
  let previous = null;
  (doc.sections ?? []).forEach((s, si) => {
    if (previous && s.from < previous.from + previous.duration) {
      out.push(issue("section-overlap", `$.sections[${si}].from`,
        `section "${s.id}" starts at ${s.from}, before section "${previous.id}" ends at ${previous.from + previous.duration}`));
    }
    if (!previous || s.from + s.duration > previous.from + previous.duration) previous = s;
  });
  return out;
}

function checkFades(doc) {
  const out = [];
  doc.tracks.forEach((t, ti) =>
    t.items.forEach((it, ii) => {
      const p = itemPath(ti, ii);
      for (const key of ["fadeIn", "fadeOut"]) {
        if (it[key] !== undefined && it[key] > it.duration) {
          out.push(issue("fade-too-long", `${p}.${key}`, `${key} of ${it[key]} frames is longer than item "${it.id}" (${it.duration})`));
        }
      }
      for (const key of ["transitionIn", "transitionOut"]) {
        if (it[key] && it[key].duration > it.duration) {
          out.push(issue("fade-too-long", `${p}.${key}.duration`, `${key} of ${it[key].duration} frames is longer than item "${it.id}" (${it.duration})`));
        }
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Migration from v1alpha1
// ---------------------------------------------------------------------------
// v1alpha1 is a sequence of segments in seconds. Each segment becomes a
// `still` (or `clip`, for video) item on one visual track; captions become a
// `captions` track; a dissolve or wipe into the next segment becomes a
// crossfade that keeps every segment's start time (the earlier item is
// lengthened), a fade becomes a transitionOut. The sound of a video segment
// becomes an audio item. Segment audio settings on images are dropped: an
// image has no sound. v1alpha2 requires a content hash for every asset and
// v1alpha1 had none, so the caller supplies them; a missing one is an error.
// The result is validated before it is returned: a v1alpha1 document v1alpha2
// cannot express (an id with spaces, overlapping captions) throws.

const CAPTION_PROPS = ["position", "font", "fontSize", "color", "backgroundColor"];

/**
 * @param {object} doc a studio.video/v1alpha1 EditTimeline
 * @param {{assetHashes?: Record<string, string>}} options content hash per sourceAsset path
 * @returns {object} a studio.video/v1alpha2 EditTimeline
 */
export function migrateEditTimelineV1alpha1(doc, { assetHashes = {} } = {}) {
  if (doc?.apiVersion !== "studio.video/v1alpha1" || doc?.kind !== "EditTimeline") {
    throw new TypeError("expected a studio.video/v1alpha1 EditTimeline");
  }
  if (!Number.isInteger(doc.fps)) {
    throw new RangeError(`fps ${doc.fps} is not an integer; v1alpha2 counts whole frames`);
  }
  const frames = (seconds) => Math.round(seconds * doc.fps);
  // Round absolute times, never a start and a length separately: two
  // segments that touch in seconds must still touch in frames.
  const span = (startSec, durationSec) => {
    const from = frames(startSec);
    return { from, duration: Math.max(1, frames(startSec + durationSec) - from) };
  };

  const missing = [...new Set(doc.segments.map((s) => s.sourceAsset))].filter((p) => !assetHashes[p]);
  if (missing.length > 0) throw new Error(`no content hash for: ${missing.join(", ")}`);

  const assets = {};
  const main = [];
  const captions = [];
  const sound = [];

  doc.segments.forEach((s) => {
    const kind = s.sourceKind === "video" ? "video" : "image";
    const { from, duration } = span(s.startSec, s.durationSec);
    assets[s.id] = { path: s.sourceAsset, hash: assetHashes[s.sourceAsset], kind };
    const props = { src: { $asset: s.id } };
    if (s.transform?.fit) props.fit = s.transform.fit;
    if (s.transform?.scale) props.scale = s.transform.scale;
    main.push({ id: s.id, from, duration, kit: { name: kind === "video" ? "clip" : "still", version: "1.0.0" }, props });
    if (s.caption) {
      const at = span(s.startSec + s.caption.start, s.caption.duration);
      captions.push(captionItem(`${s.id}-caption`, at.from, at.duration, s.caption));
    }
    // In v1alpha1 a scene's sound plays unless `audio.mute` says otherwise.
    if (kind === "video" && !s.audio?.mute) {
      sound.push(compact({
        id: `${s.id}-sound`, from, duration, asset: s.id,
        gain: s.audio?.volume,
        fadeIn: s.audio?.fadeIn === undefined ? undefined : frames(s.audio.fadeIn),
        fadeOut: s.audio?.fadeOut === undefined ? undefined : frames(s.audio.fadeOut),
      }));
    }
  });

  const transitions = new Map(doc.segments.map((s, i) => [i, s.transition]));
  for (const t of doc.transitions ?? []) transitions.set(t.afterSegmentIndex, t);
  for (const [i, t] of transitions) {
    if (!t || t.type === "none" || !main[i]) continue;
    const d = frames(t.duration);
    if (d <= 0) continue;
    const next = main[i + 1];
    if ((t.type === "dissolve" || t.type === "wipe") && next) {
      main[i].duration = next.from + d - main[i].from;
      next.transitionIn = { type: "crossfade", duration: d };
    } else {
      main[i].transitionOut = { type: "fade", duration: d };
    }
  }

  (doc.captions ?? []).forEach((c, ci) => {
    const segment = doc.segments[c.segmentIndex];
    if (!segment) throw new RangeError(`captions[${ci}] names segment ${c.segmentIndex}, which does not exist`);
    const at = span(segment.startSec + c.start, c.duration);
    captions.push(captionItem(`caption-${ci + 1}`, at.from, at.duration, c));
  });

  const tracks = [{ id: "main", type: "visual", z: 0, items: main }];
  if (captions.length > 0) tracks.push({ id: "captions", type: "visual", z: 20, items: captions });
  if (sound.length > 0) tracks.push({ id: "sound", type: "audio", items: sound });

  const durationInFrames = Math.max(...tracks.flatMap((t) => t.items.map((it) => it.from + it.duration)));

  const migrated = {
    apiVersion: EDIT_TIMELINE_API_VERSION,
    kind: "EditTimeline",
    episodeRef: doc.episodeRef,
    revision: doc.revision,
    fps: doc.fps,
    durationInFrames,
    resolution: doc.resolution,
    assets,
    tracks,
    metadata: { migratedFrom: "studio.video/v1alpha1" },
  };
  // A migration returns a valid timeline or nothing: ids that v1alpha2 does not
  // allow, simultaneous captions, a dissolve longer than its segment all end here.
  const problems = validateEditTimeline(migrated);
  if (problems.length > 0) {
    throw new Error(`not a valid v1alpha2 timeline: ${problems.map((p) => `${p.code} at ${p.path}`).join("; ")}`);
  }
  return migrated;
}

function captionItem(id, from, duration, caption) {
  const props = { text: caption.text };
  for (const key of CAPTION_PROPS) if (caption[key] !== undefined) props[key] = caption[key];
  return { id, from, duration, kit: { name: "captions", version: "1.0.0" }, props };
}

function compact(record) {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined));
}
