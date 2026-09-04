import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, Interface } from "node:readline";
import { accessSync, constants, readdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import { CodexActivityKind, CodexActivitySignal, CodexOverview, CodexTask, CodexTaskStatus } from "./types";
import { CodexLocalActivityReader } from "./codex-local-activity";
import { localizedCopy, LocalizedDataCopy } from "./localization";
import { appServerTransports, prepareSharedCodexDaemon, SharedDaemonOptions } from "./codex-daemon";

type JsonRpcMessage = { id?: number | string; method?: string; params?: any; result?: any; error?: any };
export type SharedDaemonPreparer = (options: SharedDaemonOptions) => Promise<boolean>;

export class CodexBridge extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: Interface;
  private nextId = 1;
  private pending = new Map<number | string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private tasks = new Map<string, CodexTask>();
  private connected = false;
  private lastError?: string;
  private refreshTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private stopped = false;
  private subscribedThreads = new Set<string>();
  private connecting?: Promise<void>;
  private localInferenceAvailable = false;
  private readonly localActivity: CodexLocalActivityReader;

  constructor(
    private readonly codexHome = process.env.CODEX_HOME || path.join(homedir(), ".codex"),
    private readonly copy: LocalizedDataCopy = localizedCopy("en").data
  ) {
    super();
    this.localActivity = new CodexLocalActivityReader([codexHome], copy.codexTask);
  }

  start() {
    this.stopped = false;
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), 2000);
  }

  stop() {
    this.stopped = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.lines?.close();
    this.child?.kill();
    this.child = undefined;
  }

  overview(): CodexOverview { return this.makeOverview(); }

  async refresh(): Promise<CodexOverview> {
    if (!this.connected) void this.connect();
    if (this.connected) {
      try { await this.refreshAppServer(); } catch (error) { this.handleError(error); }
    }
    try {
      const inferred = await this.localActivity.refresh();
      this.localInferenceAvailable = inferred.length > 0;
      for (const task of inferred) this.mergeInferredTask(task);
    } catch (error) {
      if (!this.connected) this.handleError(error);
    }
    this.emitOverview();
    return this.makeOverview();
  }

  private async refreshAppServer() {
    let response: any;
    try {
      response = await this.request("thread/list", {
        limit: 30,
        archived: false,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"]
      });
    } catch {
      // Older App Server versions accept the core parameters but may reject newer sort/filter fields.
      response = await this.request("thread/list", { limit: 30, archived: false });
    }
    const list = response?.data ?? response?.threads ?? [];
    for (const raw of list) this.upsertThread(raw);
    const subscribeTargets = list.filter((raw: any) => raw?.id && raw?.status?.type === "active" && !this.subscribedThreads.has(raw.id)).slice(0, 8);
    await Promise.allSettled(subscribeTargets.map(async (raw: any) => { await this.request("thread/resume", { threadId: raw.id }); this.subscribedThreads.add(raw.id); }));
    const readTargets = [...list]
      .filter((raw: any) => raw?.id)
      .sort((a: any, b: any) => normalizeTimestamp(b.updatedAt ?? b.updated_at) - normalizeTimestamp(a.updatedAt ?? a.updated_at))
      .slice(0, 12);
    await Promise.allSettled(readTargets.map(async (raw: any) => {
      const detail = await this.request("thread/read", { threadId: raw.id, includeTurns: true });
      this.applyThreadRead(raw.id, detail);
    }));
  }

  private connect() {
    if (this.connected || this.stopped) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = this.connectOnce().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private async connectOnce() {
    const commands = discoverCodexCliCandidates();
    if (!commands.length) {
      this.lastError = this.copy.codexMissing;
      this.emitOverview();
      return;
    }
    for (const command of commands) {
      const transports = await resolveAppServerTransports(command, this.codexHome);
      for (const args of transports) {
        try {
          const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: homedir(), CODEX_HOME: this.codexHome } });
          this.child = child;
          this.lines = createInterface({ input: child.stdout });
          this.lines.on("line", (line) => this.receive(line));
          child.stderr.on("data", (buf) => {
            const line = String(buf).trim();
            if (line && !line.includes('"level":"WARN"')) this.lastError = line.slice(-500);
          });
          const spawnFailure = new Promise<never>((_, reject) => child.once("error", reject));
          await Promise.race([
            this.request("initialize", { clientInfo: { name: "codex_emotion_pet", title: "Grok Bot Pet", version: "0.1.5" } }),
            spawnFailure
          ]);
          this.send({ method: "initialized", params: {} });
          this.connected = true;
          this.lastError = undefined;
          child.once("exit", () => this.handleDisconnect());
          child.once("error", (error) => { this.lastError = error.message; this.handleDisconnect(); });
          this.emitOverview();
          return;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          this.lines?.close(); this.child?.kill(); this.child = undefined;
        }
      }
    }
    this.scheduleReconnect();
    this.emitOverview();
  }

  private request(method: string, params: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ id, method, params });
      setTimeout(() => {
        const pending = this.pending.get(id);
        if (pending) { this.pending.delete(id); reject(new Error(this.copy.requestTimedOut(method))); }
      }, 12000).unref();
    });
  }

  private send(message: JsonRpcMessage) { this.child?.stdin.write(`${JSON.stringify(message)}\n`); }

  private receive(line: string) {
    let message: JsonRpcMessage;
    try { message = JSON.parse(line); } catch { return; }
    if (isServerRequestMessage(message)) {
      this.handleServerRequest(message.method!, message.params);
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message || this.copy.requestFailed)) : pending.resolve(message.result);
      return;
    }
    this.handleNotification(message.method, message.params);
  }

  private handleNotification(method?: string, params?: any) {
    const task = this.taskForParams(params);
    if (method === "thread/status/changed") {
      if (task) {
        const next = mapRuntimeStatus(params?.status);
        task.activeFlags = params?.status?.activeFlags || [];
        if (next === "waiting-input") this.setEmotionHint(task, "waiting");
        else if (next === "processing" && !["processing", "waiting-input"].includes(task.status)) this.setEmotionHint(task, "receiving");
        if (next !== "idle" || task.status === "idle") task.status = next;
        task.updatedAt = Date.now();
        this.emitOverview();
      }
    } else if (method === "turn/started") {
      if (task) { task.status = "processing"; task.turnId = params?.turn?.id; task.startedAt = Date.now(); task.updatedAt = Date.now(); this.setEmotionHint(task, "receiving"); this.setActivity(task, { kind: "user-message", phase: "completed", at: Date.now(), itemId: params?.turn?.id }); this.emitOverview(); }
    } else if (method === "turn/completed") {
      if (task) { task.status = mapTurnStatus(params?.turn?.status, task.activeFlags); task.updatedAt = Date.now(); this.setEmotionHint(task, task.status); this.emitOverview(); }
    } else if (method === "item/started") {
      if (task) {
        const hint = inferItemEmotion(params?.item);
        task.status = hint === "waiting" ? "waiting-input" : hint === "error" ? "error" : "processing";
        task.updatedAt = Date.now(); this.setEmotionHint(task, hint);
        const signal = inferActivitySignal(method, params); if (signal) this.setActivity(task, signal);
        this.emitOverview();
      }
    } else if (method === "item/completed") {
      if (task) {
        const hint = inferItemEmotion(params?.item, true);
        if (hint === "error") task.status = "error";
        task.updatedAt = Date.now(); this.setEmotionHint(task, hint);
        const signal = inferActivitySignal(method, params); if (signal) this.setActivity(task, signal);
        this.emitOverview();
      }
    } else if (task) {
      const signal = inferActivitySignal(method, params);
      if (!signal) return;
      this.setActivity(task, signal);
      task.updatedAt = signal.at;
      if (signal.kind === "approval") {
        task.status = signal.phase === "completed" ? "processing" : "waiting-input";
        if (signal.phase === "completed") task.activeFlags = task.activeFlags.filter((flag) => !/approval|input|serverrequest/i.test(flag));
      }
      else if (signal.kind === "error" || signal.phase === "failed") task.status = "error";
      else if (!["completed", "error", "stopped"].includes(task.status)) task.status = "processing";
      this.emitOverview();
    }
  }

  private handleServerRequest(method: string, params: any) {
    const task = this.taskForParams(params);
    if (!task) return;
    task.status = "waiting-input";
    task.activeFlags = [...new Set([...task.activeFlags, requestFlag(method)])];
    task.updatedAt = Date.now();
    this.setEmotionHint(task, /approval/i.test(method) ? "waiting" : "restricted");
    this.setActivity(task, { kind: "approval", phase: "started", at: Date.now(), itemId: params?.itemId ?? params?.requestId });
    this.emitOverview();
  }

  private taskForParams(params: any) {
    const threadId = params?.threadId ?? params?.thread?.id ?? params?.turn?.threadId ?? params?.conversationId;
    return threadId ? this.tasks.get(threadId) : undefined;
  }

  private setActivity(task: CodexTask, activity: CodexActivitySignal) {
    if (task.activity?.itemId && activity.itemId && task.activity.itemId === activity.itemId && task.activity.phase === activity.phase) return;
    task.activity = activity;
  }

  private setEmotionHint(task: CodexTask, hint: string) {
    task.emotionHint = hint;
    task.emotionHintAt = Date.now();
  }

  private upsertThread(raw: any) {
    if (!raw?.id) return;
    const existing = this.tasks.get(raw.id);
    const updatedAt = Math.max(normalizeTimestamp(raw.updatedAt ?? raw.updated_at ?? raw.createdAt ?? raw.created_at), existing?.updatedAt || 0) || Date.now();
    const runtimeStatus = raw.status ? mapRuntimeStatus(raw.status) : "idle";
    const status = runtimeStatus === "idle" ? existing?.status || "idle" : runtimeStatus;
    this.tasks.set(raw.id, {
      threadId: raw.id,
      parentThreadId: raw.parentThreadId ?? raw.parent_thread_id ?? existing?.parentThreadId,
      title: raw.name || raw.title || raw.preview || this.copy.unnamedTask,
      cwd: raw.cwd,
      sourceKind: normalizeSourceKind(raw.sourceKind ?? raw.source_kind ?? raw.source),
      status,
      activeFlags: raw.status?.activeFlags || existing?.activeFlags || [],
      turnId: existing?.turnId,
      updatedAt,
      startedAt: existing?.startedAt,
      emotionHint: existing?.emotionHint,
      emotionHintAt: existing?.emotionHintAt,
      activity: existing?.activity
    });
  }

  private mergeInferredTask(inferred: CodexTask) {
    const existing = this.tasks.get(inferred.threadId);
    if (!existing) {
      this.tasks.set(inferred.threadId, inferred);
      return;
    }
    const inferredIsNewer = inferred.updatedAt >= existing.updatedAt;
    const officialIsActive = ["receiving", "processing", "waiting-input"].includes(existing.status)
      && existing.updatedAt > inferred.updatedAt + 3000;
    if (inferredIsNewer && !officialIsActive) {
      existing.status = inferred.status;
      existing.turnId = inferred.turnId || existing.turnId;
      existing.startedAt = inferred.startedAt || existing.startedAt;
      existing.updatedAt = inferred.updatedAt;
      existing.activity = inferred.activity || existing.activity;
      existing.emotionHint = inferred.emotionHint || existing.emotionHint;
      existing.emotionHintAt = inferred.emotionHintAt || existing.emotionHintAt;
    }
    if ((!existing.title || existing.title === this.copy.unnamedTask) && inferred.title) existing.title = inferred.title;
    existing.cwd = existing.cwd || inferred.cwd;
    existing.sourceKind = existing.sourceKind || inferred.sourceKind;
    existing.parentThreadId = existing.parentThreadId || inferred.parentThreadId;
  }

  private applyThreadRead(threadId: string, response: any) {
    const thread = response?.thread ?? response;
    const task = this.tasks.get(threadId);
    if (!task || !thread) return;
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    const lastTurn = turns.at(-1);
    const activeFlags = thread.status?.activeFlags || task.activeFlags;
    task.activeFlags = activeFlags;
    const threadUpdatedAt = Math.max(normalizeTimestamp(thread.updatedAt ?? thread.updated_at), task.updatedAt);
    const previousStatus = task.status;
    const runtimeStatus = mapRuntimeStatus(thread.status);
    const persistedTurnStatus = lastTurn?.status ? mapTurnStatus(lastTurn.status, activeFlags) : "idle";
    task.status = inferPersistedTaskStatus(thread.status, lastTurn, threadUpdatedAt, Date.now());
    task.turnId = lastTurn?.id || task.turnId;
    const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
    const lastItem = items.at(-1);
    if (lastItem) {
      const itemStatus = String(typeof lastItem.status === "object" ? lastItem.status?.type : lastItem.status || "").toLowerCase();
      const terminal = /completed|failed|error|declined|denied|cancelled|canceled/.test(itemStatus);
      const signal = inferActivitySignal(terminal ? "item/completed" : "item/started", { item: lastItem });
      if (signal) {
        if (!terminal && ["processing", "receiving", "waiting-input"].includes(task.status)) signal.at = Date.now();
        this.setActivity(task, signal);
      }
    }
    const externallyInferred = runtimeStatus === "idle" && task.status === "processing" && persistedTurnStatus !== "processing";
    if (externallyInferred) {
      if (previousStatus !== "processing") task.startedAt = Math.min(threadUpdatedAt, Date.now());
    } else {
      task.startedAt = normalizeTimestamp(lastTurn?.startedAt ?? lastTurn?.started_at) || task.startedAt;
    }
    task.title = thread.name || thread.title || task.title;
    task.cwd = thread.cwd || task.cwd;
    task.parentThreadId = thread.parentThreadId ?? thread.parent_thread_id ?? task.parentThreadId;
    task.updatedAt = threadUpdatedAt;
  }

  private handleDisconnect() { if (this.stopped) return; this.connected = false; this.child = undefined; this.subscribedThreads.clear(); this.pending.forEach(({ reject }) => reject(new Error(this.copy.disconnected))); this.pending.clear(); this.emitOverview(); this.scheduleReconnect(); }
  private handleError(error: unknown) { this.lastError = error instanceof Error ? error.message : String(error); this.emitOverview(); }
  private scheduleReconnect() { if (!this.reconnectTimer && !this.stopped) this.reconnectTimer = setTimeout(() => { this.reconnectTimer = undefined; void this.connect(); }, 4000); }
  private emitOverview() { this.emit("overview", this.makeOverview()); }
  private makeOverview(): CodexOverview {
    const tasks = [...this.tasks.values()];
    const selected = selectTasks(tasks);
    const connected = this.connected || this.localInferenceAvailable;
    return {
      connected,
      connectionMode: this.connected ? "app-server" : connected ? "local-inference" : undefined,
      hasWaiting: tasks.some(isAwaitingApproval),
      ...selected,
      lastError: this.lastError
    };
  }
}

