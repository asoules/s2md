import { convertAndWrite } from "./convert";

/**
 * SessionEnd hook entry point.
 * Reads hook JSON from stdin, extracts transcript_path, converts to markdown.
 */
export async function main() {
  // Read all of stdin
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString("utf-8").trim();

  if (!input) {
    process.stderr.write("s2md hook: no input received on stdin\n");
    process.exit(0);
  }

  let hookData: { transcript_path?: string };
  try {
    hookData = JSON.parse(input);
  } catch {
    process.stderr.write("s2md hook: failed to parse stdin JSON\n");
    process.exit(0);
  }

  const transcriptPath = hookData.transcript_path;
  if (!transcriptPath) {
    process.stderr.write("s2md hook: no transcript_path in input\n");
    process.exit(0);
  }

  try {
    const outPath = await convertAndWrite(transcriptPath);
    if (outPath) {
      process.stderr.write(`s2md: wrote ${outPath}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `s2md hook: conversion failed: ${err instanceof Error ? err.message : err}\n`
    );
  }

  process.exit(0);
}

// Run directly if this file is the entry point
if (require.main === module) {
  main();
}
