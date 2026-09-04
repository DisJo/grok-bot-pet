import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CodexActivityKind, CodexActivitySignal, CodexTask, CodexTaskStatus } from "./types";

const INITIAL_TAIL_BYTES = 1024 * 1024;
const MAX_LIFECYCLE_LOOKBACK_BYTES = 64 * 1024 * 1024;
const RECENT_SESSION_LIMIT = 24;
const ACTIVE_WRITE_WINDOW_MS = 120_000;
const RESCAN_INTERVAL_MS = 12_000;

interface SessionMeta {
  threadId: string;
  parentThreadId?: string;
  cwd?: string;
  sourceKind?: string;
  originator?: string;
}

interface SessionState {
  file: string;
  size: number;
  carry: string;
  meta: SessionMeta;
  turnId?: string;
  startedAt?: number;
  openTurn: boolean;
  pendingApprovalCallIds: Set<string>;
  terminalStatus?: CodexTaskStatus;
  awaitingPlanConfirmation?: boolean;
  lastActivity?: CodexActivitySignal;
  emotionHint?: string;
  lastEventAt: number;
}

export interface ParsedLocalEventState {
  turnId?: string;
  startedAt?: number;
  openTurn: boolean;
  terminalStatus?: CodexTaskStatus;
  lastActivity?: CodexActivitySignal;
  emotionHint?: string;
  lastEventAt: number;
}

export class CodexLocalActivityReader {
  private sessionFiles: string[] = [];
  private lastScanAt = 0;
  private states = new Map<string, SessionState>();

  constructor(private readonly codexHomes = discoverCodexHomes(), private readonly defaultTaskTitle = "Codex Task") {}

  async refresh(now = Date.now()): Promise<CodexTask[]> {
    if (!this.sessionFiles.length || now - this.lastScanAt >= RESCAN_INTERVAL_MS) await this.scan(now);
    const ranked = await Promise.all(this.sessionFiles.map(async (file) => {
      try { return { file, info: await stat(file) }; } catch { return undefined; }
    }));
    const recent = ranked
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry?.info.isFile()))
      .sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)
      .slice(0, RECENT_SESSION_LIMIT);

    const tasks: CodexTask[] = [];
    for (const { file, info } of recent) {
      try {
        const state = await this.updateState(file, info.size);
        const updatedAt = Math.max(info.mtimeMs, state.lastEventAt);
        const recentlyWritten = now - info.mtimeMs <= ACTIVE_WRITE_WINDOW_MS;
        const status: CodexTaskStatus = state.awaitingPlanConfirmation || state.pendingApprovalCallIds.size > 0 ? "waiting-input"
          : state.openTurn && recentlyWritten
            ? state.lastActivity?.kind === "approval" && state.lastActivity.phase !== "completed" ? "waiting-input" : "processing"
            : state.terminalStatus || "idle";
        const fallbackName = state.meta.cwd ? path.basename(state.meta.cwd) : this.defaultTaskTitle;
        tasks.push({
          threadId: state.meta.threadId,
          parentThreadId: state.meta.parentThreadId,
          title: fallbackName || this.defaultTaskTitle,
          cwd: state.meta.cwd,
          sourceKind: state.meta.sourceKind,
          status,
          activeFlags: [],
          turnId: state.turnId,
          updatedAt,
          startedAt: state.startedAt,
          emotionHint: status === "processing" ? state.emotionHint || "processing" : status,
          emotionHintAt: state.lastEventAt || updatedAt,
          activity: state.lastActivity
        });
      } catch {}
    }
    return tasks;
  }

  private async scan(now: number) {
    const collected = new Set<string>();
    for (const home of this.codexHomes) await collectJsonl(path.join(home, "sessions"), collected);
    this.sessionFiles = [...collected];
    this.lastScanAt = now;
  }

  private async updateState(file: string, size: number) {
    let state = this.states.get(file);
    if (!state || size < state.size) {
      const meta = await readSessionMeta(file);
      state = {
        file,
        size: 0,
        carry: "",
        meta,
        openTurn: false,
        pendingApprovalCallIds: new Set(),
        lastEventAt: 0
      };
      Object.assign(state, await readLastLifecycle(file, size));
      const start = Math.max(0, size - INITIAL_TAIL_BYTES);
      const chunk = await readRange(file, start, size - start);
      const usable = start > 0 ? chunk.slice(Math.max(0, chunk.indexOf("\n") + 1)) : chunk;
      const { lines, carry } = completeJsonLines(usable);
      state.carry = carry;
      applyLocalSessionLines(state, lines);
      state.size = size;
      this.states.set(file, state);
      return state;
    }
    if (size > state.size) {
      const appended = await readRange(file, state.size, size - state.size);
      const text = state.carry + appended;
      const { lines, carry } = completeJsonLines(text);
      state.carry = carry;
      applyLocalSessionLines(state, lines);
      state.size = size;
    }
    return state;
  }
}

