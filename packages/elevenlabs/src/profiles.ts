// What ElevenLabs calls are estimated to cost. ElevenLabs returns no price for
// forced alignment, so the spend ledger settles at this estimate: edit it when
// the plan's price changes.

export interface PriceProfile {
  /** US dollars per minute of audio. */
  usdPerMinute: number;
  /** Always true: a published price, not one the provider reported. */
  estimate: true;
}

export const ELEVENLABS_PROFILES: Readonly<{ forcedAlignment: PriceProfile }> = Object.freeze({
  // Billed like speech-to-text: about $0.40 an hour of audio.
  forcedAlignment: Object.freeze({ usdPerMinute: 0.0067, estimate: true as const }),
});
