# Comprehensive Approval Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pet show its soft waiting-color breathing state for every visible Codex approval or structured-input prompt, including desktop-host-only terminal and Browser confirmations, and clear that state immediately when the interaction ends.

**Architecture:** A focused `PendingInteractionTracker` combines explicit App Server request identities, high-confidence rollout identities, and a global macOS Accessibility boolean. `CodexBridge` owns the tracker and the host observer lifecycle, while the native bridge inspects only `com.openai.codex` and exposes no prompt contents. The renderer treats the aggregated `CodexOverview.hasWaiting` signal as higher priority than recent command, browser, or tool activity.

**Tech Stack:** TypeScript 7, Electron 44, Vitest 4, Objective-C++/Cocoa/ApplicationServices, Node-API, electron-builder

**Spec:** `docs/superpowers/specs/2026-09-04-comprehensive-approval-detection-design.md`

## Global Constraints

- Query Accessibility data only for the running application with bundle identifier `com.openai.codex`.
- The native layer may return only `boolean` or `unavailable`; it must not return, store, log, IPC-send, or transmit commands, URLs, prompt text, or other Accessibility content.
- Do not infer waiting from tool duration, missing output, normal Browser navigation, model reasoning, network latency, or Guardian auto-review.
- Do not click, approve, deny, cancel, or otherwise control Codex approval UI.
- Clear each App Server or rollout identity independently; clear host UI waiting when the recognized panel disappears.
- Turn completion, interruption, and connection reset clear pending identities in their scope.
- Waiting must outrank fresh command, Browser, and tool activity, without changing shape rotation, task badge logic, fixed-shape behavior, or terminal-result flows.
- Missing or denied Accessibility permission degrades to App Server plus rollout detection without error color or repeated permission prompts.
- Build an unsigned arm64 macOS development app, replace only `/Applications/Grok Bot Pet.app`, and restart only Grok Bot Pet; do not restart Codex.
- Keep all commits local on `dev`; do not push any branch.

## File Structure

- Create `electron/pending-interaction-tracker.ts`: pure state machine for protocol, rollout, and host-UI pending sources.
- Create `electron/pending-interaction-tracker.test.ts`: source isolation, multi-request resolution, turn cleanup, replacement, reset, and host transition tests.
- Modify `electron/codex-local-activity.test.ts`: exact negative fixtures for host-only terminal and Browser prompts plus ordinary long-running activity.
- Modify `electron/codex-bridge.ts`: tracker ownership, App Server request/resolution lifecycle, rollout synchronization, host observer polling, and aggregated overview state.
- Modify `electron/codex-bridge.test.ts`: all documented request families, per-ID resolution, threadless global waiting, lifecycle cleanup, polling, and no-false-wait regressions.
- Modify `electron/native-window-bridge.ts`: typed adapter for `codexApprovalVisible(promptForPermission?: boolean): boolean | undefined`.
- Modify `electron/native-window-bridge.test.ts`: boolean validation, unavailable behavior, and native exception containment.
- Modify `native/window-bridge/window_bridge.mm`: guarded Accessibility trust query and semantic approval-panel recognition for Codex only.
- Modify `scripts/build-native-window-bridge.mjs`: link `ApplicationServices`.
- Modify `electron/native-window-build.test.ts`: native source privacy, bundle-ID, framework, and exported-method assertions.
- Modify `electron/main.ts`: inject the native approval query into `CodexBridge`.
- Modify `src/character-engine/director.ts`: make `overview.hasWaiting` authoritative before recent task activity.
- Modify `src/character-engine/director.test.ts`: prove global and task-scoped waiting beat fresh activity and clear after resolution.

---

### Task 1: Pending Interaction Tracker

**Files:**
- Create: `electron/pending-interaction-tracker.test.ts`
- Create: `electron/pending-interaction-tracker.ts`

**Interfaces:**
- Consumes: no application state; this is a pure TypeScript module.
- Produces: `PendingInteractionSource`, `PendingInteractionRef`, and `PendingInteractionTracker` with `add`, `resolve`, `replace`, `clearTurn`, `clearThread`, `setHostVisible`, `hasWaiting`, `hasForThread`, and `reset`.

- [ ] **Step 1: Write the failing tracker tests**

