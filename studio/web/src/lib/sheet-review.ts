// The layout sheet of a spec-driven episode, as the Storyboard tab shows it
// (avg-goz): what the gateway answers, and the pure bits the panel needs.

export interface EpisodeRef {
  channel: string;
  series: string;
  episode: string;
}

export interface SheetStill {
  index: number;
  frame: number;
  seconds: number;
  label: string;
  /** Relative to the episode. */
  path: string;
}

export interface SheetReviewState {
  state: string;
  verified?: boolean | null;
  at?: string | null;
  actor?: string | null;
  note?: string | null;
  message: string;
}

export interface LayoutSheetAnswer {
  specDriven: boolean;
  sheet: {
    createdAt: string | null;
    scale: number | null;
    columns: number | null;
    rows: number | null;
    grid: { path: string; hash: string };
    rules: string | null;
    frames: SheetStill[];
  } | null;
  timelineChanged: boolean;
  review: SheetReviewState;
}

export const episodeApi = (ref: EpisodeRef) =>
  `/api/channels/${encodeURIComponent(ref.channel)}/series/${encodeURIComponent(ref.series)}/episodes/${encodeURIComponent(ref.episode)}`;

/** "channel/series/episode" as the library selects it, or null. */
export function parseEpisodeKey(key: string | null | undefined): EpisodeRef | null {
  const parts = (key ?? "").split("/");
  return parts.length === 3 && parts.every((p) => p !== "") ? { channel: parts[0]!, series: parts[1]!, episode: parts[2]! } : null;
}

/** mm:ss.ff at 30 fps, as the sheet labels its stills. */
export function formatSheetTime(seconds: number, fps = 30): string {
  const whole = Math.max(0, seconds);
  const m = Math.floor(whole / 60);
  const s = Math.floor(whole % 60);
  const f = Math.round((whole - Math.floor(whole)) * fps) % fps;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(f).padStart(2, "0")}`;
}

/** The still `step` away from `i`, wrapping around the `n` stills. */
export function nextStill(i: number, n: number, step: number): number {
  if (n <= 0) return 0;
  return (((i + step) % n) + n) % n;
}

/** One line saying where the sheet stands, and whether the person can review it. */
export function sheetStatusLine(answer: LayoutSheetAnswer): { tone: "muted" | "warn" | "ok" | "bad"; text: string; reviewable: boolean } {
  // A sheet.json naming files outside the sheet, or stills that are not the ones it describes: nothing to sign.
  if (answer.review.state === "invalid" || (answer.sheet && answer.review.state === "no-sheet")) {
    return { tone: "warn", text: answer.review.message, reviewable: false };
  }
  if (!answer.sheet) return { tone: "muted", text: "No sheet yet: Pi makes it (pva_layout_sheet).", reviewable: false };
  if (answer.timelineChanged) return { tone: "warn", text: "The timeline changed since this sheet: make it again before reviewing.", reviewable: false };
  const { review } = answer;
  if (review.state === "approved") {
    return { tone: "ok", text: `Approved${review.at ? ` at ${review.at}` : ""}${review.verified ? " (verified)" : review.verified === false ? " (signature does not verify)" : ""}.`, reviewable: true };
  }
  if (review.state === "rejected") return { tone: "bad", text: `Rejected${review.note ? `: ${review.note}` : "."}`, reviewable: true };
  if (review.state === "unreviewed") return { tone: "muted", text: "Not reviewed yet.", reviewable: true };
  return { tone: "warn", text: review.message, reviewable: true };
}
