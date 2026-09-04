import { spawn } from "node:child_process";
import { homedir } from "node:os";

export const CODEX_DAEMON_ENV = "CODEX_APP_SERVER_USE_LOCAL_DAEMON";

export type CommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs?: number
) => Promise<boolean>;

export interface SharedDaemonOptions {
  codexCli: string;
  codexHome: string;
  platform?: NodeJS.Platform;
  run?: CommandRunner;
}

export async function prepareSharedCodexDaemon(options: SharedDaemonOptions) {
  if ((options.platform ?? process.platform) !== "darwin") return false;
  const run = options.run ?? runCommand;
  const enabled = await run("/bin/launchctl", ["setenv", CODEX_DAEMON_ENV, "1"]);
  if (!enabled) return false;
  return run(options.codexCli, ["app-server", "daemon", "start"], {
    ...process.env,
    HOME: homedir(),
    CODEX_HOME: options.codexHome,
    [CODEX_DAEMON_ENV]: "1"
  });
}

export function appServerTransports(socket: string, daemonReady: boolean): string[][] {
  const stdio = ["app-server", "--listen", "stdio://"];
  return daemonReady
    ? [["app-server", "proxy", "--sock", socket], stdio]
    : [stdio];
}

export function runCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeoutMs = 5_000
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, { env: env ?? process.env, stdio: "ignore" });
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    timeout.unref();
    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}
