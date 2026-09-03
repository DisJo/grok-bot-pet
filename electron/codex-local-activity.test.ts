import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverCodexCliCandidates } from "./codex-bridge";
import { CodexLocalActivityReader, parseLocalSessionLines } from "./codex-local-activity";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local Codex activity inference", () => {
  it("tracks an unfinished turn and its latest activity", () => {
    const state = parseLocalSessionLines([
      line("2026-09-01T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-1", started_at: 1788192000 }),
      line("2026-09-01T00:00:01.000Z", "response_item", { type: "reasoning", id: "reason-1" }),
      line("2026-09-01T00:00:02.000Z", "response_item", { type: "custom_tool_call", id: "tool-1" })
    ]);
    expect(state.openTurn).toBe(true);
    expect(state.turnId).toBe("turn-1");
    expect(state.lastActivity?.kind).toBe("command");
    expect(state.emotionHint).toBe("focus");
  });

  it("reports an unfinished escalated exec call as waiting for approval", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-approval.jsonl");
    writeFileSync(file, [
      line(new Date().toISOString(), "session_meta", { id: "thread-approval", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-approval" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        id: "call-approval",
        name: "exec",
        status: "in_progress",
        input: JSON.stringify({
          cmd: "ps -axo pid=,command=",
          sandbox_permissions: "require_escalated",
          justification: "Allow a read-only process check?"
        })
      })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "thread-approval",
      status: "waiting-input",
      activity: { kind: "approval" }
    });
  });

  it("keeps an automatically approved escalated exec call in the working state", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-auto-approved.jsonl");
    writeFileSync(file, [
      line(new Date().toISOString(), "session_meta", { id: "thread-auto-approved", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-auto-approved" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        id: "call-auto-approved",
        name: "exec",
        status: "completed",
        input: JSON.stringify({
          cmd: "ps -axo pid=,command=",
          sandbox_permissions: "require_escalated"
        })
      })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "thread-auto-approved",
      status: "processing",
      activity: { kind: "command", phase: "progress" }
    });
  });

  it("reads a complete approval record before the writer appends a newline", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-unflushed-approval.jsonl");
    writeFileSync(file, [
      line(new Date().toISOString(), "session_meta", { id: "thread-unflushed", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-unflushed" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        id: "call-unflushed",
        name: "exec",
        status: "completed",
        input: JSON.stringify({
          cmd: "ps -axo pid=,command=",
          sandbox_permissions: "require_escalated"
        })
      })
    ].join("\n"));

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "thread-unflushed",
      status: "processing",
      activity: { kind: "command", phase: "progress" }
    });
  });

  it("maps completed and interrupted lifecycle records", () => {
    const completed = parseLocalSessionLines([
      line("2026-09-01T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-1" }),
      line("2026-09-01T00:00:02.000Z", "event_msg", { type: "task_complete", turn_id: "turn-1" })
    ]);
    expect(completed.openTurn).toBe(false);
    expect(completed.terminalStatus).toBe("completed");

    const stopped = parseLocalSessionLines([
      line("2026-09-01T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-2" }),
      line("2026-09-01T00:00:02.000Z", "event_msg", { type: "turn_aborted", turn_id: "turn-2" })
    ]);
    expect(stopped.openTurn).toBe(false);
    expect(stopped.terminalStatus).toBe("stopped");
  });

  it("maps any task completion with an error payload to terminal error", () => {
    const failed = parseLocalSessionLines([
      line("2026-09-01T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-error" }),
      line("2026-09-01T00:00:02.000Z", "event_msg", {
        type: "task_complete",
        turn_id: "turn-error",
        error: { message: "An OpenAI request failed", codex_error_info: "future_error_code" }
      })
    ]);

    expect(failed.openTurn).toBe(false);
    expect(failed.terminalStatus).toBe("error");
    expect(failed.lastActivity).toMatchObject({ kind: "error", phase: "failed" });
    expect(failed.emotionHint).toBe("error");
  });

  it("keeps a completed plan waiting until the user starts another turn", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-plan.jsonl");
    const now = new Date().toISOString();
    writeFileSync(file, [
      line(now, "session_meta", { id: "thread-plan", cwd: "/tmp/project", source: "vscode" }),
      line(now, "event_msg", { type: "task_started", turn_id: "turn-plan" }),
      line(now, "event_msg", { type: "item_completed", item: { type: "Plan", id: "plan-1" } }),
      line(now, "event_msg", { type: "task_complete", turn_id: "turn-plan" })
    ].join("\n") + "\n");
    const reader = new CodexLocalActivityReader([root]);

    expect((await reader.refresh())[0]).toMatchObject({
      threadId: "thread-plan",
      status: "waiting-input",
      activity: { kind: "approval", phase: "started", itemId: "plan-1" }
    });

    appendFileSync(file, line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-after-plan" }) + "\n");

    expect((await reader.refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "user-message" }
    });
  });

  it("finds an open turn even when its start is outside the one-megabyte activity tail", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "01");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-2026-09-01T00-00-00-thread-long.jsonl");
    const records = [
      line("2026-09-01T00:00:00.000Z", "session_meta", { id: "thread-long", cwd: "/tmp/project", source: "cli" }),
      line("2026-09-01T00:00:01.000Z", "event_msg", { type: "task_started", turn_id: "turn-long", started_at: Math.floor(Date.now() / 1000) }),
      ...Array.from({ length: 9500 }, (_, index) => line(new Date(Date.now() - 1000).toISOString(), "event_msg", { type: "token_count", padding: "x".repeat(160), index })),
      line(new Date().toISOString(), "response_item", { type: "reasoning", id: "reason-latest" })
    ];
    writeFileSync(file, `${records.join("\n")}\n`);
    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]?.threadId).toBe("thread-long");
    expect(tasks[0]?.status).toBe("processing");
    expect(tasks[0]?.activity?.kind).toBe("reasoning");
  });

  it("preserves a CLI subagent's parent thread identity", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-child.jsonl");
    writeFileSync(file, [
      line(new Date().toISOString(), "session_meta", {
        id: "cli-child",
        parent_thread_id: "cli-parent",
        cwd: "/tmp/project",
        source: { subagent: { other: "worker" } }
      }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-child" })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "cli-child",
      parentThreadId: "cli-parent",
      sourceKind: "subagent",
      status: "processing"
    });
  });

  it("leaves an independent CLI task without a parent", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-cli.jsonl");
    writeFileSync(file, [
      line(new Date().toISOString(), "session_meta", { id: "cli-top", cwd: "/tmp/project", source: "cli" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-cli" })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]?.threadId).toBe("cli-top");
    expect(tasks[0]?.parentThreadId).toBeUndefined();
    expect(tasks[0]?.status).toBe("processing");
  });
});

describe("Codex CLI discovery", () => {
  it("finds npm/nvm installations even when Finder did not inherit their PATH", () => {
    const root = temporaryRoot();
    const executable = path.join(root, ".nvm", "versions", "node", "v24.0.0", "bin", "codex");
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, "#!/bin/sh\n");
    chmodSync(executable, 0o755);
    expect(discoverCodexCliCandidates(root, "", undefined)).toContain(executable);
  });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "grok-pet-test-"));
  temporaryRoots.push(root);
  return root;
}

function line(timestamp: string, type: string, payload: Record<string, unknown>) {
  return JSON.stringify({ timestamp, type, payload });
}
