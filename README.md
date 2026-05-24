# Codex plugin for Claude Code

Use Codex from inside Claude Code for code reviews or to delegate tasks to Codex.

This plugin is for Claude Code users who want an easy way to start using Codex from the workflow
they already have.

> [!NOTE]
> **Unbounded fork.** This is a fork of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)
> with every runtime boundary lifted. The behavior is baked into the plugin, so it is the same
> regardless of your `~/.codex/config.toml`:
>
> - **Always-allow / full access** — every Codex thread (task *and* review) runs with `approval_policy = "never"` and `sandbox_mode = "danger-full-access"`, pinned both per-thread and per-turn (`sandboxPolicy: dangerFullAccess`, guarding against [openai/codex#14068](https://github.com/openai/codex/issues/14068)): no approval prompts, full filesystem, full network. Upstream ran reviews read-only and rescue tasks workspace-write (no network).
> - **Reasoning effort** — defaults to `high` (pass `--effort` to override).
> - **Live web search** — the app-server is started with `web_search = "live"`, `tools.web_search.context_size = "high"`, update checks off, and the full-access warning suppressed.
> - **Runtime fluidity** — tool output up to `32k` tokens (less truncation) and background commands up to 15 min (`background_terminal_max_timeout`).
> - **Review context** — the full diff is always inlined (no 2-file / 256 KB / 24 KB truncation), so reviews never fall back to the lightweight "self-collect" summary.
> - **`status --wait`** — waits until the job finishes instead of giving up after 4 minutes (an explicit `--timeout-ms` still wins).
> - **Stop-gate review** — runs up to 24h instead of 15 minutes.
> - **Job retention** — full job history is kept (no 50-job pruning).
> - **`status` display** — every tracked job and all progress lines are shown.

<video src="./docs/plugin-demo.webm" controls muted playsinline autoplay></video>

## What You Get

- `/codex:review` for a Codex code review (full access in this fork, not read-only)
- `/codex:adversarial-review` for a steerable challenge review
- `/codex:it`, `/codex:status`, `/codex:result`, and `/codex:cancel` to delegate work and manage background jobs

## Requirements

- **ChatGPT subscription (incl. Free) or OpenAI API key.**
  - Usage will contribute to your Codex usage limits. [Learn more](https://developers.openai.com/codex/pricing).
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add yigitkonur/codex-plugin-cc
```

Install the plugin:

```bash
/plugin install codex@codex-unbounded
```

> [!IMPORTANT]
> This fork ships the same plugin name (`codex`) so all `/codex:*` commands and the
> `codex:codex-it` subagent keep working. If you already have the official
> `codex@openai-codex` plugin installed, uninstall it first to avoid a duplicate
> `codex` plugin name: `/plugin uninstall codex@openai-codex`.

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/codex:setup
```

`/codex:setup` will tell you whether Codex is ready. If Codex is missing and npm is available, it can offer to install Codex for you.

If you prefer to install Codex yourself, use:

```bash
npm install -g @openai/codex
```

If Codex is installed but not logged in yet, run:

```bash
!codex login
```

After install, you should see:

- the slash commands listed below
- the `codex:codex-it` subagent in `/agents`

One simple first run is:

```bash
/codex:review --background
/codex:status
/codex:result
```

## Usage

### `/codex:review`

Runs a normal Codex review on your current work. It gives you the same quality of code review as running `/review` inside Codex directly.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/codex:adversarial-review`](#codexadversarial-review) when you want to challenge a specific decision or risk area.

Examples:

```bash
/codex:review
/codex:review --base main
/codex:review --background
```

Unlike upstream, this fork runs reviews with full access (`danger-full-access`), so a review **can** modify files or use the network — it is no longer read-only. When run in the background you can use [`/codex:status`](#codexstatus) to check on the progress and [`/codex:cancel`](#codexcancel) to cancel the ongoing task.

### `/codex:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/codex:review`, including `--base <ref>` for branch review.
It also supports `--wait` and `--background`. Unlike `/codex:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/codex:adversarial-review
/codex:adversarial-review --base main challenge whether this was the right caching and retry design
/codex:adversarial-review --background look for race conditions and question the chosen approach
```

In this fork this command runs with full access and is **not** read-only — it can modify code or use the network.

### `/codex:it`

Hands a substantial task to Codex through the `codex:codex-it` subagent — a **live supervisor** (not a thin forwarder) that enqueues Codex with `--background`, polls status until terminal, watches structured transcript markers, and ends with a markdown-table report.

Use it when you want Codex to:

- investigate a bug
- implement a focused fix or refactor
- continue a previous Codex task
- research a question and return cited evidence
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Substantial tasks can run for many minutes. The supervisor uses `--background` and a blocking-poll loop, capped at 45 minutes; on cap it returns a "still running" handback naming the `jobId` so you can resume with `/codex:status` and `/codex:result`.

It supports `--task-spec <path>`, `--worktree=auto|always|off`, `--background`, `--wait`, `--resume`, `--fresh`, `--model`, and `--effort`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest Codex thread for this repo.

#### Quick usage (no spec)

```bash
/codex:it investigate why the tests started failing
/codex:it fix the failing test with the smallest safe patch
/codex:it --resume apply the top fix from the last run
/codex:it --model gpt-5.4-mini --effort medium investigate the flaky integration test
/codex:it --model spark fix the issue quickly
/codex:it --background investigate the regression
```

You can also just ask for a task to be delegated to Codex:

```text
Ask Codex to redesign the database connection to be more resilient.
```

#### Spec-driven usage (recommended for write tasks)

For any task that should produce commits, write a **task spec** first (see the next section). Then dispatch:

```bash
/codex:it --task-spec .agent-docs/tasks/20260524-143521-fix-the-thing.md
```

The supervisor refuses to run write-mode dispatches without a spec — pass one, or use `--worktree=off` and accept that no integration commands will be surfaced.

**Notes:**

- If you do not pass `--model`, Codex chooses its own default; this fork defaults reasoning effort to `high` unless you pass `--effort`.
- If you say `spark`, the plugin maps that to `gpt-5.3-codex-spark`.
- Follow-up requests can continue the latest Codex task in the repo via `--resume`.
- The supervisor's final response is a markdown-table report — surface integration commands per F4 (never auto-merge).

### Task spec files (`.agent-docs/tasks/`)

A task spec is a markdown file with YAML frontmatter that contracts a Codex run. The frontmatter defines `title`, `scope`, `mode` (`write` / `read-only` / `research`), `acceptance` criteria, and optional `issue`, `commit_policy`, `verify_with`, and `timeout`. The body — everything after the closing `---` — becomes the Codex prompt verbatim.

**File naming.** Timestamp-prefixed kebab-case, UTC: `.agent-docs/tasks/YYYYMMDDHHMMSS-<slug>.md`. The timestamp sorts lexically and chronologically, never races under parallel creation, and tells you when the task was authored.

**Minimal write-mode spec:**

```markdown
---
title: Stop poisoning RunFinalizeCheckpoint in stage-finalizing
issue: 2
scope: supabase/functions/stage-finalizing/index.ts
mode: write
acceptance:
  - claimStep insert is removed
  - finalizing_progress events still emit for each step
  - runs.finished_at and finalizing_completed_at still written at the end
  - npm test passes
commit_policy: single
---
Remove the no-op `claimStep` insert in `supabase/functions/stage-finalizing/
index.ts:12-22` so the real finalizer's checkpoint mutex is no longer
poisoned by the edge stub. Preserve the progress-event loop and the final
`runs` update. Add an inline comment naming #2 + #28.
```

**Validation.** Required frontmatter: `title`, `scope`, `mode`. For `mode: write`, `acceptance` must have at least one item. The companion validates against `plugins/codex/schemas/task-spec.schema.json` and exits 2 with structured stderr JSON (`{error, path, missing, invalid}`) on failure — the supervisor surfaces the JSON and stops without inventing missing fields.

**Worktree behavior (F3-refined).** By default (`--worktree=auto`), write-mode dispatches create a fresh git worktree under `<cwd>/.claude/worktrees/codex/<jobId>/` on branch `codex/<YYYYMMDD>-<slug>`, branching from `HEAD` (committed local work included; uncommitted changes excluded). Read-only and research modes stay in-place (no worktree). A pre-flight check refuses creation if uncommitted files overlap the spec's `scope`. `--worktree=always` forces a worktree even for read-only; `--worktree=off` forces in-place even for write.

**Integration (F4 — never auto-merge).** When Codex finishes, the supervisor's final report surfaces the exact commands:

- `git -C <worktree> log --oneline <branch>` — list the commits.
- `git cherry-pick $(git -C <worktree> log --reverse --format=%H <branch> ^HEAD | xargs)` — apply them.
- `git worktree remove <path>` and `git branch -D <branch>` — clean up.

The supervisor never runs these. You (or the orchestrator) decide whether and how to integrate. Stale worktrees older than 7 days get pruned at SessionStart automatically.

### `/codex:status`

Shows running and recent Codex jobs for the current repository.

Examples:

```bash
/codex:status
/codex:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/codex:result`

Shows the final stored Codex output for a finished job.
When available, it also includes the Codex session ID so you can reopen that run directly in Codex with `codex resume <session-id>`.

Examples:

```bash
/codex:result
/codex:result task-abc123
```

### `/codex:cancel`

Cancels an active background Codex job.

Examples:

```bash
/codex:cancel
/codex:cancel task-abc123
```

### `/codex:setup`

Checks whether Codex is installed and authenticated.
If Codex is missing and npm is available, it can offer to install Codex for you.

You can also use `/codex:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/codex:setup --enable-review-gate
/codex:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Codex review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Codex loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/codex:review
```

### Hand A Problem To Codex

```bash
/codex:it investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/codex:adversarial-review --background
/codex:it --background investigate the flaky test
```

Then check in with:

```bash
/codex:status
/codex:result
```

## Codex Integration

The Codex plugin wraps the [Codex app server](https://developers.openai.com/codex/app-server). It uses the global `codex` binary installed in your environment and [applies the same configuration](https://developers.openai.com/codex/config-basic).

### Common Configurations

If you want to change the default reasoning effort or the default model that gets used by the plugin, you can define that inside your user-level or project-level `config.toml`. For example to always use `gpt-5.4-mini` on `high` for a specific project you can add the following to a `.codex/config.toml` file at the root of the directory you started Claude in:

```toml
model = "gpt-5.4-mini"
model_reasoning_effort = "high"
```

Your configuration will be picked up based on:

- user-level config in `~/.codex/config.toml`
- project-level overrides in `.codex/config.toml`
- project-level overrides only load when the [project is trusted](https://developers.openai.com/codex/config-advanced#project-config-files-codexconfigtoml)

Check out the Codex docs for more [configuration options](https://developers.openai.com/codex/config-reference).

### Moving The Work Over To Codex

Delegated tasks and any [stop gate](#what-does-the-review-gate-do) run can also be directly resumed inside Codex by running `codex resume` either with the specific session ID you received from running `/codex:result` or `/codex:status` or by selecting it from the list.

This way you can review the Codex work or continue the work there.

## FAQ

### Do I need a separate Codex account for this plugin?

If you are already signed into Codex on this machine, that account should work immediately here too. This plugin uses your local Codex CLI authentication.

If you only use Claude Code today and have not used Codex yet, you will also need to sign in to Codex with either a ChatGPT account or an API key. [Codex is available with your ChatGPT subscription](https://developers.openai.com/codex/pricing/), and [`codex login`](https://developers.openai.com/codex/cli/reference/#codex-login) supports both ChatGPT and API key sign-in. Run `/codex:setup` to check whether Codex is ready, and use `!codex login` if it is not.

### Does the plugin use a separate Codex runtime?

No. This plugin delegates through your local [Codex CLI](https://developers.openai.com/codex/cli/) and [Codex app server](https://developers.openai.com/codex/app-server/) on the same machine.

That means:

- it uses the same Codex install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Codex config I already have?

Yes. If you already use Codex, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key or base URL setup?

Yes. Because the plugin uses your local Codex CLI, your existing sign-in method and config still apply.

If you need to point the built-in OpenAI provider at a different endpoint, set `openai_base_url` in your [Codex config](https://developers.openai.com/codex/config-advanced/#config-and-state-locations).
