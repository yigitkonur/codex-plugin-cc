---
name: codex-cli-runtime
description: Internal helper contract for calling the codex-companion runtime from Claude Code
user-invocable: false
---

# Codex Runtime

Use this skill only inside the `codex:codex-it` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" <subcommand> [args]`

The `codex:codex-it` agent is a **live supervisor**, not a thin forwarder. It enqueues Codex (`task --background`), polls status until terminal, fetches the result, and cross-references commits against the task spec. It MAY call `status` and `result` (for its supervision loop) but MUST NOT call `setup`, `review`, `adversarial-review`, or `cancel` — those have dedicated `/codex:*` slash commands.

## Subcommand selection

- `task` — for every dispatch (coding, research, diagnosis, fix). Always `--background` so the supervisor can poll.
- `status [--job-id <id>] [--json]` — poll the job state. Use inside the blocking-poll loop.
- `result [--job-id <id>] [--json]` — fetch the final result envelope after a terminal status.
- Forbidden inside `codex:codex-it`: `setup`, `review`, `adversarial-review`, `cancel`.

## `task` flag mappings

- `--task-spec <path>` — load the spec file, validate the frontmatter against `schemas/task-spec.schema.json`, and use the spec body as the prompt verbatim. **Mutex** with `--prompt-file`. On validation failure: exit code 2 + `{"error":"spec-validation-failed", path, missing, invalid}` on stderr (the supervisor surfaces this and stops).
- `--prompt-file <path>` — legacy path: read the file as the prompt with no validation. Mutex with `--task-spec`.
- `--worktree=auto|always|off` — `auto` (default) creates a fresh git worktree iff `mode: write`; `always` forces a worktree regardless of mode; `off` forces in-place. Branches from `HEAD` into `<cwd>/.claude/worktrees/codex/<jobId>/` on `codex/<YYYYMMDD>-<slug>(-N)`. Pre-flight refuses on uncommitted-scope overlap (exit 2 + `{"error":"scope-overlap", overlaps, scope}` on stderr).
- `--transcript <path>` — override the transcript file location. Default: `<cwd>/.agent-docs/scratchpad/codex-<jobId>.md` when a spec was passed; otherwise the legacy plugin-data log file.
- `--background` — required for the supervisor (returns a `jobId` immediately; the supervisor polls).
- `--write` — implied automatically when the spec has `mode: write`; explicit `--write` still works for prompt-only invocations. Default `false`. **v1.4.1 safety gate:** `--write` without `--task-spec` exits 1 with the message `"Write-mode dispatch requires a task spec…"` unless `--worktree=off` is also passed (the documented escape for legacy in-place behavior). The gate lives in the companion's `handleTask` so Sonnet cannot dispatch around it; do **not** attempt to satisfy it by self-authoring a spec file — surface the refusal verbatim and ask the orchestrator to write the spec.
- `--resume-last` / `--resume` — continue the latest Codex thread for this workspace. Strip from natural-language prompt text before forwarding.
- `--fresh` — force a new thread; mutex with `--resume`.
- `--model <model|spark>` — `spark` maps to `gpt-5.3-codex-spark`; otherwise pass through unchanged.
- `--effort none|minimal|low|medium|high|xhigh` — default `high` in this fork; explicit values override.
- `--cwd <path>` — explicit workspace root override.
- `--json` — emit JSON for machine consumption.

## Command selection rules

- Use exactly one `task` invocation per dispatch — the supervisor's polling loop does NOT spawn additional tasks.
- If the forwarded request includes `--background` or `--wait`, those are Claude-side execution controls. The supervisor design assumes `--background`; never strip it.
- If the forwarded request includes `--resume`, strip that token from the natural-language prompt and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token and do not add `--resume-last`.
- `--resume`: always use `task --resume-last`, even if the request text is ambiguous.
- `--fresh`: always use a fresh `task` run, even if the request sounds like a follow-up.

## Safety rules

- Default to write-capable Codex work when the user did not explicitly request read-only behavior.
- Preserve the spec body verbatim when forwarding `--task-spec`. Do not paraphrase.
- Surface stderr verbatim on validation/worktree failure (exit 2). **Do not auto-repair specs** — the supervisor refuses and asks the orchestrator to fix.
- The supervisor does NOT execute integration commands; it surfaces them in the final report (per F4 — never auto-merge).
- The supervisor caps its own wall-clock at 45 minutes (or the spec's `timeout`, whichever is shorter); on cap it returns a "still running" handback that names the `jobId` and the resume instructions.
- The supervisor's read-list is bounded: spec file, transcript file, MISSION_PROTOCOL.md sections via `--offset/--limit`, and `git log/diff/show` against the worktree. No grep, no repo enumeration.