export async function resolveAppServerTransports(
  command: string,
  codexHome: string,
  prepare: SharedDaemonPreparer = prepareSharedCodexDaemon
) {
  const daemonReady = await prepare({ codexCli: command, codexHome });
  return appServerTransports(
    path.join(codexHome, "app-server-control", "app-server-control.sock"),
    daemonReady
  );
}

function isAwaitingApproval(task: CodexTask) {
  if (task.status !== "waiting-input") return false;
  return task.activity?.kind === "approval" && ["started", "progress"].includes(task.activity.phase)
    || task.activeFlags.some((flag) => /approval/i.test(flag));
}

export function mapRuntimeStatus(status: any): CodexTaskStatus {
  if (!status || status.type === "notLoaded" || status.type === "idle") return "idle";
  if (status.activeFlags?.some((flag: string) => /approval|input/i.test(flag))) return "waiting-input";
  if (status.type === "systemError") return "error";
  return status.type === "active" ? "processing" : "idle";
}

export function mapTurnStatus(status: unknown, activeFlags: string[] = []): CodexTaskStatus {
  if (activeFlags.some((flag) => /approval|input/i.test(flag))) return "waiting-input";
  const normalized = String(typeof status === "object" && status ? (status as any).type : status || "")
    .replace(/[\s_-]/g, "")
    .toLowerCase();
  if (["inprogress", "active", "running", "processing"].includes(normalized)) return "processing";
  if (["failed", "error", "systemerror"].includes(normalized)) return "error";
  if (["interrupted", "stopped", "cancelled", "canceled"].includes(normalized)) return "stopped";
  if (["completed", "complete", "succeeded", "success"].includes(normalized)) return "completed";
  return "idle";
}

