import type { RenderAttempt, RenderReport } from "$lib/render-types";

export const RENDER_ATTEMPT: RenderAttempt = {
  id: "render-2026-07-27-a1b2",
  episodeId: "ep-02-memory",
  status: "current",
  filePath: "output/render-2026-07-27-a1b2.mp4",
  fileAvailable: true,
  fileSizeBytes: 84216384,
  durationSeconds: 260,
  resolution: { width: 1920, height: 1080 },
  codecs: { video: "h264", audio: "aac" },
  fps: 30,
  createdAt: "2026-07-27T12:00:00Z",
  sceneVersions: [
    "scene-1-v3",
    "scene-2-v2",
    "scene-3-v4",
    "scene-4-v1",
    "scene-5-v2",
    "scene-6-v0",
  ],
};

export const FAILED_RENDER: RenderAttempt = {
  ...RENDER_ATTEMPT,
  id: "render-2026-07-27-failed",
  status: "failed",
  fileAvailable: false,
  fileSizeBytes: null,
};

export const RENDER_REPORT: RenderReport = {
  renderId: RENDER_ATTEMPT.id,
  overall: "pass",
  findings: [
    {
      code: "RESOLUTION_MATCH",
      severity: "pass",
      description: "Output resolution 1920×1080 matches target.",
    },
    {
      code: "CODEC_MATCH",
      severity: "pass",
      description: "Video codec h264, audio codec aac match output profile.",
    },
    {
      code: "DURATION_MATCH",
      severity: "pass",
      description: "Output duration 4:20 matches timeline (±0.5s tolerance).",
    },
    {
      code: "FRAME_DECODE",
      severity: "pass",
      description: "All sampled frames (200) decoded without errors.",
    },
    {
      code: "BLANK_FRAME_CHECK",
      severity: "pass",
      description: "No blank frames detected in 200 samples.",
    },
    {
      code: "LOUDNESS",
      severity: "warn",
      description: "Integrated loudness -22.4 LUFS, true peak -1.8 dBTP — within EBU R128 spec.",
    },
    {
      code: "CAPTIONS_PRESENT",
      severity: "pass",
      description: "Closed captions track present with 42 cue entries.",
    },
  ],
  sampledFrameCount: 200,
  blankFrameDetected: false,
  loudness: { integrated: -22.4, truePeak: -1.8 },
};

export const WARN_RENDER_REPORT: RenderReport = {
  ...RENDER_REPORT,
  overall: "fail",
  findings: [
    ...RENDER_REPORT.findings,
    {
      code: "AUDIO_GAP",
      severity: "fail",
      description: "Audio gap of 320ms detected at 2:15 — scene 4 narration missing.",
    },
  ],
};
