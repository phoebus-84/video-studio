// The poetry-short compiler (compiler/base.ts beside this file, once copied
// into a release), drawing one more item: the channel's sample card over its
// first second (avg-d1x).

import type { SeriesCompiler } from "@studio/series";
import { compiler as base } from "./base";

export const compiler: SeriesCompiler = {
  ...base,
  compile(input) {
    const result = base.compile(input);
    if (!result.ok) return result;
    result.timeline.tracks.push({
      id: "library", type: "visual", z: 99,
      items: [{ id: "card", from: 0, duration: 30, kit: { name: "sample-card", version: "1.0.0" }, props: { text: "from the channel", color: "#1b2a4a" } }],
    } as never);
    return result;
  },
};
