# Shared Codex Daemon and Status Breathing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all four task status colors breathe softly and connect Grok Bot Pet to the same local Codex App Server daemon as Codex Desktop so live approval requests produce the waiting state.

**Architecture:** Keep status animation policy in the renderer's existing `statusColorBehavior` function. Add a focused Electron daemon helper that publishes the macOS daemon opt-in, starts the official Codex daemon with a bounded timeout, and returns whether the bridge should prefer its existing socket proxy; retain private stdio and JSONL as fallbacks.

**Tech Stack:** Electron 44, TypeScript 7, React 19, Node child processes, Vitest 4, Codex CLI 0.150.1.

**Spec:** `docs/superpowers/specs/2026-09-04-shared-codex-daemon-status-breathing-design.md`

## Global Constraints

- Preserve all existing uncommitted status-animation and preview changes.
- Do not delete stale socket files; recovery belongs to `codex app-server daemon start`.
- Do not terminate or restart Codex Desktop automatically.
- Keep reduced-motion behavior steady at the full configured status color.
- A daemon failure must fall back to the existing private stdio App Server.
- Do not add dependencies.

---

### Task 1: Extend breathing to failed and interrupted states

**Files:**
- Modify: `src/character-engine/GrokCharacter.test.ts`
- Modify: `src/character-engine/GrokCharacter.tsx:160`

**Interfaces:**
- Consumes: `StatusColorRole = "completed" | "error" | "stopped" | "waiting"`
- Produces: `statusColorBehavior(role): "breathe" | undefined`

- [ ] **Step 1: Change the existing policy test to require breathing for all four roles**

```typescript
it("breathes for every task status color", () => {
  expect((["completed", "error", "stopped", "waiting"] as const)
    .map((role) => statusColorBehavior(role)))
    .toEqual(["breathe", "breathe", "breathe", "breathe"]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- src/character-engine/GrokCharacter.test.ts`

Expected: FAIL because `error` and `stopped` still return `steady`.

- [ ] **Step 3: Implement the minimal policy change**

```typescript
export function statusColorBehavior(role: StatusColorRole | undefined): "breathe" | undefined {
  if (role) return "breathe";
  return undefined;
}
```

- [ ] **Step 4: Run the focused renderer and director tests**

Run: `npm test -- src/character-engine/GrokCharacter.test.ts src/character-engine/director.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the status-animation change**

```bash
git add src/App.tsx src/character-engine/GrokCharacter.tsx src/character-engine/GrokCharacter.test.ts src/character-engine/director.ts src/character-engine/director.test.ts
git commit -m "feat: breathe all task status colors"
```

### Task 2: Add a bounded shared-daemon preparation helper

**Files:**
- Create: `electron/codex-daemon.ts`
- Create: `electron/codex-daemon.test.ts`

**Interfaces:**
- Consumes: discovered Codex CLI path, Codex home, platform, and an injectable command runner.
- Produces: `prepareSharedCodexDaemon(options): Promise<boolean>` and `appServerTransports(socket, daemonReady): string[][]`.

- [ ] **Step 1: Write failing tests for macOS preparation and transport order**

```typescript
it("enables the login-session opt-in before starting the daemon on macOS", async () => {
  const calls: Array<[string, string[]]> = [];
  const ready = await prepareSharedCodexDaemon({
    codexCli: "/codex",
    codexHome: "/codex-home",
    platform: "darwin",
    run: async (command, args) => { calls.push([command, args]); return true; }
  });
  expect(ready).toBe(true);
  expect(calls).toEqual([
    ["/bin/launchctl", ["setenv", "CODEX_APP_SERVER_USE_LOCAL_DAEMON", "1"]],
    ["/codex", ["app-server", "daemon", "start"]]
  ]);
});

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
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npm test -- electron/codex-daemon.test.ts`

Expected: FAIL because `electron/codex-daemon.ts` does not exist.

- [ ] **Step 3: Implement the pure preparation orchestration and transport planner**

```typescript
export interface SharedDaemonOptions {
  codexCli: string;
  codexHome: string;
  platform?: NodeJS.Platform;
  run?: CommandRunner;
}

export async function prepareSharedCodexDaemon(options: SharedDaemonOptions) {
  const run = options.run ?? runCommand;
  if ((options.platform ?? process.platform) !== "darwin") return false;
  if (!await run("/bin/launchctl", ["setenv", DAEMON_ENV, "1"])) return false;
  return run(options.codexCli, ["app-server", "daemon", "start"], {
    ...process.env,
    HOME: homedir(),
    CODEX_HOME: options.codexHome,
    [DAEMON_ENV]: "1"
  });
}

export function appServerTransports(socket: string, daemonReady: boolean) {
  const stdio = ["app-server", "--listen", "stdio://"];
  return daemonReady
    ? [["app-server", "proxy", "--sock", socket], stdio]
    : [stdio];
}
```

`runCommand(command, args, env?, timeoutMs = 5_000)` uses `spawn` with ignored stdio, resolves true only for exit code zero, kills the child after the timeout, and resolves false for errors or timeouts.

- [ ] **Step 4: Add runner tests for success, non-zero exit, and timeout using real child processes**

```typescript
it("reports command success and failure", async () => {
  await expect(runCommand(process.execPath, ["-e", "process.exit(0)"])).resolves.toBe(true);
  await expect(runCommand(process.execPath, ["-e", "process.exit(2)"])).resolves.toBe(false);
  await expect(runCommand("/missing/grok-command", [])).resolves.toBe(false);
});

