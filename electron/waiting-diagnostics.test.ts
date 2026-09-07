import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WaitingDiagnostics } from "./waiting-diagnostics";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("waiting diagnostics", () => {
  it("records initial and changed source snapshots with only allowlisted fields", () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-waiting-diagnostics-"));
    roots.push(root);
    const file = path.join(root, "waiting.jsonl");
    const diagnostics = new WaitingDiagnostics(file);
    const base = { timestamp: 1_000, protocolPending: 0, rolloutPending: 0, hostVisible: false, taskFallbackPending: 0, waiting: false };

    diagnostics.reset();
    diagnostics.record({ ...base, threadId: "must-not-be-written", command: "must-not-be-written" } as any);
    diagnostics.record({ ...base, timestamp: 1_500 });
    diagnostics.record({ ...base, timestamp: 2_000, protocolPending: 1, waiting: true });
    diagnostics.record({ ...base, timestamp: 3_000, protocolPending: 1, rolloutPending: 2, waiting: true });
    diagnostics.record({ ...base, timestamp: 4_000, protocolPending: 1, rolloutPending: 2, hostVisible: true, waiting: true });
    diagnostics.record({ ...base, timestamp: 5_000, protocolPending: 1, rolloutPending: 2, hostVisible: true, taskFallbackPending: 3, waiting: true });

    const records = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(records).toHaveLength(5);
    expect(records.map((record) => Object.keys(record))).toEqual(Array(5).fill([
      "timestamp", "protocolPending", "rolloutPending", "hostVisible", "taskFallbackPending", "waiting"
    ]));
    expect(records.map((record) => [record.protocolPending, record.rolloutPending, record.hostVisible, record.taskFallbackPending, record.waiting])).toEqual([
      [0, 0, false, 0, false], [1, 0, false, 0, true], [1, 2, false, 0, true], [1, 2, true, 0, true], [1, 2, true, 3, true]
    ]);
    expect(readFileSync(file, "utf8")).not.toContain("must-not-be-written");
  });

  it("contains reset and append failures", () => {
    const diagnostics = new WaitingDiagnostics("/private/tmp/grok-bot-pet-waiting-diagnostics.jsonl", {
      reset: () => { throw new Error("reset failed"); },
      append: () => { throw new Error("append failed"); }
    });

    expect(() => diagnostics.reset()).not.toThrow();
    expect(() => diagnostics.record({ timestamp: 1_000, protocolPending: 0, rolloutPending: 0, hostVisible: false, taskFallbackPending: 0, waiting: false })).not.toThrow();
  });
});
