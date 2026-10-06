// poetry-short@1.0.0 — released: never edit this file; add poetry-short/<next>.ts instead.
//
// A vertical poem: pictures that change on the words the spec names, one
// narration unit, captions grouped from the measured words. Everything this
// version does is in this file (it imports only the contracts' helpers and
// ../../types.js), and its golden test fails if its output ever changes.

import { resolveCues } from "@studio/contracts/src/cues.mjs";
import { layoutUnit } from "@studio/contracts/src/narration-takes.mjs";
import { outputProfile } from "@studio/contracts/src/output-profiles.mjs";
import type { CompileInput, CompileProblem, CompileResult, EditTimeline, SeriesCompiler } from "../../types.js";

const FPS = 30;
/** Frames a crossfade between two panels lasts, centred on their boundary. */
const CROSSFADE = 12;
/** A caption group closes before it would grow past this many characters. */
const CAPTION_CHARACTERS = 42;
const SENTENCE_PAUSE = /[.!?;:]$/;
const UNIT = "narration";
const SPEC_PATH = "episode-spec.json";

interface PoetryShortData {
  title: string;
  narration: string;
  holdSeconds: number;
  panels: { assetId: string; cue: string }[];
  style: {
    fontFamily: string;
    captionKit: { name: string; version: string };
    voiceProfile: string;
    outputProfile: string;
  };
}

const frames = (seconds: number) => Math.round(seconds * FPS);
const collapse = (text: string) => text.trim().split(/\s+/).join(" ");

