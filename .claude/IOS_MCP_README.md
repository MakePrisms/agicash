# iOS Simulator MCP Setup

This worktree (`feat/ios-scaffold`) is wired with two MCP servers so future
iOS workers can drive Xcode builds + simulator UI through MCP tool calls
instead of fighting with `simctl` + AppleScript.

## Configured MCP servers

Defined in [`.mcp.json`](../.mcp.json):

| Server | Invocation | Purpose |
|---|---|---|
| `XcodeBuildMCP` | `npx -y xcodebuildmcp@latest mcp` | Build, run, install, log-capture, UI-automate, screenshot iOS simulators and devices via Xcode toolchain. |
| `apple-docs` | `npx -y apple-docs-mcp` | Search and fetch Apple developer documentation (UIKit, SwiftUI, Foundation, etc.). |

Both ride on `npx`, so they auto-install on first session start. No manual
provisioning required.

## Tools exposed (XcodeBuildMCP, abridged)

Workflow groups available:

- `project-discovery` — find `.xcodeproj` / `.xcworkspace` / Swift packages
- `simulator` — build, install, launch, terminate apps; tap, swipe, type
- `simulator-management` — list, boot, shutdown, erase sims
- `ui-automation` — describe UI tree, take screenshots, send taps
- `xcode-ide` — open in Xcode, run schemes
- `device` — physical device builds (not used in this scaffold)
- `swift-package` — `swift build` / `swift test`
- `coverage` — code coverage reports
- `debugging` — LLDB attach/eval
- `utilities` — clean, derived data manipulation

Run `npx -y xcodebuildmcp@latest tools` for the full enumerated list.

## Invoking from a worker

Tools appear under the `mcp__XcodeBuildMCP__*` namespace once a fresh Claude
Code session loads in this worktree. Common entry points already pre-allowed
in [`settings.local.json`](settings.local.json):

- `mcp__XcodeBuildMCP__discover_projs` — find Xcode projects under cwd
- `mcp__XcodeBuildMCP__list_sims` — enumerate available simulators
- `mcp__XcodeBuildMCP__build_sim` — build for a simulator
- `mcp__XcodeBuildMCP__build_run_sim` — build + install + launch on a sim
- `mcp__XcodeBuildMCP__session_set_defaults` — pin scheme/sim/workspace for the session
- `mcp__XcodeBuildMCP__screenshot` — capture a sim screenshot
- `mcp__XcodeBuildMCP__start_sim_log_cap` — begin tailing console logs
- `Bash(xcrun simctl:*)` — escape hatch for raw simctl

Other XcodeBuildMCP tools will prompt for permission on first use; accept and
add them here if they recur.

## Booted simulator (current)

| Field | Value |
|---|---|
| Device | iPhone 17 |
| UDID | `D8B557E3-0E01-4193-9129-8A9CF9C5BD00` |
| App bundle ID | `com.makeprisms.agicash` |

Build product (Debug-iphonesimulator):

```
/Users/claude/Library/Developer/Xcode/DerivedData/Agicash-fksuyplfttvvlcfnikxnjvnhmnpf/Build/Products/Debug-iphonesimulator/Agicash.app
```

A `session_set_defaults` call pinning the UDID + scheme is the recommended
first step in any iOS worker session.

## Caveat — MCP load timing

MCP servers are read **once at Claude Code session startup**. If you are
already running an agent in this worktree when these files land, the MCP
will not be loaded for that agent. Spawn a NEW session (e.g. open a fresh
pane / refold the agent) to pick up `XcodeBuildMCP` and `apple-docs`.

The npx invocation will pull `xcodebuildmcp@latest` and `apple-docs-mcp` on
first run; expect a 30-60s startup delay the first time.

## Origin

Pattern lifted verbatim from `~/Murmur/.mcp.json` and
`~/Murmur/.claude/settings.local.json`. iOS-only entries were ported;
Murmur-specific permissions (project paths, design-token web fetches, `gh pr`
helpers, `make` targets) were intentionally excluded.
