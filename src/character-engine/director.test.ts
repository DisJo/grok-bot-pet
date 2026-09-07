import { describe, expect, it } from "vitest";
import { AnimationDirector, STATE_SHAPE, baseDirective, validateStateCoverage } from "./director";
import { GROK_SHAPES, GROK_STATES } from "./types";
import { CodexActivityKind, CodexOverview } from "../types";

const overview = (patch: Partial<CodexOverview> = {}): CodexOverview => ({ connected: true, activeCount: 0, hasWaiting: false, recentTasks: [], ...patch });

describe("Grok animation coverage", () => {
  it("maps all 39 states and exercises all 18 body shapes", () => {
    expect(GROK_STATES).toHaveLength(39);
    expect(GROK_SHAPES).toHaveLength(18);
    expect(validateStateCoverage()).toBe(true);
    expect(new Set(Object.values(STATE_SHAPE))).toEqual(new Set(GROK_SHAPES));
  });

  it("maps every Codex activity kind to a valid state", () => {
    const kinds: CodexActivityKind[] = ["user-message", "reasoning", "plan", "web-search", "command", "file-change", "tool-call", "collaboration", "agent-output", "context-compaction", "approval", "error"];
    for (const kind of kinds) {
      const task = { threadId: "t", title: "T", status: "processing" as const, activeFlags: [], updatedAt: 10_000, activity: { kind, phase: "progress" as const, at: 10_000 } };
      expect(GROK_STATES).toContain(baseDirective(overview({ selectedTask: task }), 10_100).state);
    }
  });
});

