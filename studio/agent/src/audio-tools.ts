// ---------------------------------------------------------------------------
// Audio editing for Pi (avg-8hs.5): render a recipe in an episode or a
// source — takes cut on words, pauses reshaped, beds layered and ducked, the
// mix mastered — and analyse any audio file.
// ---------------------------------------------------------------------------

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { join } from "node:path";
import { analyzeAudio, sourcePath } from "@av/audio-edit";
import { editAudio, type EditRecipe } from "@studio/episode";
import { WORKSPACE_PARAMS, workspaceOf } from "./workspace-target.js";

const fail = (error: unknown) => ({
  content: [{ type: "text" as const, text: `❌ ${(error as { code?: string }).code ? `${(error as { code: string }).code}: ` : ""}${error instanceof Error ? error.message : String(error)}` }],
  details: {} as Record<string, unknown>,
  isError: true as unknown as boolean,
});

const db = (n: number | null | undefined, unit: string) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : `${n.toFixed(1)} ${unit}`);

export function registerAudioTools(pi: ExtensionAPI): void {
  const libraryRoot = () => process.env.AVG_LIBRARY_ROOT || join(process.cwd(), "library");

  pi.registerTool({
    name: "pva_edit_audio",
    label: "Edit Audio",
    description:
      "Make an audio file from others, in an episode or a channel source: cut and join takes (on words: { word, edge } cuts at the quietest point of " +
      "the pause beside it), reshape pauses with the take's own room tone, layer tracks with gains, fades, crossfades, gain curves and ducking, and " +
      "master the mix (loudness LUFS, true peak, head/tail trim, fades). Writes the file, <file>.edit.json (recipe, inputs and output by hash, " +
      "report, and the words carried from the takes) and <file>.peaks.json. A take made this way registers with pva_register_take and gets its " +
      "timing from pva_align_take with provider \"derived\". Load the audio-editing skill for how to write the recipe.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      recipe: Type.Any({ description: "The recipe: { output: { path, sampleRate?, channels? }, tracks: [{ id, gain?, duck?, clips: [{ id, source: { take } | { path }, in?, out?, at, gain?, fadeIn?, fadeOut?, crossfade?, automation? }] }], pauses?: [{ take, after, seconds }], master?: { gain?, loudness?, truePeak?, trim?, fadeIn?, fadeOut? } }" }),
    }),
    async execute(_id, params) {
      try {
        const ws = workspaceOf(libraryRoot(), params);
        const { record, recordPath } = await editAudio(ws.dir, params.recipe as EditRecipe);
        const r = record.report;
        const lines = [
          `${r.concerns.length === 0 ? "✅" : "⚠️"} ${record.output.path}: ${record.output.durationSeconds.toFixed(2)} s, ${db(r.loudness.integrated, "LUFS")}, true peak ${db(r.loudness.truePeak, "dBTP")}` +
            `${r.normalization !== "none" ? ` (${r.normalization})` : ""}; ${record.placements.length} clips, ${r.joins.length} joins` +
            `${record.words ? `, ${record.words.length} words carried` : ""} → ${recordPath}`,
          ...r.concerns.map((c) => `- ${c}`),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }], details: { recordPath, record } as unknown as Record<string, unknown> };
      } catch (error) {
        return fail(error);
      }
    },
  });

  pi.registerTool({
    name: "pva_analyze_audio",
    label: "Analyze Audio",
    description: "Measure an audio file of an episode or a source: duration, loudness (integrated LUFS, range, true peak), clipped samples, and its silences — to choose takes and set levels before an edit.",
    parameters: Type.Object({
      ...WORKSPACE_PARAMS,
      path: Type.String({ description: "The file, relative to the workspace (e.g. assets/takes/recita.1ac662cf.wav)" }),
    }),
    async execute(_id, params) {
      try {
        const ws = workspaceOf(libraryRoot(), params);
        const file = sourcePath(ws.dir, params.path);
        const a = await analyzeAudio(file);
        const inner = a.silences.filter(([s, e]) => s > 0.01 && e < a.durationSeconds - 0.01);
        const text = [
          `${params.path}: ${a.durationSeconds.toFixed(2)} s; ${db(a.loudness.integrated, "LUFS")}, range ${db(a.loudness.range, "LU")}, true peak ${db(a.loudness.truePeak, "dBTP")}; ${a.clipped} clipped samples`,
          `silences: ${inner.length} inside (${inner.slice(0, 12).map(([s, e]) => `${s.toFixed(2)}–${e.toFixed(2)}`).join(", ")}${inner.length > 12 ? ", …" : ""})` +
            `${a.silences[0] && a.silences[0][0] <= 0.01 ? `; ${a.silences[0][1].toFixed(2)} s at the head` : ""}`,
        ].join("\n");
        const { peaks: _p, rms: _r, ...summary } = a;
        return { content: [{ type: "text" as const, text }], details: summary as unknown as Record<string, unknown> };
      } catch (error) {
        return fail(error);
      }
    },
  });
}
