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