describe("animation director", () => {
  it("plays the offline shutdown sequence", () => {
    const director = new AnimationDirector();
    const offline = overview({ connected: false });
    expect(director.next(offline, 1000).state).toBe("loading");
    expect(director.next(offline, 1800).state).toBe("powering-down");
    expect(director.next(offline, 3000).state).toBe("sleeping");
  });

  it("holds a new body shape long enough to avoid morph thrashing", () => {
    const director = new AnimationDirector();
    director.next(overview(), 5000);
    director.next(overview(), 9000);
    director.force("thinking", 10_000);
    const next = director.next(overview(), 11_000);
    expect(next.state).not.toBe("thinking");
    expect(next.shape).toBe("squircle");
  });

  it("lets approval and errors preempt immediately", () => {
    const director = new AnimationDirector();
    director.force("playful", 10_000);
    const task = { threadId: "t", title: "T", status: "waiting-input" as const, activeFlags: ["waitingOnApproval"], updatedAt: 10_100, activity: { kind: "approval" as const, phase: "started" as const, at: 10_100 } };
    expect(director.next(overview({ selectedTask: task, activeCount: 1 }), 10_100).state).toBe("listening");
  });

  it("keeps terminal colors during result animations but clears completed afterward", () => {
    const cases = [
      { status: "completed" as const, role: "completed", after: 13200, afterRole: undefined, samples: [[5000, "sending"], [5700, "celebrate"], [8300, "laughing"], [9700, "proud"], [11300, "happy"]] },
      { status: "error" as const, role: "error", after: 10300, afterRole: "error", samples: [[5000, "alerting"], [5800, "scared"], [6750, "angry"], [8050, "sad"]] },
      { status: "stopped" as const, role: "stopped", after: 7900, afterRole: "stopped", samples: [[5000, "powering-down"], [6000, "sad"]] }
    ];
    for (const entry of cases) {
      const director = new AnimationDirector();
      director.next(overview(), 0);
      director.next(overview({ selectedTask: { threadId: "t", turnId: "turn-1", title: "T", status: "processing", activeFlags: [], updatedAt: 4000 } }), 4000);
      const task = { threadId: "t", turnId: "turn-1", title: "T", status: entry.status, activeFlags: [], updatedAt: 5000 };
      for (const [at, state] of entry.samples) {
        const next = director.next(overview({ selectedTask: task }), at as number);
        expect(next.state).toBe(state);
        expect(next.statusColorRole).toBe(entry.role);
      }
      expect(director.next(overview({ selectedTask: task }), entry.after).statusColorRole).toBe(entry.afterRole);
    }
  });

  it("does not replay a completed result discovered during startup hydration", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const completed = { threadId: "t", turnId: "turn-1", title: "T", status: "completed" as const, activeFlags: [], updatedAt: 100 };
    const directive = director.next(overview({ selectedTask: completed, recentTasks: [completed] }), 100);
    expect(directive.statusColorRole).toBeUndefined();
    expect(directive.state).not.toBe("sending");
  });

  it("does not replay a failed result after reconnecting", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const processing = { threadId: "t", turnId: "turn-1", title: "T", status: "processing" as const, activeFlags: [], updatedAt: 1000 };
    director.next(overview({ selectedTask: processing, recentTasks: [processing] }), 1000);
    director.next(overview({ connected: false }), 2000);
    const failed = { ...processing, status: "error" as const, updatedAt: 3000 };
    const directive = director.next(overview({ selectedTask: failed, recentTasks: [failed] }), 3000);
    expect(directive.statusColorRole).toBe("error");
    expect(directive.state).not.toBe("alerting");
  });

  it("keeps the waiting color active until input is resolved and then clears it", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const waiting = { threadId: "t", turnId: "turn-1", title: "T", status: "waiting-input" as const, activeFlags: ["waitingOnApproval"], updatedAt: 5000, activity: { kind: "approval" as const, phase: "started" as const, at: 5000, itemId: "approval-1" } };
    expect(director.next(overview({ selectedTask: waiting }), 5000).statusColorRole).toBe("waiting");
    expect(director.next(overview({ selectedTask: waiting }), 7600).statusColorRole).toBe("waiting");
    const resumed = { ...waiting, status: "processing" as const, activeFlags: [], updatedAt: 7700, activity: { ...waiting.activity, phase: "completed" as const, at: 7700 } };
    expect(director.next(overview({ selectedTask: resumed }), 7700).statusColorRole).toBeUndefined();
  });

  it("keeps the waiting color active for input without an approval request", () => {
    const task = { threadId: "t", title: "T", status: "waiting-input" as const, activeFlags: [], updatedAt: 5000 };

    const directive = baseDirective(overview({ selectedTask: task }), 5100);

    expect(directive.statusColorRole).toBe("waiting");
  });

  it("shows the waiting color for a user-choice input request", () => {
    const task = { threadId: "t", title: "T", status: "waiting-input" as const, activeFlags: ["waitingOnInput"], updatedAt: 5000 };

    const directive = baseDirective(overview({ selectedTask: task }), 5100);

    expect(directive.statusColorRole).toBe("waiting");
  });

  it("lets a threadless global wait outrank fresh command activity", () => {
    const command = {
      threadId: "thread-1", title: "Command", status: "processing" as const,
      activeFlags: [], updatedAt: 10_000,
      activity: { kind: "command" as const, phase: "progress" as const, at: 10_000 }
    };

    expect(baseDirective(overview({ hasWaiting: true, selectedTask: command }), 10_100).statusColorRole).toBe("waiting");
  });

  it("clears the global waiting color when the host panel disappears", () => {
    const command = {
      threadId: "thread-1", title: "Command", status: "processing" as const,
      activeFlags: [], updatedAt: 10_000,
      activity: { kind: "command" as const, phase: "progress" as const, at: 10_000 }
    };

    expect(baseDirective(overview({ hasWaiting: false, selectedTask: command }), 10_100).statusColorRole).toBeUndefined();
  });

  it("does not show the waiting color while approval activity is still processing", () => {
    const task = { threadId: "t", title: "T", status: "processing" as const, activeFlags: [], updatedAt: 5000, activity: { kind: "approval" as const, phase: "started" as const, at: 5000 } };

    const directive = baseDirective(overview({ selectedTask: task }), 5100);

    expect(directive.statusColorRole).toBeUndefined();
  });

  it("keeps global waiting when background tasks complete, fail, or stop", () => {
    const cases = [
      { status: "completed" as const, after: 13_200 },
      { status: "error" as const, after: 10_300 },
      { status: "stopped" as const, after: 7_900 }
    ];

    for (const entry of cases) {
      const director = new AnimationDirector();
      const waiting = { threadId: "waiting", turnId: "turn-waiting", title: "Waiting", status: "waiting-input" as const, activeFlags: ["waitingOnApproval"], updatedAt: 3000, activity: { kind: "approval" as const, phase: "started" as const, at: 3000 } };
      const processing = { threadId: "result", turnId: "turn-1", title: "Result", status: "processing" as const, activeFlags: [], updatedAt: 4000 };
      director.next(overview({ hasWaiting: true, selectedTask: waiting, recentTasks: [waiting, processing] }), 4000);
      const terminal = { ...processing, status: entry.status, updatedAt: 5000 };

      expect(director.next(overview({ hasWaiting: true, selectedTask: waiting, recentTasks: [waiting, terminal] }), 5000).statusColorRole).toBe("waiting");
      expect(director.next(overview({ hasWaiting: true, selectedTask: waiting, recentTasks: [waiting, terminal] }), entry.after).statusColorRole).toBe("waiting");
    }
  });

  it("finishes a result flow when global waiting begins midway", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const processing = { threadId: "result", turnId: "turn-1", title: "Result", status: "processing" as const, activeFlags: [], updatedAt: 4000 };
    director.next(overview({ selectedTask: processing, recentTasks: [processing] }), 4000);
    const completed = { ...processing, status: "completed" as const, updatedAt: 5000 };
    const waiting = { threadId: "waiting", turnId: "turn-waiting", title: "Waiting", status: "waiting-input" as const, activeFlags: ["waitingOnApproval"], updatedAt: 5000, activity: { kind: "approval" as const, phase: "started" as const, at: 5000 } };

    expect(director.next(overview({ selectedTask: completed, recentTasks: [completed] }), 5000).state).toBe("sending");
    expect(director.next(overview({ selectedTask: completed, recentTasks: [completed, waiting] }), 5700).state).toBe("celebrate");
    expect(director.next(overview({ selectedTask: completed, recentTasks: [completed, waiting] }), 13_200).statusColorRole).toBe("waiting");
  });

  it("does not restart a terminal flow when polling only changes updatedAt", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    director.next(overview({ selectedTask: { threadId: "t", turnId: "turn-1", title: "T", status: "processing", activeFlags: [], updatedAt: 4000 } }), 4000);
    const completed = { threadId: "t", turnId: "turn-1", title: "T", status: "completed" as const, activeFlags: [], updatedAt: 5000 };
    expect(director.next(overview({ selectedTask: completed }), 5000).state).toBe("sending");
    expect(director.next(overview({ selectedTask: { ...completed, updatedAt: 9000 } }), 8300).state).toBe("laughing");
  });

  it("bursts particles immediately when the selected task completes", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    director.next(overview({ selectedTask: { threadId: "selected", turnId: "turn-1", title: "Selected", status: "processing", activeFlags: [], updatedAt: 4000 } }), 4000);
    const completed = { threadId: "selected", turnId: "turn-1", title: "Selected", status: "completed" as const, activeFlags: [], updatedAt: 5000 };
    const result = director.next(overview({ selectedTask: completed }), 5000);
    expect(result.state).toBe("sending");
    expect(result.oneShot).toBe("burst");
    expect(result.statusColorRole).toBe("completed");
  });

  it("does not preempt a selected processing task when a background task completes", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const selected = { threadId: "selected", turnId: "turn-a", title: "Selected", status: "processing" as const, activeFlags: [], updatedAt: 4000 };
    const background = { threadId: "background", turnId: "turn-b", title: "Background", status: "processing" as const, activeFlags: [], updatedAt: 4000 };
    director.next(overview({ selectedTask: selected, recentTasks: [background] }), 4000);

    const completed = { ...background, status: "completed" as const, updatedAt: 5000 };
    const result = director.next(overview({ selectedTask: selected, recentTasks: [completed] }), 5000);
    expect(result.state).toBe("working");
    expect(result.oneShot).toBeUndefined();
    expect(result.statusColorRole).toBeUndefined();
  });

  it("deduplicates a completed turn but still bursts for the next turn in the same thread", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    const processingTurn1 = { threadId: "thread", turnId: "turn-1", title: "Task", status: "processing" as const, activeFlags: [], updatedAt: 4000 };
    director.next(overview({ selectedTask: processingTurn1 }), 4000);
    const completedTurn1 = { ...processingTurn1, status: "completed" as const, updatedAt: 5000 };
    const firstResult = director.next(overview({ selectedTask: completedTurn1 }), 5000);
    expect(firstResult.oneShot).toBe("burst");

    director.next(overview({ selectedTask: { ...processingTurn1, updatedAt: 5100 } }), 5100);
    const repeatedResult = director.next(overview({ selectedTask: { ...completedTurn1, updatedAt: 5200 } }), 5200);
    expect(repeatedResult.expiresAt).toBe(firstResult.expiresAt);

    const processingTurn2 = { ...processingTurn1, turnId: "turn-2", updatedAt: 6000 };
    director.next(overview({ selectedTask: processingTurn2 }), 6000);
    const completedTurn2 = { ...processingTurn2, status: "completed" as const, updatedAt: 7000 };
    expect(director.next(overview({ selectedTask: completedTurn2 }), 7000).oneShot).toBe("burst");
  });

  it("cancels a result color immediately when a new task starts", () => {
    const director = new AnimationDirector();
    director.next(overview(), 0);
    director.next(overview({ selectedTask: { threadId: "t", turnId: "turn-1", title: "T", status: "processing", activeFlags: [], updatedAt: 4000 } }), 4000);
    const completed = { threadId: "t", turnId: "turn-1", title: "T", status: "completed" as const, activeFlags: [], updatedAt: 5000 };
    expect(director.next(overview({ selectedTask: completed }), 5000).statusColorRole).toBe("completed");
    const nextTask = { ...completed, threadId: "next", turnId: "turn-2", status: "processing" as const, updatedAt: 5100 };
    expect(director.next(overview({ selectedTask: nextTask }), 5100).statusColorRole).toBeUndefined();
  });
});