export function inferItemEmotion(item: any, completed = false): string {
  const text = [item?.type, item?.name, item?.tool, item?.status, item?.title, item?.error?.message]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/denied|refus|restrict|blocked|not.?allowed/.test(text)) return "restricted";
  if (/error|fail|panic|crash/.test(text)) return "error";
  if (/approval|user.?input|question|elicitation/.test(text)) return "waiting";
  if (/web.?search|search|retriev|browse/.test(text)) return completed ? "recalling" : "searching";
  if (/reason|think|analysis/.test(text)) return completed ? "replying" : "thinking";
  if (/context.?compact|summar|memory|recall/.test(text)) return "recalling";
  if (/agent.?message|assistant.?message|response|output|reply/.test(text)) return "replying";
  if (/user.?message|prompt|instruction/.test(text)) return "receiving";
  if (/mcp|network|connect|download|fetch/.test(text)) return "loading";
  if (/image|vision|screenshot/.test(text)) return "curious";
  if (/review|diff/.test(text)) return "doubt";
  if (/command|terminal|shell|exec|file.?change|patch|edit|write/.test(text)) return "focus";
  return "processing";
}

export function isServerRequestMessage(message: JsonRpcMessage) {
  return message.id !== undefined && typeof message.method === "string";
}

export function inferActivitySignal(method?: string, params?: any): CodexActivitySignal | undefined {
  if (!method) return undefined;
  const normalizedMethod = method.toLowerCase();
  const item = params?.item ?? params?.delta ?? params;
  const kind = inferActivityKind(normalizedMethod, item);
  if (!kind) return undefined;
  const statusText = [item?.status, item?.error?.message, params?.status].filter(Boolean).join(" ").toLowerCase();
  const phase: CodexActivitySignal["phase"] =
    /declin|denied|refus|cancel/.test(statusText) ? "declined"
      : /fail|error|panic|crash/.test(statusText) ? "failed"
        : normalizedMethod.includes("completed") || normalizedMethod.includes("resolved") ? "completed"
          : normalizedMethod.includes("delta") || normalizedMethod.includes("updated") ? "progress"
            : "started";
  return {
    kind,
    phase,
    at: normalizeTimestamp(params?.at ?? params?.updatedAt ?? params?.updated_at ?? item?.updatedAt ?? item?.updated_at ?? item?.completedAt ?? item?.completed_at ?? item?.startedAt ?? item?.started_at) || Date.now(),
    itemId: params?.itemId ?? item?.id ?? params?.requestId
  };
}

