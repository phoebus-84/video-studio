import { expect, test, describe } from "vitest";
import { peaksFrom, peaksToPath, formatTime } from "../../src/lib/waveform";

describe("peak reduction", () => {
  test("keeps the peak of each bucket, not the mean", () => {
    /* Averaging would flatten a transient to 0.25 and make a clipped take look
       like a quiet one. */
    const samples = new Float32Array([0, 0, 0, 1]);
    expect(Array.from(peaksFrom(samples, 1))).toEqual([1]);
  });

  test("treats negative excursions as equal magnitude", () => {
    const samples = new Float32Array([-0.8, 0.2]);
    expect(peaksFrom(samples, 1)[0]).toBeCloseTo(0.8);
  });

  test("splits samples evenly across buckets", () => {
    const samples = new Float32Array([1, 0, 0, 0.5]);
    expect(Array.from(peaksFrom(samples, 2))).toEqual([1, 0.5]);
  });

  test("produces exactly the requested bucket count", () => {
    const samples = new Float32Array(1000).fill(0.3);
    expect(peaksFrom(samples, 64)).toHaveLength(64);
  });

  test("handles more buckets than samples without crashing", () => {
    const peaks = peaksFrom(new Float32Array([1, 1]), 8);
    expect(peaks).toHaveLength(8);
    expect(peaks.every((p) => Number.isFinite(p))).toBe(true);
  });

  test("empty input yields a silent, correctly sized result", () => {
    expect(Array.from(peaksFrom(new Float32Array(), 3))).toEqual([0, 0, 0]);
  });

  test("zero buckets yields nothing rather than dividing by zero", () => {
    expect(peaksFrom(new Float32Array([1]), 0)).toHaveLength(0);
  });
});

describe("waveform path", () => {
  test("is a closed polygon", () => {
    const path = peaksToPath(new Float32Array([0.5, 1, 0.5]), 100, 100);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
  });

  test("is symmetric about the vertical midpoint", () => {
    const path = peaksToPath(new Float32Array([1]), 10, 100);
    /* One sample at full scale spans the full height, centred on 50. */
    expect(path).toContain("0.00");
    expect(path).toContain("100.00");
  });

  test("silence still draws a hairline rather than a gap", () => {
    /* A gap would read as missing audio; quiet audio is not missing audio. */
    const path = peaksToPath(new Float32Array([0]), 10, 100);
    expect(path).toContain("49.50");
    expect(path).toContain("50.50");
  });

  test("empty peaks produce no path", () => {
    expect(peaksToPath(new Float32Array(), 100, 100)).toBe("");
  });
});

describe("timecode formatting", () => {
  test("shows tenths, which is the resolution drift is judged at", () => {
    expect(formatTime(18.64)).toBe("0:18.6");
  });

  test("pads seconds below ten", () => {
    expect(formatTime(65.2)).toBe("1:05.2");
  });

  test("handles zero and minute boundaries", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(60)).toBe("1:00.0");
  });

  test("degrades on non-finite input instead of printing NaN", () => {
    expect(formatTime(NaN)).toBe("0:00.0");
    expect(formatTime(Infinity)).toBe("0:00.0");
    expect(formatTime(-5)).toBe("0:00.0");
  });
});