function completeJsonLines(text: string) {
  const lines = text.split("\n");
  const tail = lines.pop() || "";
  if (!tail.trim()) return { lines, carry: "" };
  try {
    JSON.parse(tail);
    lines.push(tail);
    return { lines, carry: "" };
  } catch {
    return { lines, carry: tail };
  }
}

export function discoverCodexHomes() {
  const home = process.env.HOME;
  return [...new Set([
    process.env.CODEX_HOME,
    home && path.join(home, ".codex")
  ].filter((value): value is string => Boolean(value)))];
}

export function parseLocalSessionLines(lines: string[]): ParsedLocalEventState {
  const state: SessionState = {
    file: "fixture.jsonl",
    size: 0,
    carry: "",
    meta: { threadId: "fixture" },
    openTurn: false,
    pendingApprovalCallIds: new Set(),
    lastEventAt: 0
  };
  applyLocalSessionLines(state, lines);
  return state;
}

function applyLocalSessionLines(state: SessionState, lines: string[]) {
  for (const line of lines) {
    if (!line.trim()) continue;
    let record: any;
    try { record = JSON.parse(line); } catch { continue; }
    const at = normalizeTimestamp(record?.timestamp) || Date.now();
    state.lastEventAt = Math.max(state.lastEventAt, at);
    const payload = record?.payload || {};
    if (record?.type === "session_meta") {
      state.meta.threadId = payload.id || state.meta.threadId;
      state.meta.parentThreadId = payload.parent_thread_id ?? payload.parentThreadId ?? state.meta.parentThreadId;
      state.meta.cwd = payload.cwd || state.meta.cwd;
      state.meta.sourceKind = normalizeSource(payload.source) || state.meta.sourceKind;
      state.meta.originator = payload.originator || state.meta.originator;
      continue;
    }
    if (record?.type === "turn_context" && payload.cwd) state.meta.cwd = payload.cwd;
    if (record?.type === "event_msg") {
      const type = String(payload.type || "").toLowerCase();
      if (type === "task_started") {
        state.openTurn = true;
        state.turnId = payload.turn_id || state.turnId;
        state.startedAt = normalizeTimestamp(payload.started_at) || at;
        state.terminalStatus = undefined;
        state.awaitingPlanConfirmation = false;
        state.pendingApprovalCallIds.clear();
        state.lastActivity = { kind: "user-message", phase: "completed", at, itemId: state.turnId };
        state.emotionHint = "receiving";
        continue;
      }
      if (type === "task_complete") {
        state.openTurn = false;
        state.turnId = payload.turn_id || state.turnId;
        if (payload.error != null) {
          state.awaitingPlanConfirmation = false;
          state.pendingApprovalCallIds.clear();
          state.terminalStatus = "error";
          state.lastActivity = { kind: "error", phase: "failed", at, itemId: state.turnId };
          state.emotionHint = "error";
          continue;
        }
        if (state.awaitingPlanConfirmation) {
          state.terminalStatus = "waiting-input";
          state.emotionHint = "waiting";
          continue;
        }
        state.terminalStatus = "completed";
        state.pendingApprovalCallIds.clear();
        state.lastActivity = { kind: "agent-output", phase: "completed", at, itemId: state.turnId };
        state.emotionHint = "completed";
        continue;
      }
      if (/aborted|interrupted|cancelled|canceled|stopped/.test(type)) {
        state.openTurn = false;
        state.awaitingPlanConfirmation = false;
        state.pendingApprovalCallIds.clear();
        state.terminalStatus = "stopped";
        state.emotionHint = "stopped";
        continue;
      }
      if (/error|failed|panic/.test(type)) {
        state.openTurn = false;
        state.awaitingPlanConfirmation = false;
        state.pendingApprovalCallIds.clear();
        state.terminalStatus = "error";
        state.lastActivity = { kind: "error", phase: "failed", at, itemId: payload.item_id };
        state.emotionHint = "error";
        continue;
      }
      if (type === "user_message") {
        state.awaitingPlanConfirmation = false;
        state.pendingApprovalCallIds.clear();
        state.terminalStatus = "completed";
        state.lastActivity = { kind: "user-message", phase: "completed", at, itemId: state.turnId };
        state.emotionHint = "receiving";
        continue;
      }
      if (type === "agent_message") {
        state.lastActivity = { kind: "agent-output", phase: payload.phase === "final_answer" ? "completed" : "progress", at, itemId: state.turnId };
        state.emotionHint = payload.phase === "final_answer" ? "replying" : "processing";
        continue;
      }
      if (type === "item_started" || type === "item_completed") {
        applyItemActivity(state, payload.item, type === "item_completed" ? "completed" : "started", at);
      }
      continue;
    }
    if (record?.type === "response_item") {
      const approvalCallId = escalatedExecCallId(payload);
      if (approvalCallId) {
        state.pendingApprovalCallIds.add(approvalCallId);
        state.lastActivity = { kind: "approval", phase: "started", at, itemId: approvalCallId };
        state.emotionHint = "waiting";
        continue;
      }
      const completedCallId = String(payload?.call_id || "");
      if (completedCallId && state.pendingApprovalCallIds.delete(completedCallId)) {
        state.lastActivity = { kind: "approval", phase: "completed", at, itemId: completedCallId };
        state.emotionHint = "focus";
        continue;
      }
      applyItemActivity(state, payload, "progress", at);
    }
  }
}

