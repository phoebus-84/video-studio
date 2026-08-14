import { describe, expect, it } from "vitest";
import { processGatewayEvent } from "../src/rpc-hardening.js";

interface Update {
  type: string;
  message: string;
  author?: string;
}

function run(event: {
  channel: string;
  type: string;
  data: Record<string, unknown>;
}): Update[] {
  const updates: Update[] = [];
  processGatewayEvent(event, (update) => updates.push(update));
  return updates;
}

describe("review event notification gating", () => {
  it("notifies on thread creation", () => {
    const updates = run({
      channel: "review",
      type: "thread-created",
      data: { anchor: "render/render-002.mp4" },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.type).toBe("review-new");
  });

  it("notifies on operator comments", () => {
    const updates = run({
      channel: "review",
      type: "message-added",
      data: { threadId: "t1", messageId: "m1", author: "operator" },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.type).toBe("review-reply");
    expect(updates[0]!.author).toBe("operator");
  });

  it("emits but flags non-operator (pi) comments so the notify layer can suppress the turn", () => {
    const updates = run({
      channel: "review",
      type: "message-added",
      data: { threadId: "t1", messageId: "m1", author: "pi" },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.type).toBe("review-reply");
    expect(updates[0]!.author).toBe("pi");
  });

  it("tolerates a missing author", () => {
    const updates = run({
      channel: "review",
      type: "message-added",
      data: { threadId: "t1", messageId: "m1" },
    });
    expect(updates[0]!.author).toBe("unknown");
  });
});