it("terminates commands that exceed the timeout", async () => {
  const startedAt = Date.now();
  await expect(runCommand(process.execPath, ["-e", "setTimeout(() => {}, 1000)"], undefined, 20)).resolves.toBe(false);
  expect(Date.now() - startedAt).toBeLessThan(500);
});
```

- [ ] **Step 5: Run the daemon-helper tests**

Run: `npm test -- electron/codex-daemon.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit the daemon helper**

```bash
git add electron/codex-daemon.ts electron/codex-daemon.test.ts
git commit -m "feat: prepare shared Codex daemon"
```

### Task 3: Prefer the shared daemon from `CodexBridge`

**Files:**
- Modify: `electron/codex-bridge.ts:105`
- Modify: `electron/codex-bridge.test.ts`

**Interfaces:**
- Consumes: `prepareSharedCodexDaemon` and `appServerTransports` from Task 2.
- Produces: bridge connection order `daemon proxy → private stdio`, with private stdio alone on preparation failure.

- [ ] **Step 1: Write a failing bridge-level transport selection test**

Add `resolveAppServerTransports(command, codexHome, prepare = prepareSharedCodexDaemon)` and test the wished-for API before implementing it:

```typescript
it("prepares the daemon before selecting bridge transports", async () => {
  const calls: unknown[] = [];
  const transports = await resolveAppServerTransports("/codex", "/codex-home", async (options) => {
    calls.push(options);
    return true;
  });
  expect(calls).toEqual([{ codexCli: "/codex", codexHome: "/codex-home" }]);
  expect(transports).toEqual([
    ["app-server", "proxy", "--sock", "/codex-home/app-server-control/app-server-control.sock"],
    ["app-server", "--listen", "stdio://"]
  ]);
});
```

- [ ] **Step 2: Run the bridge test and verify RED**

Run: `npm test -- electron/codex-bridge.test.ts`

Expected: FAIL because bridge connection still depends only on `existsSync(socket)`.

- [ ] **Step 3: Integrate daemon preparation into each discovered CLI candidate**

```typescript
export type SharedDaemonPreparer = typeof prepareSharedCodexDaemon;

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

for (const command of commands) {
  const transports = await resolveAppServerTransports(command, this.codexHome);
  for (const args of transports) {
    // The existing try/catch spawn and initialize body remains here unchanged.
  }
}
```

Move only the transport selection boundary. Do not change request dispatch, task merging, or JSONL fallback logic.

- [ ] **Step 4: Add a regression assertion for the existing approval request path**

Seed a task in the bridge, feed `receive()` an `item/commandExecution/requestApproval` JSON-RPC request, and assert `overview()` exposes `waiting-input` with an approval activity. This documents the expected endpoint of the shared transport without duplicating renderer tests.

- [ ] **Step 5: Run Electron-focused tests and type checks**

Run: `npm test -- electron/codex-daemon.test.ts electron/codex-bridge.test.ts`

Run: `npm run typecheck`

Expected: both commands PASS.

- [ ] **Step 6: Commit the bridge integration**

```bash
git add electron/codex-bridge.ts electron/codex-bridge.test.ts
git commit -m "feat: connect pet through shared Codex daemon"
```

### Task 4: Verify the integrated build and configure the local session

**Files:**
- No additional source files expected.
- Preserve: `pulse-preview.html` and `src/pulse-preview.tsx`.

**Interfaces:**
- Consumes: packaged Electron application, installed Codex CLI, current macOS launchd user session.
- Produces: shared daemon socket and an application build ready for local use.

- [ ] **Step 1: Run all automated verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: all commands exit zero without new warnings.

- [ ] **Step 2: Start and inspect the Codex daemon**

Run: `launchctl setenv CODEX_APP_SERVER_USE_LOCAL_DAEMON 1`

Run: `codex app-server daemon start`

Run: `codex app-server daemon version`

Expected: version output reports the running daemon and the socket accepts a proxy connection. These commands require user approval because they update the user's local Codex runtime outside the repository.

- [ ] **Step 3: Build the development macOS bundle**

Run: `npm run build:mac:dev`

Expected: the unpacked arm64 app bundle is produced successfully.

- [ ] **Step 4: Hand off the one-time Codex Desktop restart**

Do not terminate Codex from this task. Tell the user that the current Codex Desktop process still owns a private stdio App Server and must be restarted once to inherit the launchd opt-in.

- [ ] **Step 5: After restart, run the visible approval smoke test**

Trigger one harmless escalated command. Before approving, verify the pet shows the waiting color and breathing motion; after approving, verify it exits waiting. Also verify failed and interrupted sample states breathe in the preview or automated renderer policy test.
