# Changelog

## 1.4.0 — codex-it fork bump

Major rework of the rescue agent into a spec-driven live supervisor.

**Renamed**
- `codex:codex-rescue` → `codex:codex-it` (agent, slash command, all references). The "rescue" framing was too narrow — the agent handles any substantial Codex offload (coding, research, diagnosis, refactor).

**Added — task-spec workflow**
- New `--task-spec <path>` flag on `task` (mutex with `--prompt-file`). Loads `.agent-docs/tasks/<timestamp>-<slug>.md`, validates the YAML frontmatter against `schemas/task-spec.schema.json`, uses the body as the Codex prompt verbatim.
- Frontmatter contract: required `title`, `scope`, `mode` (`write` / `read-only` / `research`); for `mode: write`, `acceptance` is required with at least one criterion. Optional `issue`, `commit_policy`, `verify_with`, `timeout`.
- Validation failures exit with code **2** and a structured stderr JSON (`{error: "spec-validation-failed", path, missing, invalid}`). The supervisor surfaces this and stops — it never invents missing fields.
- `mode: write` in the spec implies `--write` automatically.

**Added — worktree lifecycle**
- New `--worktree=auto|always|off` flag (default `auto`). `auto` creates a worktree iff `mode: write`; `always` forces; `off` keeps in-place.
- Branch: `codex/<YYYYMMDD>-<slug>` from `HEAD` (committed local work included; uncommitted excluded).
- Path: `<cwd>/.claude/worktrees/codex/<jobId>/`.
- Pre-flight check refuses creation when uncommitted files overlap the spec's `scope` — exits 2 with `{error: "scope-overlap", overlaps, scope}` on stderr.
- Branch-name collision suffixing (`-2`, `-3`, …) up to 99.
- Final report surfaces the `git cherry-pick` / `git worktree remove` / `git branch -D` commands (F4 — never auto-merge).
- SessionStart hook prunes stale worktrees older than 7 days; SessionEnd does NOT auto-clean.

**Changed — agent design**
- `codex:codex-it` now uses `tools: Bash, Read, Monitor` (was just `Bash`). It is a **live supervisor**, not a thin forwarder: it enqueues Codex with `--background`, polls `status --json` in a blocking loop, watches structured transcript markers (`## Phase`, `## Decision`, `## Blocker`, `## Done`), cross-references commits against the spec's acceptance criteria, and ends with a markdown-table report.
- Supervisor is hard-capped at 45 minutes per dispatch (or the spec's `timeout`, whichever is shorter). On cap: returns a "still running" handback naming the `jobId`.
- Read-list is bounded — only the spec file, the transcript file, MISSION_PROTOCOL.md sections via `--offset/--limit`, and `git log/diff/show` against the worktree. No grep, no repo enumeration.
- Distilled MISSION_PROTOCOL.md summary inline (commit hygiene, scope, no auto-merge, verification, honest reporting); the agent reads specific sections on demand rather than loading all 456 lines per dispatch.
- The agent MAY call `status` and `result`; it MUST NOT call `setup`, `review`, `adversarial-review`, or `cancel`.

**Added — skills**
- `gpt-5-4-prompting` gains a "Spec-file recipe" section folding spec frontmatter into XML blocks (`<task>`, `<acceptance>`, `<commit_contract>`, `<verification_loop>`, `<scope_safety>`) plus two spec-specific anti-patterns.
- `codex-prompt-recipes` gains a "Spec-Driven Fix & Verify" recipe template.

**Added — schemas**
- `schemas/task-spec.schema.json` — canonical JSON Schema for the task-spec frontmatter (documentation; runtime validation is hand-rolled in `scripts/lib/spec-loader.mjs` with zero new dependencies).

**Added — companion**
- `scripts/lib/spec-loader.mjs` — frontmatter parser + schema-aware validator + `SpecValidationError` with structured `toJson()` shape.
- `scripts/lib/worktree.mjs` — `createCodexWorktree`, `resolveBranchName`, `buildWorktreeFinishCommands`, `pruneStaleWorktrees`, `slugifyTitle`.
- `scripts/session-lifecycle-hook.mjs` SessionStart now calls `pruneStaleWorktrees({ maxAgeDays: 7 })` opportunistically.

**Tests**
- 87 → 111 (+24): 13 spec-loader, 11 worktree. All assertions in `tests/commands.test.mjs` updated for the new agent + skill + command content.
- One pre-existing flake (`tests/git.test.mjs:89` — `.claude/worktrees/agent-test/` untracked-dir fixture; likely affected by user-global `core.excludesfile`) is unrelated to this release.

**Defers (v1.4.1 / v1.5 candidates)**
- Auto-handoff to gpt-5.5 review based on spec `verify_with` criteria (frontmatter field is wired through; the second-stage pipeline is out of scope for v1.4.0).
- PostToolUse commit-message hook to enforce conventional-commit format at the harness layer.
- `appendTranscriptEvent` helper in `tracked-jobs.mjs` (the agent prompt instructs Codex to emit markers itself; companion-side wiring is redundant for MVP).
- Companion-side report file at `.agent-docs/scratchpad/codex-<jobId>-report.md` (the agent's return message IS the report).

## 1.0.0

- Initial version of the Codex plugin for Claude Code.
