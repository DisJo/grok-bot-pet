import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CodexBridge, CodexBridgeDependencies, inferActivitySignal, inferItemEmotion, inferPersistedTaskStatus, isServerRequestMessage, isUserBlockingServerRequest, mapRuntimeStatus, mapTurnStatus, resolveAppServerTransports, rolloutPendingRefs, selectTasks } from "./codex-bridge";
import { JsonRpcTransport, JsonRpcTransportHandlers } from "./codex-transport";
import { CodexTask } from "./types";

describe("Codex status mapping", () => {
  it("maps active work and waiting approval", () => {
    expect(mapRuntimeStatus({ type: "active", activeFlags: [] })).toBe("processing");
    expect(mapRuntimeStatus({ type: "active", activeFlags: ["waitingOnApproval"] })).toBe("waiting-input");
  });
  it("maps idle and errors", () => {
    expect(mapRuntimeStatus({ type: "idle" })).toBe("idle");
    expect(mapRuntimeStatus({ type: "systemError" })).toBe("error");
  });
  it("uses the authoritative last-turn status", () => {
    expect(mapTurnStatus("inProgress")).toBe("processing");
    expect(mapTurnStatus("completed")).toBe("completed");
    expect(mapTurnStatus("failed")).toBe("error");
    expect(mapTurnStatus("interrupted")).toBe("stopped");
  });
  it("keeps approval/input flags above the turn status", () => {
    expect(mapTurnStatus("inProgress", ["waitingOnApproval"])).toBe("waiting-input");
  });
});

