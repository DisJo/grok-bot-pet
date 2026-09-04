import { describe, expect, it } from "vitest";
import {
  appServerTransports,
  prepareSharedCodexDaemon,
  runCommand
} from "./codex-daemon";

describe("shared Codex daemon preparation", () => {
  it("enables the login-session opt-in before starting the daemon on macOS", async () => {
    const calls: Array<{ command: string; args: string[]; env?: NodeJS.ProcessEnv }> = [];

    const ready = await prepareSharedCodexDaemon({
      codexCli: "/codex",
      codexHome: "/codex-home",
      platform: "darwin",
      run: async (command, args, env) => {
        calls.push({ command, args, env });
        return true;
      }
    });

    expect(ready).toBe(true);
    expect(calls.map(({ command, args }) => ({ command, args }))).toEqual([
      {
        command: "/bin/launchctl",
        args: ["setenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "1"]
      },
      {
        command: "/codex",
        args: ["app-server", "daemon", "start"]
      }
    ]);
    expect(calls[1].env).toMatchObject({
      CODEX_HOME: "/codex-home",
      CODEX_APP_SERVER_USE_LOCAL_DAEMON: "1"
    });
  });

  it("does not start a shared daemon outside macOS", async () => {
    let called = false;
    const ready = await prepareSharedCodexDaemon({
      codexCli: "/codex",
      codexHome: "/codex-home",
      platform: "linux",
      run: async () => { called = true; return true; }
    });

    expect(ready).toBe(false);
    expect(called).toBe(false);
  });

  it("stops preparation when the login-session opt-in fails", async () => {
    const calls: string[] = [];
    const ready = await prepareSharedCodexDaemon({
      codexCli: "/codex",
      codexHome: "/codex-home",
      platform: "darwin",
      run: async (command) => {
        calls.push(command);
        return false;
      }
    });

    expect(ready).toBe(false);
    expect(calls).toEqual(["/bin/launchctl"]);
  });
});

describe("App Server transport preference", () => {
  it("falls back to stdio when daemon preparation fails", () => {
    expect(appServerTransports("/daemon.sock", false)).toEqual([
      ["app-server", "--listen", "stdio://"]
    ]);
  });

  it("prefers the daemon proxy and retains stdio fallback when ready", () => {
    expect(appServerTransports("/daemon.sock", true)).toEqual([
      ["app-server", "proxy", "--sock", "/daemon.sock"],
      ["app-server", "--listen", "stdio://"]
    ]);
  });
});

describe("bounded command runner", () => {
  it("reports command success, non-zero exit, and spawn failure", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.exit(0)"])).resolves.toBe(true);
    await expect(runCommand(process.execPath, ["-e", "process.exit(2)"])).resolves.toBe(false);
    await expect(runCommand("/missing/grok-command", [])).resolves.toBe(false);
  });

  it("terminates commands that exceed the timeout", async () => {
    const startedAt = Date.now();

    await expect(runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 1000)"],
      undefined,
      20
    )).resolves.toBe(false);

    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