```ts
import { describe, expect, it } from "vitest";
import { PendingInteractionTracker } from "./pending-interaction-tracker";

describe("pending interaction tracker", () => {
  it("resolves simultaneous protocol requests independently", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "request-1", threadId: "thread-1", turnId: "turn-1" });
    tracker.add("protocol", { id: "request-2", threadId: "thread-1", turnId: "turn-1" });
    expect(tracker.resolve("protocol", "request-1")).toMatchObject({ id: "request-1", threadId: "thread-1" });
    expect(tracker.hasWaiting()).toBe(true);
    expect(tracker.resolve("protocol", "request-2")).toMatchObject({ id: "request-2", threadId: "thread-1" });
    expect(tracker.hasWaiting()).toBe(false);
  });

  it("keeps sources isolated and replaces rollout snapshots", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "same-id", threadId: "thread-1" });
    tracker.replace("rollout", [{ id: "same-id", threadId: "thread-2" }]);
    tracker.resolve("protocol", "same-id");
    expect(tracker.hasForThread("thread-2")).toBe(true);
    tracker.replace("rollout", []);
    expect(tracker.hasWaiting()).toBe(false);
  });

  it("clears only matching turn and thread scopes", () => {
    const tracker = new PendingInteractionTracker();
    tracker.add("protocol", { id: "a", threadId: "thread-1", turnId: "turn-a" });
    tracker.add("protocol", { id: "b", threadId: "thread-1", turnId: "turn-b" });
    tracker.add("rollout", { id: "c", threadId: "thread-2", turnId: "turn-c" });
    tracker.clearTurn("thread-1", "turn-a");
    expect(tracker.hasForThread("thread-1")).toBe(true);
    tracker.clearThread("thread-1");
    expect(tracker.hasForThread("thread-1")).toBe(false);
    expect(tracker.hasForThread("thread-2")).toBe(true);
  });

  it("tracks host visibility transitions and resets every source", () => {
    const tracker = new PendingInteractionTracker();
    expect(tracker.setHostVisible(true)).toBe(true);
    expect(tracker.setHostVisible(true)).toBe(false);
    expect(tracker.hasWaiting()).toBe(true);
    expect(tracker.setHostVisible(false)).toBe(true);
    tracker.add("protocol", { id: "request" });
    tracker.reset();
    expect(tracker.hasWaiting()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tracker test to verify the red state**

Run: `npx vitest run electron/pending-interaction-tracker.test.ts`

Expected: FAIL because `./pending-interaction-tracker` does not exist.

- [ ] **Step 3: Implement the minimal pure tracker**

```ts
export type PendingInteractionSource = "protocol" | "rollout";

export interface PendingInteractionRef {
  id: string;
  threadId?: string;
  turnId?: string;
}

export class PendingInteractionTracker {
  private readonly entries = new Map<PendingInteractionSource, Map<string, PendingInteractionRef>>([
    ["protocol", new Map()],
    ["rollout", new Map()]
  ]);
  private hostVisible = false;

  add(source: PendingInteractionSource, ref: PendingInteractionRef) {
    const entries = this.entries.get(source)!;
    const previous = entries.get(ref.id);
    entries.set(ref.id, ref);
    return JSON.stringify(previous) !== JSON.stringify(ref);
  }

  resolve(source: PendingInteractionSource, id: string) {
    const entries = this.entries.get(source)!;
    const resolved = entries.get(id);
    if (resolved) entries.delete(id);
    return resolved;
  }

  replace(source: PendingInteractionSource, refs: PendingInteractionRef[]) {
    const entries = this.entries.get(source)!;
    const previous = JSON.stringify([...entries.values()]);
    entries.clear();
    for (const ref of refs) entries.set(ref.id, ref);
    return previous !== JSON.stringify([...entries.values()]);
  }

  clearTurn(threadId: string, turnId?: string) {
    return this.removeWhere((ref) => ref.threadId === threadId && (!turnId || ref.turnId === turnId));
  }

  clearThread(threadId: string) {
    return this.removeWhere((ref) => ref.threadId === threadId);
  }

  setHostVisible(visible: boolean) {
    if (this.hostVisible === visible) return false;
    this.hostVisible = visible;
    return true;
  }

  hasWaiting() {
    return this.hostVisible || [...this.entries.values()].some((entries) => entries.size > 0);
  }

  hasForThread(threadId: string) {
    return [...this.entries.values()].some((entries) => [...entries.values()].some((ref) => ref.threadId === threadId));
  }