describe("host approval observer", () => {
  it("observes silently, emits only on host visibility transitions, and stops polling", () => {
    vi.useFakeTimers();
    try {
      const samples: Array<boolean | undefined> = [undefined, false, true, true, false];
      const promptFlags: boolean[] = [];
      const bridge = new CodexBridge("/tmp/codex-host-observer-test", undefined, {
        codexApprovalVisible: (prompt) => { promptFlags.push(prompt); return samples.shift(); }
      });
      (bridge as any).refresh = async () => bridge.overview();
      const overviews: boolean[] = [];
      bridge.on("overview", (value) => overviews.push(value.hasWaiting));

      bridge.start();
      vi.advanceTimersByTime(2_000);
      bridge.stop();
      const callsAtStop = promptFlags.length;
      vi.advanceTimersByTime(1_000);

      expect(promptFlags).toEqual([false, false, false, false, false]);
      expect(overviews).toEqual([true, false]);
      expect(promptFlags).toHaveLength(callsAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps one observer when started twice and stops every host poll", () => {
    vi.useFakeTimers();
    try {
      const promptFlags: boolean[] = [];
      const bridge = new CodexBridge("/tmp/codex-host-idempotent-start-test", undefined, {
        codexApprovalVisible: (prompt) => { promptFlags.push(prompt); return false; }
      });
      (bridge as any).refresh = async () => bridge.overview();

      bridge.start();
      bridge.start();
      vi.advanceTimersByTime(500);
      expect(promptFlags).toEqual([false, false]);

      bridge.stop();
      vi.advanceTimersByTime(1_000);
      expect(promptFlags).toEqual([false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never requests permission on fresh launches or restarts when access is unavailable", () => {
    vi.useFakeTimers();
    try {
      const promptFlags: boolean[] = [];
      for (let launch = 0; launch < 2; launch += 1) {
        const bridge = new CodexBridge("/tmp/codex-host-no-permission-test", undefined, {
          codexApprovalVisible: (prompt) => { promptFlags.push(prompt); return undefined; }
        });
        vi.spyOn(bridge, "refresh").mockImplementation(async () => bridge.overview());
        bridge.start();
        vi.advanceTimersByTime(500);
        bridge.stop();
        bridge.start();
        vi.advanceTimersByTime(500);
        bridge.stop();
        expect(bridge.overview()).toMatchObject({ hasWaiting: false, lastError: undefined });
      }
      expect(promptFlags).toEqual([false, false, false, false, false, false, false, false]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an unavailable native sample without disturbing other pending waits", () => {
    const samples: Array<boolean | undefined> = [true, undefined];
    const bridge = new CodexBridge("/tmp/codex-host-unavailable-test", undefined, {
      codexApprovalVisible: () => samples.shift()
    });
    const tracker = (bridge as any).pendingInteractions;
    tracker.add("protocol", { id: "protocol-request", threadId: "protocol-thread" });
    tracker.add("rollout", { id: "rollout-request", threadId: "rollout-thread" });
    const overviews: boolean[] = [];
    bridge.on("overview", (value) => overviews.push(value.hasWaiting));

    (bridge as any).pollHostApproval();
    (bridge as any).pollHostApproval();

    expect(bridge.overview()).toMatchObject({ hasWaiting: true, lastError: undefined });
    expect(tracker.resolve("protocol", "protocol-request")).toMatchObject({ id: "protocol-request" });
    expect(tracker.resolve("rollout", "rollout-request")).toMatchObject({ id: "rollout-request" });
    expect(tracker.hasWaiting()).toBe(false);
    expect(overviews).toEqual([true, true]);
  });
});

describe("Codex refresh fallback", () => {
  it("keeps only stable rollout approval identities", () => {
    const task = (overrides: Partial<CodexTask>): CodexTask => ({
      threadId: "thread-1", title: "Task", status: "waiting-input", activeFlags: [], updatedAt: 1,
      activity: { kind: "approval", phase: "started", at: 1, itemId: "call-1" }, ...overrides
    });

    expect(rolloutPendingRefs([
      task({ turnId: "turn-1" }),
      task({ threadId: "thread-2", activity: { kind: "approval", phase: "completed", at: 1, itemId: "call-2" } }),
      task({ threadId: "thread-3", status: "processing" }),
      task({ threadId: "thread-4", activity: { kind: "command", phase: "started", at: 1, itemId: "call-4" } }),
      task({ threadId: "thread-5", activity: { kind: "approval", phase: "progress", at: 1 } })
    ])).toEqual([{ id: "call-1", threadId: "thread-1", turnId: "turn-1" }]);
  });

  it("does not block local activity while App Server is still connecting", async () => {
    const bridge = new CodexBridge("/tmp/codex-refresh-test");
    let finishConnect!: () => void;
    (bridge as any).connect = () => new Promise<void>((resolve) => { finishConnect = resolve; });
    (bridge as any).localActivity = {
      refresh: async () => [{
        threadId: "local-task",
        title: "Local task",
        status: "waiting-input",
        activeFlags: [],
        updatedAt: Date.now(),
        activity: { kind: "approval", phase: "progress", at: Date.now() }
      }]
    };

    const refresh = bridge.refresh();
    const overview = await Promise.race([
      refresh,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 20))
    ]);
    finishConnect();
    await refresh;

    expect(overview?.selectedTask).toMatchObject({
      threadId: "local-task",
      status: "waiting-input"
    });
    expect(overview?.hasWaiting).toBe(true);
  });

  it("does not treat a blocked goal from another task as approval waiting", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-pet-goals-"));
    try {
      writeGoalFixture(root, "blocked");
      const bridge = bridgeWithLocalProcessing(root);

      const overview = await bridge.refresh();

      expect(overview.hasWaiting).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not treat ordinary input as approval waiting", async () => {
    const bridge = new CodexBridge("/tmp/codex-refresh-test");
    (bridge as any).connect = async () => {};
    (bridge as any).localActivity = {
      refresh: async () => [{
        threadId: "local-input",
        title: "Local input",
        status: "waiting-input",
        activeFlags: [],
        updatedAt: Date.now()
      }]
    };

    const overview = await bridge.refresh();

    expect(overview.hasWaiting).toBe(false);
  });

  it("replaces rollout pending identities on every refresh", async () => {
    const bridge = new CodexBridge("/tmp/codex-rollout-tracker-test");
    (bridge as any).connect = async () => {};
    const replace = vi.spyOn((bridge as any).pendingInteractions, "replace");
    let waiting = true;
    (bridge as any).localActivity = { refresh: async () => [{
      threadId: "thread-1", title: "Task", status: waiting ? "waiting-input" : "processing",
      activeFlags: [], updatedAt: Date.now(),
      activity: { kind: waiting ? "approval" : "command", phase: "started", at: Date.now(), itemId: "call-1" }
    }] };
    expect((await bridge.refresh()).hasWaiting).toBe(true);
    expect(replace).toHaveBeenLastCalledWith("rollout", [{ id: "call-1", threadId: "thread-1", turnId: undefined }]);
    waiting = false;
    expect((await bridge.refresh()).hasWaiting).toBe(false);
    expect(replace).toHaveBeenLastCalledWith("rollout", []);
  });
});

describe("item emotion mapping", () => {
  it("maps Codex item kinds to visible activity", () => {
    expect(inferItemEmotion({ type: "webSearch" })).toBe("searching");
    expect(inferItemEmotion({ type: "reasoning" })).toBe("thinking");
    expect(inferItemEmotion({ type: "agentMessage" })).toBe("replying");
    expect(inferItemEmotion({ type: "commandExecution" })).toBe("focus");
    expect(inferItemEmotion({ type: "mcpToolCall" })).toBe("loading");
    expect(inferItemEmotion({ type: "contextCompaction" })).toBe("recalling");
  });
  it("recognizes failures and restrictions before generic item types", () => {
    expect(inferItemEmotion({ type: "commandExecution", status: "failed" })).toBe("error");
    expect(inferItemEmotion({ type: "commandExecution", status: "denied" })).toBe("restricted");
  });
});

describe("App Server event dispatch", () => {
  it("prepares the daemon before selecting bridge transports", async () => {
    const calls: unknown[] = [];

    const transports = await resolveAppServerTransports("/codex", "/codex-home", async (options) => {
      calls.push(options);
      return true;
    });

    expect(calls).toEqual([{ codexCli: "/codex", codexHome: "/codex-home" }]);
    expect(transports).toEqual([
      { kind: "daemon", socketPath: "/codex-home/app-server-control/app-server-control.sock" },
      { kind: "stdio", args: ["app-server", "--listen", "stdio://"] }
    ]);
  });

  it("falls back to a working stdio transport when the daemon connection fails", async () => {
    const attempts: string[] = [];
    const bridge = bridgeWithTransports({
      resolveAppServerTransports: async () => [
        { kind: "daemon", socketPath: "/missing.sock" },
        { kind: "stdio", args: ["app-server", "--listen", "stdio://"] }
      ],
      connectUnixSocketWebSocket: async () => {
        attempts.push("daemon");
        throw new Error("daemon unavailable");
      },
      connectStdioJsonRpc: async (_command, _args, _env, handlers) => {
        attempts.push("stdio");
        return respondingTransport(handlers);
      }
    });

    await (bridge as any).connect();

    expect(attempts).toEqual(["daemon", "stdio"]);
    expect(bridge.overview()).toMatchObject({ connected: true, connectionMode: "app-server" });
    bridge.stop();
  });

  it("does not publish a connection that finishes after stop", async () => {
    let finishResolution!: (value: any) => void;
    let daemonConnections = 0;
    const bridge = bridgeWithTransports({
      resolveAppServerTransports: () => new Promise((resolve) => { finishResolution = resolve; }),
      connectUnixSocketWebSocket: async () => {
        daemonConnections += 1;
        throw new Error("must not connect");
      }
    });

    const connecting = (bridge as any).connect();
    bridge.stop();
    finishResolution([{ kind: "daemon", socketPath: "/daemon.sock" }]);
    await connecting;

    expect(daemonConnections).toBe(0);
    expect(bridge.overview().connected).toBe(false);
  });

  it("distinguishes a server request from a client response", () => {
    expect(isServerRequestMessage({ id: 4, method: "item/commandExecution/requestApproval", params: { threadId: "t" } })).toBe(true);
    expect(isServerRequestMessage({ id: 4, result: {} })).toBe(false);
  });

  it.each([
    "item/commandExecution/requestApproval",
    "item/fileChange/requestApproval",
    "item/permissions/requestApproval",
    "item/tool/requestUserInput",
    "mcpServer/elicitation/request"
  ])("tracks %s until its request id resolves", (method) => {
    const bridge = bridgeWithProtocolTask();

    (bridge as any).receive(JSON.stringify({
      id: "request-1",
      method,
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" }
    }));
    expect(bridge.overview().hasWaiting).toBe(true);

    (bridge as any).receive(JSON.stringify({
      method: "serverRequest/resolved",
      params: { requestId: "request-1" }
    }));
    expect(bridge.overview()).toMatchObject({
      hasWaiting: false,
      selectedTask: {
        threadId: "thread-1",
        status: "processing",
        activity: { kind: "approval", phase: "completed", itemId: "request-1" }
      }
    });
  });

  it("tracks only documented user-blocking server requests", () => {
    expect(isUserBlockingServerRequest("item/commandExecution/requestApproval")).toBe(true);
    expect(isUserBlockingServerRequest("item/commandExecution/notApproval")).toBe(false);

    const bridge = bridgeWithProtocolTask();
    (bridge as any).receive(JSON.stringify({
      id: "unknown-request",
      method: "item/commandExecution/notApproval",
      params: { threadId: "thread-1", turnId: "turn-1" }
    }));

    expect(bridge.overview()).toMatchObject({
      hasWaiting: false,
      selectedTask: { threadId: "thread-1", status: "processing" }
    });
  });

  it("keeps a task waiting until every tracked request id resolves", () => {
    const bridge = bridgeWithProtocolTask({ activeFlags: ["waitingOnApproval", "waitingOnInput", "serverRequest:legacy", "approvalAudit", "keep-me"] });
    for (const [id, method] of [["request-1", "item/commandExecution/requestApproval"], ["request-2", "item/tool/requestUserInput"]] as const) {
      (bridge as any).receive(JSON.stringify({ id, method, params: { threadId: "thread-1", turnId: "turn-1" } }));
    }

    (bridge as any).receive(JSON.stringify({ method: "serverRequest/resolved", params: { requestId: "request-1" } }));
    expect(bridge.overview()).toMatchObject({
      hasWaiting: true,
      selectedTask: {
        status: "waiting-input",
        activeFlags: expect.arrayContaining(["waitingOnApproval", "waitingOnInput", "serverRequest:legacy", "approvalAudit", "keep-me"]),
        activity: { kind: "approval", phase: "started" }
      }
    });

    (bridge as any).receive(JSON.stringify({ method: "serverRequest/resolved", params: { requestId: "request-2" } }));
    expect(bridge.overview()).toMatchObject({
      hasWaiting: false,
      selectedTask: {
        status: "processing",
        activeFlags: ["approvalAudit", "keep-me"],
        activity: { kind: "approval", phase: "completed", itemId: "request-2" }
      }
    });
  });

  it("keeps outstanding protocol waits visible through ordinary status and activity notifications", () => {
    const bridge = bridgeWithProtocolTask();
    for (const id of ["request-1", "request-2"]) {
      (bridge as any).receive(JSON.stringify({
        id,
        method: "item/commandExecution/requestApproval",
        params: { threadId: "thread-1", turnId: "turn-1", itemId: id }
      }));
    }

    (bridge as any).receive(JSON.stringify({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "active", activeFlags: [] } }
    }));
    (bridge as any).receive(JSON.stringify({
      method: "item/commandExecution/requestApproval/completed",
      params: { threadId: "thread-1", item: { id: "unrelated-item" } }
    }));

    expect(bridge.overview()).toMatchObject({
      hasWaiting: true,
      selectedTask: {
        status: "waiting-input",
        activeFlags: ["waitingOnApproval"],
        activity: { kind: "approval", phase: "started", itemId: "request-2" }
      }
    });

    (bridge as any).receive(JSON.stringify({ method: "serverRequest/resolved", params: { requestId: "request-1" } }));
    expect(bridge.overview().selectedTask).toMatchObject({ status: "waiting-input" });
    (bridge as any).receive(JSON.stringify({ method: "serverRequest/resolved", params: { requestId: "request-2" } }));
    expect(bridge.overview().selectedTask).toMatchObject({ status: "processing" });
  });

  it("uses a nested turn scope for protocol requests and terminal status cleanup", () => {
    const bridge = bridgeWithProtocolTask({ turnId: "old-turn" });
    (bridge as any).receive(JSON.stringify({
      id: "nested-request",
      method: "item/fileChange/requestApproval",
      params: { turn: { id: "nested-turn", threadId: "thread-1" } }
    }));

    (bridge as any).receive(JSON.stringify({
      method: "thread/status/changed",
      params: { turn: { id: "nested-turn", threadId: "thread-1" }, status: { type: "interrupted" } }
    }));

    expect((bridge as any).pendingInteractions.resolve("protocol", "nested-request")).toBeUndefined();
    expect(bridge.overview().selectedTask).toMatchObject({ status: "stopped" });
  });

  it("keeps a completed turn terminal even when another turn still has a pending identity", () => {
    const bridge = bridgeWithProtocolTask({ activeFlags: ["waitingOnApproval"] });
    (bridge as any).pendingInteractions.add("protocol", { id: "other-turn", threadId: "thread-1", turnId: "turn-2" });

    (bridge as any).receive(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } }
    }));

    expect(bridge.overview().selectedTask).toMatchObject({ status: "completed" });
  });

  it("tracks a documented threadless request globally without creating a task", () => {
    const bridge = new CodexBridge("/tmp/codex-threadless-request-test");

    (bridge as any).receive(JSON.stringify({
      id: "threadless-request",
      method: "mcpServer/elicitation/request",
      params: {}
    }));

    expect(bridge.overview()).toMatchObject({ hasWaiting: true, selectedTask: undefined });
    expect((bridge as any).tasks.size).toBe(0);
  });

  it("clears protocol requests only for a completed or interrupted turn scope", () => {
    const bridge = bridgeWithProtocolTask();
    for (const [id, turnId] of [["turn-1-request", "turn-1"], ["turn-2-request", "turn-2"]] as const) {
      (bridge as any).receive(JSON.stringify({
        id,
        method: "item/commandExecution/requestApproval",
        params: { threadId: "thread-1", turnId }
      }));
    }

    (bridge as any).receive(JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } }
    }));
    expect((bridge as any).pendingInteractions.resolve("protocol", "turn-1-request")).toBeUndefined();
    expect((bridge as any).pendingInteractions.resolve("protocol", "turn-2-request")).toMatchObject({ turnId: "turn-2" });

    (bridge as any).receive(JSON.stringify({
      id: "interrupted-request",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-2" }
    }));
    (bridge as any).tasks.get("thread-1").turnId = "turn-2";
    (bridge as any).receive(JSON.stringify({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: { type: "interrupted" } }
    }));
    expect((bridge as any).pendingInteractions.resolve("protocol", "interrupted-request")).toBeUndefined();
  });

  it("preserves host and rollout waiting on disconnect but resets everything on stop", () => {
    const bridge = new CodexBridge("/tmp/codex-disconnect-test");
    const tracker = (bridge as any).pendingInteractions;
    tracker.add("protocol", { id: "protocol-request", threadId: "protocol-thread" });
    tracker.add("rollout", { id: "rollout-request", threadId: "rollout-thread" });
    tracker.setHostVisible(true);
    const replace = vi.spyOn(tracker, "replace");

    (bridge as any).handleDisconnect(0);

    expect(replace).toHaveBeenCalledWith("protocol", []);
    expect(tracker.hasWaiting()).toBe(true);
    expect(tracker.resolve("protocol", "protocol-request")).toBeUndefined();
    expect(tracker.resolve("rollout", "rollout-request")).toMatchObject({ id: "rollout-request" });

    bridge.stop();
    expect(tracker.hasWaiting()).toBe(false);
  });

  it("maps streaming event families to activity signals", () => {
    expect(inferActivitySignal("item/reasoning/summaryTextDelta", {})?.kind).toBe("reasoning");
    expect(inferActivitySignal("turn/plan/updated", {})?.kind).toBe("plan");
    expect(inferActivitySignal("turn/diff/updated", {})?.kind).toBe("file-change");
    expect(inferActivitySignal("item/commandExecution/outputDelta", {})?.kind).toBe("command");
    expect(inferActivitySignal("item/agentMessage/delta", {})?.kind).toBe("agent-output");
  });

  it("recognizes approvals, completion and failures", () => {
    expect(inferActivitySignal("item/commandExecution/requestApproval", {})?.kind).toBe("approval");
    expect(inferActivitySignal("item/completed", { item: { type: "fileChange" } })?.phase).toBe("completed");
    expect(inferActivitySignal("item/completed", { item: { type: "mcpToolCall", status: "failed" } })?.phase).toBe("failed");
  });

  it("recognizes an unresolved sandbox approval from a persisted tool item", () => {
    const signal = inferActivitySignal("item/started", {
      item: {
        type: "customToolCall",
        status: "inProgress",
        input: JSON.stringify({
          cmd: "npm run build:mac",
          sandbox_permissions: "require_escalated"
        })
      }
    });

    expect(signal?.kind).toBe("approval");
    expect(signal?.phase).toBe("started");
  });

  it("turns a live approval request into waiting input", () => {
    const bridge = new CodexBridge("/tmp/codex-approval-test");
    (bridge as any).tasks.set("thread-1", {
      threadId: "thread-1",
      title: "Approval test",
      status: "processing",
      activeFlags: [],
      updatedAt: 1
    });

    (bridge as any).receive(JSON.stringify({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "command-1" }
    }));

    expect(bridge.overview().selectedTask).toMatchObject({
      threadId: "thread-1",
      status: "waiting-input",
      activity: { kind: "approval", phase: "started", itemId: "command-1" }
    });
  });
});

