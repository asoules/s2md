import * as fs from "fs";
import * as readline from "readline";

export type SessionFormat = "claude" | "pi" | "unknown";

/**
 * Detect whether a JSONL file is a Claude Code or pi session.
 *
 * - Pi sessions start with a `{"type":"session", ...}` header
 * - Claude sessions have entries with `{"type":"user"|"assistant"|"queue-operation", ...}`
 */
export async function detectFormat(jsonlPath: string): Promise<SessionFormat> {
  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let format: SessionFormat = "unknown";

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed);
      const type = obj.type;

      // Pi sessions always start with type: "session"
      if (type === "session" && obj.version !== undefined) {
        format = "pi";
        break;
      }

      // Claude sessions have these top-level types
      if (
        type === "user" ||
        type === "assistant" ||
        type === "queue-operation" ||
        type === "system" ||
        type === "progress" ||
        type === "file-history-snapshot"
      ) {
        format = "claude";
        break;
      }
    } catch {
      // skip
    }
  }

  rl.close();
  input.destroy();
  return format;
}
