---
name: gpt-5-4-prompting
description: Internal guidance for composing Codex and GPT-5.4 prompts for coding, review, diagnosis, and research tasks inside the Codex Claude Code plugin
user-invocable: false
---

# GPT-5.4 Prompting

Use this skill when `codex:codex-it` needs to ask Codex or another GPT-5.4-based workflow for help.

Prompt Codex like an operator, not a collaborator. Keep prompts compact and block-structured with XML tags. State the task, the output contract, the follow-through defaults, and the small set of extra constraints that matter.

Core rules:
- Prefer one clear task per Codex run. Split unrelated asks into separate runs.
- Tell Codex what done looks like. Do not assume it will infer the desired end state.
- Add explicit grounding and verification rules for any task where unsupported guesses would hurt quality.
- Prefer better prompt contracts over raising reasoning or adding long natural-language explanations.
- Use XML tags consistently so the prompt has stable internal structure.

Default prompt recipe:
- `<task>`: the concrete job and the relevant repository or failure context.
- `<structured_output_contract>` or `<compact_output_contract>`: exact shape, ordering, and brevity requirements.
- `<default_follow_through_policy>`: what Codex should do by default instead of asking routine questions.
- `<verification_loop>` or `<completeness_contract>`: required for debugging, implementation, or risky fixes.
- `<grounding_rules>` or `<citation_rules>`: required for review, research, or anything that could drift into unsupported claims.

When to add blocks:
- Coding or debugging: add `completeness_contract`, `verification_loop`, and `missing_context_gating`.
- Review or adversarial review: add `grounding_rules`, `structured_output_contract`, and `dig_deeper_nudge`.
- Research or recommendation tasks: add `research_mode` and `citation_rules`.
- Write-capable tasks: add `action_safety` so Codex stays narrow and avoids unrelated refactors.

How to choose prompt shape:
- Use built-in `review` or `adversarial-review` commands when the job is reviewing local git changes. Those prompts already carry the review contract.
- Use `task` when the task is diagnosis, planning, research, or implementation and you need to control the prompt more directly.
- Use `task --resume-last` for follow-up instructions on the same Codex thread. Send only the delta instruction instead of restating the whole prompt unless the direction changed materially.

Working rules:
- Prefer explicit prompt contracts over vague nudges.
- Use stable XML tag names that match the block names from the reference file.
- Do not raise reasoning or complexity first. Tighten the prompt and verification rules before escalating.
- Ask Codex for brief, outcome-based progress updates only when the task is long-running or tool-heavy.
- Keep claims anchored to observed evidence. If something is a hypothesis, say so.

Prompt assembly checklist:
1. Define the exact task and scope in `<task>`.
2. Choose the smallest output contract that still makes the answer easy to use.
3. Decide whether Codex should keep going by default or stop for missing high-risk details.
4. Add verification, grounding, and safety tags only where the task needs them.
5. Remove redundant instructions before sending the prompt.

Reusable blocks live in [references/prompt-blocks.md](references/prompt-blocks.md).
Concrete end-to-end templates live in [references/codex-prompt-recipes.md](references/codex-prompt-recipes.md).
Common failure modes to avoid live in [references/codex-prompt-antipatterns.md](references/codex-prompt-antipatterns.md).

## Spec-file recipe (when invoked via `--task-spec`)

When the supervisor is dispatched with a task spec (`.agent-docs/tasks/<ts>-<slug>.md`), the spec body becomes the Codex prompt verbatim. The spec also contracts the task through frontmatter (`title`, `scope`, `mode`, `acceptance`, `commit_policy`). Fold the frontmatter into the prompt as explicit XML blocks so Codex treats them as load-bearing constraints, not advice:

- `<task>` — the spec body verbatim, plus a one-line preamble citing `spec.title` and `spec.scope`.
- `<acceptance>` — one bullet per `spec.acceptance` item, exactly as written.
- `<commit_contract>` — `commit_policy: per-phase` → "Commit after each meaningful phase with a conventional commit message referencing #<spec.issue>"; `commit_policy: single` → "Make exactly one final commit with a conventional message"; in both cases emit `## Phase` markers in the transcript before each commit, plus a final `## Done` marker.
- `<verification_loop>` — "Before finalizing, re-state how each `<acceptance>` item is satisfied with explicit evidence (file:line, test output, or transcript reference)."
- `<scope_safety>` — "Stay within the files/dirs listed in `<task>`'s scope; if work outside scope is unavoidable, write a `## Decision` marker to the transcript explaining why, and surface the divergence in the final summary."

Anti-patterns specific to spec dispatches:

- **Do not paraphrase the spec body.** Pass it through verbatim under `<task>`. The supervisor's verification depends on the spec being the canonical contract.
- **Do not invent acceptance criteria.** If the spec lacks `acceptance:` for a write run, the companion already exited 2 — the supervisor must surface that, not write criteria itself.
