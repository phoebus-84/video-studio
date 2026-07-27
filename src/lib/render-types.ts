/** A render attempt produced by the FFmpeg composer. */
export interface RenderAttempt {
  id: string;
  episodeId: string;
  status: "current" | "superseded" | "failed" | "validating";
  filePath: string;
  fileAvailable: boolean;
  fileSizeBytes: number | null;
  durationSeconds: number;
  resolution: { width: number; height: number };
  codecs: { video: string; audio: string };
  fps: number;
  createdAt: string;
  /** Which scene attempts this render includes. */
  sceneVersions: string[];
}

export interface QaFinding {
  code: string;
  severity: "pass" | "warn" | "fail";
  description: string;
}

export interface RenderReport {
  renderId: string;
  overall: "pass" | "fail";
  findings: QaFinding[];
  sampledFrameCount: number;
  blankFrameDetected: boolean;
  loudness: { integrated: number; truePeak: number };
}