describe("persisted external task status", () => {
  it("infers new external work written after the previous terminal turn", () => {
    expect(inferPersistedTaskStatus(
      { type: "notLoaded" },
      { status: "completed", startedAt: 100, completedAt: 120 },
      130_000,
      135_000
    )).toBe("processing");
  });
  it("keeps a terminal status when the thread timestamp belongs to that turn", () => {
    expect(inferPersistedTaskStatus(
      { type: "notLoaded" },
      { status: "completed", startedAt: 100, completedAt: 120 },
      121_000,
      125_000
    )).toBe("completed");
  });
  it("always trusts an official loaded runtime status first", () => {
    expect(inferPersistedTaskStatus({ type: "active", activeFlags: [] }, { status: "completed" }, 0, 0)).toBe("processing");
  });
});

describe("task priority", () => {
  const task = (threadId: string, status: CodexTask["status"], updatedAt: number, extra: Partial<CodexTask> = {}): CodexTask => ({ threadId, title: threadId, status, updatedAt, activeFlags: [], ...extra });
  it("prefers the newest active task over a newer completed task", () => {
    const result = selectTasks([task("active", "processing", 10), task("done", "completed", 20)]);
    expect(result.selectedTask?.threadId).toBe("active");
    expect(result.activeCount).toBe(1);
  });
  it("uses the most recent task when no work is active", () => {
    expect(selectTasks([task("old", "idle", 10), task("new", "completed", 20)]).selectedTask?.threadId).toBe("new");
  });

  it("counts and lists a desktop parent once while excluding its guardian child", () => {
    const result = selectTasks([
      task("desktop-a", "processing", 10, { sourceKind: "vscode" }),
      task("desktop-b", "processing", 20, { sourceKind: "vscode" }),
      task("guardian", "processing", 30, { sourceKind: "subAgent", parentThreadId: "desktop-a" })
    ]);
    expect(result.activeCount).toBe(2);
    expect(result.recentTasks.map((entry) => entry.threadId)).toEqual(["desktop-a", "desktop-b"]);
  });

  it("folds a child's newest activity into its top-level parent", () => {
    const result = selectTasks([
      task("parent", "idle", 10, { sourceKind: "vscode" }),
      task("child", "processing", 30, {
        sourceKind: "subAgentReview",
        parentThreadId: "parent",
        emotionHint: "searching",
        activity: { kind: "web-search", phase: "started", at: 30 }
      })
    ]);
    expect(result.activeCount).toBe(1);
    expect(result.selectedTask).toMatchObject({
      threadId: "parent",
      status: "processing",
      emotionHint: "searching",
      activity: { kind: "web-search" }
    });
  });

  it("keeps a parent's approval wait above a newer processing guardian", () => {
    const result = selectTasks([
      task("parent", "waiting-input", 10, {
        sourceKind: "vscode",
        activity: { kind: "approval", phase: "progress", at: 10 }
      }),
      task("guardian", "processing", 20, {
        sourceKind: "subAgent",
        parentThreadId: "parent",
        activity: { kind: "user-message", phase: "completed", at: 20 }
      })
    ]);

    expect(result.selectedTask).toMatchObject({
      threadId: "parent",
      status: "waiting-input",
      activity: { kind: "approval" }
    });
  });

  it("counts an independent CLI task but not its CLI subagent", () => {
    const result = selectTasks([
      task("cli-parent", "processing", 10, { sourceKind: "cli" }),
      task("cli-child", "processing", 20, { sourceKind: "subagent", parentThreadId: "cli-parent" })
    ]);
    expect(result.activeCount).toBe(1);
    expect(result.recentTasks.map((entry) => entry.threadId)).toEqual(["cli-parent"]);
  });

  it("counts an active top-level task whose persisted parent points to itself", () => {
    const result = selectTasks([
      task("desktop-self-parent", "processing", 10, {
        sourceKind: "vscode",
        parentThreadId: "desktop-self-parent"
      })
    ]);
    expect(result.activeCount).toBe(1);
    expect(result.recentTasks.map((entry) => entry.threadId)).toEqual(["desktop-self-parent"]);
  });
});

