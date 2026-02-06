import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Resolve a cwd to the project root, handling git worktrees.
 *
 * 1. If cwd has a .git *file* (worktree), parse gitdir and derive main repo root.
 * 2. If cwd has a .git *directory*, it's already the root.
 * 3. If cwd doesn't exist, return as-is.
 */
export function resolveProjectRoot(cwd: string): string {
  if (!cwd || cwd === "unknown") return cwd;

  const gitPath = path.join(cwd, ".git");

  try {
    const stat = fs.statSync(gitPath);

    if (stat.isFile()) {
      // Worktree: .git is a file containing "gitdir: <path>"
      const content = fs.readFileSync(gitPath, "utf-8").trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (match) {
        const gitdir = match[1];
        // gitdir looks like /path/to/main-repo/.git/worktrees/<name>
        // Strip /.git/worktrees/<name> to get the main repo root
        const worktreeMatch = gitdir.match(/^(.+)\/\.git\/worktrees\/.+$/);
        if (worktreeMatch) {
          return worktreeMatch[1];
        }
      }
      // Couldn't parse, fall through to return cwd
    }

    // .git is a directory — already at root
    return cwd;
  } catch {
    // .git doesn't exist or cwd doesn't exist — return as-is
    return cwd;
  }
}

/**
 * Convert a project root path to a slug for use in output directory names.
 * Strips leading / and replaces remaining / with -
 */
export function projectSlug(projectRoot: string): string {
  return projectRoot.replace(/^\//, "").replace(/\//g, "-");
}

/**
 * Compute the output path for a session's markdown file.
 */
export function outputPath(projectRoot: string, sessionId: string): string {
  const slug = projectSlug(projectRoot);
  return path.join(os.homedir(), ".s2md", "projects", slug, `${sessionId}.md`);
}
