// ---------------------------------------------------------------------------
// Paid calls go through the episode's spend ledger (avg-91o)
// ---------------------------------------------------------------------------
// `pva_generate_image` (fal) and `pva_generate_minimax_h3_video` used to call
// the provider directly: no reservation, no record, no cap. An episode that
// bought forty images reported $0, and nothing would have stopped the forty-
// first at any price.
//
// Every paid call now reserves its estimate in the journal before the request
// leaves and settles it after (`withSpend` in @studio/contracts). The estimate
// is the provider profile's own price; a model with no profile has no price,
// which is refused under a budget (nothing to check against the cap) and
// recorded as unpriced without one.
//
// This keeps the TOOLS honest. Pi's environment still holds FAL_KEY, so a
// `curl` from its shell reaches fal with no reservation — that is the
// same-user boundary avg-qr4.8 owns, and nothing here pretends otherwise.
// ---------------------------------------------------------------------------

import { load as loadYaml } from "js-yaml";
import { listProfiles } from "@av/fal-media";
import {
  withSpend, resolveBudgetEnvelope, toMicros,
  type Money, type SpendCall,
} from "@studio/contracts/src/budget.mjs";
import { episodePath } from "@studio/contracts/src/layout.mjs";

export type { SpendCall };

export interface PaidCallTarget {
  libraryRoot: string;
  channel: string;
  series: string;
  episode: string;
}

export interface PaidCall {
  capability: string;
  provider: string;
  /** A fal profile id or endpoint id; also where the estimate comes from. */
  model: string;
  /** What the call is for, in a few words: "image s3", "clip shot-2". */
  purpose: string;
  /** A price that is not fal's: the provider's own profile (ElevenLabs, avg-8hs.2). */
  estimate?: { estimate: Money; priced: boolean; profile: string };
}

/** What a fal model costs per call, from its profile — or that nobody knows. */
export function falEstimate(model: string): { estimate: Money; priced: boolean; profile: string } {
  const profile = listProfiles().find((p) => p.profileId === model || p.endpointId === model);
  if (!profile) return { estimate: { currency: "USD", micros: 0 }, priced: false, profile: model };
  return {
    estimate: { currency: profile.pricing.currency, micros: toMicros(profile.pricing.estimatedUnitCost) },
    priced: true,
    profile: profile.profileId,
  };
}

/**
 * Reserve, perform, settle. `perform` marks `call.sending()` just before the
 * request leaves and `call.refused()` when the provider rejects it; it
 * returns the value and, when the provider says, what it charged.
 *
 * Throws `SpendRefused` without calling `perform` when the budget says no;
 * the tool turns that into its error, with the figures in the message.
 */
export async function paidCall<T>(
  target: PaidCallTarget,
  call: PaidCall,
  perform: (spend: SpendCall) => Promise<{ value: T; cost?: Money | null; providerRequestId?: string }>,
): Promise<T> {
  const ref = { channel: target.channel, series: target.series, episode: target.episode };
  const dir = episodePath(target.libraryRoot, ref.channel, ref.series, ref.episode);
  const { envelope } = await resolveBudgetEnvelope(target.libraryRoot, ref, (text) => loadYaml(text));
  const { estimate, priced, profile } = call.estimate ?? falEstimate(call.model);
  return withSpend(dir, {
    episode: ref, actor: "pi",
    capability: call.capability, provider: call.provider, profile, purpose: call.purpose,
    estimate, priced, envelope,
  }, perform, {
    // The work happened and its output is on disk; the reservation stays
    // open, so the budget keeps counting it until someone looks.
    onLedgerError: (e) => console.warn(`spend ledger: ${e.message}`),
  });
}

/** A provider's cost report as ledger money, or null when it sent none. */
export function providerCost(cost: { amount: number; currency: string } | null | undefined): Money | null {
  if (!cost || typeof cost.amount !== "number" || !Number.isFinite(cost.amount) || cost.amount < 0) return null;
  return { currency: cost.currency, micros: toMicros(cost.amount) };
}
