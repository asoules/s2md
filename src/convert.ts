import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveProjectRoot, projectSlug, outputPath } from "./resolve";

// ── JSONL types ──────────────────────────────────────────────────────────────

interface JournalEntry {
  type: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  message?: Message;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  toolUseResult?: ToolResultContent[];
  sourceToolAssistantUUID?: string;
  // assistant-specific
  requestId?: string;
}

interface Message {
  role: string;
  content: string | ContentBlock[];
  model?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | ToolResultContent[];
}

interface ToolResultContent {
  type: string;
  text?: string;
}

// ── Options ──────────────────────────────────────────────────────────────────

export interface ConvertOptions {
  includeTools?: boolean;
  includeThinking?: boolean;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

async function parseJSONL(filePath: string): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const input = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

// ── Metadata extraction ─────────────────────────────────────────────────────

interface SessionMeta {
  sessionId: string;
  cwd: string;
  projectRoot: string;
  date: string;
  agent: string;
}

function extractMeta(entries: JournalEntry[]): SessionMeta {
  let sessionId = "unknown";
  let cwd = "unknown";
  let date = "unknown";

  for (const e of entries) {
    if (e.sessionId && sessionId === "unknown") sessionId = e.sessionId;
    if (e.cwd && cwd === "unknown") cwd = e.cwd;
    if (e.timestamp && date === "unknown") {
      date = e.timestamp.slice(0, 10); // YYYY-MM-DD
    }
    if (sessionId !== "unknown" && cwd !== "unknown" && date !== "unknown")
      break;
  }

  const projectRoot = resolveProjectRoot(cwd);

  return { sessionId, cwd, projectRoot, date, agent: "claude" };
}

// ── Tool result lookup ──────────────────────────────────────────────────────

function buildToolResultMap(
  entries: JournalEntry[]
): Map<string, string> {
  const map = new Map<string, string>();

  for (const e of entries) {
    if (e.type !== "user") continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== "tool_result" || !block.tool_use_id) continue;

      let resultText: string;
      if (typeof block.content === "string") {
        resultText = block.content;
      } else if (Array.isArray(block.content)) {
        resultText = block.content
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text!)
          .join("\n");
      } else if (e.toolUseResult) {
        resultText = e.toolUseResult
          .filter((c) => c.type === "text" && c.text)
          .map((c) => c.text!)
          .join("\n");
      } else {
        resultText = "(no output)";
      }

      map.set(block.tool_use_id, resultText);
    }
  }

  return map;
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function toolSummary(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") {
    const cmd = input.command as string | undefined;
    return cmd ? `Bash — \`${cmd}\`` : "Bash";
  }
  if (name === "Read") {
    return `Read — \`${input.file_path ?? ""}\``;
  }
  if (name === "Write") {
    return `Write — \`${input.file_path ?? ""}\``;
  }
  if (name === "Edit") {
    return `Edit — \`${input.file_path ?? ""}\``;
  }
  if (name === "Glob") {
    return `Glob — \`${input.pattern ?? ""}\``;
  }
  if (name === "Grep") {
    return `Grep — \`${input.pattern ?? ""}\``;
  }
  if (name === "Task") {
    const desc = (input.description as string) || (input.prompt as string) || "";
    const short = desc.length > 60 ? desc.slice(0, 57) + "..." : desc;
    return `Task — ${short}`;
  }
  if (name === "WebFetch") {
    return `WebFetch — \`${input.url ?? ""}\``;
  }
  if (name === "WebSearch") {
    return `WebSearch — \`${input.query ?? ""}\``;
  }
  // MCP or unknown tools
  return name;
}

function truncate(text: string, max: number = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n... (truncated)";
}

