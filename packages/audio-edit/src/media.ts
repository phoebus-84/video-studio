import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AudioEditError } from "./errors.js";

export const run = promisify(execFile);
export const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";
export const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";

/** A file's audio duration, in seconds; `bad-audio` when it has no audio ffprobe can read. */
export async function audioDuration(file: string): Promise<number> {
  try {
    const { stdout } = await run(FFPROBE(), ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration:format=duration", "-of", "json", file]);
    const info = JSON.parse(stdout) as { streams?: { duration?: string }[]; format?: { duration?: string } };
    if (!info.streams || info.streams.length === 0) throw new Error("no audio stream");
    const seconds = Number(info.streams[0]!.duration ?? info.format?.duration);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("no duration");
    return seconds;
  } catch (error) {
    throw new AudioEditError("bad-audio", `${file} is not audio ffprobe can read: ${(error as Error).message}`);
  }
}
