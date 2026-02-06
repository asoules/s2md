#!/usr/bin/env node

const command = process.argv[2];

function printUsage() {
  console.log(`s2md — Convert Claude Code sessions to Markdown

Usage:
  s2md backfill [options]     Batch-convert historical sessions
  s2md hook                   Run as SessionEnd hook (reads stdin)
  s2md help                   Show this help

Backfill options:
  --project <path>            Only convert sessions in this project directory
  --force                     Overwrite existing .md files
  --include-tools             Include tool calls in output
  --include-thinking          Include thinking blocks in output

Output:
  Files are written to ~/.s2md/projects/{project-slug}/{session-id}.md
`);
}

async function main() {
  switch (command) {
    case "backfill": {
      const { main: backfillMain } = await import("./backfill");
      await backfillMain();
      break;
    }
    case "hook": {
      const { main: hookMain } = await import("./hook");
      await hookMain();
      break;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main();
