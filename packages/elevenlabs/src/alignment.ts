// Forced alignment (avg-8hs.2): when each word of a known text is spoken in
// an audio file. https://elevenlabs.io/docs/api-reference/forced-alignment/create

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ElevenLabsError } from "./errors.js";
import { postForm, type RequestOptions } from "./request.js";

export interface AlignedWord {
  text: string;
  start: number;
  end: number;
  /** ElevenLabs' alignment loss for the word: lower is better. */
  loss?: number;
}

export interface ForcedAlignmentResult {
  words: AlignedWord[];
  /** The whole transcript's average loss. */
  loss?: number;
}

export interface ForcedAlignmentOptions extends RequestOptions {
  audioPath: string;
  text: string;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export async function forcedAlignment(options: ForcedAlignmentOptions): Promise<ForcedAlignmentResult> {
  const audio = await readFile(options.audioPath);
  const answer = await postForm("/v1/forced-alignment", () => {
    const form = new FormData();
    form.append("file", new Blob([audio]), basename(options.audioPath));
    form.append("text", options.text);
    return form;
  }, options) as { words?: unknown; loss?: unknown };
  if (!Array.isArray(answer?.words)) throw new ElevenLabsError("uncertain", "ElevenLabs answered without words");
  const words = answer.words.flatMap((w: { text?: unknown; start?: unknown; end?: unknown; loss?: unknown }) =>
    typeof w?.text === "string" && isNumber(w.start) && isNumber(w.end)
      ? [{ text: w.text, start: w.start, end: w.end, ...(isNumber(w.loss) ? { loss: w.loss } : {}) }]
      : []);
  return { words, ...(isNumber(answer.loss) ? { loss: answer.loss } : {}) };
}