function renderToolBlock(
  block: ContentBlock,
  toolResults: Map<string, string>
): string {
  const name = block.name ?? "Unknown";
  const input = block.input ?? {};
  const summary = toolSummary(name, input);
  const result = block.id ? toolResults.get(block.id) ?? "(no output)" : "(no output)";

  const lines: string[] = [];
  lines.push(`<details>`);
  lines.push(`<summary>🔧 ${summary}</summary>`);
  lines.push("");

  // Show input for non-Bash tools (Bash command is already in the summary)
  if (name !== "Bash") {
    const inputStr = JSON.stringify(input, null, 2);
    if (inputStr !== "{}") {
      lines.push("**Input:**");
      lines.push("```json");
      lines.push(truncate(inputStr));
      lines.push("```");
      lines.push("");
    }
  }

  lines.push("**Output:**");
  lines.push("```");
  lines.push(truncate(result));
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  return lines.join("\n");
}

function renderAssistant(
  entry: JournalEntry,
  toolResults: Map<string, string>,
  opts: ConvertOptions
): string | null {
  const content = entry.message?.content;
  if (!content || !Array.isArray(content)) return null;

  const parts: string[] = [];

  for (const block of content) {
    if (block.type === "thinking" && opts.includeThinking && block.thinking) {
      parts.push("<details>");
      parts.push("<summary>💭 Thinking</summary>");
      parts.push("");
      parts.push(block.thinking);
      parts.push("");
      parts.push("</details>");
      parts.push("");
    } else if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "tool_use" && opts.includeTools) {
      parts.push(renderToolBlock(block, toolResults));
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function renderUser(entry: JournalEntry): string | null {
  const content = entry.message?.content;
  if (!content) return null;

  // Plain string prompt
  if (typeof content === "string") {
    return content;
  }

  // Array: skip tool_result entries (those are internal plumbing)
  // Only render if there's actual user text
  const textParts = content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!);

  if (textParts.length === 0) return null;
  return textParts.join("\n");
}

// ── Main convert function ───────────────────────────────────────────────────

export async function convert(
  jsonlPath: string,
  opts: ConvertOptions = {}
): Promise<{ markdown: string; meta: SessionMeta } | null> {
  const entries = await parseJSONL(jsonlPath);
  const meta = extractMeta(entries);

  // Skip sessions with no conversation content
  const hasConversation = entries.some(
    (e) =>
      (e.type === "user" && e.message?.content && typeof e.message.content === "string") ||
      (e.type === "assistant" &&
        Array.isArray(e.message?.content) &&
        e.message!.content.some((b) => b.type === "text" && b.text))
  );
  if (!hasConversation) return null;

  const toolResults = opts.includeTools
    ? buildToolResultMap(entries)
    : new Map<string, string>();

  const sections: string[] = [];

  // Header
  sections.push(`# Session ${meta.sessionId}`);
  sections.push(`**Agent:** ${meta.agent}`);
  sections.push(`**Date:** ${meta.date}`);
  sections.push(`**Project:** ${meta.projectRoot}`);
  sections.push("");

  // Track last role to avoid duplicate headers
  let lastRole: string | null = null;

  for (const entry of entries) {
    // Skip non-conversation entries
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    // Skip sidechain messages
    if (entry.isSidechain) continue;

    if (entry.type === "user") {
      const text = renderUser(entry);
      if (!text) continue;

      sections.push("---");
      sections.push("");
      sections.push("## User");
      sections.push("");
      sections.push(text);
      sections.push("");
      lastRole = "user";
    } else if (entry.type === "assistant") {
      const text = renderAssistant(entry, toolResults, opts);
      if (!text) continue;

      // Only add header if last wasn't also assistant
      // (multiple assistant entries can happen with tool calls in between)
      if (lastRole !== "assistant") {
        sections.push("---");
        sections.push("");
        sections.push("## Assistant");
        sections.push("");
      }

      sections.push(text);
      sections.push("");
      lastRole = "assistant";
    }
  }

  return { markdown: sections.join("\n"), meta };
}

// ── Write helper ─────────────────────────────────────────────────────────────

export async function convertAndWrite(
  jsonlPath: string,
  opts: ConvertOptions = {}
): Promise<string | null> {
  const result = await convert(jsonlPath, opts);
  if (!result) return null;

  const { markdown, meta } = result;
  const outPath = outputPath(meta.projectRoot, meta.sessionId);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, markdown, "utf-8");
  return outPath;
}
