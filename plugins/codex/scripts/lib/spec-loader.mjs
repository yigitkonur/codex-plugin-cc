import fs from "node:fs";
import path from "node:path";

// Spec-loader for codex-it task specs (`.agent-docs/tasks/<ts>-<slug>.md`).
//
// Loads a markdown file with YAML frontmatter, validates the frontmatter
// against the task-spec schema (see `schemas/task-spec.schema.json`), and
// returns `{ path, frontmatter, body }`. Throws SpecValidationError with a
// structured `{ missing, invalid }` shape that the caller renders to stderr
// before exiting with code 2.
//
// Hand-rolled YAML frontmatter parser (no new deps). Supports the subset the
// schema needs: string/number/boolean scalars, quoted strings, inline arrays
// (`[a, b]`), and block arrays (`- a\n  - b`). Does NOT handle nested objects
// or multiline scalars — the schema doesn't need them.

const REQUIRED_FIELDS = ["title", "scope", "mode"];
const VALID_MODES = ["write", "read-only", "research"];
const VALID_COMMIT_POLICIES = ["per-phase", "single"];
const VALID_VERIFY_WITH = ["gpt-5.4", "gpt-5.5"];

export class SpecValidationError extends Error {
  constructor({ path: specPath, missing, invalid }) {
    super(`spec-validation-failed: ${specPath} (missing=${missing.length}, invalid=${invalid.length})`);
    this.name = "SpecValidationError";
    this.code = "spec-validation-failed";
    this.specPath = specPath;
    this.missing = missing;
    this.invalid = invalid;
  }
  toJson() {
    return {
      error: "spec-validation-failed",
      path: this.specPath,
      missing: this.missing,
      invalid: this.invalid
    };
  }
}

export function loadAndValidateSpec(specPath, cwd) {
  const absolutePath = path.isAbsolute(specPath) ? specPath : path.resolve(cwd, specPath);

  let raw;
  try {
    raw = fs.readFileSync(absolutePath, "utf8");
  } catch (err) {
    throw new SpecValidationError({
      path: absolutePath,
      missing: [],
      invalid: [`file: ${err.message}`]
    });
  }

  const parsed = parseFrontmatter(raw, absolutePath);
  const { frontmatter, body } = parsed;

  const missing = [];
  const invalid = [];

  for (const key of REQUIRED_FIELDS) {
    const value = frontmatter[key];
    const empty = value === undefined || value === null || value === ""
      || (Array.isArray(value) && value.length === 0);
    if (empty) missing.push(key);
  }

  // scope must be a string OR a non-empty array of strings. Without this,
  // a malformed `scope: 42` would pass validation and crash at worktree
  // creation time when scopeOverlaps() tries to iterate.
  if (frontmatter.scope !== undefined && frontmatter.scope !== null && frontmatter.scope !== "") {
    const isString = typeof frontmatter.scope === "string";
    const isStringArray = Array.isArray(frontmatter.scope)
      && frontmatter.scope.length > 0
      && frontmatter.scope.every((s) => typeof s === "string" && s.length > 0);
    if (!isString && !isStringArray) {
      invalid.push(`scope: must be a string or non-empty array of strings (got ${typeof frontmatter.scope === "object" ? "array/object" : typeof frontmatter.scope})`);
    }
  }

  if (frontmatter.mode !== undefined && !VALID_MODES.includes(frontmatter.mode)) {
    invalid.push(`mode: '${frontmatter.mode}' is not in [${VALID_MODES.join(", ")}]`);
  }
  if (frontmatter.mode === "write") {
    if (!Array.isArray(frontmatter.acceptance) || frontmatter.acceptance.length < 1) {
      missing.push("acceptance (required when mode: write)");
    }
  }
  if (frontmatter.commit_policy !== undefined && !VALID_COMMIT_POLICIES.includes(frontmatter.commit_policy)) {
    invalid.push(`commit_policy: '${frontmatter.commit_policy}' is not in [${VALID_COMMIT_POLICIES.join(", ")}]`);
  }
  if (frontmatter.verify_with !== undefined && !VALID_VERIFY_WITH.includes(frontmatter.verify_with)) {
    invalid.push(`verify_with: '${frontmatter.verify_with}' is not in [${VALID_VERIFY_WITH.join(", ")}]`);
  }
  // timeout must be a string matching /^\d+[mh]$/. parseScalar coerces bare
  // numeric YAML values (e.g. `timeout: 45`) to numbers, which previously
  // bypassed this validation entirely. Reject any non-string explicitly.
  if (frontmatter.timeout !== undefined && frontmatter.timeout !== null) {
    if (typeof frontmatter.timeout !== "string") {
      invalid.push(`timeout: must be a string like '45m' or '2h' (got ${typeof frontmatter.timeout}: ${JSON.stringify(frontmatter.timeout)}). Quote the value or add a 'm'/'h' suffix.`);
    } else if (!/^\d+[mh]$/.test(frontmatter.timeout)) {
      invalid.push(`timeout: '${frontmatter.timeout}' must match /^\\d+[mh]$/ (e.g. 45m, 2h)`);
    }
  }
  if (!body || body.trim().length === 0) {
    missing.push("body (the task prompt — markdown content after the frontmatter)");
  }

  if (missing.length || invalid.length) {
    throw new SpecValidationError({ path: absolutePath, missing, invalid });
  }

  return { path: absolutePath, frontmatter, body };
}

function parseFrontmatter(raw, specPath) {
  const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = raw.match(FRONT_RE);
  if (!match) {
    throw new SpecValidationError({
      path: specPath,
      missing: ["frontmatter (--- ... ---)"],
      invalid: []
    });
  }
  const [, yamlText, body] = match;
  const frontmatter = {};
  const lines = yamlText.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) { i++; continue; }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!kv) { i++; continue; }
    const [, key, valueRaw] = kv;
    const value = valueRaw.trim();
    if (value === "") {
      // Block array follows: lines beginning with `  - ` are items.
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const itemMatch = lines[j].match(/^\s+-\s+(.*)$/);
        if (!itemMatch) break;
        items.push(parseScalar(itemMatch[1].trim()));
        j++;
      }
      frontmatter[key] = items;
      i = j;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      frontmatter[key] = inner ? inner.split(",").map((s) => parseScalar(s.trim())) : [];
      i++;
    } else {
      frontmatter[key] = parseScalar(value);
      i++;
    }
  }
  return { frontmatter, body: body.replace(/^\r?\n/, "") };
}

function parseScalar(s) {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  return s;
}
