import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { resolveProjectRoot, projectSlug, outputPath } from "./resolve";
import { ConvertOptions } from "./convert";

// ── Pi JSONL types ───────────────────────────────────────────────────────────

interface PiEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  // session header
  version?: number;
  cwd?: string;
  // message
  message?: PiMessage;
  // model_change
  provider?: string;
  modelId?: string;
  // compaction
  summary?: string;
  tokensBefore?: number;
}

interface PiMessage {
  role: string;
  content?: string | PiContentBlock[];
  timestamp?: number;
  // assistant
  provider?: string;
  model?: string;
  stopReason?: string;
  // toolResult
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: unknown;
  // bashExecution
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
  excludeFromContext?: boolean;
}

interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

// ── Metadata ─────────────────────────────────────────────────────────────────

interface SessionMeta {
  sessionId: string;
  cwd: string;
  projectRoot: string;
  date: string;
  agent: string;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

async function parseJSONL(filePath: string): Promise<PiEntry[]> {
  const entries: PiEntry[] = [];
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

function extractMeta(entries: PiEntry[]): SessionMeta {
  let sessionId = "unknown";
  let cwd = "unknown";
  let date = "unknown";

  // Session header is always first
  const header = entries.find((e) => e.type === "session");
  if (header) {
    if (header.id) sessionId = header.id;
    if (header.cwd) cwd = header.cwd;
    if (header.timestamp) date = header.timestamp.slice(0, 10);
  }

  const projectRoot = resolveProjectRoot(cwd);

  return { sessionId, cwd, projectRoot, date, agent: "pi" };
}

// ── Tool result lookup ──────────────────────────────────────────────────────

function buildToolResultMap(entries: PiEntry[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const e of entries) {
    if (e.type !== "message") continue;
    const msg = e.message;
    if (!msg || msg.role !== "toolResult") continue;

    const callId = msg.toolCallId;
    if (!callId) continue;

    const content = msg.content;
    let text: string;
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text!)
        .join("\n");
    } else {
      text = "(no output)";
    }

    map.set(callId, text);
  }

  return map;
}

// ── Markdown rendering ──────────────────────────────────────────────────────

function toolSummary(
  name: string,
  args: Record<string, unknown>
): string {
  if (name === "bash") {
    const cmd = args.command as string | undefined;
    return cmd ? `Bash — \`${cmd}\`` : "Bash";
  }
  if (name === "read") {
    return `Read — \`${args.path ?? ""}\``;
  }
  if (name === "write") {
    return `Write — \`${args.path ?? ""}\``;
  }
  if (name === "edit") {
    return `Edit — \`${args.path ?? ""}\``;
  }
  if (name === "grep") {
    return `Grep — \`${args.pattern ?? ""}\``;
  }
  if (name === "find") {
    return `Find — \`${args.pattern ?? ""}\``;
  }
  if (name === "ls") {
    return `Ls — \`${args.path ?? ""}\``;
  }
  return name;
}

function truncate(text: string, max: number = 2000): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n... (truncated)";
}

function renderToolBlock(
  block: PiContentBlock,
  toolResults: Map<string, string>
): string {
  const name = block.name ?? "Unknown";
  const args = block.arguments ?? {};
  const summary = toolSummary(name, args);
  const result = block.id
    ? toolResults.get(block.id) ?? "(no output)"
    : "(no output)";

  const lines: string[] = [];
  lines.push(`<details>`);
  lines.push(`<summary>🔧 ${summary}</summary>`);
  lines.push("");

  if (name !== "bash") {
    const inputStr = JSON.stringify(args, null, 2);
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
  entry: PiEntry,
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
    } else if (block.type === "text" && block.text?.trim()) {
      parts.push(block.text);
    } else if (block.type === "toolCall" && opts.includeTools) {
      parts.push(renderToolBlock(block, toolResults));
    }
  }

  if (parts.length === 0) return null;
  return parts.join("\n\n");
}

function renderUser(entry: PiEntry): string | null {
  const content = entry.message?.content;
  if (!content) return null;

  if (typeof content === "string") {
    return content;
  }

  const textParts = content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!);

  if (textParts.length === 0) return null;
  return textParts.join("\n");
}

// ── Main convert function ───────────────────────────────────────────────────

export async function convertPi(
  jsonlPath: string,
  opts: ConvertOptions = {}
): Promise<{ markdown: string; meta: SessionMeta } | null> {
  const entries = await parseJSONL(jsonlPath);
  const meta = extractMeta(entries);

  // Skip sessions with no conversation content
  const hasConversation = entries.some(
    (e) =>
      e.type === "message" &&
      ((e.message?.role === "user" && e.message?.content) ||
        (e.message?.role === "assistant" &&
          Array.isArray(e.message?.content) &&
          e.message!.content.some((b) => b.type === "text" && b.text?.trim())))
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

  let lastRole: string | null = null;

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const role = entry.message?.role;

    if (role === "user") {
      const text = renderUser(entry);
      if (!text) continue;

      sections.push("---");
      sections.push("");
      sections.push("## User");
      sections.push("");
      sections.push(text);
      sections.push("");
      lastRole = "user";
    } else if (role === "assistant") {
      const text = renderAssistant(entry, toolResults, opts);
      if (!text) continue;

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
    // Skip toolResult, bashExecution — they're rendered inline via tool blocks
  }

  return { markdown: sections.join("\n"), meta };
}

// ── Write helper ─────────────────────────────────────────────────────────────

export async function convertPiAndWrite(
  jsonlPath: string,
  opts: ConvertOptions = {}
): Promise<string | null> {
  const result = await convertPi(jsonlPath, opts);
  if (!result) return null;

  const { markdown, meta } = result;
  const outPath = outputPath(meta.projectRoot, meta.sessionId);
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, markdown, "utf-8");
  return outPath;
}
