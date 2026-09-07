import { describe, expect, it, vi } from "vitest";

const diagnosticIo = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn()
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:fs")>(),
  appendFileSync: diagnosticIo.appendFileSync,
  writeFileSync: diagnosticIo.writeFileSync
}));

import { CodexBridge } from "./codex-bridge";

describe("CodexBridge diagnostics isolation", () => {
  it("performs no diagnostic filesystem writes without an injected sink", () => {
    const bridge = new CodexBridge("/tmp/codex-no-waiting-diagnostics-test");
    (bridge as any).refresh = async () => bridge.overview();

    bridge.start();
    bridge.stop();

    expect(diagnosticIo.writeFileSync).not.toHaveBeenCalled();
    expect(diagnosticIo.appendFileSync).not.toHaveBeenCalled();
  });
});
