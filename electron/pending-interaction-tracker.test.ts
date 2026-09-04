import { describe, expect, it } from "vitest";
import { PendingInteractionTracker } from "./pending-interaction-tracker";

describe("pending interaction tracker", () => {
  it("resolves simultaneous protocol requests independently", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "request-1", threadId: "thread-1", turnId: "turn-1" });
    tracker.add("protocol", { id: "request-2", threadId: "thread-1", turnId: "turn-1" });
    expect(tracker.resolve("protocol", "request-1")).toMatchObject({ id: "request-1", threadId: "thread-1" });
    expect(tracker.hasWaiting()).toBe(true);
    expect(tracker.resolve("protocol", "request-2")).toMatchObject({ id: "request-2", threadId: "thread-1" });
    expect(tracker.hasWaiting()).toBe(false);
  });

  it("keeps sources isolated and replaces rollout snapshots", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "same-id", threadId: "thread-1" });
    tracker.replace("rollout", [{ id: "same-id", threadId: "thread-2" }]);
    tracker.resolve("protocol", "same-id");
    expect(tracker.hasForThread("thread-2")).toBe(true);
    tracker.replace("rollout", []);
    expect(tracker.hasWaiting()).toBe(false);
  });

  it("clears only matching turn and thread scopes", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "a", threadId: "thread-1", turnId: "turn-a" });
    tracker.add("protocol", { id: "b", threadId: "thread-1", turnId: "turn-b" });
    tracker.add("rollout", { id: "c", threadId: "thread-2", turnId: "turn-c" });
    tracker.clearTurn("thread-1", "turn-a");
    expect(tracker.hasForThread("thread-1")).toBe(true);
    tracker.clearThread("thread-1");
    expect(tracker.hasForThread("thread-1")).toBe(false);
    expect(tracker.hasForThread("thread-2")).toBe(true);
  });

  it("tracks host visibility transitions and resets every source", () => {
    const tracker = new PendingInteractionTracker();
    expect(tracker.setHostVisible(true)).toBe(true);
    expect(tracker.setHostVisible(true)).toBe(false);
    expect(tracker.hasWaiting()).toBe(true);
    expect(tracker.setHostVisible(false)).toBe(true);
    tracker.add("protocol", { id: "request" });
    tracker.reset();
    expect(tracker.hasWaiting()).toBe(false);
  });
});
