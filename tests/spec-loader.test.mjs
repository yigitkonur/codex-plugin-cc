import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  loadAndValidateSpec,
  SpecValidationError
} from "../plugins/codex/scripts/lib/spec-loader.mjs";

function tempSpec(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-spec-"));
  const p = path.join(dir, "spec.md");
  fs.writeFileSync(p, content);
  return p;
}

test("loadAndValidateSpec accepts a valid write spec", () => {
  const p = tempSpec(`---
title: Fix the thing
scope: src/foo.ts
mode: write
acceptance:
  - exit code is 0
  - new test passes
---
Here is the body of the prompt.
`);
  const spec = loadAndValidateSpec(p, process.cwd());
  assert.equal(spec.frontmatter.title, "Fix the thing");
  assert.equal(spec.frontmatter.mode, "write");
  assert.deepEqual(spec.frontmatter.acceptance, ["exit code is 0", "new test passes"]);
  assert.equal(spec.body.trim(), "Here is the body of the prompt.");
  assert.equal(spec.path, p);
});

test("loadAndValidateSpec rejects missing title with SpecValidationError", () => {
  const p = tempSpec(`---
scope: src/foo.ts
mode: read-only
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) => err instanceof SpecValidationError && err.missing.includes("title")
  );
});

test("loadAndValidateSpec rejects missing acceptance when mode: write", () => {
  const p = tempSpec(`---
title: t
scope: s
mode: write
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.missing.some((m) => m.startsWith("acceptance"))
  );
});

test("loadAndValidateSpec rejects invalid mode", () => {
  const p = tempSpec(`---
title: t
scope: s
mode: unsafe
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.invalid.some((i) => i.startsWith("mode:"))
  );
});

test("loadAndValidateSpec accepts research mode without acceptance", () => {
  const p = tempSpec(`---
title: research a thing
scope: src/foo.ts
mode: research
---
Tell me about X.
`);
  const spec = loadAndValidateSpec(p, process.cwd());
  assert.equal(spec.frontmatter.mode, "research");
  assert.equal(spec.body.trim(), "Tell me about X.");
});

test("loadAndValidateSpec accepts read-only mode without acceptance", () => {
  const p = tempSpec(`---
title: look at the diff
scope: src/foo.ts
mode: read-only
---
Body
`);
  const spec = loadAndValidateSpec(p, process.cwd());
  assert.equal(spec.frontmatter.mode, "read-only");
});

test("loadAndValidateSpec supports inline-array scope and acceptance", () => {
  const p = tempSpec(`---
title: t
scope: [src/foo.ts, src/bar.ts]
mode: write
acceptance: [one, two]
---
Body
`);
  const spec = loadAndValidateSpec(p, process.cwd());
  assert.deepEqual(spec.frontmatter.scope, ["src/foo.ts", "src/bar.ts"]);
  assert.deepEqual(spec.frontmatter.acceptance, ["one", "two"]);
});

test("loadAndValidateSpec rejects invalid commit_policy", () => {
  const p = tempSpec(`---
title: t
scope: s
mode: write
acceptance: [x]
commit_policy: every-line
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.invalid.some((i) => i.startsWith("commit_policy:"))
  );
});

test("loadAndValidateSpec rejects missing frontmatter (no leading ---)", () => {
  const p = tempSpec(`title: bad\n\nBody\n`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.missing.some((m) => m.startsWith("frontmatter"))
  );
});

test("loadAndValidateSpec rejects empty body", () => {
  const p = tempSpec(`---
title: t
scope: s
mode: research
---
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.missing.some((m) => m.startsWith("body"))
  );
});

test("loadAndValidateSpec resolves relative paths against the provided cwd", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-spec-cwd-"));
  const p = path.join(dir, "rel.md");
  fs.writeFileSync(
    p,
    `---
title: t
scope: s
mode: research
---
Body
`
  );
  const spec = loadAndValidateSpec("rel.md", dir);
  assert.equal(spec.path, p);
});

test("SpecValidationError.toJson produces the documented stderr shape", () => {
  const err = new SpecValidationError({
    path: "/tmp/x.md",
    missing: ["acceptance"],
    invalid: ["mode: 'unsafe' is not in [write, read-only, research]"]
  });
  assert.deepEqual(err.toJson(), {
    error: "spec-validation-failed",
    path: "/tmp/x.md",
    missing: ["acceptance"],
    invalid: ["mode: 'unsafe' is not in [write, read-only, research]"]
  });
});

test("loadAndValidateSpec rejects non-string-non-array scope (e.g. numeric)", () => {
  const p = tempSpec(`---
title: t
scope: 42
mode: write
acceptance: [x]
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.invalid.some((i) => i.startsWith("scope:"))
  );
});

test("loadAndValidateSpec accepts string scope and array-of-strings scope", () => {
  const a = tempSpec(`---
title: t
scope: src/foo.ts
mode: research
---
Body
`);
  const b = tempSpec(`---
title: t
scope: [src/foo.ts, src/bar.ts]
mode: research
---
Body
`);
  assert.equal(loadAndValidateSpec(a, process.cwd()).frontmatter.scope, "src/foo.ts");
  assert.deepEqual(loadAndValidateSpec(b, process.cwd()).frontmatter.scope, ["src/foo.ts", "src/bar.ts"]);
});

test("loadAndValidateSpec rejects numeric timeout (YAML coerces bare numbers)", () => {
  const p = tempSpec(`---
title: t
scope: s
mode: research
timeout: 45
---
Body
`);
  assert.throws(
    () => loadAndValidateSpec(p, process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.invalid.some((i) => i.startsWith("timeout:") && i.includes("must be a string"))
  );
});

test("loadAndValidateSpec accepts valid timeout strings: 45m, 2h", () => {
  for (const t of ["45m", "2h"]) {
    const p = tempSpec(`---
title: t
scope: s
mode: research
timeout: ${t}
---
Body
`);
    const spec = loadAndValidateSpec(p, process.cwd());
    assert.equal(spec.frontmatter.timeout, t);
  }
});

test("loadAndValidateSpec rejects file not found with a clear invalid entry", () => {
  assert.throws(
    () => loadAndValidateSpec("/tmp/__definitely_does_not_exist__.md", process.cwd()),
    (err) =>
      err instanceof SpecValidationError &&
      err.invalid.some((i) => i.startsWith("file:"))
  );
});
