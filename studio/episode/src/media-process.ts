import { spawn } from "node:child_process";

/** Async, no shell, bounded diagnostics, cancellation waits for the child to exit. */
export async function mediaCommand(command: string, args: string[], signal?: AbortSignal, timeoutMs = 10 * 60_000): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", stopped: Error | undefined, escalation: ReturnType<typeof setTimeout> | undefined;
    child.stdout.on("data", (b: Buffer) => { stdout = (stdout + b.toString()).slice(-64_000); });
    child.stderr.on("data", (b: Buffer) => { stderr = (stderr + b.toString()).slice(-4000); });
    const stop = (reason: Error) => {
      if (stopped) return;
      stopped = reason; child.kill("SIGTERM");
      escalation = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const cancel = () => stop(new Error("Media production cancelled"));
    const timer = setTimeout(() => stop(new Error(`${command} exceeded ${timeoutMs}ms`)), timeoutMs);
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const cleanup = () => { clearTimeout(timer); if (escalation) clearTimeout(escalation); signal?.removeEventListener("abort", cancel); };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => { cleanup(); if (stopped) reject(stopped); else if (code !== 0) reject(new Error(`${command} failed (${code}): ${stderr}`)); else resolve(stdout); });
  });
}
export const mediaFfmpeg = (args: string[], signal?: AbortSignal) => mediaCommand(process.env.FFMPEG_PATH ?? "ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...args], signal);
export async function measureProducedMedia(file: string, signal?: AbortSignal): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  const json = await mediaCommand(process.env.FFPROBE_PATH ?? "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file], signal, 30_000);
  const data = JSON.parse(json), video = data.streams?.find((s: any) => s.codec_type === "video" && s.width && s.height);
  const duration = Number(data.format?.duration);
  return { ...(video ? { width: video.width, height: video.height } : {}), ...(Number.isFinite(duration) && duration > 0 ? { durationSeconds: duration } : {}) };
}