function bridgeWithLocalProcessing(root: string) {
  const bridge = new CodexBridge(root);
  (bridge as any).connect = async () => {};
  (bridge as any).localActivity = {
    refresh: async () => [{
      threadId: "local-task",
      title: "Local task",
      status: "processing",
      activeFlags: [],
      updatedAt: Date.now()
    }]
  };
  return bridge;
}

function bridgeWithProtocolTask(overrides: Partial<CodexTask> = {}) {
  const bridge = new CodexBridge("/tmp/codex-protocol-test");
  (bridge as any).tasks.set("thread-1", {
    threadId: "thread-1",
    turnId: "turn-1",
    title: "Protocol test",
    status: "processing",
    activeFlags: [],
    updatedAt: 1,
    ...overrides
  });
  return bridge;
}

function writeGoalFixture(root: string, status: string) {
  const db = new DatabaseSync(path.join(root, "goals_1.sqlite"));
  try {
    db.exec("CREATE TABLE thread_goals (thread_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL)");
    db.prepare("INSERT INTO thread_goals (thread_id, status) VALUES (?, ?)").run("other-task", status);
  } finally {
    db.close();
  }
}

function bridgeWithTransports(overrides: Partial<CodexBridgeDependencies>) {
  return new CodexBridge("/tmp/codex-transport-test", undefined, {
    discoverCodexCliCandidates: () => ["/codex"],
    ...overrides
  });
}

function respondingTransport(handlers: JsonRpcTransportHandlers): JsonRpcTransport {
  return {
    send(message) {
      const request = JSON.parse(message);
      if (request.id !== undefined) {
        queueMicrotask(() => handlers.onMessage(JSON.stringify({ id: request.id, result: {} })));
      }
    },
    close() {}
  };
}
