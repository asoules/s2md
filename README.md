# s2md

Convert Claude Code sessions to readable Markdown files.

- **Automatic** — Installs as a Claude Code plugin that converts every session on exit
- **Backfill** — One command to convert all your historical sessions
- **Clean output** — Just the conversation by default; opt-in for tool calls and thinking blocks

## Install

### As a Claude Code plugin (recommended)

```bash
claude plugin install s2md
```

This auto-registers a `SessionEnd` hook that converts each session to Markdown when it ends.

### Via npm (for backfill CLI)

```bash
npm install -g s2md
```

Or use without installing:

```bash
npx s2md backfill
```

## Usage

### Backfill historical sessions

```bash
# Convert all sessions
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

1. Reads the session's `.jsonl` transcript from `~/.claude/projects/`
2. Extracts the project root (resolves git worktrees to the main repo)
3. Renders user prompts and assistant responses as Markdown
4. Writes to `~/.s2md/projects/` organized by project

## License

MIT
