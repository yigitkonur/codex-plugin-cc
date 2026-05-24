import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorktreeFinishCommands,
  createCodexWorktree,
  pruneStaleWorktrees,
  resolveBranchName,
  resolveWorktreePath,
  slugifyTitle,
  WorktreeError
} from "../plugins/codex/scripts/lib/worktree.mjs";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worktree-"));
  git(["init", "--quiet", "-b", "main"], dir);
  git(["config", "user.email", "test@example.com"], dir);
  git(["config", "user.name", "Test"], dir);
  git(["config", "commit.gpgSign", "false"], dir);
  fs.writeFileSync(path.join(dir, "a.txt"), "v1\n");
  git(["add", "a.txt"], dir);
  git(["commit", "-m", "init"], dir);
  return dir;
}

test("slugifyTitle produces kebab-case, falls back to 'task'", () => {
  assert.equal(slugifyTitle("Fix the Thing"), "fix-the-thing");
  assert.equal(slugifyTitle("  multi   spaces!!  "), "multi-spaces");
  assert.equal(slugifyTitle(""), "task");
  assert.equal(slugifyTitle(undefined), "task");
  assert.equal(slugifyTitle("!!!"), "task");
  // Caps at 40 chars
  const long = slugifyTitle("a".repeat(80));
  assert.equal(long.length, 40);
});

test("resolveWorktreePath returns <cwd>/.claude/worktrees/codex/<jobId>", () => {
  const p = resolveWorktreePath({ jobId: "task-abc", cwd: "/tmp/foo" });
  assert.equal(p, path.resolve("/tmp/foo/.claude/worktrees/codex/task-abc"));
});

test("createCodexWorktree creates a worktree under .claude/worktrees/codex/<jobId>", () => {
  const cwd = mkRepo();
  const result = createCodexWorktree({ jobId: "task-001", slug: "test-fix", cwd });
  assert.equal(result.path, path.join(cwd, ".claude", "worktrees", "codex", "task-001"));
  assert.match(result.branch, /^codex\/\d{8}-test-fix$/);
  assert.ok(fs.existsSync(path.join(result.path, "a.txt")));
  // Branch exists in the parent repo
  const heads = git(["branch", "--list", result.branch], cwd).trim();
  assert.ok(heads.includes(result.branch));
});

test("createCodexWorktree pre-flight refuses when uncommitted files overlap scope", () => {
  const cwd = mkRepo();
  fs.writeFileSync(path.join(cwd, "a.txt"), "dirty\n");
  assert.throws(
    () =>
      createCodexWorktree({
        jobId: "task-002",
        slug: "test",
        scope: "a.txt",
        cwd
      }),
    (err) => err instanceof WorktreeError && err.code === "scope-overlap"
  );
});

test("createCodexWorktree allows uncommitted files outside the spec scope", () => {
  const cwd = mkRepo();
  fs.writeFileSync(path.join(cwd, "b.txt"), "unrelated\n");
  const result = createCodexWorktree({
    jobId: "task-003",
    slug: "test",
    scope: "a.txt",
    cwd
  });
  assert.ok(fs.existsSync(result.path));
});

test("createCodexWorktree refuses on non-git directory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-no-git-"));
  assert.throws(
    () => createCodexWorktree({ jobId: "task-004", slug: "t", cwd: dir }),
    (err) => err instanceof WorktreeError && err.code === "not-a-git-repo"
  );
});

test("resolveBranchName suffixes on collision (codex/<date>-<slug> taken → -2)", () => {
  const cwd = mkRepo();
  // Pre-create the unsuffixed branch
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  git(["branch", `codex/${today}-existing`], cwd);
  const branch = resolveBranchName({ slug: "existing", cwd });
  assert.equal(branch, `codex/${today}-existing-2`);
});

