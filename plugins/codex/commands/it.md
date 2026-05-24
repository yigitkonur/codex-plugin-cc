---
description: Hand a substantial Codex job (coding, research, diagnosis, refactor) to the codex-it live supervisor with a task spec or freeform prompt
argument-hint: "[--task-spec <path>] [--worktree=auto|always|off] [--background|--wait] [--resume|--fresh] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh>] [what Codex should do]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `codex:codex-it` subagent via the `Agent` tool (`subagent_type: "codex:codex-it"`), forwarding the raw user request as the prompt.
`codex:codex-it` is a subagent, not a skill — do not call `Skill(codex:codex-it)` (no such skill) or `Skill(codex:it)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
The final user-visible response must be the supervisor's markdown-table report verbatim.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `codex:codex-it` subagent in the background.
- If the request includes `--wait`, run the `codex:codex-it` subagent in the foreground.
- If neither flag is present, default to foreground.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model` and `--effort` are runtime-selection flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- `--task-spec <path>` and `--worktree=auto|always|off` are companion flags. Preserve them for the forwarded `task` call as-is.
- If the request includes `--resume`, do not ask whether to continue. The user already chose.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Codex, check for a resumable codex-it thread from this Claude session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current Codex thread or start a new one.
- The two choices must be:
  - `Continue current Codex thread`
  - `Start a new Codex thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Codex thread (Recommended)` first.
- Otherwise put `Start a new Codex thread (Recommended)` first.
- If the user chooses continue, add `--resume` before routing to the subagent.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a **live supervisor**, not a thin forwarder. It enqueues Codex with `task --background`, polls status, monitors the transcript, and ends with a markdown-table report. The subagent MAY call `status` and `result`; it MUST NOT call `setup`, `review`, `adversarial-review`, or `cancel`.
- Return the supervisor's final markdown-table report verbatim to the user.
- Do not paraphrase, summarize, rewrite, or add commentary before or after it.
- Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort.
- Leave the model unset unless the user explicitly asks for one. If they ask for `spark`, map it to `gpt-5.3-codex-spark`.
- Leave `--task-spec`, `--worktree`, `--resume`, and `--fresh` in the forwarded request. The subagent handles that routing when it builds the `task` command.
- For write-mode runs without a `--task-spec`, the subagent will refuse and ask you to create a spec at `.agent-docs/tasks/<timestamp>-<slug>.md`. Surface that refusal verbatim.
- If the helper reports that Codex is missing or unauthenticated, stop and tell the user to run `/codex:setup`.
- If the user did not supply a request, ask what Codex should do.