  reset() {
    for (const entries of this.entries.values()) entries.clear();
    this.hostVisible = false;
  }

  private removeWhere(predicate: (ref: PendingInteractionRef) => boolean) {
    let changed = false;
    for (const entries of this.entries.values()) {
      for (const [id, ref] of entries) if (predicate(ref)) changed = entries.delete(id) || changed;
    }
    return changed;
  }
}
```

- [ ] **Step 4: Run the tracker test to verify the green state**

Run: `npx vitest run electron/pending-interaction-tracker.test.ts`

Expected: PASS with 4 tests.

- [ ] **Step 5: Commit the tracker**

```bash
git add electron/pending-interaction-tracker.ts electron/pending-interaction-tracker.test.ts
git commit -m "feat: track pending interactions by source"
```

---

### Task 2: Rollout Inference Guardrails and Tracker Synchronization

**Files:**
- Modify: `electron/codex-local-activity.test.ts`
- Modify: `electron/codex-bridge.ts`
- Modify: `electron/codex-bridge.test.ts`

**Interfaces:**
- Consumes: `PendingInteractionTracker.replace("rollout", refs)` from Task 1 and existing `CodexLocalActivityReader.refresh(): Promise<CodexTask[]>`.
- Produces: `rolloutPendingRefs(tasks: CodexTask[]): PendingInteractionRef[]`, using only `waiting-input` tasks with a pending `approval` activity and a stable `activity.itemId`.

- [ ] **Step 1: Add exact negative parser fixtures**

Add tests proving each host-only record stays `processing` with command/tool activity when its rollout lacks explicit approval metadata:

```ts
it("does not guess a destructive Desktop exec is waiting without approval metadata", () => {
  const state = parseLocalSessionLines([
    line("2026-09-04T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-host-exec" }),
    line("2026-09-04T00:00:01.000Z", "response_item", {
      type: "custom_tool_call", id: "tool-host-exec", call_id: "call-host-exec", name: "exec",
      status: "completed", input: JSON.stringify({ cmd: "rm -rf /tmp/approval-fixture" })
    })
  ]);
  expect(state.lastActivity).toMatchObject({ kind: "command", phase: "progress" });
});

