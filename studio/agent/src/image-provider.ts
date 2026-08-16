// ── Image provider selection ────────────────────────────────────────────────
//
// `image.generate` has two providers: fal.ai, metered per image, and an OpenAI
// ChatGPT/Codex plan, billed as a subscription. Which one a series uses is an
// editorial and budget decision, so it lives in that series' pipeline.yaml
// rather than in code:
//
//   image:
//     provider: openai-codex          # or openai-codex/gpt-5.5
//     provider: fal-ai/flux/dev       # anything else is a fal model id
//
// This module owns the mapping from that string to a provider, and the studio
// side of getting a credential. @av/codex-image deliberately knows none of it.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { seriesPath, channelPath } from "@studio/contracts/src/layout.mjs";

/** fal model used when a series expresses no preference. */
export const DEFAULT_FAL_MODEL = "fal-ai/flux/dev";
/** Routing model used when a series asks for Codex without naming one. */
export const DEFAULT_CODEX_MODEL = "gpt-5.5";

/** The OpenAI subscription provider, as Pi's model registry names it. */
export const CODEX_PROVIDER = "openai-codex";

export type ImageProvider =
  | { kind: "fal"; model: string }
  | { kind: "codex"; model: string };

/**
 * Parse a configured provider string.
 *
 * Anything not prefixed `openai-codex` is a fal model id, which keeps every
 * existing pipeline.yaml working unchanged.
 */
export function parseProvider(configured: string | undefined): ImageProvider {
  const value = (configured ?? "").trim();
  if (!value) return { kind: "fal", model: DEFAULT_FAL_MODEL };

  if (value === CODEX_PROVIDER || value.startsWith(`${CODEX_PROVIDER}/`)) {
    const model = value.slice(CODEX_PROVIDER.length + 1);
    return { kind: "codex", model: model || DEFAULT_CODEX_MODEL };
  }
  // "openai" alone is ambiguous between the plan and the metered API, and
  // guessing wrong bills someone. Name the provider explicitly.
  return { kind: "fal", model: value };
}

/**
 * Read the provider a series (or its channel) configured.
 *
 * Series wins over channel, which is how a channel sets a house default and
 * one series overrides it.
 */
export function resolveImageProvider(
  libraryRoot: string,
  channel: string,
  series: string,
): ImageProvider {
  for (const dir of [seriesPath(libraryRoot, channel, series), channelPath(libraryRoot, channel)]) {
    const configured = readConfiguredProvider(join(dir, "pipeline.yaml"));
    if (configured) return parseProvider(configured);
  }
  return { kind: "fal", model: DEFAULT_FAL_MODEL };
}

function readConfiguredProvider(yamlPath: string): string | undefined {
  if (!existsSync(yamlPath)) return undefined;
  try {
    const config = load(readFileSync(yamlPath, "utf-8")) as
      | { image?: { provider?: unknown }; providers?: { imageGeneration?: unknown } }
      | undefined;
    const value = config?.image?.provider ?? config?.providers?.imageGeneration;
    return typeof value === "string" && value.trim() ? value : undefined;
  } catch {
    // A malformed pipeline.yaml must not decide which account gets billed;
    // fall through to the next level and ultimately to the fal default.
    return undefined;
  }
}
