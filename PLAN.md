# s2md — Claude Code Session-to-Markdown

## What it does

Two modes of operation:

1. **Hook mode** — A `SessionEnd` hook that automatically converts each session's JSONL transcript to Markdown when the session ends.
2. **CLI mode** — A one-time manual command to batch-convert all historical sessions under `~/.claude/projects/`.

## JSONL Format Summary

Each line is a JSON object with a `type` field:

- **`user`** — `message.content` is either a plain string (user prompt) or an array containing `tool_result` blocks
- **`assistant`** — `message.content` is an array of blocks: `text`, `tool_use`, and/or `thinking`
- **`system`**, **`progress`**, **`queue-operation`**, **`file-history-snapshot`** — metadata (skip these)

## Project Path Resolution

The project directory names under `~/.claude/projects/` are **lossy** — dashes replace both `/` and `-` in the real path. You **cannot** reliably reverse the encoding.

The `cwd` field inside each JSONL entry has the actual working directory, but it may be a **git worktree path** rather than the project root. Examples:

| `cwd` (from JSONL) | Actual project root |
|---|---|
| `/home/user/projects/my-app` | `/home/user/projects/my-app` (already root) |
| `~/.worktrees/my-app/session-3` | `/home/user/projects/my-app` (worktree) |
| `/tmp/worktrees/session-10` | `/home/user/projects/my-app` (worktree, deleted) |
| `~/projects/mono/worktrees/feature-x` | `~/projects/mono` (worktree, deleted) |

**Resolution strategy (`resolveProjectRoot(cwd)`):**

1. **`cwd` exists and has a `.git` *file*** → it's a worktree. Parse `gitdir: <path>` from the file, strip `/.git/worktrees/...` suffix to get the main repo root.
2. **`cwd` exists and has a `.git` *directory*** → it's already the project root. Use as-is.
3. **`cwd` doesn't exist** (deleted worktree) → use `cwd` as-is. Still useful context even if unresolvable.

## Hook Input

The `SessionEnd` hook receives JSON on stdin with:

- `session_id` — current session identifier
- `transcript_path` — path to the `.jsonl` file
- `cwd` — current working directory
- `reason` — why the session ended

## Architecture

```
s2md/
├── package.json
├── tsconfig.json
├── src/
│   ├── convert.ts        # Core: JSONL → Markdown conversion logic
│   ├── hook.ts           # Hook entry point: reads stdin, calls convert on single file
│   └── backfill.ts       # CLI entry point: finds & batch-converts all historical sessions
└── .claude/
    └── settings.local.json
```

- **`convert.ts`** — Pure conversion logic. Takes a JSONL file path, returns/writes Markdown. Shared by both modes.
- **`hook.ts`** — Reads the `SessionEnd` JSON from stdin, extracts `transcript_path`, calls `convert`.
- **`backfill.ts`** — Walks `~/.claude/projects/`, finds all `*.jsonl` files (excluding `agent-*` subagent transcripts), skips any that already have a `.md` sibling, and converts the rest.

## CLI Usage

```bash
# Hook mode (called automatically by Claude Code)
echo '{"transcript_path": "..."}' | node dist/hook.js

# Backfill all historical sessions
node dist/backfill.js

# Backfill a specific project directory
node dist/backfill.js --project ~/.claude/projects/-home-user-projects-my-app

# Backfill, overwriting existing .md files
node dist/backfill.js --force

# Include tool calls in output
node dist/backfill.js --include-tools

# Include thinking blocks in output
node dist/backfill.js --include-thinking
```

## Output Location

Markdown files are written to:

```
~/.s2md/projects/{project-slug}/{session-id}.md
```

Where `{project-slug}` is the resolved project root with leading `/` stripped and remaining `/` replaced by `-`. Examples:

```
/home/user/projects/my-app  →  ~/.s2md/projects/home-user-projects-my-app/abc123.md
/home/user/Code/mono        →  ~/.s2md/projects/home-user-Code-mono/def456.md
```

Directories are created as needed.

## Markdown Output Format

```markdown
# Session abc12345-...
**Agent:** claude
**Date:** 2026-02-05
**Project:** /home/user/projects/my-app

---

## User
Hello, can you help me with X?

---

## Assistant
Sure! Let me look at that.

<details>
<summary>🔧 Tool: Bash — `ls -la`</summary>

` ` `
file1.txt
file2.txt
` ` `

</details>

Here's what I found...

---

## User
Great, now do Y.
```

## Key Design Decisions

1. **Thinking blocks** — Only included when `--include-thinking` is passed. Rendered in a collapsed `<details>` section with a `💭 Thinking` header.
2. **Tool use + results** — Only included when `--include-tools` is passed. Pairs each `tool_use` with its matching `tool_result` (matched by `tool_use_id`) and renders as a collapsed `<details>` block showing tool name, input, and output. Without the flag, assistant messages show only `text` (and optionally `thinking`) blocks.
3. **Skip metadata** — Ignore `system`, `progress`, `queue-operation`, `file-history-snapshot` lines
4. **Output location** — Write to `~/.s2md/projects/{project-slug}/{session-id}.md`. Creates directories as needed.
5. **Async hook** — Run as `async: true` so it doesn't block session exit
6. **No dependencies beyond Node** — Use only built-ins (`fs`, `readline`, `path`) — no npm deps needed
7. **Skip subagent transcripts** — Files matching `agent-*.jsonl` are subagent logs; skip them during backfill
8. **Idempotent backfill** — By default, skip sessions that already have a `.md` in `~/.s2md/projects/`; `--force` to overwrite
9. **Project path from `cwd`** — Extract the real project path from the first `user` entry's `cwd` field, then resolve through git worktree detection

## Hook Configuration

Added to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node <path-to-s2md>/dist/hook.js",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Build Steps

1. `npm init` + TypeScript setup
2. Implement `src/convert.ts`:
   - Read + parse JSONL file line by line
   - Extract session metadata: `sessionId`, `cwd` (from first user entry), first timestamp as date, agent (hardcoded to `claude` for now; future: detect from JSONL source)
   - Resolve `cwd` to project root via git worktree detection
   - Build a `tool_use_id → tool_result` lookup map in a first pass
   - Walk entries in order, rendering each user/assistant turn to Markdown
   - Pair `tool_use` blocks with their `tool_result` inline
   - Return the Markdown string
3. Implement `src/hook.ts`:
   - Read hook JSON from stdin
   - Extract `transcript_path`
   - Call `convert()`, write `.md` file to `~/.s2md/projects/...`
4. Implement `src/backfill.ts`:
   - Parse CLI args (`--project`, `--force`)
   - Walk `~/.claude/projects/*/*.jsonl`
   - Skip `agent-*.jsonl` and sessions with existing `.md` (unless `--force`)
   - Call `convert()` for each, report progress
5. Compile with `tsc`
6. Register the hook in `~/.claude/settings.json`