function compile(input: CompileInput): CompileResult {
  const data = input.spec.data as unknown as PoetryShortData;
  const problems: CompileProblem[] = [];
  const warnings: string[] = [];

  const profile = outputProfile(data.style.outputProfile);
  if (!profile) {
    problems.push({ code: "unknown-profile", path: "$.data.style.outputProfile", message: `no output profile "${data.style.outputProfile}"` });
  }

  const specHash = input.inputs[SPEC_PATH];
  if (!specHash) {
    problems.push({ code: "missing-input", path: "$.inputs", message: `the hash of ${SPEC_PATH} was not supplied` });
  }

  // ── Narration ─────────────────────────────────────────────────────────────
  const unitIndex = input.narration.units.findIndex((u) => u.id === UNIT);
  if (unitIndex === -1) {
    problems.push({ code: "missing-unit", path: "$.units", message: `takes.json has no unit "${UNIT}"` });
    return { ok: false, problems };
  }
  const unit = input.narration.units[unitIndex]!;
  const texts = new Map(input.narration.takes.map((t) => [t.id, t.text]));
  const spoken = collapse(unit.sequence.map((entry) => texts.get(entry.take) ?? "").join(" "));
  if (spoken !== collapse(data.narration)) {
    problems.push({
      code: "narration-mismatch",
      path: "$.data.narration",
      message: `the takes of unit "${UNIT}" say "${spoken}", not the spec's narration`,
    });
  }

  const laid = layoutUnit(input.narration, UNIT, input.timings);
  if ("problems" in laid) {
    problems.push(...laid.problems);
    return { ok: false, problems };
  }
  const layout = laid.layout;

  // ── Panels on their cues ──────────────────────────────────────────────────
  const scope = { timing: layout.timing, startSeconds: 0, fps: FPS };
  const resolved = resolveCues(data.panels.map((panel, i) => ({ path: `$.data.panels[${i}].cue`, cue: panel.cue, scope })));
  problems.push(...resolved.problems);
  data.panels.forEach((panel, i) => {
    if (!input.assets[`image-${panel.assetId}`]) {
      problems.push({ code: "missing-asset", path: `$.data.panels[${i}].assetId`, message: `no image for "${panel.assetId}" in assets/images` });
    }
  });
  if (problems.length > 0) return { ok: false, problems };

  const cueFrames = data.panels.map((_, i) => resolved.frames[`$.data.panels[${i}].cue`]!);
  for (let i = 1; i < cueFrames.length; i++) {
    if (cueFrames[i]! <= cueFrames[i - 1]!) {
      return {
        ok: false,
        problems: [{
          code: "cue-order",
          path: `$.data.panels[${i}].cue`,
          message: `panel ${i + 1} starts at frame ${cueFrames[i]}, not after panel ${i} (frame ${cueFrames[i - 1]})`,
        }],
      };
    }
  }

  // ── Duration ──────────────────────────────────────────────────────────────
  // Voice items are rounded on absolute times, so pieces that touch in
  // seconds still touch in frames.
  const voiceItems = layout.pieces.map((piece, k) => {
    const from = frames(piece.at);
    return {
      id: `voice-${k + 1}`,
      from,
      duration: Math.max(1, frames(piece.at + piece.duration) - from),
      asset: `narration-${piece.take}`,
      ...(frames(piece.from) > 0 ? { trimStart: frames(piece.from) } : {}),
      source: "narration",
    };
  });
  const voiceEnd = Math.max(0, ...voiceItems.map((item) => item.from + item.duration));
  // A hair under the next frame is that frame: 7.5 s × 30 is 225, not 226.
  const durationInFrames = Math.max(1, voiceEnd, Math.ceil((layout.durationSeconds + data.holdSeconds) * FPS - 1e-6));

  // This template's schema allows only words as cues, and a word is said
  // before the voice ends; but a compiler does not re-validate its input, and
  // a panel starting after the end must not reach the validators as a bug.
  const late = cueFrames.findIndex((frame, i) => i > 0 && frame >= durationInFrames);
  if (late !== -1) {
    return {
      ok: false,
      problems: [{
        code: "cue-after-end",
        path: `$.data.panels[${late}].cue`,
        message: `panel ${late + 1} would start at frame ${cueFrames[late]}, at or after the end of the video (${durationInFrames} frames)`,
      }],
    };
  }

  // ── Panels ────────────────────────────────────────────────────────────────
  // The first panel opens the video whatever its cue; the last holds to the end.
  const bounds = [0, ...cueFrames.slice(1), durationInFrames];
  const length = (i: number) => bounds[i + 1]! - bounds[i]!;
  const fades = (i: number) => i > 0 && length(i - 1) > CROSSFADE && length(i) > CROSSFADE;
  const half = CROSSFADE / 2;
  const panelItems = data.panels.map((panel, i) => {
    const from = bounds[i]! - (fades(i) ? half : 0);
    const end = bounds[i + 1]! + (i + 1 < data.panels.length && fades(i + 1) ? half : 0);
    return {
      id: `panel-${i + 1}`,
      from,
      duration: end - from,
      kit: { name: "still", version: "1.0.0" },
      props: { src: { $asset: `image-${panel.assetId}` }, fit: "cover" },
      source: `panels[${i}]`,
      ...(fades(i) ? { transitionIn: { type: "crossfade" as const, duration: CROSSFADE } } : {}),
    };
  });

  // ── Captions ──────────────────────────────────────────────────────────────
  const groups: { text: string; from: number; end: number }[] = [];
  let group: typeof layout.timing.words = [];
  const close = () => {
    if (group.length === 0) return;
    groups.push({ text: group.map((w) => w.text).join(" "), from: frames(group[0]!.start), end: frames(group[group.length - 1]!.end) });
    group = [];
  };
  for (const word of layout.timing.words) {
    if (group.length > 0 && [...group, word].map((w) => w.text).join(" ").length > CAPTION_CHARACTERS) close();
    group.push(word);
    if (SENTENCE_PAUSE.test(word.text)) close();
  }
  close();
  const captionItems: Record<string, unknown>[] = [];
  groups.forEach((cue, i) => {
    const end = Math.min(cue.end, groups[i + 1]?.from ?? Infinity, durationInFrames);
    if (end <= cue.from) {
      warnings.push(`caption "${cue.text}" dropped: shorter than a frame once the next one starts`);
      return;
    }
    captionItems.push({
      id: `caption-${captionItems.length + 1}`,
      from: cue.from,
      duration: end - cue.from,
      kit: { name: data.style.captionKit.name, version: data.style.captionKit.version },
      props: { text: cue.text, position: "bottom", font: data.style.fontFamily },
      source: "narration",
    });
  });

  // ── Assets ────────────────────────────────────────────────────────────────
  const assets: EditTimeline["assets"] = {};
  for (const panel of data.panels) assets[`image-${panel.assetId}`] = { ...input.assets[`image-${panel.assetId}`]! };
  for (const piece of layout.pieces) {
    const id = `narration-${piece.take}`;
    const asset = input.assets[id];
    if (!asset) {
      return { ok: false, problems: [{ code: "missing-asset", path: "$.takes", message: `no audio asset "${id}" for take "${piece.take}"` }] };
    }
    assets[id] = { ...asset };
  }

  const tracks: EditTimeline["tracks"] = [{ id: "panels", type: "visual", z: 0, items: panelItems }];
  if (captionItems.length > 0) tracks.push({ id: "captions", type: "visual", z: 10, items: captionItems as never });
  tracks.push({ id: "voice", type: "audio", items: voiceItems });

  const timeline = {
    apiVersion: "studio.video/v1alpha2",
    kind: "EditTimeline",
    episodeRef: { ...input.spec.episodeRef },
    revision: 1,
    derivedFrom: {
      spec: { path: SPEC_PATH, hash: specHash!, revision: input.spec.revision },
      compiler: { id: compiler.id, version: compiler.version },
    },
    fps: FPS,
    durationInFrames,
    resolution: { width: profile!.width, height: profile!.height },
    profile: structuredClone(profile!),
    assets,
    tracks,
    sections: [{ id: "poem", from: 0, duration: durationInFrames, source: "title", chapter: { title: data.title } }],
    metadata: {
      builtBy: `@studio/series ${compiler.id}@${compiler.version}`,
      template: { ...input.spec.template },
      inputs: Object.fromEntries(Object.entries(input.inputs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    },
  } as EditTimeline;
  return { ok: true, timeline, warnings };
}

export const compiler: SeriesCompiler = {
  id: "poetry-short",
  version: "1.0.0",
  description: "A vertical poem: pictures changing on cued words, one narration unit, captions grouped from the measured words.",
  compile,
};
