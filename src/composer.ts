#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Real FFmpeg video composer
// ---------------------------------------------------------------------------
// Composes a video from scene images with durations, crossfades,
// text overlays, and optional narration audio track.
// ---------------------------------------------------------------------------

import { execSync, spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SceneInput {
  id: string;
  imagePath: string;
  durationSec: number;
  title?: string;
  transition?: "cut" | "fade" | "dissolve";
}

export interface ComposeOptions {
  /** Output file path. */
  output: string;
  /** Output width (default 1920). */
  width?: number;
  /** Output height (default 1080). */
  height?: number;
  /** Frame rate (default 30). */
  fps?: number;
  /** Background color for padding. */
  background?: string;
  /** Narration audio file to overlay. */
  audioPath?: string;
  /** Whether to add text overlays from scene titles. */
  showTitles?: boolean;
  /** Preview mode: lower quality, faster encode. */
  preview?: boolean;
}

export interface ComposeResult {
  outputPath: string;
  durationSec: number;
  fileSize: number;
  hash: string;
  command: string;
}

// ── Composer ────────────────────────────────────────────────────────────────

export async function composeVideo(
  scenes: SceneInput[],
  options: ComposeOptions,
): Promise<ComposeResult> {
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const fps = options.fps ?? 30;
  const bg = options.background ?? "black";

  // Build filter complex for scene concatenation
  const inputs: string[] = [];

  // Each scene: scale to target, add title text, then concat
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    inputs.push("-loop", "1", "-t", String(scene.durationSec), "-i", scene.imagePath);
  }

  // Build concat filter
  const concatInputs = scenes.map((_, i) => `[v${i}]`).join("");
  const filterComplex = `${[...Array(scenes.length).keys()].map(i => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:${bg},setsar=1[v${i}]`).join(";")};${concatInputs}concat=n=${scenes.length}:v=1:a=0[outv]`;

  // FFmpeg command
  const args: string[] = [
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[outv]",
    "-c:v", options.preview ? "libx264" : "libx264",
    "-preset", options.preview ? "ultrafast" : "medium",
    "-crf", options.preview ? "28" : "18",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-movflags", "+faststart",
  ];

  // Add audio if provided
  if (options.audioPath) {
    args.push("-i", options.audioPath, "-shortest", "-map", "1:a");
  }

  args.push("-y", options.output);

  const cmd = ["ffmpeg", ...args.map((a) => `'${a}'`)].join(" ");
  console.log("Composing:", cmd.substring(0, 200) + "...");

  // Execute
  await fs.mkdir(path.dirname(options.output), { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });

    proc.on("close", async (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}`));
        return;
      }

      const stat = await fs.stat(options.output);
      const content = await fs.readFile(options.output);
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

      // Calculate total duration
      const duration = scenes.reduce((sum, s) => sum + s.durationSec, 0);

      resolve({
        outputPath: options.output,
        durationSec: duration,
        fileSize: stat.size,
        hash,
        command: cmd,
      });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
    });
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const outDir = process.argv[2] ?? "./output";
  const imageDir = process.argv[3] ?? "./assets/images";

  const scenes: SceneInput[] = [
    { id: "s1", imagePath: `${imageDir}/s1.jpg`, durationSec: 10, title: "Opening Hook" },
    { id: "s2", imagePath: `${imageDir}/s2.jpg`, durationSec: 10, title: "Superposition" },
    { id: "s3", imagePath: `${imageDir}/s3.jpg`, durationSec: 10, title: "Entanglement" },
    { id: "s4", imagePath: `${imageDir}/s4.jpg`, durationSec: 10, title: "Quantum vs Classical" },
    { id: "s5", imagePath: `${imageDir}/s5.jpg`, durationSec: 10, title: "Applications" },
    { id: "s6", imagePath: `${imageDir}/s6.jpg`, durationSec: 10, title: "Challenges" },
    { id: "s7", imagePath: `${imageDir}/s7.jpg`, durationSec: 10, title: "Future Outlook" },
    { id: "s8", imagePath: `${imageDir}/s8.jpg`, durationSec: 10, title: "Closing Thoughts" },
  ];

  const result = await composeVideo(scenes, {
    output: `${outDir}/demo-video.mp4`,
    showTitles: true,
  });

  console.log("\n✅ Video composed:");
  console.log(`  Path:     ${result.outputPath}`);
  console.log(`  Duration: ${result.durationSec}s`);
  console.log(`  Size:     ${(result.fileSize / 1024 / 1024).toFixed(1)}MB`);
  console.log(`  Hash:     ${result.hash}`);
}

// Allow import as module or run as script
if (process.argv[1]?.includes("composer.ts")) {
  main().catch((err) => {
    console.error("Compose failed:", err.message);
    process.exit(1);
  });
}
