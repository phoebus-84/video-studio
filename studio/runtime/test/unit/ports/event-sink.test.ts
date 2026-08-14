import { describe, it, expect } from "vitest";
import { FakeEventSink } from "../../fixtures/index.js";
import { isOk } from "../../../src/result.js";
import type { Event } from "../../../src/ports/event-sink.js";

describe("EventSink port via FakeEventSink", () => {
  describe("append", () => {
    it("appends an event with timestamp and eventId", async () => {
      const sink = new FakeEventSink();
      const r = await sink.append({ type: "stage.attempted", stageId: "s1" });
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value.type).toBe("stage.attempted");
        expect(r.value.stageId).toBe("s1");
        expect(r.value.timestamp).toBeTruthy();
        expect(r.value.eventId).toBeTruthy();
      }
      expect(sink.count()).toBe(1);
    });

    it("assigns sequential eventIds", async () => {
      const sink = new FakeEventSink();
      const a = await sink.append({ type: "a" });
      const b = await sink.append({ type: "b" });
      if (isOk(a) && isOk(b)) {
        expect(a.value.eventId).toBe("evt_0");
        expect(b.value.eventId).toBe("evt_1");
      } else {
        expect.fail("expected both appends to succeed");
      }
    });
  });

  describe("appendAll", () => {
    it("appends multiple events", async () => {
      const sink = new FakeEventSink();
      const events: Omit<Event, "timestamp" | "eventId">[] = [
        { type: "x" },
        { type: "y" },
        { type: "z" },
      ];
      const r = await sink.appendAll(events);
      expect(isOk(r)).toBe(true);
      if (isOk(r)) {
        expect(r.value).toHaveLength(3);
        expect(r.value[0]!.eventId).toBe("evt_0");
        expect(r.value[2]!.eventId).toBe("evt_2");
      }
      expect(sink.count()).toBe(3);
    });
  });

  describe("clear", () => {
    it("resets the event list", async () => {
      const sink = new FakeEventSink();
      await sink.append({ type: "t" });
      expect(sink.count()).toBe(1);
      sink.clear();
      expect(sink.count()).toBe(0);
    });
  });
});
