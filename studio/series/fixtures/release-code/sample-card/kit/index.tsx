// A kit a channel carries in the library (avg-d1x): a full-frame colour card
// with a line of text. Sealed by `vpr kit seal` into kit.cjs; React, Remotion
// and zod are the application's.

import React from "react";
import { AbsoluteFill } from "remotion";
import { z } from "zod";

const props = z.object({ text: z.string(), color: z.string().regex(/^#[0-9a-f]{6}$/) }).strict();

export const kit = {
  name: "sample-card",
  version: "1.0.0",
  description: "A colour card with a line of text, from the channel's library",
  props,
  component: ({ props: p }: { props: Record<string, unknown> }) => {
    const { text, color } = p as z.infer<typeof props>;
    return <AbsoluteFill style={{ background: color, color: "#ffffff", fontSize: 96, justifyContent: "center", alignItems: "center" }}>{text}</AbsoluteFill>;
  },
  examples: [{ id: "navy", props: { text: "library", color: "#1b2a4a" }, durationInFrames: 30, frame: 12 }],
};
