import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Worktree lifecycle for codex-it.
//
// Codex tasks in `write` mode run inside a fresh git worktree under
// `<cwd>/.claude/worktrees/codex/<jobId>/` on a branch `codex/<YYYYMMDD>-<slug>`.
// Worktrees branch from HEAD (not origin/<default>), so committed local work
// is included but uncommitted changes are NOT. The pre-flight check refuses
// to create a worktree if any uncommitted file overlaps the spec's `scope`.
//
// Never auto-merges (per F4). The agent's final report surfaces the exact
// `git cherry-pick` / `git worktree remove` commands; the orchestrator (or
// human) decides whether to integrate.

const WORKTREES_DIR = path.join(".claude", "worktrees", "codex");

export class WorktreeError extends Error {
  constructor({ code, message, details = {} }) {
    super(message);
    this.name = "WorktreeError";
    this.code = code; // "scope-overlap" | "not-a-git-repo" | "branch-collision" | "git-failed"
    this.details = details;
  }
  toJson() {
    return { error: this.code, message: this.message, details: this.details };
  }
}

function gitSync(args, cwd) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (err) {
    const stderr = err.stderr ? String(err.stderr) : "";
    throw new WorktreeError({
      code: "git-failed",
      message: `git ${args.join(" ")} failed${stderr ? ": " + stderr.trim() : ""}`,
      details: { args, stderr }
    });
  }
}

function isGitRepo(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

export function slugifyTitle(title) {
  if (!title) return "task";
  const slug = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "task";
}

function branchExists(branch, cwd) {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return true;
  } catch {
    return false;
  }
}

function uncommittedFiles(cwd) {
  const out = gitSync(["status", "--porcelain"], cwd);
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim().split(" -> ").pop().trim());
}

function scopeOverlaps(uncommitted, scope) {
  if (!scope) return [];
  const scopes = (Array.isArray(scope) ? scope : [scope]).filter(Boolean);
  if (scopes.length === 0) return [];
  return uncommitted.filter((file) =>
    scopes.some((s) => {
      const sNorm = s.replace(/^\.\//, "").replace(/\/$/, "");
      const fNorm = file.replace(/^\.\//, "");
      return fNorm === sNorm || fNorm.startsWith(sNorm + "/") || sNorm.startsWith(fNorm + "/");
    })
  );
}

export function resolveBranchName({ slug, cwd, dateStr = todayUtc() }) {
  const base = `codex/${dateStr}-${slug}`;
  let branch = base;
  let suffix = 2;
  while (branchExists(branch, cwd)) {
    branch = `${base}-${suffix}`;
    suffix++;
    if (suffix > 99) {
      throw new WorktreeError({
        code: "branch-collision",
        message: `too many branch-name collisions for ${base}`,
        details: { base }
      });
    }
  }
  return branch;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

export function resolveWorktreePath({ jobId, cwd }) {
  return path.resolve(cwd, WORKTREES_DIR, jobId);
}

export function createCodexWorktree({ jobId, slug, scope, cwd }) {
  if (!isGitRepo(cwd)) {
    throw new WorktreeError({
      code: "not-a-git-repo",
      message: `not a git repository: ${cwd}`,
      details: { cwd }
    });
  }

  // Pre-flight: refuse if uncommitted files overlap the task scope.
  const overlaps = scopeOverlaps(uncommittedFiles(cwd), scope);
  if (overlaps.length > 0) {
    throw new WorktreeError({
      code: "scope-overlap",
      message: `uncommitted changes in [${overlaps.join(", ")}] overlap with task scope; commit, stash, or set --worktree=off`,
      details: { overlaps, scope: Array.isArray(scope) ? scope : [scope].filter(Boolean) }
    });
  }

  const branch = resolveBranchName({ slug: slugifyTitle(slug), cwd });
  const worktreePath = resolveWorktreePath({ jobId, cwd });
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

  // Branch from HEAD (includes committed local work; excludes uncommitted).
  gitSync(["worktree", "add", "-b", branch, worktreePath, "HEAD"], cwd);

  return { path: worktreePath, branch };
}

// Single-quote a shell value: wrap in '...', escape embedded single quotes
// as '\''.  Safe for paths or branch names with spaces or shell metacharacters.
function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function buildWorktreeFinishCommands({ path: worktreePath, branch }) {
  // Parameter accepts the shape returned by createCodexWorktree: { path, branch }.
  // All interpolated values are single-quoted so the generated commands stay
  // copy-paste safe even when the path contains spaces or shell metacharacters.
  // The cherry-pick form guards the empty-SHA-list case (no commits on the
  // branch yet) so `git cherry-pick` with no args doesn't error.
  const wt = shq(worktreePath);
  const br = shq(branch);
  return {
    listCommits: `git -C ${wt} log --oneline ${br}`,
    cherryPick: `shas=$(git -C ${wt} log --reverse --format=%H ${br} ^HEAD); [ -n "$shas" ] && git cherry-pick $shas || echo "no commits to cherry-pick"`,
    fastForward: `git merge --ff-only ${br}`,
    removeWorktree: `git worktree remove ${wt}`,
    deleteBranch: `git branch -D ${br}`
  };
}

export function pruneStaleWorktrees({ cwd, maxAgeDays = 7 } = {}) {
  const worktreesDir = path.resolve(cwd, WORKTREES_DIR);
  if (!fs.existsSync(worktreesDir)) return { pruned: 0, kept: 0, errors: 0 };
  const entries = fs.readdirSync(worktreesDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let pruned = 0;
  let kept = 0;
  let errors = 0;
  for (const entry of entries) {
    const wtPath = path.join(worktreesDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(wtPath);
    } catch {
      errors++;
      continue;
    }
    if (stat.mtimeMs >= cutoff) {
      kept++;
      continue;
    }
    try {
      execFileSync("git", ["worktree", "remove", "--force", wtPath], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      pruned++;
    } catch {
      try {
        fs.rmSync(wtPath, { recursive: true, force: true });
        pruned++;
      } catch {
        errors++;
      }
    }
  }
  return { pruned, kept, errors };
}
