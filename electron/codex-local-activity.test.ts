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
  it("keeps unanswered input requests waiting across quiet logs, other activity, and restart", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-user-input.jsonl");
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    writeFileSync(file, [
      line(timestamp, "session_meta", { id: "thread-input", source: "vscode" }),
      line(timestamp, "event_msg", { type: "task_started", turn_id: "turn-input" }),
      line(timestamp, "response_item", {
        type: "function_call", id: "item-input", call_id: "call-input", name: "request_user_input", arguments: "{}"
      }),
      line(timestamp, "response_item", { type: "reasoning", id: "reasoning-1" }),
      line(timestamp, "response_item", { type: "function_call_output", call_id: "unrelated", output: "done" })
    ].join("\n") + "\n");
    const reader = new CodexLocalActivityReader([root]);
    for (const [currentReader, at] of [[reader, now], [reader, now + 180_000], [new CodexLocalActivityReader([root]), now + 180_000]] as const) {
      expect((await currentReader.refresh(at))[0]).toMatchObject({
        status: "waiting-input", emotionHint: "waiting-input",
        activity: { kind: "approval", phase: "started", itemId: "call-input" }
      });
    }
    appendFileSync(file, line(timestamp, "response_item", {
      type: "function_call_output", call_id: "call-input", output: "{\"answers\":{}}"
    }) + "\n");
    expect((await reader.refresh(now))[0]).toMatchObject({ status: "processing" });
    expect((await new CodexLocalActivityReader([root]).refresh(now + 180_000))[0].status).not.toBe("waiting-input");
  });

  it("resolves only the answered input request and clears waits when the turn ends", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-inputs.jsonl");
    const timestamp = new Date().toISOString();
    writeFileSync(file, [
      line(timestamp, "session_meta", { id: "thread-inputs", source: "vscode" }),
      line(timestamp, "event_msg", { type: "task_started", turn_id: "turn-inputs" }),
      ...["input-1", "input-2"].map((call_id) => line(timestamp, "response_item", {
        type: "function_call", call_id, name: "functions.request_user_input", arguments: "{}"
      })),
      line(timestamp, "response_item", { type: "function_call_output", call_id: "input-1", output: "{}" })
    ].join("\n") + "\n");
    const reader = new CodexLocalActivityReader([root]);
    expect((await reader.refresh())[0]).toMatchObject({
      status: "waiting-input", activity: { kind: "approval", itemId: "input-2" }
    });
    appendFileSync(file, line(timestamp, "event_msg", { type: "task_complete", turn_id: "turn-inputs" }) + "\n");
    expect((await reader.refresh())[0]).toMatchObject({ status: "completed" });
  });

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

  it("does not guess a destructive Desktop exec is waiting without approval metadata", () => {
    const state = parseLocalSessionLines([
      line("2026-09-04T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-host-exec" }),
      line("2026-09-04T00:00:01.000Z", "response_item", {
        type: "custom_tool_call", id: "tool-host-exec", call_id: "call-host-exec", name: "exec",
        status: "completed", input: JSON.stringify({ cmd: "rm -rf /tmp/approval-fixture" })
      })
    ]);
    expect(state.lastActivity).toMatchObject({ kind: "command", phase: "progress" });
  });

  it("does not guess a Desktop Browser call is waiting without policy metadata", () => {
    const state = parseLocalSessionLines([
      line("2026-09-04T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-host-browser" }),
      line("2026-09-04T00:00:01.000Z", "response_item", {
        type: "function_call", id: "tool-host-browser", call_id: "call-host-browser",
        name: "mcp__cua_repl", status: "completed", arguments: JSON.stringify({ code: "await cua.createBrowserTab('iab', 'https://example.com')" })
      })
    ]);
    expect(state.lastActivity?.kind).not.toBe("approval");
  });

  it("keeps an unfinished auto-executed escalated exec call processing with command activity", async () => {
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
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("keeps a completed-envelope Desktop escalated exec call processing with command activity", async () => {
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
        call_id: "call-auto-approved",
        input: `const result = await tools.exec_command({
          cmd: "ps -axo pid=,command=",
          sandbox_permissions: "require_escalated",
          justification: "Allow a read-only process check?"
        });`
      })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "thread-auto-approved",
      status: "processing",
      activity: { kind: "command", phase: "progress", itemId: "call-auto-approved" }
    });
  });

  it("reports command activity when an auto-executed Desktop tool output arrives", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-approved.jsonl");
    const now = new Date().toISOString();
    writeFileSync(file, [
      line(now, "session_meta", { id: "thread-approved", cwd: "/tmp/project", source: "vscode" }),
      line(now, "event_msg", { type: "task_started", turn_id: "turn-approved" }),
      line(now, "response_item", {
        type: "custom_tool_call",
        id: "tool-approved",
        call_id: "call-approved",
        name: "exec",
        status: "completed",
        input: `const result = await tools.exec_command({
          cmd: "pwd",
          sandbox_permissions: "require_escalated",
          justification: "Allow pwd?"
        });`
      }),
      line(now, "response_item", {
        type: "custom_tool_call_output",
        id: "tool-output-approved",
        call_id: "call-approved",
        output: [{ type: "input_text", text: "/tmp/project" }]
      })
    ].join("\n") + "\n");

    const tasks = await new CodexLocalActivityReader([root]).refresh();
    expect(tasks[0]).toMatchObject({
      threadId: "thread-approved",
      status: "processing",
      activity: { kind: "command", phase: "progress", itemId: "tool-output-approved" }
    });
  });

  it("keeps an MCP tool processing while Guardian reviews an approval-gated policy", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "rollout-mcp-approval.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-mcp", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-mcp" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-mcp",
        name: "exec",
        status: "completed",
        input: `const result = await tools.mcp__codegraph__codegraph_context({ task: "inspect" });`
      })
    ].join("\n") + "\n");
    const reader = new CodexLocalActivityReader([root]);

    expect((await reader.refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command", phase: "progress", itemId: "turn-mcp" }
    });
  });

  it("does not wait for MCP tools that are approved or declared read-only", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "rollout-mcp-no-approval.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-mcp-safe", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-mcp-safe" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-approved",
        name: "exec",
        status: "completed",
        input: `await tools.mcp__codegraph__codegraph_explore({ query: "reader" });`
      }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-readonly",
        name: "exec",
        status: "completed",
        input: `await tools.mcp__node_repl__js({ code: "1 + 1" });`
      })
    ].join("\n") + "\n");
    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({ status: "processing" });
  });

  it("keeps MCP activity processing when the matching tool output arrives", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "rollout-mcp-completed.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-mcp-done", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-mcp-done" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-mcp-done",
        name: "exec",
        status: "completed",
        input: `await tools.mcp__codegraph__codegraph_context({ task: "inspect" });`
      }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call_output",
        call_id: "call-mcp-done",
        output: "ok"
      })
    ].join("\n") + "\n");
    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("does not wait when an escalated command matches an approved prefix", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["curl"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-allowed-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-allowed-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-allowed-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-curl",
        name: "exec",
        status: "completed",
        input: `await tools.exec_command({ cmd: "curl https://example.com", sandbox_permissions: "require_escalated", prefix_rule: ["curl"] });`
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("does not wait when JSON function-call input names an approved prefix", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["curl"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-json-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-json-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-json-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "function_call",
        call_id: "call-json-curl",
        name: "exec",
        input: JSON.stringify({
          cmd: "curl https://example.com",
          sandbox_permissions: "require_escalated",
          prefix_rule: ["curl"]
        })
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("keeps an escalated command processing when an approved prefix does not match", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["curl"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-mismatched-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-mismatched-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-mismatched-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "function_call",
        call_id: "call-mismatched-command",
        name: "exec",
        input: JSON.stringify({
          cmd: "touch /tmp/not-approved",
          sandbox_permissions: "require_escalated",
          prefix_rule: ["curl"]
        })
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("keeps an escalated compound command processing when only its first segment is approved", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["curl"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-compound-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-compound-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-compound-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "function_call",
        call_id: "call-compound-command",
        name: "exec",
        input: JSON.stringify({
          cmd: "curl https://example.com && touch /tmp/not-approved",
          sandbox_permissions: "require_escalated",
          prefix_rule: ["curl"]
        })
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("recognizes an approved argv prefix containing a quoted space", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["echo", "hello world"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-quoted-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-quoted-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-quoted-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "function_call",
        call_id: "call-quoted-command",
        name: "exec",
        input: JSON.stringify({
          cmd: `echo "hello world" again`,
          sandbox_permissions: "require_escalated"
        })
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("keeps an escalated command with unknown backslash escapes processing", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    const rules = path.join(root, "rules");
    mkdirSync(sessions, { recursive: true });
    mkdirSync(rules, { recursive: true });
    writeFileSync(path.join(rules, "default.rules"), `prefix_rule(pattern=["printf", "q"], decision="allow")\n`);
    writeFileSync(path.join(sessions, "rollout-backslash-command.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-backslash-command", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-backslash-command" }),
      line(new Date().toISOString(), "response_item", {
        type: "function_call",
        call_id: "call-backslash-command",
        name: "exec",
        input: JSON.stringify({
          cmd: String.raw`printf "\q"`,
          sandbox_permissions: "require_escalated"
        })
      })
    ].join("\n") + "\n");

    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("does not infer user approval from a destructive MCP call", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions", "2026", "09", "02");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "rollout-destructive-mcp.jsonl"), [
      line(new Date().toISOString(), "session_meta", { id: "thread-destructive", cwd: "/tmp/project", source: "vscode" }),
      line(new Date().toISOString(), "event_msg", { type: "task_started", turn_id: "turn-destructive" }),
      line(new Date().toISOString(), "response_item", {
        type: "custom_tool_call",
        call_id: "call-destructive",
        name: "exec",
        input: `await tools.mcp__store__delete_record({ id: "1" });`
      })
    ].join("\n") + "\n");
    expect((await new CodexLocalActivityReader([root]).refresh())[0]).toMatchObject({
      status: "processing",
      activity: { kind: "command" }
    });
  });

  it("reads an unflushed complete escalated exec record as command activity", async () => {
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
      activity: { kind: "command", phase: "progress", itemId: "call-unflushed" }
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

  it("keeps a failed command separate from the unfinished turn result", () => {
    const state = parseLocalSessionLines([
      line("2026-09-01T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-1" }),
      line("2026-09-01T00:00:01.000Z", "event_msg", {
        type: "item_completed", item: { type: "CommandExecution", id: "command-1", status: "failed" }
      })
    ]);
    expect(state.openTurn).toBe(true);
    expect(state.lastActivity).toMatchObject({ kind: "command", phase: "failed" });
    expect(state.terminalStatus).toBeUndefined();
  });

  it("does not turn a recovered command failure into a task failure when logs go quiet", async () => {
    const root = temporaryRoot();
    const sessions = path.join(root, "sessions");
    mkdirSync(sessions, { recursive: true });
    const file = path.join(sessions, "rollout-command-retry.jsonl");
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    writeFileSync(file, [
      line(timestamp, "session_meta", { id: "thread-retry", source: "vscode" }),
      line(timestamp, "event_msg", { type: "task_started", turn_id: "turn-retry" }),
      line(timestamp, "event_msg", {
        type: "item_completed", item: { type: "CommandExecution", id: "command-1", status: "failed" }
      }),
      line(timestamp, "event_msg", {
        type: "item_completed", item: { type: "CommandExecution", id: "command-2", status: "completed" }
      })
    ].join("\n") + "\n");
    const reader = new CodexLocalActivityReader([root]);
    expect((await reader.refresh(now))[0]).toMatchObject({ status: "processing" });
    for (const currentReader of [reader, new CodexLocalActivityReader([root])]) {
      expect((await currentReader.refresh(now + 180_000))[0]).toMatchObject({
        status: "idle", emotionHint: "idle", activity: { kind: "command", phase: "completed" }
      });
    }
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
