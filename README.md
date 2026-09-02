<div align="center">
  <h1>Grok Bot Pet</h1>
  <p><strong>An animated macOS desktop companion for Codex.</strong></p>
  <p>See your agent think, search, edit, wait, finish, and fail — without reopening the task window.</p>
  <p><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>
  <p>
    <code>macOS</code> <code>Electron</code> <code>Codex</code> <code>Codex CLI</code>
    <code>desktop pet</code> <code>menu bar app</code> <code>Grok Bot</code>
    <code>SVG animation</code> <code>TypeScript</code>
  </p>
</div>

> [!NOTE]
> Grok Bot Pet is an unofficial community project. Its character concept, visual language, and core animation behavior originate from and are inspired by **Grok Bot**. It is not affiliated with, endorsed by, or sponsored by OpenAI or xAI.

## What it does

Grok Bot Pet turns local Codex activity into an expressive character that lives directly on your macOS desktop. The desktop shows only the pet; tasks, controls, and customization stay in the menu bar.

It observes Codex desktop and CLI activity and reacts to reasoning, searches, commands, file edits, approvals, replies, completion, failure, and interruption.

## Highlights

- Transparent, frameless, draggable, always-on-top desktop character.
- Visible across macOS Spaces and full-screen desktops.
- Task-aware expressions, shapes, colors, particles, ribbons, and motion.
- Menu bar access to current tasks, connection controls, and customization.
- Adjustable size, opacity, body and eye colors, shapes, shadows, badges, animation, and pointer following.
- Read-only observation: it never creates, interrupts, deletes, approves, or replies to a Codex task.
- Local-first: task content is not uploaded to a third-party service.

## Requirements

- macOS 13 or later
- Apple Silicon or Intel Mac
- Codex for macOS, Codex CLI, or a compatible Codex installation

## Install

1. Download the latest Universal `.dmg` or `.zip` from the [GitHub Releases](../../releases) page.
2. Move **Grok Bot Pet.app** to `/Applications`.
3. Open the app and use its icon in the macOS menu bar.

Published release builds are signed with an Apple Developer ID and notarized by Apple. macOS may still show its standard confirmation that the app was downloaded from the internet on first launch.

Share the generated `.dmg` or `.zip`, not a bare `.app`; some chat and cloud services can damage an unpackaged app bundle.

## Using the pet

Click the menu bar icon to view tasks, refresh detection, open Codex, or customize the character. Click the pet for a random interaction, drag it anywhere on the desktop, and let its eyes follow the pointer while idle.

The app uses the local Codex App Server when available and falls back to local Codex session information for CLI visibility. Detection detail can vary by Codex version.

## Run from source

Source builds require a current Node.js LTS release and Xcode Command Line Tools (run `xcode-select --install` if they are not installed). The command-line tools compile the native macOS window bridge.

```bash
npm ci
npm run dev
```

Useful checks and builds:

```bash
npm run typecheck
npm test
npm run build
npm run build:mac
```

## Privacy and limitations

- No task content is uploaded by Grok Bot Pet.
- No screen recording or Accessibility permission is required.
- The app observes tasks but does not control approvals or user input.
- macOS only.
- Automatic updates are not implemented yet; install new releases manually.

## Attribution and intellectual property

The core character animation mechanics originate from Grok Bot and were studied, ported, and reimplemented in TypeScript for this project. This repository does not claim ownership of the Grok Bot character design, visual identity, name, or related trademarks.

**Grok**, **Grok Bot**, xAI, and their related designs and marks belong to their respective rights holders. **Codex**, OpenAI, and their related marks also belong to their respective rights holders.

The [MIT License](LICENSE) applies only to this project's original implementation code. It does **not** grant rights to third-party trademarks, character designs, visual identities, or protected assets. Keep this attribution when redistributing or modifying the project, and review whether your intended use is permitted in your jurisdiction.

See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for the complete notice.

## Disclaimer

- This repository is provided solely for learning and research. It grants no permission for commercial use or redistribution.
- All character designs, names and trademarks, icons, visual elements, geometry data, and any material extracted from application bundles belong to xAI or the applicable rights holders.
- Without express authorization from the applicable rights holders, do not use the above material commercially, redistribute it, or present it publicly as your own trademark, original asset, or work.
