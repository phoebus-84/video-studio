/**
 * Doctor: diagnostic tool that reports FFmpeg capabilities.
 *
 * Checks:
 * - FFmpeg and ffprobe discovery
 * - Version
 * - Available codecs against a required list
 * - Available filters against a required list
 *
 * Output is a structured report suitable for both human reading and
 * machine consumption.
 */

import type { DoctorReport, RequiredCapabilityReport } from "./types.js";
import { discoverFfmpeg } from "./discovery.js";
import type { Logger } from "./types.js";

/**
 * Required codecs for the composer's core functionality.
 * These are the minimum codecs needed to produce valid output.
 */
const CORE_REQUIRED_CODECS = [
  // Video encoders
  "libx264",
  "libx265",
  // Audio encoders
  "aac",
  // Video decoders (needed to read inputs)
  "h264",
  "hevc",
  "vp9",
  // Audio decoders
  "mp3",
  "opus",
  "vorbis",
  "pcm_s16le",
];

/**
 * Required filters for the composer's core functionality.
 */
const CORE_REQUIRED_FILTERS = [
  // Video
  "scale",
  "fps",
  "trim",
  "setpts",
  "format",
  "overlay",
  "concat",
  "split",
  "null",
  // Audio
  "anull",
  "atrim",
  "asetpts",
  "aconcat",
  "volume",
  "loudnorm",
  "aresample",
  "aformat",
  "amix",
];

/**
 * Run the doctor diagnostic.
 *
 * Returns a structured report. If `logger` is provided, also writes
 * human-readable diagnostics to it.
 */
export async function runDoctor(
  logger?: Logger,
  requiredCodecs?: string[],
  requiredFilters?: string[],
): Promise<DoctorReport> {
  const errors: string[] = [];
  const codecs = requiredCodecs ?? CORE_REQUIRED_CODECS;
  const filters = requiredFilters ?? CORE_REQUIRED_FILTERS;

  let ffmpegInfo = null;
  try {
    ffmpegInfo = await discoverFfmpeg();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Discovery failed: ${msg}`);
    if (logger) logger.error(msg);
  }

  if (!ffmpegInfo) {
    errors.push("FFmpeg not found on PATH");
    if (logger) logger.error("FFmpeg not found on PATH");
  }

  const codecReport = buildCapabilityReport(
    codecs,
    ffmpegInfo?.codecs.map((c) => c.name) ?? [],
  );
  const filterReport = buildCapabilityReport(
    filters,
    ffmpegInfo?.filters.map((f) => f.name) ?? [],
  );

  if (logger) {
    logDoctorReport(logger, ffmpegInfo, codecReport, filterReport, errors);
  }

  return {
    ffmpeg: ffmpegInfo,
    errors,
    requiredCodecs: codecReport,
    requiredFilters: filterReport,
  };
}

function buildCapabilityReport(
  required: string[],
  available: string[],
): RequiredCapabilityReport {
  const availableSet = new Set(available);
  const found: string[] = [];
  const missing: string[] = [];

  for (const name of required) {
    if (availableSet.has(name)) {
      found.push(name);
    } else {
      missing.push(name);
    }
  }

  return {
    required,
    found,
    missing,
    satisfied: missing.length === 0,
  };
}

function logDoctorReport(
  logger: Logger,
  info: DoctorReport["ffmpeg"],
  codecReport: RequiredCapabilityReport,
  filterReport: RequiredCapabilityReport,
  errors: string[],
): void {
  if (info) {
    logger.info(`FFmpeg found at ${info.path}`, {
      version: info.parsed,
      totalCodecs: info.codecs.length,
      totalFilters: info.filters.length,
    });
  }

  if (codecReport.missing.length > 0) {
    logger.warn("Missing required codecs", {
      missing: codecReport.missing,
    });
  } else {
    logger.info("All required codecs available", {
      found: codecReport.found.length,
    });
  }

  if (filterReport.missing.length > 0) {
    logger.warn("Missing required filters", {
      missing: filterReport.missing,
    });
  } else {
    logger.info("All required filters available", {
      found: filterReport.found.length,
    });
  }

  for (const err of errors) {
    logger.error(err);
  }
}
