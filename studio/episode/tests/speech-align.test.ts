import { describe, expect, it } from "vitest";
import { AlignError, mapToText, snapToSilences } from "../src/speech-align.js";

/**
 * Turning a provider's words into a take's WordTiming words (avg-8hs.2):
 * the written text's own tokens, each with the provider's times, kept out of
 * the measured silences and never shorter than 80 ms. The fixtures are the
 * spike's: Qwen3-ForcedAligner on CreativeStudio's San Martino recital.
 */

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("mapToText", () => {
  it("gives every token of the written text the time of its word, punctuation and all", () => {
    const { words, unmapped } = mapToText("La nebbia, sale.", [w("La", 0, 0.24), w("nebbia", 0.24, 0.72), w("sale", 0.72, 1.1)]);
    expect(words).toEqual([w("La", 0, 0.24), w("nebbia,", 0.24, 0.72), w("sale.", 0.72, 1.1)]);
    expect(unmapped).toEqual([]);
  });

  it("matches apostrophes and accents whatever the provider does with them", () => {
    const { words } = mapToText("a gl'irti colli de' tini", [w("a", 0, 0.1), w("glirti", 0.1, 0.5), w("colli", 0.5, 0.9), w("de", 0.9, 1), w("tini", 1, 1.4)]);
    expect(words.map((x) => [x.text, x.start, x.end])).toEqual([["a", 0, 0.1], ["gl'irti", 0.1, 0.5], ["colli", 0.5, 0.9], ["de'", 0.9, 1], ["tini", 1, 1.4]]);
  });

  it("joins a word the provider split, and splits none it merged", () => {
    const split = mapToText("gl'irti colli", [w("gl", 0.1, 0.2), w("irti", 0.2, 0.5), w("colli", 0.5, 0.9)]).words;
    expect(split).toEqual([w("gl'irti", 0.1, 0.5), w("colli", 0.5, 0.9)]);
    const merged = mapToText("dal ribollir", [w("dalribollir", 1, 2)]).words;
    // A merged word is shared by length: 3 letters of 11, then 8.
    expect(merged).toEqual([w("dal", 1, 1.273), w("ribollir", 1.273, 2)]);
  });

  it("gives a token no word matched the gap between its neighbours, with no confidence", () => {
    // One word in ten unmatched is within the limit.
    const rest = ["tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci"].map((t, i) => w(t, 0.9 + i * 0.4, 1.3 + i * 0.4));
    const { words, unmapped } = mapToText("uno due tre quattro cinque sei sette otto nove dieci", [w("uno", 0, 0.5), ...rest]);
    expect(words[1]).toEqual({ text: "due", start: 0.5, end: 0.9, confidence: 0 });
    expect(unmapped).toEqual([1]);
  });

  it("keeps going after a misheard word", () => {
    const { words, unmapped } = mapToText("più vigili colli", [w("piu", 0, 0.3), w("viginando", 0.3, 0.8), w("colli", 0.8, 1.2)]);
    expect(words.map((x) => x.text)).toEqual(["più", "vigili", "colli"]);
    expect(words[2]).toEqual(w("colli", 0.8, 1.2));
    expect(unmapped).toEqual([]);
  });

  it("refuses an alignment that left more than one token in ten unmatched", () => {
    expect(() => mapToText("uno due tre quattro cinque", [w("uno", 0, 0.5), w("cinque", 2, 2.5)])).toThrow(AlignError);
    try {
      mapToText("uno due tre quattro cinque", [w("uno", 0, 0.5), w("cinque", 2, 2.5)]);
    } catch (e) {
      expect((e as AlignError).code).toBe("alignment-mismatch");
      expect((e as AlignError).message).toMatch(/3 of 5 words/);
    }
  });

  it("keeps words in order and never overlapping", () => {
    const { words } = mapToText("a b c", [w("a", 0, 0.6), w("b", 0.5, 0.9), w("c", 0.85, 1.2)]);
    for (let i = 1; i < words.length; i++) expect(words[i]!.start).toBeGreaterThanOrEqual(words[i - 1]!.end);
  });
});

describe("snapToSilences", () => {
  // The spike's San Martino: silences measured at -35 dB, 0.10 s.
  const silences: [number, number][] = [[1.663, 2.689], [3.887, 4.936], [6.028, 7.004], [16.554, 17.854]];

  it("keeps a word out of the pause after it", () => {
    const [sale, rallegrar] = snapToSilences([w("sale", 3.36, 4.8), w("rallegrar", 15.84, 17.84)], silences, 30.8);
    expect(sale).toEqual(w("sale", 3.36, 3.887));
    expect(rallegrar).toEqual(w("rallegrar", 15.84, 16.554));
  });

  it("starts a word where the pause before it ends", () => {
    const [urla] = snapToSilences([w("urla", 5.92, 7.36)], [[5.9, 7.004]], 30.8);
    expect(urla).toEqual(w("urla", 7.004, 7.36));
  });

  it("keeps the side of a word with more speech when a silence falls inside it", () => {
    // Qwen starts "piovigginando" 63 ms before a one-second pause: it is said after it.
    const [word] = snapToSilences([w("piovigginando", 1.6, 3.36)], silences, 30.8);
    expect(word).toEqual(w("piovigginando", 2.689, 3.36));
  });

  it("makes every word at least 80 ms, taking the time from a long neighbour", () => {
    const words = snapToSilences([w("a", 0.72, 0.72), w("gl'irti", 0.72, 1.12), w("colli", 1.12, 1.6)], [], 30.8);
    expect(words).toEqual([w("a", 0.72, 0.8), w("gl'irti", 0.8, 1.12), w("colli", 1.12, 1.6)]);
    const last = snapToSilences([w("lungo", 0, 1), w("a", 1, 1)], [], 1.05);
    expect(last[1]!.end - last[1]!.start).toBeGreaterThanOrEqual(0.05);
    expect(last[1]!.end).toBeLessThanOrEqual(1.05);
    expect(last[0]!.end).toBeLessThanOrEqual(last[1]!.start);
  });

  it("rounds to the millisecond and keeps the order", () => {
    const words = snapToSilences([w("a", 0.12345, 0.45678), w("b", 0.45678, 0.91234)], [], 2);
    expect(words).toEqual([w("a", 0.123, 0.457), w("b", 0.457, 0.912)]);
  });
});