function inferActivityKind(method: string, item: any): CodexActivityKind | undefined {
  const type = String(item?.type ?? item?.kind ?? "").replace(/[\s_-]/g, "").toLowerCase();
  const text = `${method} ${type} ${item?.name ?? ""} ${item?.tool ?? ""}`.toLowerCase();
  const approvalInput = item?.input ?? item?.arguments ?? item?.params;
  const approvalText = typeof approvalInput === "string" ? approvalInput : JSON.stringify(approvalInput ?? {});
  const itemStatus = String(typeof item?.status === "object" ? item.status?.type : item?.status ?? "").toLowerCase();
  if (/["']?sandbox_permissions["']?\s*:\s*["']require_escalated["']/.test(approvalText)
    && !/completed|failed|declined|denied|cancelled|canceled/.test(itemStatus)) return "approval";
  if (/approval|userinput|elicitation|requestpermission|request_user_input|serverrequest/.test(text)) return "approval";
  if (/error|failed|systemerror/.test(text)) return "error";
  if (/contextcompaction|compact/.test(text)) return "context-compaction";
  if (/websearch|search/.test(text)) return "web-search";
  if (/reasoning|analysis/.test(text)) return "reasoning";
  if (/plan/.test(text)) return "plan";
  if (/commandexecution|outputdelta|terminal|shell|exec/.test(text)) return "command";
  if (/filechange|diff|patch|edit|writefile/.test(text)) return "file-change";
  if (/collabtoolcall|collaboration|subagent/.test(text)) return "collaboration";
  if (/mcptoolcall|dynamictoolcall|toolcall|imageview/.test(text)) return "tool-call";
  if (/agentmessage|assistantmessage|dictat|response/.test(text)) return "agent-output";
  if (/usermessage|prompt|instruction/.test(text)) return "user-message";
  return undefined;
}

export function inferPersistedTaskStatus(runtime: any, lastTurn: any, threadUpdatedAt: number, now: number): CodexTaskStatus {
  const runtimeStatus = mapRuntimeStatus(runtime);
  if (runtimeStatus !== "idle") return runtimeStatus;
  const activeFlags = runtime?.activeFlags || [];
  const turnStatus = lastTurn?.status ? mapTurnStatus(lastTurn.status, activeFlags) : "idle";
  if (turnStatus === "processing" || turnStatus === "waiting-input") return turnStatus;

  const completedAt = normalizeTimestamp(lastTurn?.completedAt ?? lastTurn?.completed_at);
  const startedAt = normalizeTimestamp(lastTurn?.startedAt ?? lastTurn?.started_at);
  const recentlyWritten = threadUpdatedAt > 0 && now - threadUpdatedAt < 75_000;
  const writeAfterTerminal = completedAt > 0
    ? threadUpdatedAt - completedAt > 2500
    : startedAt > 0 && threadUpdatedAt - startedAt > 5000;
  return recentlyWritten && writeAfterTerminal ? "processing" : turnStatus;
}

export function selectTasks(tasks: CodexTask[]) {
  const byId = new Map(tasks.map((task) => [task.threadId, task]));
  const topLevel = tasks.filter((task) => !task.parentThreadId && !/^subagent/i.test(task.sourceKind || ""));
  const effective = new Map(topLevel.map((task) => [task.threadId, { ...task }]));

  for (const child of tasks) {
    if (!child.parentThreadId) continue;
    const rootId = topLevelParentId(child, byId);
    const parent = rootId ? effective.get(rootId) : undefined;
    if (!parent || child.updatedAt <= parent.updatedAt) continue;
    if (parent.status === "waiting-input" && child.status !== "waiting-input") continue;
    effective.set(rootId!, {
      ...parent,
      status: child.status,
      activeFlags: child.activeFlags,
      turnId: child.turnId,
      updatedAt: child.updatedAt,
      startedAt: child.startedAt,
      emotionHint: child.emotionHint,
      emotionHintAt: child.emotionHintAt,
      activity: child.activity
    });
  }

  const recentTasks = [...effective.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
  const active = recentTasks.filter((task) => ["receiving", "processing", "waiting-input"].includes(task.status));
  return { recentTasks, activeCount: active.length, selectedTask: [...active, ...recentTasks].find(Boolean) };
}

function topLevelParentId(task: CodexTask, byId: Map<string, CodexTask>) {
  const visited = new Set([task.threadId]);
  let parentId = task.parentThreadId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return undefined;
    if (!parent.parentThreadId && !/^subagent/i.test(parent.sourceKind || "")) return parent.threadId;
    parentId = parent.parentThreadId;
  }
  return undefined;
}

export function discoverCodexCliCandidates(userHome = homedir(), searchPath = process.env.PATH || "", explicitPath = process.env.CODEX_CLI_PATH) {
  const candidates = [
    explicitPath,
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(userHome, "Applications/ChatGPT.app/Contents/Resources/codex"),
    path.join(userHome, "Applications/Codex.app/Contents/Resources/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    path.join(userHome, ".local/bin/codex"),
    path.join(userHome, ".volta/bin/codex"),
    path.join(userHome, "Library/pnpm/codex"),
    ...searchPath.split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, "codex")),
    ...versionedCodexPaths(path.join(userHome, ".nvm/versions/node"), "bin/codex"),
    ...versionedCodexPaths(path.join(userHome, ".local/share/fnm/node-versions"), "installation/bin/codex"),
    ...versionedCodexPaths(path.join(userHome, "Library/Application Support/fnm/node-versions"), "installation/bin/codex")
  ].filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(candidates)].filter(isExecutable);
}

function versionedCodexPaths(root: string, suffix: string) {
  try { return readdirSync(root).sort().reverse().map((version) => path.join(root, version, suffix)); }
  catch { return []; }
}

function isExecutable(candidate: string) {
  try { accessSync(candidate, constants.X_OK); return true; } catch { return false; }
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number") return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isNaN(parsed) ? 0 : parsed; }
  return 0;
}

function normalizeSourceKind(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)[0];
  return undefined;
}

function requestFlag(method: string) {
  if (/approval/i.test(method)) return "waitingOnApproval";
  if (/input|elicitation/i.test(method)) return "waitingOnInput";
  return "waitingOnServerRequest";
}
