import { CodexActivityKind, CodexOverview, CodexTask } from "../types";
import { CharacterDirective, GROK_STATES, GrokOneShot, GrokShape, GrokState, StatusColorRole } from "./types";

export const STATE_SHAPE: Record<GrokState, GrokShape> = {
  sleeping: "pebble", waking: "egg", idle: "blob", listening: "bean", thinking: "squircle",
  searching: "crystal", working: "tablet", excited: "gem", surprised: "egg", suspicious: "hex",
  angry: "wedge", drowsy: "pebble", happy: "blob", curious: "leaf", confused: "hex",
  bored: "pebble", proud: "gem", shy: "bean", sad: "teardrop", laughing: "gem",
  scared: "wedge", playful: "leaf", celebrate: "gem", orbit: "dome", radar: "crystal",
  progress: "cloud", spawning: "egg", humming: "dome", loading: "cylinder",
  dictating: "capsule", writing: "arch", sending: "capsule", receiving: "capsule",
  uploading: "cylinder", notifying: "egg", alerting: "wedge", dragging: "shield",
  bouncing: "leaf", "powering-down": "teardrop"
};

const IDLE_CYCLE: GrokState[] = [
  "idle", "curious", "bored", "playful", "happy", "shy", "proud", "drowsy",
  "excited", "suspicious", "confused", "idle", "laughing"
];

const ACTIVITY_STATE: Record<CodexActivityKind, GrokState> = {
  "user-message": "receiving",
  reasoning: "thinking",
  plan: "progress",
  "web-search": "searching",
  command: "working",
  "file-change": "writing",
  "tool-call": "loading",
  collaboration: "humming",
  "agent-output": "dictating",
  "context-compaction": "progress",
  approval: "listening",
  error: "alerting"
};

type Beat = { state: GrokState; duration: number; priority: number; oneShot?: GrokOneShot; statusColorRole?: StatusColorRole };

export class AnimationDirector {
  private connected?: boolean;
  private signature = "";
  private queue: Array<CharacterDirective & { expiresAt: number }> = [];
  private current: CharacterDirective = directive("loading", 50);
  private currentAt = 0;
  private shapeAt = 0;
  private resultArmedThreads = new Set<string>();
  private playedResultKeys = new Set<string>();

  next(overview: CodexOverview, now = Date.now()): CharacterDirective {
    const terminalTask = this.observeResultTransition(overview);
    const signature = overviewSignature(overview);
    if (terminalTask) {
      this.signature = signature;
      this.enqueue(sequenceFor({ ...overview, selectedTask: terminalTask }, this.connected, true), now);
    } else if (signature !== this.signature) {
      this.signature = signature;
      if (!(overview.hasWaiting && this.hasActiveResultFlow(now))) this.enqueue(sequenceFor(overview, this.connected), now);
    }
    this.connected = overview.connected;

    while (this.queue[0] && this.queue[0].expiresAt <= now) this.queue.shift();
    const desired = this.queue[0] || baseDirective(overview, now);
    return this.accept(desired, now);
  }