test("buildWorktreeFinishCommands returns the five documented commands, shell-quoted, and pairs with createCodexWorktree's return shape", () => {
  // Accepts { path, branch } (the same shape createCodexWorktree returns).
  const cmds = buildWorktreeFinishCommands({
    path: "/tmp/wt",
    branch: "codex/20260524-test"
  });
  // All interpolated values are single-quoted, including the simple cases.
  assert.equal(cmds.listCommits, "git -C '/tmp/wt' log --oneline 'codex/20260524-test'");
  assert.equal(cmds.fastForward, "git merge --ff-only 'codex/20260524-test'");
  assert.equal(cmds.removeWorktree, "git worktree remove '/tmp/wt'");
  assert.equal(cmds.deleteBranch, "git branch -D 'codex/20260524-test'");
  // Cherry-pick guards the empty-SHA case (no commits → no-op + message).
  assert.match(cmds.cherryPick, /^shas=\$\(git -C '\/tmp\/wt' log --reverse --format=%H 'codex\/20260524-test' \^HEAD\); \[ -n "\$shas" \] && git cherry-pick \$shas \|\| echo "no commits to cherry-pick"$/);
});

test("buildWorktreeFinishCommands shell-quotes paths with spaces and shell metacharacters", () => {
  const cmds = buildWorktreeFinishCommands({
    path: "/Users/Bob's Mac/repo/.claude/worktrees/codex/abc",
    branch: "codex/20260524-fix$thing"
  });
  // Single quote inside the path is escaped as '\''.
  assert.ok(cmds.removeWorktree.includes("'/Users/Bob'\\''s Mac/repo/.claude/worktrees/codex/abc'"));
  // $ in the branch name doesn't get expanded — it's inside single quotes.
  assert.ok(cmds.deleteBranch.endsWith("'codex/20260524-fix$thing'"));
});

test("buildWorktreeFinishCommands consumes createCodexWorktree's return value directly", () => {
  const cwd = mkRepo();
  const wt = createCodexWorktree({ jobId: "task-pair", slug: "pair-test", cwd });
  const cmds = buildWorktreeFinishCommands(wt);
  // No `undefined` in the generated commands.
  for (const cmd of Object.values(cmds)) {
    assert.ok(!cmd.includes("undefined"), `command should not contain "undefined": ${cmd}`);
  }
  // The actual worktree path + branch are present, quoted.
  assert.ok(cmds.removeWorktree.includes(`'${wt.path}'`));
  assert.ok(cmds.deleteBranch.endsWith(`'${wt.branch}'`));
});

test("pruneStaleWorktrees removes directories older than maxAgeDays", () => {
  const cwd = mkRepo();
  // Create a worktree the proper way, then backdate its mtime
  const result = createCodexWorktree({ jobId: "task-stale", slug: "stale", cwd });
  const eightDaysAgo = Date.now() / 1000 - 8 * 24 * 60 * 60;
  fs.utimesSync(result.path, eightDaysAgo, eightDaysAgo);
  // Also create a fresh worktree that should be kept
  const fresh = createCodexWorktree({ jobId: "task-fresh", slug: "fresh", cwd });
  const stats = pruneStaleWorktrees({ cwd, maxAgeDays: 7 });
  assert.equal(stats.pruned, 1);
  assert.equal(stats.kept, 1);
  assert.ok(!fs.existsSync(result.path), "stale worktree should be removed");
  assert.ok(fs.existsSync(fresh.path), "fresh worktree should remain");
});

test("pruneStaleWorktrees is a no-op when the worktrees dir doesn't exist", () => {
  const cwd = mkRepo();
  const stats = pruneStaleWorktrees({ cwd });
  assert.deepEqual(stats, { pruned: 0, kept: 0, errors: 0 });
});

test("createCodexWorktree includes committed local work but not uncommitted", () => {
  const cwd = mkRepo();
  // Add a new committed file
  fs.writeFileSync(path.join(cwd, "committed.txt"), "committed\n");
  git(["add", "committed.txt"], cwd);
  git(["commit", "-m", "add committed"], cwd);
  // Add an uncommitted file
  fs.writeFileSync(path.join(cwd, "uncommitted.txt"), "uncommitted\n");
  // No scope conflict (uncommitted.txt outside any scope)
  const result = createCodexWorktree({ jobId: "task-base", slug: "base-test", cwd });
  // committed file in worktree
  assert.ok(fs.existsSync(path.join(result.path, "committed.txt")));
  // uncommitted file NOT in worktree
  assert.ok(!fs.existsSync(path.join(result.path, "uncommitted.txt")));
});
