import { appendFileSync, writeFileSync } from "node:fs";

export const WAITING_DIAGNOSTICS_PATH = "/private/tmp/grok-bot-pet-waiting-diagnostics.jsonl";

export interface WaitingDiagnosticsSnapshot {
  timestamp: number;
  protocolPending: number;
  rolloutPending: number;
  hostVisible: boolean;
  taskFallbackPending: number;
  waiting: boolean;
}

export interface WaitingDiagnosticsSink {
  reset(): void;
  record(snapshot: WaitingDiagnosticsSnapshot): void;
}

type WaitingDiagnosticsIo = {
  reset(file: string): void;
  append(file: string, line: string): void;
};

const defaultIo: WaitingDiagnosticsIo = {
  reset: (file) => writeFileSync(file, ""),
  append: (file, line) => appendFileSync(file, line)
};

export class WaitingDiagnostics implements WaitingDiagnosticsSink {
  private previous?: string;

  constructor(
    private readonly file = WAITING_DIAGNOSTICS_PATH,
    private readonly io: WaitingDiagnosticsIo = defaultIo
  ) {}

  reset() {
    this.previous = undefined;
    try { this.io.reset(this.file); } catch {}
  }

  record(snapshot: WaitingDiagnosticsSnapshot) {
    const record = {
      timestamp: numberValue(snapshot.timestamp),
      protocolPending: countValue(snapshot.protocolPending),
      rolloutPending: countValue(snapshot.rolloutPending),
      hostVisible: snapshot.hostVisible === true,
      taskFallbackPending: countValue(snapshot.taskFallbackPending),
      waiting: snapshot.waiting === true
    };
    const signature = JSON.stringify([
      record.protocolPending, record.rolloutPending, record.hostVisible, record.taskFallbackPending, record.waiting
    ]);
    if (signature === this.previous) return;
    try {
      this.io.append(this.file, `${JSON.stringify(record)}\n`);
      this.previous = signature;
    } catch {}
  }
}

function countValue(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function numberValue(value: number) {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}
