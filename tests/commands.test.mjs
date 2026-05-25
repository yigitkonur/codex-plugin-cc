import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /does not support staged-only review, unstaged-only review, or extra focus text/i);
});

test("adversarial review command uses AskUserQuestion and background Bash while staying review-only", () => {
  const source = read("commands/adversarial-review.md");
  assert.match(source, /AskUserQuestion/);
  assert.match(source, /\bBash\(/);
  assert.match(source, /Do not fix issues/i);
  assert.match(source, /review-only/i);
  assert.match(source, /return Codex's output verbatim to the user/i);
  assert.match(source, /```bash/);
  assert.match(source, /```typescript/);
  assert.match(source, /adversarial-review "\$ARGUMENTS"/);
  assert.match(source, /\[--scope auto\|working-tree\|branch\] \[focus \.\.\.\]/);
  assert.match(source, /run_in_background:\s*true/);
  assert.match(source, /command:\s*`node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/codex-companion\.mjs" adversarial-review "\$ARGUMENTS"`/);
  assert.match(source, /description:\s*"Codex adversarial review"/);
  assert.match(source, /Do not call `BashOutput`/);
  assert.match(source, /Return the command stdout verbatim, exactly as-is/i);
  assert.match(source, /git status --short --untracked-files=all/);
  assert.match(source, /git diff --shortstat/);
  assert.match(source, /Treat untracked files or directories as reviewable work/i);
  assert.match(source, /Recommend waiting only when the scoped review is clearly tiny, roughly 1-2 files total/i);
  assert.match(source, /In every other case, including unclear size, recommend background/i);
  assert.match(source, /The companion script parses `--wait` and `--background`/i);
  assert.match(source, /Claude Code's `Bash\(..., run_in_background: true\)` is what actually detaches the run/i);
  assert.match(source, /When in doubt, run the review/i);
  assert.match(source, /\(Recommended\)/);
  assert.match(source, /uses the same review target selection as `\/codex:review`/i);
  assert.match(source, /supports working-tree review, branch review, and `--base <ref>`/i);
  assert.match(source, /does not support `--scope staged` or `--scope unstaged`/i);
  assert.match(source, /can still take extra focus text after the flags/i);
});

test("continue is not exposed as a user-facing command", () => {
  const commandFiles = fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).sort();
  assert.deepEqual(commandFiles, [
    "adversarial-review.md",
    "cancel.md",
    "it.md",
    "result.md",
    "review.md",
    "setup.md",
    "status.md"
  ]);
});

test("codex-it command absorbs continue semantics", () => {
  const rescue = read("commands/it.md");
  const agent = read("agents/codex-it.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const runtimeSkill = read("skills/codex-cli-runtime/SKILL.md");

  assert.match(rescue, /The final user-visible response must be the supervisor's markdown-table report verbatim/i);
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Agent/);
  // Regression for #234: `Skill(codex:it)` from the main agent recursed
  // because it.md (formerly rescue.md) named the routing with ambiguous prose ("Route this
  // request to the `codex:codex-it` subagent") while running under
  // `context: fork` — forked general-purpose subagents do not expose the
  // `Agent` tool, so the fork fell back to `Skill` and re-entered this
  // command. Pin the explicit transport and the inline (no-fork) execution.
  assert.match(rescue, /subagent_type: "codex:codex-it"/);
  assert.match(rescue, /do not call `Skill\(codex:codex-it\)`/i);
  assert.doesNotMatch(rescue, /^context:\s*fork\b/m);
  assert.match(rescue, /--background\|--wait/);
  assert.match(rescue, /--resume\|--fresh/);
  assert.match(rescue, /--model <model\|spark>/);
  assert.match(rescue, /--effort <none\|minimal\|low\|medium\|high\|xhigh>/);
  assert.match(rescue, /task-resume-candidate --json/);
  assert.match(rescue, /AskUserQuestion/);
  assert.match(rescue, /Continue current Codex thread/);
  assert.match(rescue, /Start a new Codex thread/);
  assert.match(rescue, /run the `codex:codex-it` subagent in the background/i);
  assert.match(rescue, /default to foreground/i);
  assert.match(rescue, /Do not forward them to `task`/i);
  assert.match(rescue, /`--model` and `--effort` are runtime-selection flags/i);
  assert.match(rescue, /Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort/i);
  assert.match(rescue, /If they ask for `spark`, map it to `gpt-5\.3-codex-spark`/i);
  assert.match(rescue, /If the request includes `--resume`, do not ask whether to continue/i);
  assert.match(rescue, /If the request includes `--fresh`, do not ask whether to continue/i);
  assert.match(rescue, /If the user chooses continue, add `--resume`/i);
  assert.match(rescue, /If the user chooses a new thread, add `--fresh`/i);
  // commands/it.md — live supervisor framing (was: thin forwarder)
  assert.match(rescue, /live supervisor/i);
  assert.match(rescue, /not a thin forwarder/i);
  assert.match(rescue, /supervisor's final markdown-table report verbatim/i);
  assert.match(rescue, /Do not paraphrase, summarize, rewrite, or add commentary/i);
  assert.match(rescue, /Leave `--task-spec`, `--worktree`, `--resume`, and `--fresh`/);
  assert.match(rescue, /--task-spec <path>/);
  assert.match(rescue, /--worktree=auto\|always\|off/);

  // agents/codex-it.md — live supervisor contract
  assert.match(agent, /tools:\s*Bash,\s*Read,\s*Monitor/);
  assert.match(agent, /live supervisor/i);
  assert.match(agent, /blocking[- ]poll/i);
  assert.match(agent, /MISSION_PROTOCOL\.md/);
  assert.match(agent, /45[- ]minute cap/i);
  assert.match(agent, /markdown[- ]table/i);
  assert.match(agent, /bypassPermissions/);
  assert.match(agent, /never auto-merge|never auto-merges/i);
  assert.match(agent, /spec\.acceptance/);
  assert.match(agent, /git cherry-pick/);
  assert.match(agent, /git worktree remove/);
  assert.match(agent, /Hard read-list rule|read-list rule/i);
  assert.match(agent, /scope-overlap/);
  assert.match(agent, /spec-validation-failed/);
  assert.match(agent, /gpt-5-4-prompting/);
  assert.match(agent, /poll[- ]loop|poll loop|blocking polling loop/i);
  assert.match(agent, /spark.*gpt-5\.3-codex-spark|gpt-5\.3-codex-spark.*spark/);
  assert.match(agent, /still running.*handback|handback.*still.running/i);

  // v1.4.2 doc-lint — agent + skill must carry the "do not elaborate flags"
  // rule that closes the v1.4.1 T2 dogfood failure (Sonnet self-added
  // --write + --worktree=off on a freeform prompt). Patterns kept loose so
  // markdown formatting (**bold**) inside the phrases doesn't break the
  // assertion; the goal is to catch silent rule removal, not exact wording.
  assert.match(agent, /do not elaborate flags/i);
  assert.match(agent, /NEVER ADD[^.]{0,30}flag/i);
  assert.match(agent, /did NOT pass[^.]{0,10}`--write`/i);
  assert.match(agent, /do not infer it/i);
  assert.match(runtimeSkill, /v1\.4\.2|never add flags the user did not|do not elaborate flags/i);

  // skills/codex-cli-runtime — new flag mappings + supervisor model
  assert.match(runtimeSkill, /live supervisor.{0,8}not a thin forwarder/i);
  assert.match(runtimeSkill, /MAY call `status` and `result`/i);
  assert.match(runtimeSkill, /MUST NOT call `setup`, `review`, `adversarial-review`, or `cancel`/i);
  assert.match(runtimeSkill, /--task-spec <path>/);
  assert.match(runtimeSkill, /--worktree=auto\|always\|off/);
  assert.match(runtimeSkill, /--transcript <path>/);
  assert.match(runtimeSkill, /spec-validation-failed/);
  assert.match(runtimeSkill, /scope-overlap/);
  assert.match(runtimeSkill, /Mutex\*\* with `--prompt-file`|Mutex with `--prompt-file`/);
  assert.match(runtimeSkill, /mode: write/);
  assert.match(runtimeSkill, /Map `spark` to `--model gpt-5\.3-codex-spark`|spark.*gpt-5\.3-codex-spark/);
  assert.match(runtimeSkill, /--effort none\|minimal\|low\|medium\|high\|xhigh/);
  assert.match(runtimeSkill, /Default to write-capable Codex work/i);
  assert.match(runtimeSkill, /45 minutes|45-min/);
  assert.match(runtimeSkill, /Do not auto-repair|auto-repair specs/i);
  assert.match(readme, /`codex:codex-it` subagent/i);
  assert.match(readme, /this fork defaults reasoning effort to `high` unless you pass `--effort`/i);
  assert.match(readme, /--model gpt-5\.4-mini --effort medium/i);
  assert.match(readme, /`spark`, the plugin maps that to `gpt-5\.3-codex-spark`/i);
  assert.match(readme, /continue a previous Codex task/i);
  assert.match(readme, /### `\/codex:setup`/);
  assert.match(readme, /### `\/codex:review`/);
  assert.match(readme, /### `\/codex:adversarial-review`/);
  assert.match(readme, /uses the same review target selection as `\/codex:review`/i);
  assert.match(readme, /--base main challenge whether this was the right caching and retry design/);
  assert.match(readme, /### `\/codex:it`/);
  assert.match(readme, /### `\/codex:status`/);
  assert.match(readme, /### `\/codex:result`/);
  assert.match(readme, /### `\/codex:cancel`/);
});

test("result and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  const resultHandling = read("skills/codex-result-handling/SKILL.md");

  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /codex-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /codex-companion\.mjs" cancel "\$ARGUMENTS"/);
  assert.match(resultHandling, /do not turn a failed or incomplete Codex run into a Claude-side implementation attempt/i);
  assert.match(resultHandling, /if Codex was never successfully invoked, do not generate a substitute answer at all/i);
});

test("internal docs use task terminology for codex-it dispatches", () => {
  const runtimeSkill = read("skills/codex-cli-runtime/SKILL.md");
  const promptingSkill = read("skills/gpt-5-4-prompting/SKILL.md");
  const promptRecipes = read("skills/gpt-5-4-prompting/references/codex-prompt-recipes.md");

  assert.match(runtimeSkill, /codex-companion\.mjs" <subcommand>/);
  assert.match(runtimeSkill, /for every dispatch/i);
  assert.match(runtimeSkill, /task --resume-last/i);
  assert.match(runtimeSkill, /task --background/i);
  assert.match(promptingSkill, /Use `task` when the task is diagnosis/i);
  assert.match(promptingSkill, /Spec-file recipe/i);
  assert.match(promptingSkill, /Do not paraphrase the spec body/i);
  assert.match(promptRecipes, /Codex task prompts/i);
  assert.match(promptRecipes, /Use these as starting templates for Codex task prompts/i);
  assert.match(promptRecipes, /## Diagnosis/);
  assert.match(promptRecipes, /## Narrow Fix/);
  assert.match(promptRecipes, /## Spec-Driven Fix & Verify/);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command can offer Codex install and still points users to codex login", () => {
  const setup = read("commands/setup.md");
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

  assert.match(setup, /argument-hint:\s*'\[--enable-review-gate\|--disable-review-gate\]'/);
  assert.match(setup, /AskUserQuestion/);
  assert.match(setup, /npm install -g @openai\/codex/);
  assert.match(setup, /codex-companion\.mjs" setup --json \$ARGUMENTS/);
  assert.match(readme, /!codex login/);
  assert.match(readme, /offer to install Codex for you/i);
  assert.match(readme, /\/codex:setup --enable-review-gate/);
  assert.match(readme, /\/codex:setup --disable-review-gate/);
});