  private observeResultTransition(overview: CodexOverview): CodexTask | undefined {
    const wasConnected = this.connected;
    if (!overview.connected || wasConnected === false) this.resultArmedThreads.clear();

    const tasksByThread = new Map(overview.recentTasks.map((task) => [task.threadId, task]));
    if (overview.selectedTask) tasksByThread.set(overview.selectedTask.threadId, overview.selectedTask);
    const tasks = [...tasksByThread.values()];
    for (const task of tasks) {
      if (["receiving", "processing", "waiting-input"].includes(task.status)) this.resultArmedThreads.add(task.threadId);
    }

    if (!overview.connected || wasConnected !== true) return undefined;
    const terminal = tasks
      .filter((task) => {
        if (!["completed", "error", "stopped"].includes(task.status) || !this.resultArmedThreads.has(task.threadId)) return false;
        return !this.playedResultKeys.has(resultKey(task));
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (terminal) {
      this.resultArmedThreads.delete(terminal.threadId);
      this.rememberPlayedResult(resultKey(terminal));
    }
    return terminal;
  }

  private rememberPlayedResult(key: string) {
    this.playedResultKeys.add(key);
    if (this.playedResultKeys.size <= 256) return;
    const oldest = this.playedResultKeys.values().next().value;
    if (oldest) this.playedResultKeys.delete(oldest);
  }

  private hasActiveResultFlow(now: number) {
    return this.queue.some((beat) => beat.expiresAt > now && beat.statusColorRole && beat.statusColorRole !== "waiting");
  }

  force(state: GrokState, now = Date.now(), oneShot?: GrokOneShot) {
    this.queue = [{ ...directive(state, 100, oneShot), expiresAt: now + 900 }];
    return this.accept(this.queue[0], now, true);
  }

  private enqueue(beats: Beat[], now: number) {
    this.queue = [];
    if (!beats.length) return;
    let at = now;
    this.queue = beats.map((beat) => {
      at += beat.duration;
      return { ...directive(beat.state, beat.priority, beat.oneShot, beat.statusColorRole), expiresAt: at };
    });
  }

  private accept(desired: CharacterDirective, now: number, force = false): CharacterDirective {
    const stateChanged = desired.state !== this.current.state;
    const mayInterrupt = force || desired.priority >= 90 || desired.priority > this.current.priority || now - this.currentAt >= 800;
    if (stateChanged && !mayInterrupt) {
      this.current = { ...this.current, statusColorRole: desired.statusColorRole };
      return this.current;
    }

    let shape = desired.shape;
    if (!force && shape !== this.current.shape && desired.priority < 90 && now - this.shapeAt < 2200) shape = this.current.shape;
    if (stateChanged) this.currentAt = now;
    if (shape !== this.current.shape) this.shapeAt = now;
    this.current = { ...desired, shape };
    return this.current;
  }
}

export function directive(state: GrokState, priority = 20, oneShot?: GrokOneShot, statusColorRole?: StatusColorRole): CharacterDirective {
  return { state, shape: STATE_SHAPE[state], emphasis: priority >= 70, priority, oneShot, statusColorRole };
}

export function baseDirective(overview: CodexOverview, now: number): CharacterDirective {
  if (!overview.connected) return directive("sleeping", 10);
  const task = overview.selectedTask;
  if (hasAwaitingApproval(overview)) return directive("listening", 90, undefined, "waiting");
  if (!task) return directive(IDLE_CYCLE[Math.floor(now / 6500) % IDLE_CYCLE.length], 10);
  if (task.status === "error") return directive("sad", 95, undefined, "error");
  if (task.status === "stopped") return directive("sad", 90, undefined, "stopped");
  if (task.status === "completed") return directive(IDLE_CYCLE[Math.floor(now / 6500) % IDLE_CYCLE.length], 10);
  const activity = task.activity;
  if (activity && now - activity.at < 6500) {
    if (activity.phase === "failed") return directive("alerting", 95, undefined, "error");
    if (activity.phase === "declined") return directive("alerting", 95, undefined, "error");
    if (!(activity.kind === "approval" && activity.phase === "completed")) {
      const statusColorRole = activity.kind === "error" ? "error" : undefined;
      return directive(activity.kind === "approval" ? "working" : ACTIVITY_STATE[activity.kind], activity.kind === "approval" ? 60 : 65, undefined, statusColorRole);
    }
  }
  if (task.status === "waiting-input") return directive(now - task.updatedAt > 18_000 ? "suspicious" : "listening", 90, undefined, "waiting");
  if (task.status === "processing" || task.status === "receiving") return directive(task.status === "receiving" ? "receiving" : "working", 60);
  return directive(IDLE_CYCLE[Math.floor(now / 6500) % IDLE_CYCLE.length], 10);
}

function sequenceFor(overview: CodexOverview, wasConnected?: boolean, allowTerminalResult = false): Beat[] {
  if (!overview.connected) return wasConnected !== false ? beats(["loading", 700, 80], ["powering-down", 1100, 95], ["sleeping", 5000, 20]) : [];
  const task = overview.selectedTask;
  if (task && ["completed", "error", "stopped"].includes(task.status) && !allowTerminalResult) return [];
  if (wasConnected !== true && !hasAwaitingApproval(overview) && task?.status !== "waiting-input" && task?.status !== "error") return beats(["spawning", 800, 85, "burst"], ["waking", 1000, 80], ["notifying", 1200, 75]);
  if (task?.status === "completed") return beats(["sending", 700, 90, "burst", "completed"], ["celebrate", 2600, 100, "wild-spin", "completed"], ["laughing", 1400, 75, undefined, "completed"], ["proud", 1600, 60, undefined, "completed"], ["happy", 1800, 50, undefined, "completed"]);
  if (task?.status === "error") return beats(["alerting", 800, 100, "burst", "error"], ["scared", 950, 100, undefined, "error"], ["angry", 1300, 95, undefined, "error"], ["sad", 2200, 80, undefined, "error"]);
  if (task?.status === "stopped") return beats(["powering-down", 1000, 95, undefined, "stopped"], ["sad", 1800, 85, undefined, "stopped"]);
  if (hasAwaitingApproval(overview)) return beats(["listening", 2200, 95, undefined, "waiting"], ["suspicious", 2600, 90, undefined, "waiting"]);
  if (!task) return [];
  if (task.status === "receiving") return beats(["receiving", 850, 80], ["surprised", 900, 75], ["excited", 1100, 65]);
  const activity = task.activity;
  if (activity?.kind === "user-message") return beats(["receiving", 850, 80], ["surprised", 750, 75]);
  if (activity?.kind === "web-search") return beats(["radar", 850, 75], ["searching", 2200, 65]);
  if (activity?.kind === "tool-call") return beats(["orbit", 900, 70], ["loading", 1700, 65], ["humming", 1100, 55]);
  if (activity?.kind === "file-change" && activity.phase === "completed") return beats(["writing", 750, 70], ["uploading", 1100, 60]);
  if (activity?.kind === "agent-output" && activity.phase === "completed") return beats(["dictating", 650, 70], ["sending", 900, 80]);
  return [];
}

function isAwaitingApproval(task?: CodexTask) {
  if (task?.status !== "waiting-input") return false;
  return task.activeFlags.some((flag) => /waitingon(?:approval|input)/i.test(flag))
    || task.activity?.kind === "approval" && ["started", "progress"].includes(task.activity.phase);
}

function hasAwaitingApproval(overview: CodexOverview) {
  return overview.hasWaiting || [overview.selectedTask, ...overview.recentTasks].some(isAwaitingApproval);
}

function beats(...values: Array<[GrokState, number, number, GrokOneShot?, StatusColorRole?]>): Beat[] {
  return values.map(([state, duration, priority, oneShot, statusColorRole]) => ({ state, duration, priority, oneShot, statusColorRole }));
}

function overviewSignature(overview: CodexOverview) {
  const task = overview.selectedTask;
  const waiting = overview.hasWaiting ? "waiting" : "clear";
  if (task && ["completed", "error", "stopped"].includes(task.status)) {
    return [overview.connected, waiting, task.threadId, task.turnId || "unknown-turn", task.status].join(":");
  }
  if (task?.status === "waiting-input") {
    return [overview.connected, waiting, task.threadId, task.turnId || "unknown-turn", task.status, task.activity?.itemId || "waiting"].join(":");
  }
  return [overview.connected, waiting, task?.threadId, task?.status, task?.updatedAt, task?.activity?.kind, task?.activity?.phase, task?.activity?.at].join(":");
}

function resultKey(task: CodexTask) {
  return [task.threadId, task.turnId || "unknown-turn", task.status].join(":");
}

export function validateStateCoverage() {
  return GROK_STATES.every((state) => Boolean(STATE_SHAPE[state]));
}
