# s2md

Convert coding agent sessions to readable Markdown files.

Supports **Claude Code** and **pi** session formats.

- **Automatic** — Converts every session on exit via hooks/extensions
- **Backfill** — One command to convert all your historical sessions from both agents
- **Clean output** — Just the conversation by default; opt-in for tool calls and thinking blocks

## Install

### 1. Install the CLI

```bash
npm install -g s2md
```

Or use without installing:

```bash
npx s2md backfill
```

### 2. Set up automatic conversion

#### Claude Code

Add a `SessionEnd` hook to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "s2md hook",
            "async": true,
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

#### pi

Create `~/.pi/agent/extensions/s2md.ts`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "child_process";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", async (_event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    try {
      execSync("s2md hook", {
        input: JSON.stringify({ transcript_path: sessionFile }),
        timeout: 30000,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      // Don't block shutdown on conversion errors
    }
  });
}
```

## Usage

### Backfill historical sessions

```bash
# Convert all sessions (Claude Code + pi)
s2md backfill

# Convert a specific project
s2md backfill --project ~/.claude/projects/-home-user-Code-my-app

# Overwrite existing files
s2md backfill --force

# Include tool calls (Bash, Read, Write, etc.)
s2md backfill --include-tools

# Include thinking blocks
s2md backfill --include-thinking
```

### Session sources

| Agent | Location |
|---|---|
| Claude Code | `~/.claude/projects/` |
| pi | `~/.pi/agent/sessions/` |

The format is auto-detected from the JSONL content.

### Output

Files are written to:

```
~/.s2md/projects/{project-slug}/{session-id}.md
```

For example:

```
~/.s2md/projects/home-user-Code-my-app/abc12345-1234-5678-9abc-def012345678.md
```

### Output format

```markdown
# Session abc12345-...
**Agent:** claude
**Date:** 2026-02-05
**Project:** /home/user/Code/my-app

---

## User

Can you help me refactor the auth module?

---

## Assistant

Sure! Let me take a look at the current implementation.

...
```

The `Agent` field is `claude` or `pi` depending on the session source.

With `--include-tools`, tool calls appear as collapsed blocks:

```markdown
<details>
<summary>🔧 Bash — `npm test`</summary>

**Output:**
...
</details>
```

With `--include-thinking`, thinking blocks appear as:

```markdown
<details>
<summary>💭 Thinking</summary>

...
</details>
```

## How it works

1. Reads session `.jsonl` transcripts from `~/.claude/projects/` and `~/.pi/agent/sessions/`
2. Auto-detects the format (Claude Code vs pi)
3. Extracts the project root (resolves git worktrees to the main repo)
4. Renders user prompts and assistant responses as Markdown
5. Writes to `~/.s2md/projects/` organized by project

## License

MIT
