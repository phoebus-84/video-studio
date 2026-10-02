// ---------------------------------------------------------------------------
// The budget guard, on the journal's spend ledger (avg-91o)
// ---------------------------------------------------------------------------
// The CLI and the gateway each used to configure a guard that answered every
// stage with `ok`, estimate 0, because there was no ledger to ask. There is
// now: `@studio/contracts/src/budget.mjs` replays the episode's spend events,
// and Pi's paid tools reserve and settle through it.
//
// The guard does not reserve. The money is spent by a paid CALL inside a
// stage — one image, one clip — not by the stage itself, and the call reserves
// its own estimate where it happens. What the guard can usefully say at a
// stage boundary is "this episode's budget is gone": a stage that declares a
// paid capability is refused once committed spend has reached the limit, so
// the agent learns before it starts rather than on its first call. Every other
// stage passes — finishing an episode whose generation is paid for must not
// need more budget.
//
// Read-only, so `status` may ask it as often as it is polled.
// ---------------------------------------------------------------------------

import { load as loadYaml } from "js-yaml";
import { err, ok, type Result } from "../result.js";
import {
  PAID_CAPABILITIES, formatMoney, readBudget, resolveBudgetEnvelope,
  type BudgetLevel, type BudgetState,
} from "@studio/contracts/src/budget.mjs";
import { episodePath } from "@studio/contracts/src/layout.mjs";
import type { ResolvedStage } from "../pipeline/types.js";
import type { BudgetGuard, DispatchContext, EpisodeRef, Reservation } from "./types.js";

/** An episode's budget, with where its limit came from. */
export interface BudgetReport extends BudgetState {
  /** The settings level whose `budget:` set the limit, or null when none does. */
  limitFrom: BudgetLevel | null;
}

/** The YAML reader contracts asks for: it carries no parser of its own. */
const parseYaml = (text: string): unknown => loadYaml(text);

/** Read an episode's budget: its envelope from settings.yaml, its spend from the journal. */
export async function readEpisodeBudget(libraryRoot: string, ref: EpisodeRef): Promise<BudgetReport> {
  const { envelope, from } = await resolveBudgetEnvelope(libraryRoot, ref, parseYaml);
  const dir = episodePath(libraryRoot, ref.channel, ref.series, ref.episode);
  return { ...(await readBudget(dir, { envelope })), limitFrom: from };
}

/** Whether a stage declares a capability that costs money. */
export function declaresPaidCapability(stage: ResolvedStage): boolean {
  return stage.definition.capabilities.some((c) => PAID_CAPABILITIES.includes(c.capability));
}

export class JournalBudgetGuard implements BudgetGuard {
  constructor(private readonly libraryRoot: string) {}

  async maySpend(
    stage: ResolvedStage,
    ctx: DispatchContext,
  ): Promise<Result<Reservation, { code: string; message: string }>> {
    // Nothing to reserve: see the header. The value is what the interface
    // has always carried, and says so.
    const none: Reservation = { reserveId: "none", estimatedCost: 0 };
    if (!declaresPaidCapability(stage)) return ok(none);

    let budget: BudgetReport;
    try {
      budget = await readEpisodeBudget(this.libraryRoot, ctx.ref);
    } catch (e) {
      // A ledger that cannot be read is a ledger that may say "exhausted".
      return err({
        code: "BUDGET_UNAVAILABLE",
        message: `its budget cannot be read (${e instanceof Error ? e.message : String(e)})`,
      });
    }
    if (budget.exhausted) {
      const cur = budget.currency;
      return err({
        code: "BUDGET_EXHAUSTED",
        message:
          `the episode's ${formatMoney(budget.limitMicros!, cur)} budget is used up ` +
          `(${formatMoney(budget.spentMicros, cur)} spent, ${formatMoney(budget.reservedMicros, cur)} reserved ` +
          `by calls still open). Raise budget.limitMicros in ${budget.limitFrom}/settings.yaml` +
          (budget.counts.open > 0 ? `, or release a reservation the provider did not bill (vpr budget <ep> release <id>)` : ""),
      });
    }
    return ok(none);
  }
}

