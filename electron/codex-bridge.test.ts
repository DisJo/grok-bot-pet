import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildMcpApprovalPolicies, CodexBridge, CodexBridgeDependencies, inferActivitySignal, inferItemEmotion, inferPersistedTaskStatus, isServerRequestMessage, mapRuntimeStatus, mapTurnStatus, resolveAppServerTransports, selectTasks } from "./codex-bridge";
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

describe("Codex refresh fallback", () => {
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
});

describe("MCP approval policy discovery", () => {
  it("backs off policy discovery after App Server rejects the metadata requests", async () => {
    const bridge = new CodexBridge("/tmp/codex-policy-backoff-test");
    let requestCount = 0;
    (bridge as any).request = async () => {
      requestCount += 1;
      throw new Error("method not found");
    };

    await (bridge as any).refreshMcpApprovalPolicies();
    await (bridge as any).refreshMcpApprovalPolicies();

    expect(requestCount).toBe(2);
  });

  it("does not block thread refresh while policy discovery is pending", async () => {
    const bridge = new CodexBridge("/tmp/codex-policy-background-test");
    (bridge as any).request = async (method: string) => {
      if (method === "config/read" || method === "mcpServerStatus/list") return new Promise(() => {});
      if (method === "thread/list") return { data: [] };
      throw new Error(`unexpected request: ${method}`);
    };

    const refreshed = await Promise.race([
      (bridge as any).refreshAppServer().then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20))
    ]);

    expect(refreshed).toBe(true);
  });

  it("combines effective config overrides with live tool annotations", () => {
    expect(buildMcpApprovalPolicies({
      mcp_servers: {
        codegraph: { tools: { codegraph_explore: { approval_mode: "approve" } } },
        safe: { default_tools_approval_mode: "writes" }
      }
    }, [{
      name: "codegraph",
      tools: {
        codegraph_context: { name: "codegraph_context" },
        codegraph_explore: { name: "codegraph_explore" }
      }
    }, {
      name: "safe",
      tools: {
        read: { name: "read", annotations: { readOnlyHint: true } }
      }
    }])).toEqual([
      { server: "codegraph", tool: "codegraph_context", mode: "auto", readOnly: undefined, destructive: undefined },
      { server: "codegraph", tool: "codegraph_explore", mode: "approve", readOnly: undefined, destructive: undefined },
      { server: "safe", tool: "read", mode: "writes", readOnly: true, destructive: undefined }
    ]);
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
