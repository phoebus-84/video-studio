// ---------------------------------------------------------------------------
// The gateway's stage dispatcher
// ---------------------------------------------------------------------------
// The gateway used to decide what ran, when, and whether it counted. It now
// only performs the work it is asked to, when the execution service asks.
//
// These four handlers still write artifacts, which ADR-0027 does not literally
// permit. Their home is avg-qr4.4's capability adapters; moving them before
// that issue designs the registry would decide where capability work lives
// ahead of the decision itself. What ends here is the gateway's ownership of
// execution semantics.
// ---------------------------------------------------------------------------

import type { StageDispatcher, DispatchContext } from "@studio/runtime";
import type { ResolvedStage } from "@studio/runtime";
import {
  handleIllustrations, handleCaptions, handleTiming, handleQa, type StageContext,
} from "./executor.js";

type Handler = (ctx: StageContext) => Promise<string[]>;

const HANDLERS: Record<string, Handler> = {
  illustrations: handleIllustrations,
  captions: handleCaptions,
  timing: handleTiming,
  qa: handleQa,
};

export class GatewayDispatcher implements StageDispatcher {
  /**
   * safety-review and continuity-check are deliberately absent, as they have
   * been since avg-qr4.1 deleted the handlers that invented their findings. A
   * stage with no handler is a refusal for someone to clear, not a failure.
   */
  canDispatch(stage: ResolvedStage): boolean {
    // `Object.hasOwn`, not `in`: `in` also matches inherited Object.prototype
    // keys, so a stage id like "toString" or "constructor" would make this
    // report true while `dispatch` below hands back a prototype method. The
    // service's blocked-versus-failed distinction rests on these two agreeing.
    return Object.hasOwn(HANDLERS, stage.definition.id);
  }

  async dispatch(stage: ResolvedStage, ctx: DispatchContext): Promise<string[]> {
    const handler = HANDLERS[stage.definition.id];
    if (!handler) {
      throw new Error(`The gateway has no handler for stage "${stage.definition.id}"`);
    }
    return handler({ episodeDir: ctx.episodeDir, ref: ctx.ref, log: ctx.log });
  }
}