it("does not guess a Desktop Browser call is waiting without policy metadata", () => {
  const state = parseLocalSessionLines([
    line("2026-09-04T00:00:00.000Z", "event_msg", { type: "task_started", turn_id: "turn-host-browser" }),
    line("2026-09-04T00:00:01.000Z", "response_item", {
      type: "function_call", id: "tool-host-browser", call_id: "call-host-browser",
      name: "mcp__cua_repl", status: "completed", arguments: JSON.stringify({ code: "await cua.createBrowserTab('iab', 'https://example.com')" })
    })
  ]);
  expect(state.lastActivity?.kind).not.toBe("approval");
});
```

Keep the existing long-running command, approved-prefix, read-only MCP, completed-output, and plan-confirmation tests as the remaining negative and positive coverage.

- [ ] **Step 2: Add a failing bridge test for rollout snapshot replacement**

```ts
it("replaces rollout pending identities on every refresh", async () => {
  const bridge = new CodexBridge("/tmp/codex-rollout-tracker-test");
  (bridge as any).connect = async () => {};
  let waiting = true;
  (bridge as any).localActivity = { refresh: async () => [{
    threadId: "thread-1", title: "Task", status: waiting ? "waiting-input" : "processing",
    activeFlags: [], updatedAt: Date.now(),
    activity: { kind: waiting ? "approval" : "command", phase: "started", at: Date.now(), itemId: "call-1" }
  }] };
  expect((await bridge.refresh()).hasWaiting).toBe(true);
  waiting = false;
  expect((await bridge.refresh()).hasWaiting).toBe(false);
});
```

- [ ] **Step 3: Run the focused tests to verify the red state**

Run: `npx vitest run electron/codex-local-activity.test.ts electron/codex-bridge.test.ts`

Expected: the two parser fixtures pass, while rollout snapshot replacement FAILS because `CodexBridge` does not use the tracker.

- [ ] **Step 4: Synchronize only high-confidence rollout identities**

Import `PendingInteractionTracker` and `PendingInteractionRef`, add `private readonly pendingInteractions = new PendingInteractionTracker()`, and after `localActivity.refresh()` call:

```ts
this.pendingInteractions.replace("rollout", rolloutPendingRefs(inferred));
```

Export this helper for a direct unit test:

```ts
export function rolloutPendingRefs(tasks: CodexTask[]): PendingInteractionRef[] {
  return tasks.flatMap((task) => task.status === "waiting-input"
    && task.activity?.kind === "approval"
    && ["started", "progress"].includes(task.activity.phase)
    && task.activity.itemId
      ? [{ id: task.activity.itemId, threadId: task.threadId, turnId: task.turnId }]
      : []);
}
```

Change `makeOverview()` to combine the tracker with the existing high-confidence hydrated App Server task fallback; the fallback preserves approval flags discovered during `thread/read` even when this observer did not see the original request event:

```ts
hasWaiting: this.pendingInteractions.hasWaiting() || tasks.some(isAwaitingApproval),
```

- [ ] **Step 5: Run the focused tests to verify the green state**

Run: `npx vitest run electron/codex-local-activity.test.ts electron/codex-bridge.test.ts electron/pending-interaction-tracker.test.ts`

Expected: PASS; host-only fixtures remain ordinary activity and explicit rollout approvals enter and leave waiting.

- [ ] **Step 6: Commit the rollout integration**

```bash
git add electron/codex-local-activity.test.ts electron/codex-bridge.ts electron/codex-bridge.test.ts
git commit -m "fix: keep rollout approval inference high confidence"
```

---

### Task 3: App Server Approval and Input Lifecycle

**Files:**
- Modify: `electron/codex-bridge.ts`
- Modify: `electron/codex-bridge.test.ts`

**Interfaces:**
- Consumes: `PendingInteractionTracker.add`, `resolve`, `clearTurn`, `clearThread`, `hasForThread`, and `reset` from Task 1.
- Produces: `isUserBlockingServerRequest(method?: string): boolean`; `handleServerRequest(requestId: number | string, method: string, params: any)`; notification handling for `serverRequest/resolved`.

- [ ] **Step 1: Add failing tests for the complete documented request set**

```ts
it.each([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request"
])("tracks %s until its request id resolves", (method) => {
  const bridge = new CodexBridge("/tmp/codex-protocol-test");
  (bridge as any).tasks.set("thread-1", {
    threadId: "thread-1", turnId: "turn-1", title: "Protocol test",
    status: "processing", activeFlags: [], updatedAt: 1
  });
  (bridge as any).receive(JSON.stringify({ id: "request-1", method, params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" } }));
  expect(bridge.overview().hasWaiting).toBe(true);
  (bridge as any).receive(JSON.stringify({ method: "serverRequest/resolved", params: { requestId: "request-1", threadId: "thread-1", turnId: "turn-1" } }));
  expect(bridge.overview().hasWaiting).toBe(false);
});
```

Also add separate tests that:

- two request IDs on one thread remain waiting after only one resolves;
- an unknown server request does not create waiting;
- a documented request without a known thread sets only global `hasWaiting` and creates no task;
- `turn/completed`, interruption status, disconnect, and `stop()` clear matching pending identities;
- a resolved request returns its task to `processing`, removes only `waitingOnApproval`, `waitingOnInput`, or `serverRequest:*` flags, and marks the matching approval activity `completed` only when no pending identity remains for that thread.

- [ ] **Step 2: Run the App Server tests to verify the red state**

Run: `npx vitest run electron/codex-bridge.test.ts`

Expected: FAIL for non-command request coverage, threadless global waiting, per-ID resolution, and lifecycle cleanup.

- [ ] **Step 3: Implement explicit request classification and request-ID tracking**

```ts
const USER_BLOCKING_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request"
]);

export function isUserBlockingServerRequest(method?: string) {
  return !!method && USER_BLOCKING_SERVER_REQUESTS.has(method);
}
```

Pass the JSON-RPC request ID through `receive`:

```ts
if (isServerRequestMessage(message)) {
  if (isUserBlockingServerRequest(message.method)) this.handleServerRequest(message.id!, message.method!, message.params);
  return;
}
```

Implement `handleServerRequest` so it always adds a protocol ref, then updates a task only when `taskForParams(params)` returns one:

```ts
this.pendingInteractions.add("protocol", {
  id: String(requestId),
  threadId: task?.threadId ?? params?.threadId,
  turnId: params?.turnId
});
```

The task update preserves the current `waiting-input`, active-flag, emotion, and approval-activity behavior. Use the request ID as the fallback activity `itemId`, so every request has a stable identity.

- [ ] **Step 4: Implement resolution and lifecycle cleanup**

Handle `serverRequest/resolved` before task-dependent notification branches:

```ts
const requestId = String(params?.requestId ?? params?.id ?? "");
const resolved = requestId ? this.pendingInteractions.resolve("protocol", requestId) : undefined;
if (!resolved) return;
const task = resolved.threadId ? this.tasks.get(resolved.threadId) : this.taskForParams(params);
if (task && !this.pendingInteractions.hasForThread(task.threadId)) {
  task.activeFlags = task.activeFlags.filter((flag) => !/approval|input|serverrequest/i.test(flag));
  if (task.status === "waiting-input") task.status = "processing";
  this.setActivity(task, { kind: "approval", phase: "completed", at: Date.now(), itemId: requestId });
}
this.emitOverview();
```

Call `clearTurn(task.threadId, task.turnId)` on `turn/completed` and interruption/terminal status notifications. Call `reset()` from `stop()` and the current disconnect handler. Do not clear other threads or other request IDs.

- [ ] **Step 5: Run the App Server and tracker tests to verify the green state**

Run: `npx vitest run electron/codex-bridge.test.ts electron/pending-interaction-tracker.test.ts`

Expected: PASS for every documented request family and all resolution paths.

- [ ] **Step 6: Commit the protocol lifecycle**

```bash
git add electron/codex-bridge.ts electron/codex-bridge.test.ts
git commit -m "feat: track App Server approval lifecycles"
```

---

### Task 4: Privacy-Preserving macOS Approval Observer

**Files:**
- Modify: `electron/native-window-bridge.test.ts`
- Modify: `electron/native-window-build.test.ts`
- Modify: `electron/native-window-bridge.ts`
- Modify: `native/window-bridge/window_bridge.mm`
- Modify: `scripts/build-native-window-bridge.mjs`

**Interfaces:**
- Consumes: existing lazy-loaded `NativeWindowBridge` and Node-API native module.
- Produces: native `codexApprovalVisible(promptForPermission?: boolean): boolean | null`; TypeScript `NativeWindowBridge.codexApprovalVisible(promptForPermission = false): boolean | undefined`.

- [ ] **Step 1: Add failing TypeScript adapter tests**

Extend the binding fixture with `codexApprovalVisible: () => false`, then add:

```ts
it("validates Codex approval visibility and preserves unavailable", () => {
  expect(new NativeWindowBridge("bridge.node", () => binding({ codexApprovalVisible: () => true })).codexApprovalVisible(true)).toBe(true);
  expect(new NativeWindowBridge("bridge.node", () => binding({ codexApprovalVisible: () => false })).codexApprovalVisible()).toBe(false);
  expect(new NativeWindowBridge("bridge.node", () => binding({ codexApprovalVisible: () => null })).codexApprovalVisible()).toBeUndefined();
  expect(new NativeWindowBridge("bridge.node", () => binding({ codexApprovalVisible: () => "yes" as any })).codexApprovalVisible()).toBeUndefined();
});
```

Extend the exception test so a thrown `codexApprovalVisible` call returns `undefined`.

- [ ] **Step 2: Add failing native source and build assertions**

Assert that the Objective-C++ source and build script contain:

```ts
expect(source).toContain("codexApprovalVisible");
expect(source).toContain('bundleIdentifier isEqualToString:@"com.openai.codex"');
expect(source).toContain("AXIsProcessTrustedWithOptions");
expect(source).toContain("kAXWindowsAttribute");
expect(source).not.toContain("napi_create_string");
expect(script).toContain('"-framework", "ApplicationServices"');
```

- [ ] **Step 3: Run adapter and native-source tests to verify the red state**

Run: `npx vitest run electron/native-window-bridge.test.ts electron/native-window-build.test.ts`

Expected: FAIL because the binding, adapter method, native export, and framework link are absent.

- [ ] **Step 4: Extend the TypeScript adapter**

```ts
export interface NativeWindowBinding {
  offsetWindow(nativeHandle: Buffer, electronDeltaX: number, electronDeltaY: number): boolean;
  setAlwaysOnTop(nativeHandle: Buffer, enabled: boolean): boolean;
  getWindowFrame(nativeHandle: Buffer): PetBounds | undefined;
  codexApprovalVisible(promptForPermission?: boolean): boolean | null;
}

codexApprovalVisible(promptForPermission = false) {
  if (typeof promptForPermission !== "boolean") return undefined;
  try {
    const visible = this.load()?.codexApprovalVisible(promptForPermission);
    return typeof visible === "boolean" ? visible : undefined;
  } catch {
    return undefined;
  }
}
```

Require `codexApprovalVisible` in `validBinding` so malformed or stale native modules degrade safely instead of partially loading.

- [ ] **Step 5: Implement the native Accessibility query**

Import ApplicationServices and add helpers with these exact responsibilities:

```objc
#import <ApplicationServices/ApplicationServices.h>

bool AccessibilityTrusted(bool promptForPermission) {
  if (!promptForPermission) return AXIsProcessTrusted();
  NSDictionary* options = @{(__bridge NSString*)kAXTrustedCheckOptionPrompt: @YES};
  return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}
```

`CodexApprovalVisible` must:

1. parse zero or one boolean argument;
2. return JavaScript `null` when trust is unavailable;
3. enumerate `NSWorkspace.sharedWorkspace.runningApplications` and keep only `application.bundleIdentifier == @"com.openai.codex"`;
4. create `AXUIElementCreateApplication(application.processIdentifier)`;
5. read `kAXWindowsAttribute` and recursively inspect role, subrole, title/value text, and enabled state only in memory;
6. recognize a visible panel only when one subtree contains a dialog/sheet/group prompt container plus both an affirmative decision control (`Allow`, `Allow once`, `允许`, `仅允许一次`, `继续`) and a rejecting control (`Deny`, `Cancel`, `拒绝`, `取消`), with case-insensitive/trimmed matching;
7. cap recursion depth at 12 and visited elements at 1500 per application;
8. release every Core Foundation object it owns;
9. return only `Boolean(env, visible)` and never create a JavaScript string, object, or array from Accessibility values.

Export it beside the existing functions:

```objc
{"codexApprovalVisible", nullptr, CodexApprovalVisible, nullptr, nullptr, nullptr, napi_default, nullptr}
```

Link the required framework immediately after Cocoa in the build arguments:

```js
"-framework", "Cocoa",
"-framework", "ApplicationServices",
```

- [ ] **Step 6: Run source tests and build the Universal native module**

Run: `npx vitest run electron/native-window-bridge.test.ts electron/native-window-build.test.ts`

Expected: PASS.

Run: `npm run build:native`

Expected: exit 0 and output `Architectures: arm64, x86_64` or the equivalent sorted architecture list.

- [ ] **Step 7: Commit the native observer**

```bash
git add electron/native-window-bridge.ts electron/native-window-bridge.test.ts electron/native-window-build.test.ts native/window-bridge/window_bridge.mm scripts/build-native-window-bridge.mjs
git commit -m "feat: observe visible Codex approval panels"
```

---

### Task 5: Host Observer Lifecycle and Waiting Priority

**Files:**
- Modify: `electron/codex-bridge.ts`
- Modify: `electron/codex-bridge.test.ts`
- Modify: `electron/main.ts`
- Modify: `src/character-engine/director.ts`
- Modify: `src/character-engine/director.test.ts`

**Interfaces:**
- Consumes: `NativeWindowBridge.codexApprovalVisible(promptForPermission?: boolean): boolean | undefined`, `PendingInteractionTracker.setHostVisible`, and `CodexOverview.hasWaiting`.
- Produces: `CodexBridgeDependencies.codexApprovalVisible?: (promptForPermission: boolean) => boolean | undefined`; one 500 ms observer owned by `CodexBridge.start()`/`stop()`; authoritative global waiting rendering.

- [ ] **Step 1: Add failing bridge observer tests with fake timers**

```ts
it("prompts once, emits only on host visibility transitions, and stops polling", () => {
  vi.useFakeTimers();
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
  expect(promptFlags[0]).toBe(true);
  expect(promptFlags.slice(1).every((value) => value === false)).toBe(true);
  expect(overviews).toEqual([true, false]);
  expect(promptFlags).toHaveLength(callsAtStop);
  vi.useRealTimers();
});
```

Add a second test proving `undefined` never sets `lastError`, never clears a protocol/rollout wait, and does not emit an overview transition.

- [ ] **Step 2: Add failing director priority regressions**

```ts
it("lets a threadless global wait outrank fresh command activity", () => {
  const command = {
    threadId: "thread-1", title: "Command", status: "processing" as const,
    activeFlags: [], updatedAt: 10_000,
    activity: { kind: "command" as const, phase: "progress" as const, at: 10_000 }
  };
  expect(baseDirective(overview({ hasWaiting: true, selectedTask: command }), 10_100).statusColorRole).toBe("waiting");
});

it("clears the global waiting color when the host panel disappears", () => {
  const command = {
    threadId: "thread-1", title: "Command", status: "processing" as const,
    activeFlags: [], updatedAt: 10_000,
    activity: { kind: "command" as const, phase: "progress" as const, at: 10_000 }
  };
  expect(baseDirective(overview({ hasWaiting: false, selectedTask: command }), 10_100).statusColorRole).toBeUndefined();
});
```

Retain the existing task-scoped waiting and result-flow tests to prove terminal-result animations remain unchanged.

- [ ] **Step 3: Run observer and director tests to verify the red state**

Run: `npx vitest run electron/codex-bridge.test.ts src/character-engine/director.test.ts`

Expected: FAIL because the dependency and observer do not exist, and `hasAwaitingApproval` ignores overview-level waiting.

- [ ] **Step 4: Implement the 500 ms host observer lifecycle**

Extend dependencies and bridge fields:

```ts
export interface CodexBridgeDependencies {
  discoverCodexCliCandidates?: () => string[];
  resolveAppServerTransports?: typeof resolveAppServerTransports;
  connectUnixSocketWebSocket?: typeof connectUnixSocketWebSocket;
  connectStdioJsonRpc?: typeof connectStdioJsonRpc;
  codexApprovalVisible?: (promptForPermission: boolean) => boolean | undefined;
}

private approvalObserverTimer?: NodeJS.Timeout;
private approvalPermissionPrompted = false;
```

From `start()`, call `pollHostApproval()` once and install one 500 ms interval. From `stop()`, clear that interval and call `pendingInteractions.reset()`. The poll method is:

```ts
private pollHostApproval() {
  const observe = this.dependencies.codexApprovalVisible;
  if (!observe) return;
  const prompt = !this.approvalPermissionPrompted;
  this.approvalPermissionPrompted = true;
  const visible = observe(prompt);
  const changed = this.pendingInteractions.setHostVisible(visible === true);
  if (changed) this.emitOverview();
}
```

When the native result is unavailable, this clears only the tracker’s host-UI layer if it was previously visible; protocol and rollout entries remain untouched. This avoids a stale host wait after Accessibility permission is revoked without erasing a wait reported by another source.

- [ ] **Step 5: Inject the native observer from the Electron entry point**

Construct the bridge in `electron/main.ts` with the existing native instance:

```ts
bridge = new CodexBridge(undefined, localizedCopy(appLocale).data, {
  codexApprovalVisible: (promptForPermission) => nativeWindowBridge.codexApprovalVisible(promptForPermission)
});
```

No extra IPC channel is added because only the aggregated overview is renderer-visible.

- [ ] **Step 6: Make global waiting authoritative in the director**

Change the helper to:

```ts
function hasAwaitingApproval(overview: CodexOverview) {
  return overview.hasWaiting || [overview.selectedTask, ...overview.recentTasks].some(isAwaitingApproval);
}
```

This makes the existing first waiting check in `baseDirective` preempt recent activity without reordering terminal-result sequence logic elsewhere.

- [ ] **Step 7: Run focused tests to verify the green state**

Run: `npx vitest run electron/codex-bridge.test.ts electron/native-window-bridge.test.ts src/character-engine/director.test.ts`

Expected: PASS; threadless host waiting appears and clears on panel visibility transitions, and fresh activity cannot mask it.

- [ ] **Step 8: Commit host aggregation and renderer priority**

```bash
git add electron/codex-bridge.ts electron/codex-bridge.test.ts electron/main.ts src/character-engine/director.ts src/character-engine/director.test.ts
git commit -m "feat: show host approval waits on the pet"
```

---

### Task 6: Full Verification, Local Package, and Acceptance

**Files:**
- Verify: all files modified in Tasks 1-5
- Build output: `release/mac-arm64/Grok Bot Pet.app`
- Replace locally: `/Applications/Grok Bot Pet.app`

**Interfaces:**
- Consumes: completed tracker, protocol integration, rollout guardrails, native observer, lifecycle, and renderer priority.
- Produces: a verified unsigned arm64 application installed locally, plus one final local verification commit only if verification requires a corrective code change.

- [ ] **Step 1: Run every targeted regression suite together**

Run:

```bash
npx vitest run electron/pending-interaction-tracker.test.ts electron/codex-local-activity.test.ts electron/codex-bridge.test.ts electron/native-window-bridge.test.ts electron/native-window-build.test.ts src/character-engine/director.test.ts
```

Expected: all targeted tests PASS with zero unhandled errors.

- [ ] **Step 2: Run the complete test suite**

Run: `npm test`

Expected: all Vitest files PASS. If Unix-socket tests are blocked by the workspace sandbox, rerun the same command with the existing test-command approval path; do not weaken or skip those tests.

- [ ] **Step 3: Run static checks and the native build**

Run: `npm run typecheck`

Expected: both renderer and Electron TypeScript projects exit 0.

Run: `npm run build:native`

Expected: exit 0 and `/usr/bin/lipo -archs build/native/window-bridge.node` reports both `arm64` and `x86_64`.

- [ ] **Step 4: Inspect the final local diff and commit any verification correction**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only intentional files are present. If a corrective source change was required, repeat the failing test first, apply the smallest fix, rerun Steps 1-3, and commit only the correction with `git commit -m "fix: complete approval detection verification"`.

- [ ] **Step 5: Build the unsigned arm64 development app**

Run: `npm run build:mac:dev`

Expected: exit 0 and `release/mac-arm64/Grok Bot Pet.app` exists. Signing identity auto-discovery remains disabled by the package script.

- [ ] **Step 6: Verify the packaged payload before installation**

Run:

```bash
/usr/bin/file "release/mac-arm64/Grok Bot Pet.app/Contents/MacOS/Grok Bot Pet"
/usr/bin/file "release/mac-arm64/Grok Bot Pet.app/Contents/Resources/native/window-bridge.node"
/usr/bin/shasum -a 256 "release/mac-arm64/Grok Bot Pet.app/Contents/Resources/app.asar"
```

Expected: the executable and native module both include `arm64`; record the package `app.asar` SHA-256 for the post-copy comparison.

- [ ] **Step 7: Replace only the local pet application and restart it**

After obtaining the user-approved local application-write action, quit only `Grok Bot Pet`, move the existing `/Applications/Grok Bot Pet.app` to a uniquely named `/private/tmp/grok-bot-pet-backup-<timestamp>.app`, copy `release/mac-arm64/Grok Bot Pet.app` to `/Applications/Grok Bot Pet.app`, and launch `/Applications/Grok Bot Pet.app`. Do not quit or relaunch ChatGPT/Codex.

Use explicit resolved paths for every move and copy. If launch fails, restore the backup before doing anything else.

- [ ] **Step 8: Verify the installed payload and remove the successful backup**

Run:

```bash
/usr/bin/shasum -a 256 "/Applications/Grok Bot Pet.app/Contents/Resources/app.asar"
/usr/bin/pgrep -fl "Grok Bot Pet"
```

Expected: the installed hash exactly matches Step 6 and one current pet process is running. After that verification succeeds, move the temporary backup to Trash or delete that exact backup path, and report whether recovery remains available.

- [ ] **Step 9: Perform manual acceptance without restarting Codex**

Trigger one harmless terminal command that the desktop host actually asks the user to approve, then leave the panel visible long enough to observe the pet. Repeat with one first-time Browser website access prompt.

For each prompt verify:

1. the pet enters the waiting-color soft breathing state while the approval panel is visible;
2. ordinary task activity does not replace the waiting color;
3. Allow, Deny, or Cancel clears the waiting color on the next observer sample, within approximately 500 ms;
4. a normal command and an already-approved website do not produce waiting;
5. the task badge, shape rotation, completed/error/stopped breathing colors, and fixed-shape behavior remain unchanged.

- [ ] **Step 10: Report final repository and installation state**

Run: `git status --short --branch && git log -8 --oneline`

Expected: `dev` contains the local implementation commits, the worktree has no unintended changes, and no remote push has occurred. Report test counts, typecheck/build results, installed hash match, Accessibility availability, manual terminal/Browser outcomes, and any backup removal performed.