function escalatedExecCallId(item: any) {
  const type = String(item?.type || "").replace(/[\s_-]/g, "").toLowerCase();
  if (!/^(customtoolcall|functioncall)$/.test(type) || String(item?.name || "").toLowerCase() !== "exec") return undefined;
  const input = typeof item?.input === "string" ? item.input : JSON.stringify(item?.input || {});
  if (!/["']?sandbox_permissions["']?\s*:\s*["']require_escalated["']/.test(input)) return undefined;
  return String(item?.call_id || item?.id || "") || undefined;
}

function applyItemActivity(state: SessionState, item: any, phase: CodexActivitySignal["phase"], at: number) {
  const kind = activityKindForItem(item);
  if (!kind) return;
  if (kind === "plan" && phase === "completed") {
    state.awaitingPlanConfirmation = true;
    state.lastActivity = { kind: "approval", phase: "started", at, itemId: item?.id || state.turnId };
    state.emotionHint = "waiting";
    return;
  }
  state.lastActivity = { kind, phase, at, itemId: item?.id || state.turnId };
  state.emotionHint = emotionForActivity(kind);
  const status = String(item?.status || item?.error?.message || "").toLowerCase();
  if (/fail|error|panic|crash/.test(status)) {
    state.lastActivity.phase = "failed";
    state.terminalStatus = "error";
    state.emotionHint = "error";
  }
}

function activityKindForItem(item: any): CodexActivityKind | undefined {
  if (escalatedExecCallId(item)) return "approval";
  const text = `${item?.type || ""} ${item?.name || ""} ${item?.tool || ""}`.replace(/[\s_-]/g, "").toLowerCase();
  if (/requestuserinput|approval|elicitation/.test(text)) return "approval";
  if (/contextcompaction|compact/.test(text)) return "context-compaction";
  if (/websearch|search/.test(text)) return "web-search";
  if (/reasoning|analysis/.test(text)) return "reasoning";
  if (/plan/.test(text)) return "plan";
  if (/commandexecution|customtoolcall|functioncall|terminal|shell|exec/.test(text)) return "command";
  if (/filechange|patch|edit|writefile/.test(text)) return "file-change";
  if (/collabtoolcall|collaboration|subagent/.test(text)) return "collaboration";
  if (/mcptoolcall|dynamictoolcall|toolcall/.test(text)) return "tool-call";
  if (/agentmessage|assistantmessage/.test(text) || (item?.type === "message" && item?.role === "assistant")) return "agent-output";
  if (/usermessage/.test(text) || (item?.type === "message" && item?.role === "user")) return "user-message";
  return undefined;
}

function emotionForActivity(kind: CodexActivityKind) {
  if (kind === "reasoning" || kind === "plan") return "thinking";
  if (kind === "web-search") return "searching";
  if (kind === "command" || kind === "file-change") return "focus";
  if (kind === "agent-output") return "replying";
  if (kind === "user-message") return "receiving";
  if (kind === "context-compaction") return "recalling";
  if (kind === "approval") return "waiting";
  if (kind === "error") return "error";
  return "loading";
}

async function readSessionMeta(file: string): Promise<SessionMeta> {
  const fallbackId = path.basename(file, ".jsonl").match(/([0-9a-f]{8}-[0-9a-f-]{27})$/i)?.[1] || path.basename(file, ".jsonl");
  const head = await readRange(file, 0, 64 * 1024);
  for (const line of head.split("\n")) {
    try {
      const record = JSON.parse(line);
      if (record?.type !== "session_meta") continue;
      return {
        threadId: record.payload?.id || fallbackId,
        parentThreadId: record.payload?.parent_thread_id ?? record.payload?.parentThreadId,
        cwd: record.payload?.cwd,
        sourceKind: normalizeSource(record.payload?.source),
        originator: record.payload?.originator
      };
    } catch {}
  }
  return { threadId: fallbackId };
}

async function readLastLifecycle(file: string, size: number): Promise<Partial<SessionState>> {
  let window = Math.min(INITIAL_TAIL_BYTES, size);
  while (window > 0) {
    const start = Math.max(0, size - window);
    const chunk = await readRange(file, start, size - start);
    const usable = start > 0 ? chunk.slice(Math.max(0, chunk.indexOf("\n") + 1)) : chunk;
    const lines = usable.split("\n");
    for (let index = lines.length - 1; index >= 0; index--) {
      let record: any;
      try { record = JSON.parse(lines[index]); } catch { continue; }
      if (record?.type !== "event_msg") continue;
      const payload = record.payload || {};
      const type = String(payload.type || "").toLowerCase();
      const at = normalizeTimestamp(record.timestamp);
      if (type === "task_complete") return {
        openTurn: false,
        turnId: payload.turn_id,
        terminalStatus: payload.error == null ? "completed" : "error",
        lastEventAt: at
      };
      if (/aborted|interrupted|cancelled|canceled|stopped/.test(type)) return { openTurn: false, turnId: payload.turn_id, terminalStatus: "stopped", lastEventAt: at };
      if (type === "task_started") return {
        openTurn: true,
        turnId: payload.turn_id,
        startedAt: normalizeTimestamp(payload.started_at) || at,
        terminalStatus: undefined,
        lastEventAt: at
      };
    }
    if (start === 0 || window >= MAX_LIFECYCLE_LOOKBACK_BYTES) break;
    window = Math.min(size, window * 2, MAX_LIFECYCLE_LOOKBACK_BYTES);
  }
  return {};
}

async function collectJsonl(directory: string, result: Set<string>) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
  await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectJsonl(target, result);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.add(target);
  }));
}

async function readRange(file: string, position: number, length: number) {
  if (length <= 0) return "";
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number") return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") { const parsed = Date.parse(value); return Number.isNaN(parsed) ? 0 : parsed; }
  return 0;
}

function normalizeSource(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>)[0];
  return undefined;
}
