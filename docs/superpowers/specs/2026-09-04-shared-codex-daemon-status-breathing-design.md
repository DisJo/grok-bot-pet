# Shared Codex Daemon and Status Breathing Design

## Goal

Make all four terminal or waiting task colors breathe softly, and make Grok Bot Pet observe live Codex Desktop approval requests by attaching both applications to the same local App Server daemon.

## Scope

- Completed, failed, interrupted, and waiting task colors use the existing 2.4-second cosine breathing transition between the configured base body color and the full configured status color.
- Reduced-motion mode keeps the full status color steady.
- Grok Bot Pet prefers the Codex local daemon and its Unix socket.
- Grok Bot Pet falls back to its existing private stdio App Server and JSONL inference when the daemon cannot be started or reached.
- Codex Desktop is opted into the shared daemon for the current macOS login session. An already-running Codex Desktop must be restarted once before it can share live approval requests.
- Existing status colors, task selection, animation sequences, and JSONL fallback behavior remain unchanged outside these requirements.

## Architecture

### Status-color behavior

`statusColorBehavior` remains the single policy function for status animation. It returns `breathe` for `completed`, `error`, `stopped`, and `waiting`. The existing renderer effect continues to own the animation frame loop and cancels it whenever the directive or color changes.

### Shared App Server lifecycle

Before opening its normal App Server connection, the Electron main process performs a best-effort shared-daemon preparation on macOS:

1. Publish `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1` to the current launchd user session so subsequently launched Codex Desktop processes choose the daemon transport.
2. Run the discovered Codex CLI with `app-server daemon start` and a short timeout.
3. If daemon startup succeeds, prefer `app-server proxy --sock <CODEX_HOME>/app-server-control/app-server-control.sock`.
4. If preparation or proxy initialization fails, immediately continue with `app-server --listen stdio://`.

The setup is idempotent: repeated starts are allowed, and failure never prevents the pet from using its existing connection path. Non-macOS platforms skip the launchd environment step but may still use a daemon that is already available.

### Approval data flow

When Codex Desktop and Grok Bot Pet share the daemon, the pet resumes active threads through its existing refresh loop. A server-to-client request such as `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput`, or `mcpServer/elicitation/request` reaches the existing `receive` and `handleServerRequest` path. That path changes the matching task to `waiting-input`, sets an approval activity, and emits the overview consumed by the animation director.

When the request resolves, normal App Server status and item notifications move the task out of `waiting-input`. The breathing waiting color therefore lasts for the real request lifetime rather than being inferred from completed JSONL records.

## Failure handling

- Missing or old Codex CLI: daemon preparation fails silently into the existing stdio transport.
- Stale daemon socket: the official `daemon start` command gets the first opportunity to recover it; the pet does not delete socket files itself.
- Daemon startup timeout or non-zero exit: skip the daemon proxy for that CLI candidate and try stdio.
- Proxy initialization failure: retain the existing per-transport cleanup and try stdio.
- Codex Desktop already running with private stdio: keep the pet operational and require one Desktop restart; do not terminate Codex automatically.

## Tests

- Assert every `StatusColorRole` selects breathing behavior.
- Preserve the existing interpolation and reduced-motion assertions.
- Unit-test daemon command planning for macOS and non-macOS.
- Unit-test transport preference after successful and failed daemon preparation.
- Preserve the existing server-request dispatch assertion and add coverage that a representative approval request produces `waiting-input` state through the bridge.
- Run the focused Vitest suites, the full test suite, TypeScript type checks, and the production build.
- Perform a local daemon smoke test, then restart Codex Desktop manually and trigger one harmless approval request to verify the visible waiting state begins before approval and ends after approval.

## Security and compatibility

The integration uses only the Codex CLI daemon and proxy commands shipped with the installed Codex version. It does not read another process's private stdio, patch the Codex application bundle, delete Codex state, or scrape the UI. The launchd variable affects only the current logged-in user's future processes and is limited to the documented internal daemon opt-in variable observed in the installed Codex Desktop build.
