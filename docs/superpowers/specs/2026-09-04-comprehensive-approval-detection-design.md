# Comprehensive Approval Detection Design

## Goal

Show the pet's waiting-color breathing state whenever Codex is visibly waiting for the user to approve or answer something, including approvals created by the ChatGPT/Codex desktop host rather than by Codex App Server. Clear the waiting state as soon as the interaction is resolved.

The solution must avoid treating ordinary long-running commands, browser navigation, model reasoning, Guardian auto-review, or already-approved actions as user waits.

## Evidence and root cause

Codex App Server documents explicit approval requests such as `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, and `mcpServer/elicitation/request`. Those requests have stable request identities and resolution events.

The two reported desktop prompts do not use that path:

- The destructive terminal command was stored as an ordinary `custom_tool_call` named `exec`. Its recorded input did not contain `sandbox_permissions: "require_escalated"`, even though the desktop host displayed an approval prompt.
- The website-access prompt was stored as an ordinary namespaced `function_call` to `mcp__cua_repl`. The rollout contained no pending-approval record between the call and its output.
- Replaying both records through the current local activity parser produces an empty pending-approval set and a normal `command` activity.

The desktop host applies its own safety policy before invoking these tools. A separate App Server subscriber and the rollout log do not receive a reliable pending event for that host-only decision. Therefore, expanding string inference alone cannot cover the feature without false positives.

## Approval and input taxonomy

The waiting color covers these user-blocking interactions:

1. App Server command-execution and file-change approvals.
2. Additional network or filesystem permission requests.
3. Structured user-input and plan-confirmation requests.
4. MCP elicitation and side-effecting app/connector approvals.
5. Desktop-host terminal confirmations, including destructive commands and policy-triggered escalation.
6. Desktop-host Browser and Computer Use confirmations, including website access and action-time confirmations.

The waiting color does not cover:

- Normal commands, browser loads, or tools that are still executing.
- Commands and sites already allowed by a persistent rule.
- Guardian or another automatic reviewer making the approval decision.
- Model reasoning, ordinary network latency, failures, or completed interactions.

## Architecture

### 1. Pending interaction tracker

Add a small main-process `PendingInteractionTracker` as the single source used to derive whether user interaction is pending. It accepts three confidence-qualified inputs:

- `protocol`: explicit App Server requests and resolutions, keyed by request ID.
- `rollout`: existing high-confidence local inference, keyed by tool call or plan item ID.
- `host-ui`: the current visibility of a recognized approval panel in the Codex desktop window.

Explicit identities are added and removed individually. The host UI signal is a boolean because the pet only needs a global waiting indication and the desktop accessibility tree may not expose a stable thread ID.

The tracker reports waiting when any source is active. Turn completion, interruption, or connection reset clears identities scoped to that turn. A matching tool output clears rollout inference. `serverRequest/resolved` clears protocol requests. Disappearance of the recognized panel clears the host UI signal.

### 2. App Server integration

Keep the current server-request handling, but explicitly track all documented user-blocking request methods rather than reducing them immediately to a task status. Handle `serverRequest/resolved` by request ID.

The bridge continues attaching known requests to their thread. A host-only wait without a thread identity sets the overview-level waiting signal and does not invent or modify a task.

### 3. Rollout inference

Retain current high-confidence inference for explicit escalated commands, configured MCP approvals, plan confirmation, and structured input. Add support for direct namespaced function-call identity where policy metadata is available.

Do not classify a tool as waiting merely because it has no output yet or has run longer than a timeout. Host-only cases that lack reliable metadata are delegated to the UI observer.

### 4. macOS host approval observer

Extend the existing native bridge with a read-only accessibility query. It will:

- Request macOS Accessibility access once when the observer first starts.
- Enumerate only running applications whose bundle identifier is `com.openai.codex`.
- Read only those applications' accessibility window trees.
- Recognize a modal as an approval/input panel from semantic controls, requiring a prompt container plus a known decision-control combination such as Allow/Allow once and Deny/Cancel. Initial matching supports the app's Chinese and English labels.
- Return only a boolean to JavaScript. It will not return prompt text, commands, URLs, or other window content.

The Electron main process polls this boolean at a modest interval while Codex is running. A state transition emits an overview update immediately. Polling stops during app shutdown.

If Accessibility access is absent or denied, the native method returns `unavailable`. The application continues using App Server and rollout signals without repeated permission prompts or an error color.

### 5. Rendering priority

Waiting must outrank recent command, browser, and tool activity. The animation director first checks the global pending-interaction signal and any task with `waiting-input`; only when neither is present may recent activity choose the working animation.

The waiting color continues using the existing soft breathing effect. Shape rotation, task badge logic, completed/error/stopped flows, and fixed-shape behavior remain unchanged.

## Data flow

1. App Server events, rollout refreshes, and the native host observer update the pending interaction tracker.
2. The tracker exposes a global `hasWaiting` result and thread-scoped request state where an identity exists.
3. `CodexBridge` includes that result in `CodexOverview` and emits only on state changes.
4. The renderer receives the overview and the animation director selects the waiting color before ordinary activity directives.
5. Resolution from the same source removes the pending state and the next overview returns the pet to its task-driven color.

## Testing

Development follows test-driven implementation.

- Parser fixtures reproduce the exact shapes of the reported terminal and Browser rollout records and prove they are not guessed as waits without a reliable signal.
- Tracker tests cover multiple simultaneous requests, source-specific resolution, turn cleanup, and host UI transitions.
- Bridge tests cover every documented App Server request class and `serverRequest/resolved`.
- Native adapter tests cover unavailable permissions, binding failures, and boolean validation.
- Native-source tests verify that only `com.openai.codex` is queried and that prompt contents are not returned to JavaScript.
- Director tests prove global and task-scoped waiting override fresh command/browser activity, and that resolution restores normal activity.
- Negative fixtures cover ordinary long-running commands, already-approved prefixes, normal browser navigation, Guardian auto-review, and completed tool calls.
- Full unit tests, TypeScript checks, the native universal build, and the unsigned arm64 macOS development package must pass.

After installation, manual acceptance uses one harmless terminal approval and one website-access approval. In each case the waiting breathing color must appear while the panel is visible and clear immediately after Allow, Deny, or Cancel. Codex itself must not be restarted.

## Security and privacy

Accessibility permission is a meaningful macOS capability. The implementation minimizes use by targeting only the `com.openai.codex` process and returning a boolean rather than captured content. No accessibility data is stored, logged, sent over IPC, or transmitted over the network.

## Non-goals

- Reproducing or controlling Codex's approval buttons from the pet.
- Automatically approving any request.
- Predicting all approval decisions from command text or elapsed time.
- Reading approval prompt contents for display or analytics.
- Changing Codex permission policies.
