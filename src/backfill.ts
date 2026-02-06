import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { convertAndWrite, ConvertOptions } from "./convert";
import { convertPiAndWrite } from "./convert-pi";
import { detectFormat } from "./detect";
import { resolveProjectRoot, outputPath } from "./resolve";

interface BackfillArgs {
  project?: string;
  force: boolean;
  includeTools: boolean;
  includeThinking: boolean;
}

function parseArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = {
    force: false,
    includeTools: false,
    includeThinking: false,
  };

  const startIdx = argv.findIndex((a) => a === "backfill");
  const i0 = startIdx >= 0 ? startIdx + 1 : 2;

  for (let i = i0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") {
      args.force = true;
    } else if (arg === "--include-tools") {
      args.includeTools = true;
    } else if (arg === "--include-thinking") {
      args.includeThinking = true;
    } else if (arg === "--project" && i + 1 < argv.length) {
      args.project = argv[++i];
    }
  }

  return args;
}

function findClaudeJsonlFiles(
  projectsDir: string,
  projectFilter?: string
): string[] {
  const files: string[] = [];

  let dirs: string[];
  if (projectFilter) {
    const resolved = path.resolve(projectFilter);
    if (!fs.existsSync(resolved)) return [];
    dirs = [resolved];
  } else {
    try {
      dirs = fs
        .readdirSync(projectsDir)
        .map((d) => path.join(projectsDir, d))
        .filter((d) => fs.statSync(d).isDirectory());
    } catch {
      return [];
    }
  }

  for (const dir of dirs) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      if (entry.startsWith("agent-")) continue;
      files.push(path.join(dir, entry));
    }
  }

  return files;
}

function findPiJsonlFiles(
  sessionsDir: string,
  projectFilter?: string
): string[] {
  const files: string[] = [];

  if (!fs.existsSync(sessionsDir)) return [];

  let dirs: string[];
  if (projectFilter) {
    const resolved = path.resolve(projectFilter);
    if (!fs.existsSync(resolved)) return [];
    dirs = [resolved];
  } else {
    try {
      dirs = fs
        .readdirSync(sessionsDir)
        .map((d) => path.join(sessionsDir, d))
        .filter((d) => fs.statSync(d).isDirectory());
    } catch {
      return [];
    }
  }

  for (const dir of dirs) {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      files.push(path.join(dir, entry));
    }
  }

  return files;
}

/**
 * Check if output already exists for a JSONL file without doing a full conversion.
 */
async function checkOutputExists(jsonlPath: string): Promise<boolean> {
  const readline = await import("readline");

  const input = fs.createReadStream(jsonlPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  let sessionId: string | undefined;
  let cwd: string | undefined;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);

      // Pi format: session header has id and cwd
      if (obj.type === "session" && obj.id && obj.cwd) {
        sessionId = obj.id;
        cwd = obj.cwd;
        break;
      }

      // Claude format: sessionId and cwd on entries
      if (!sessionId && obj.sessionId) sessionId = obj.sessionId;
      if (!cwd && obj.cwd) cwd = obj.cwd;
      if (sessionId && cwd) break;
    } catch {
      // skip
    }
  }

  rl.close();
  input.destroy();

  if (!sessionId || !cwd) return false;

  const projectRoot = resolveProjectRoot(cwd);
  const outPath = outputPath(projectRoot, sessionId);
  return fs.existsSync(outPath);
}

export async function main() {
  const args = parseArgs(process.argv);

  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");
  const piSessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");

  const claudeFiles = findClaudeJsonlFiles(claudeProjectsDir, args.project);
  const piFiles = findPiJsonlFiles(piSessionsDir, args.project);

  const allFiles = [...claudeFiles, ...piFiles];
  console.log(
    `Found ${allFiles.length} session file(s) (${claudeFiles.length} Claude, ${piFiles.length} pi)`
  );

  const opts: ConvertOptions = {
    includeTools: args.includeTools,
    includeThinking: args.includeThinking,
  };

  let converted = 0;
  let skipped = 0;
  let errors = 0;

  for (const jsonlFile of allFiles) {
    const sessionId = path.basename(jsonlFile, ".jsonl");

    try {
      if (!args.force) {
        const outputExists = await checkOutputExists(jsonlFile);
        if (outputExists) {
          skipped++;
          continue;
        }
      }

      const format = await detectFormat(jsonlFile);

      let outPath: string | null = null;
      if (format === "claude") {
        outPath = await convertAndWrite(jsonlFile, opts);
      } else if (format === "pi") {
        outPath = await convertPiAndWrite(jsonlFile, opts);
      } else {
        skipped++;
        continue;
      }

      if (!outPath) {
        skipped++;
        continue;
      }
      converted++;
      console.log(`  ✓ [${format}] ${sessionId} → ${outPath}`);
    } catch (err) {
      errors++;
      console.error(
        `  ✗ ${sessionId}: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log(
    `\nDone: ${converted} converted, ${skipped} skipped, ${errors} errors`
  );
}

// Run directly if this file is the entry point
if (require.main === module) {
  main();
}
