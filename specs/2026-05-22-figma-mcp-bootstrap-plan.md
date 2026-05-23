# Figma MCP bootstrap + sync — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the two-phase Figma integration described in [2026-05-22-figma-mcp-bootstrap-design.md](2026-05-22-figma-mcp-bootstrap-design.md): one-time bootstrap of a "POP EDS Design System" Figma file from the current EDS repo, plus an ongoing Figma → code sync tool for design-token and per-component visual updates.

**Architecture:** Phase 1 is a guided procedural workflow (interactive Claude Code session driving Figma's remote MCP) that produces a Figma file + an initial `.figma-sync.json` state file in the repo. Phase 2 is real software: a Node CLI (`scripts/figma-sync.mjs`) that reads the Figma file via MCP, three-way-diffs against `.figma-sync.json` and the repo's CSS, and proposes patches for user approval. Both phases share one mental model — Figma Variable collection ↔ CSS file, Figma Component ↔ block folder.

**Tech Stack:** Node ESM, `cheerio` (already a transitive in the repo via transform-dita), `node:test` for tests, Figma official remote MCP server (`https://mcp.figma.com/mcp`) via `claude plugin install figma@claude-plugins-official`.

**Reference:** spec at [specs/2026-05-22-figma-mcp-bootstrap-design.md](2026-05-22-figma-mcp-bootstrap-design.md). Re-read it before starting if anything below is ambiguous — the spec is authoritative.

**Phase checkpoint:** Phase 1 must be verified working before Phase 2 begins. If the bootstrap acceptance criteria in Part C don't pass (especially live-URL capture in Task A3), regroup with the user before committing further Phase 2 code.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `scripts/figma/parse-tokens.mjs` | Parse `--pop-*` and boilerplate CSS custom properties from `styles/styles.css` into a structured JSON shape that mirrors the two Variable collections in the spec. Pure function, no side effects. |
| `scripts/figma/parse-block-css.mjs` | Parse a block's CSS file and extract the top-level selector's whitelisted visual properties (per spec component-property whitelist). Pure function. |
| `scripts/figma/sync-state.mjs` | Read/write `.figma-sync.json` at the repo root. Validate shape. |
| `scripts/figma/diff.mjs` | Three-way diff between BASE (sync-state), FIGMA (passed in as a fetched snapshot), and CODE (CSS-parsed snapshot). Returns a structured diff result with conflict/drift/added/removed categories. Pure function — no Figma I/O. |
| `scripts/figma/safety.mjs` | Centralised refusal checks: cross-collection writes, unmapped component names, `blocks/sidenav/sidenav.js` writes, non-whitelisted properties. Pure functions, return reasons. |
| `scripts/figma/patch.mjs` | Given an approved diff, write the resulting changes to `styles/styles.css` and `blocks/<name>/<name>.css`. Idempotent: re-running on already-applied diff is a no-op. |
| `scripts/figma/figma-client.mjs` | Thin abstraction over the Figma MCP read calls. Single function `fetchFigmaSnapshot(fileKey)` returns `{variables, components, versionId}` in the shape `diff.mjs` consumes. Lets unit tests bypass the MCP by injecting fixtures. |
| `scripts/figma-sync.mjs` | CLI entry. Reads `.figma-sync.json`, fetches Figma snapshot via `figma-client`, runs `diff`, applies `safety` filters, prints unified diff to stdout, prompts for approval, calls `patch` + updates sync-state on yes. |
| `scripts/figma/__tests__/parse-tokens.test.mjs` | Tests for token parser. |
| `scripts/figma/__tests__/parse-block-css.test.mjs` | Tests for block-CSS parser. |
| `scripts/figma/__tests__/diff.test.mjs` | Tests for three-way diff. |
| `scripts/figma/__tests__/safety.test.mjs` | Tests for refusal rules. |
| `scripts/figma/__tests__/patch.test.mjs` | Tests for patch application. |
| `scripts/figma/__tests__/sync-state.test.mjs` | Tests for sync-state load/save/validate. |
| `scripts/figma/__tests__/fixtures/` | JSON fixtures representing realistic Figma snapshots, CSS snapshots, and sync-state snapshots for diff/patch tests. |
| `.figma-sync.json` | Sync state file at repo root. Created by Phase 1 bootstrap, updated on every Phase 2 sync. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add `"test": "node --test scripts/figma/__tests__"` script. No new dependencies — `node:test` is built-in. |
| `.gitignore` | No change needed. `.figma-sync.json` is committed (it's repo state, not local). |

### Files explicitly not touched

- `scripts/transform-dita.mjs` — out of scope, owned by the AEM Guides publish pipeline.
- `blocks/sidenav/sidenav.js` / `sidenav_data.js` — hard-refused by safety rails (AEM Guides overwrites on publish).
- Anything under `docs/` — publicly served, owned by the EDS pipeline.

---

# Part A — Setup and de-risk (operational)

### Task A1: Install the Figma plugin and authenticate

**Files:** none in repo; affects Claude Code config only.

- [ ] **Step 1: Install the plugin**

Run:
```bash
claude plugin install figma@claude-plugins-official
```

When prompted, press Enter to open the OAuth page in a browser. Click **Allow access** to authenticate Claude Code against your Figma account.

- [ ] **Step 2: Restart Claude Code**

Quit and relaunch so the new MCP server registers.

- [ ] **Step 3: Verify the MCP server is connected**

Run:
```bash
claude mcp list
```

Expected: `figma` appears in the list with a healthy status.

Also run inside Claude Code:
```
/mcp
```

Expected: Figma server listed, tools available (look for variable/component/capture-related tool names).

- [ ] **Step 4: No commit needed** — install is local to your machine.

---

### Task A2: Verify the dita-elements page is live

**Files:** none in repo.

- [ ] **Step 1: Curl the live URL**

Run:
```bash
curl -sI "https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference" | head -5
```

Expected: HTTP/2 200 (or 301 → 200 on a follow). If 404, the topic hasn't been published yet — publish from AEM Guides (see project memory `eds_integration` for the publish flow) before continuing.

- [ ] **Step 2: Spot-check rendered content**

Open the URL in a browser. Confirm the page renders Note/Warning/Tip/Caution/Important/Table blocks visibly. This is what Phase 1 will capture into Figma.

- [ ] **Step 3: No commit needed.**

---

### Task A3: De-risk live-URL capture against aem.live (the biggest unknown)

**Files:** none in repo (this is a throwaway probe).

This task validates Risk #2 from the spec: can the Figma MCP capture a *public* URL, or only a local server?

- [ ] **Step 1: Ask Claude (this session) to capture the live URL into a throwaway Figma file**

In Claude Code, prompt:
> "Using the Figma MCP, create a new Figma file called 'capture-probe' and capture the live UI from https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference into a page in that file. Report whether it worked, what tool name you called, and what came back."

- [ ] **Step 2: Inspect the result**

Open the resulting Figma file. Three possible outcomes:

| Outcome | Meaning | Next step |
|---|---|---|
| Editable frames matching the page render | ✅ Public-URL capture works | Proceed to Task A4 |
| MCP errors / refuses public URL | ❌ Local-server only | Fall back: serve `docs/` locally (`npx serve docs`) and capture `http://localhost:<port>/contents/topics/dita-element-rendering-reference.html`. Proceed to A4 with this approach noted. |
| Capture succeeds but layers are nonsense / one big image | ⚠️ Capture mechanism works but fidelity is poor | Fall back: hand Claude a screenshot of the page and have it author frames from that. Proceed to A4 with this approach noted. |

- [ ] **Step 3: Record the result**

Write a short note to yourself (in chat, or in a temp file) capturing which path you're taking forward. This affects Task C4.

- [ ] **Step 4: Delete the probe Figma file**

Throw it away — only the result matters.

- [ ] **Step 5: No commit needed.**

---

### Task A4: Add a test script entry to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

Edit `package.json`. Add `"test": "node --test scripts/figma/__tests__"` to the `"scripts"` object so it sits next to `"lint"`:

```json
"scripts": {
  "lint:js": "eslint .",
  "lint:css": "stylelint blocks/**/*.css styles/*.css",
  "lint": "npm run lint:js && npm run lint:css",
  "test": "node --test scripts/figma/__tests__",
  "semantic-release": "semantic-release --debug"
},
```

- [ ] **Step 2: Verify it runs (and finds no tests yet)**

Run:
```bash
npm test
```

Expected: exits with a message about finding zero tests. Not an error, just empty.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -F /tmp/figma-commit-msg.txt
```

Where `/tmp/figma-commit-msg.txt` contains:
```
Add test script for Figma sync tooling

Wires up node:test against scripts/figma/__tests__ where the upcoming
Figma sync engine tests will live. Zero new dependencies.
```

(Use a temp file for the commit message rather than `-m` to avoid shell-quoting issues with HEREDOCs in this repo's environment.)

---

# Part B — Token parser (TDD)

### Task B1: Token parser — extract `--pop-*` colors

**Files:**
- Create: `scripts/figma/parse-tokens.mjs`
- Create: `scripts/figma/__tests__/parse-tokens.test.mjs`
- Create: `scripts/figma/__tests__/fixtures/styles-minimal.css`

- [ ] **Step 1: Create the fixture CSS**

Create `scripts/figma/__tests__/fixtures/styles-minimal.css`:

```css
:root {
  --pop-color-primary: #642CDB;
  --pop-color-info:    #3B82F6;
  --pop-note-tint:     #EFF6FF;
  --pop-note-ring:     var(--pop-color-info);
  --pop-block-radius:  8px;
}
```

- [ ] **Step 2: Write the failing test**

Create `scripts/figma/__tests__/parse-tokens.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTokens } from '../parse-tokens.mjs';

const FIXTURE = new URL('./fixtures/styles-minimal.css', import.meta.url);

test('parses --pop-color-* into POP Brand / Color group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].value, '#642CDB');
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].cssVar, '--pop-color-primary');
  assert.equal(result.collections['POP Brand'].groups.Color['info'].value, '#3B82F6');
});

test('parses --pop-*-tint and --pop-*-ring into Block tints group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups['Block tints']['note-tint'].value, '#EFF6FF');
});

test('resolves alias var() references and records the alias source', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  const noteRing = result.collections['POP Brand'].groups['Block tints']['note-ring'];
  assert.equal(noteRing.value, '#3B82F6'); // resolved from --pop-color-info
  assert.equal(noteRing.alias, '--pop-color-info');
});

test('parses --pop-block-* into Layout group', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseTokens(css);
  assert.equal(result.collections['POP Brand'].groups.Layout['block-radius'].value, '8px');
});
```

- [ ] **Step 3: Run the test to confirm it fails**

Run:
```bash
npm test
```

Expected: FAIL — `parseTokens` is not defined / module not found.

- [ ] **Step 4: Implement `parseTokens` (minimal pass)**

Create `scripts/figma/parse-tokens.mjs`:

```javascript
// Parses CSS custom properties from styles.css into two Variable
// collections (POP Brand, Foundation) matching the shape Figma's
// MCP variable-creation tools expect. See
// specs/2026-05-22-figma-mcp-bootstrap-design.md "Token mapping".

const POP_GROUPS = [
  { match: /^--pop-color-(.+)$/, collection: 'POP Brand', group: 'Color' },
  { match: /^--pop-(.+-tint|.+-ring)$/, collection: 'POP Brand', group: 'Block tints' },
  { match: /^--pop-table-(.+)$/, collection: 'POP Brand', group: 'Table' },
  { match: /^--pop-block-(.+)$/, collection: 'POP Brand', group: 'Layout' },
];

const FOUNDATION_GROUPS = [
  { match: /^--body-font-family$|^--heading-font-family$|^--fixed-font-family$|^--body-font-size-/, collection: 'Foundation', group: 'Typography' },
  { match: /^--link-color$|^--link-hover-color$|^--text-color$|^--background-color$/, collection: 'Foundation', group: 'Color' },
  { match: /^--sidenav-/, collection: 'Foundation', group: 'Sidenav' },
];

const ALL_GROUPS = [...POP_GROUPS, ...FOUNDATION_GROUPS];

function classify(cssVar) {
  for (const rule of ALL_GROUPS) {
    const m = cssVar.match(rule.match);
    if (m) {
      const name = cssVar.replace(/^--pop-color-|^--pop-/, '').replace(/^--/, '');
      return { collection: rule.collection, group: rule.group, name };
    }
  }
  return null;
}

function extractDeclarations(css) {
  // Match --foo: value; inside any rule, lenient on whitespace.
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  const decls = new Map();
  let m;
  while ((m = re.exec(css)) !== null) {
    decls.set(m[1], m[2].trim());
  }
  return decls;
}

function resolveValue(rawValue, decls, seen = new Set()) {
  const aliasMatch = rawValue.match(/^var\((--[a-z0-9-]+)\)$/i);
  if (!aliasMatch) return { value: rawValue, alias: null };
  const aliasName = aliasMatch[1];
  if (seen.has(aliasName)) return { value: rawValue, alias: aliasName }; // cycle guard
  seen.add(aliasName);
  const target = decls.get(aliasName);
  if (!target) return { value: rawValue, alias: aliasName };
  const resolved = resolveValue(target, decls, seen);
  return { value: resolved.value, alias: aliasName };
}

export function parseTokens(cssText) {
  const decls = extractDeclarations(cssText);
  const result = {
    collections: {
      'POP Brand': { groups: {} },
      Foundation: { groups: {} },
    },
  };
  for (const [cssVar, rawValue] of decls) {
    const cls = classify(cssVar);
    if (!cls) continue;
    const { value, alias } = resolveValue(rawValue, decls);
    const groupBucket = (result.collections[cls.collection].groups[cls.group] ||= {});
    groupBucket[cls.name] = { value, cssVar, ...(alias ? { alias } : {}) };
  }
  return result;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run:
```bash
npm test
```

Expected: PASS — all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add scripts/figma/parse-tokens.mjs scripts/figma/__tests__/parse-tokens.test.mjs scripts/figma/__tests__/fixtures/styles-minimal.css
git commit -F /tmp/figma-commit-msg.txt
```

Where the commit message file contains:
```
Add token parser for Figma Variable collections

Parses --pop-* and Foundation tokens from styles.css into the
two-collection shape Phase 1 bootstrap will hand to Figma's MCP.
Resolves var() aliases and records the alias source so Phase 2
sync can preserve the alias chain.
```

---

### Task B2: Token parser — run against real `styles/styles.css`

**Files:**
- Modify: `scripts/figma/__tests__/parse-tokens.test.mjs`

- [ ] **Step 1: Add an integration test against the real file**

Append to `scripts/figma/__tests__/parse-tokens.test.mjs`:

```javascript
test('parses the real styles/styles.css without errors', async () => {
  const css = await readFile(new URL('../../../styles/styles.css', import.meta.url), 'utf8');
  const result = parseTokens(css);

  // Spot-check the known POP brand tokens from the spec
  assert.equal(result.collections['POP Brand'].groups.Color['primary'].value, '#642CDB');
  assert.equal(result.collections['POP Brand'].groups.Color['info'].value, '#3B82F6');
  assert.equal(result.collections['POP Brand'].groups.Color['danger'].value, '#EF4444');

  // Block tints
  assert.equal(result.collections['POP Brand'].groups['Block tints']['note-tint'].value, '#EFF6FF');
  assert.equal(result.collections['POP Brand'].groups['Block tints']['warning-tint'].value, '#FFFBEB');

  // Layout
  assert.equal(result.collections['POP Brand'].groups.Layout['block-radius'].value, '8px');

  // Foundation
  assert.ok(result.collections.Foundation.groups.Typography['body-font-family'].value.startsWith('Poppins'));
});
```

- [ ] **Step 2: Run the test**

Run:
```bash
npm test
```

Expected: all tests still PASS. If a spot-check fails, the token classification rules in `parse-tokens.mjs` need a tweak to match the real declarations — adjust regex and re-run.

- [ ] **Step 3: Commit (only if you changed `parse-tokens.mjs`)**

```bash
git add scripts/figma/__tests__/parse-tokens.test.mjs scripts/figma/parse-tokens.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Verify token parser against real styles/styles.css

Adds an integration test using the actual repo styles.css. Catches
classification rules that miss real-world declarations.
```

---

### Task B3: Block CSS parser — extract whitelisted properties

**Files:**
- Create: `scripts/figma/parse-block-css.mjs`
- Create: `scripts/figma/__tests__/parse-block-css.test.mjs`
- Create: `scripts/figma/__tests__/fixtures/warning.css`

- [ ] **Step 1: Create the fixture**

Create `scripts/figma/__tests__/fixtures/warning.css` (a stripped-down version of the real `blocks/warning/warning.css`):

```css
.warning {
  display: flex;
  margin: var(--pop-block-gap) 0;
  padding: var(--pop-block-pad-y) var(--pop-block-pad-x);
  border: 1px solid var(--pop-warning-ring);
  border-radius: var(--pop-block-radius);
  background: var(--pop-warning-tint);
  font-size: var(--body-font-size-xs);
}

.warning::before {
  content: "⚠";
  color: var(--pop-warning-ring);
}

.warning > div {
  flex: 1 1 auto;
}
```

- [ ] **Step 2: Write the failing test**

Create `scripts/figma/__tests__/parse-block-css.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseBlockCss } from '../parse-block-css.mjs';

const FIXTURE = new URL('./fixtures/warning.css', import.meta.url);

test('extracts only whitelisted properties from the top-level selector', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');

  // Whitelisted properties present:
  assert.equal(result.properties['border-radius'], 'var(--pop-block-radius)');
  assert.equal(result.properties['background-color'], 'var(--pop-warning-tint)');
  // `font-size` is whitelisted
  assert.equal(result.properties['font-size'], 'var(--body-font-size-xs)');

  // Non-whitelisted properties skipped:
  assert.equal(result.properties['display'], undefined);
  assert.equal(result.properties['flex'], undefined);
});

test('normalizes `background` shorthand to `background-color` when value is colorish', async () => {
  const css = '.warning { background: var(--pop-warning-tint); }';
  const result = parseBlockCss(css, 'warning');
  assert.equal(result.properties['background-color'], 'var(--pop-warning-tint)');
});

test('ignores nested selectors (::before, > div)', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');
  // The ::before block has `color: var(--pop-warning-ring)` but we should NOT
  // pick that up — it belongs to a different selector.
  assert.equal(result.properties['color'], undefined);
});

test('returns name and properties shape', async () => {
  const css = await readFile(FIXTURE, 'utf8');
  const result = parseBlockCss(css, 'warning');
  assert.equal(result.name, 'warning');
  assert.ok(typeof result.properties === 'object');
});
```

- [ ] **Step 3: Run the test and confirm failure**

Run: `npm test`

Expected: FAIL — `parseBlockCss` not defined.

- [ ] **Step 4: Implement `parseBlockCss`**

Create `scripts/figma/parse-block-css.mjs`:

```javascript
// Parses a block's CSS file and extracts whitelisted visual properties
// from the top-level selector (e.g. `.warning { ... }`). Nested selectors
// (`.warning::before`, `.warning > div`) are ignored.
//
// Whitelist matches spec "Component-property whitelist".

const WHITELIST = new Set([
  'background-color', 'color', 'border-color',
  'border-width', 'border-style', 'border-radius',
  'padding', 'margin',
  'font-family', 'font-size', 'font-weight', 'line-height',
]);

// `background: <color>;` is normalized to `background-color`.
const SHORTHAND_NORMALIZE = {
  background: 'background-color',
};

function findTopLevelRule(css, selector) {
  // Match `.selector { ... }` allowing balanced braces. Cheap brace-counting
  // since CSS doesn't use braces inside values (modulo @rules we don't care about here).
  const startRe = new RegExp(`\\.${selector}\\s*\\{`, 'g');
  const m = startRe.exec(css);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

function extractDecls(body) {
  const out = {};
  const re = /([a-z-]+)\s*:\s*([^;]+);/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

export function parseBlockCss(cssText, blockName) {
  const body = findTopLevelRule(cssText, blockName);
  if (!body) return { name: blockName, properties: {} };
  const rawDecls = extractDecls(body);

  const properties = {};
  for (const [prop, value] of Object.entries(rawDecls)) {
    const normalized = SHORTHAND_NORMALIZE[prop] || prop;
    if (WHITELIST.has(normalized)) {
      properties[normalized] = value;
    }
  }
  return { name: blockName, properties };
}
```

- [ ] **Step 5: Run tests and confirm pass**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/figma/parse-block-css.mjs scripts/figma/__tests__/parse-block-css.test.mjs scripts/figma/__tests__/fixtures/warning.css
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add block-CSS parser for component visual properties

Extracts whitelisted CSS properties from a block's top-level selector.
Normalizes `background` shorthand to `background-color`. Ignores
nested selectors so Phase 2 sync writes only the master rule.
```

---

# Part C — Phase 1 bootstrap session (procedural)

This part is an interactive Claude Code session that drives the Figma MCP. Each task is a conversation step. There are no `node:test` tests here — verification is visual inspection of the resulting Figma file.

### Task C1: Generate the token JSON for handoff to Figma

**Files:**
- Create: `scripts/figma/bootstrap-tokens.mjs` (one-off CLI to dump the parsed tokens as JSON)

- [ ] **Step 1: Write the script**

Create `scripts/figma/bootstrap-tokens.mjs`:

```javascript
// One-off CLI: parse styles/styles.css and print the Variable-collection
// JSON to stdout. Used during Phase 1 bootstrap to hand the structure
// to Claude + Figma MCP.

import { readFile } from 'node:fs/promises';
import { parseTokens } from './parse-tokens.mjs';

const css = await readFile(new URL('../../styles/styles.css', import.meta.url), 'utf8');
const result = parseTokens(css);
console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Run it and eyeball the output**

Run:
```bash
node scripts/figma/bootstrap-tokens.mjs | head -60
```

Expected: structured JSON showing `collections."POP Brand".groups.Color.primary` etc. with real values.

- [ ] **Step 3: Commit**

```bash
git add scripts/figma/bootstrap-tokens.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add bootstrap-tokens CLI for Phase 1 handoff

One-off dumper that converts styles.css into the Variable-collection JSON
Phase 1 will feed to the Figma MCP. Single source of truth: parse-tokens.mjs.
```

---

### Task C2: Create the Figma file and seed Variables (interactive)

**Files:** none in repo (driven via MCP).

- [ ] **Step 1: Dump the token JSON to stdout**

In the Claude Code session, run:
```bash
node scripts/figma/bootstrap-tokens.mjs
```

Pipe-friendly format — Claude will read this output and use it as input for MCP calls.

- [ ] **Step 2: Prompt Claude to create the file and seed Variables**

In Claude Code, prompt:
> "Using the Figma MCP, create a new Figma file named 'POP EDS Design System'. Then create two Variable collections in it: 'POP Brand' and 'Foundation'. Populate them from the JSON output of `node scripts/figma/bootstrap-tokens.mjs`. Preserve the group structure (Color, Block tints, Table, Layout, Typography, Sidenav). For any variable that has an `alias` field, set the Figma variable's description to `[alias: <alias-cssvar-name>]` so the designer can see the alias chain."

- [ ] **Step 3: Open the file and verify**

Open the new Figma file in a browser. Verify:
- Two Variable collections exist (POP Brand, Foundation)
- Spot-check 3 values: `Color/primary` = `#642CDB`, `Block tints/warning-tint` = `#FFFBEB`, `Layout/block-radius` = `8px`
- Alias values (e.g. `note-ring`) have the `[alias: ...]` description string

If anything is off, ask Claude to fix it before continuing.

- [ ] **Step 4: Record the file URL and key**

Note the file URL — the path after `figma.com/design/` contains the file key. You'll need both for Task C6.

- [ ] **Step 5: No commit needed — Figma state is external.**

---

### Task C3: Capture the Sample Page from the live aem.live URL (interactive)

**Files:** none in repo.

Use whichever capture path you established in Task A3 (public URL direct, local server fallback, or screenshot fallback).

- [ ] **Step 1: Add a "Sample Page" tab to the Figma file**

Prompt Claude:
> "In the existing 'POP EDS Design System' Figma file, add a new page called 'Sample Page'."

- [ ] **Step 2: Capture the live render**

Based on the path from A3, prompt one of:

**If public-URL capture worked (A3 outcome ✅):**
> "Capture https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference into the 'Sample Page' tab as editable Figma layers."

**If only local-server worked (A3 outcome ❌):**

First, in a *separate terminal*, run:
```bash
npx serve docs -l 3000
```
Note the port from the output (forced to 3000 above for predictability). Then prompt:
> "Capture http://localhost:3000/contents/topics/dita-element-rendering-reference.html into the 'Sample Page' tab as editable Figma layers."

Keep the `npx serve` process running until Phase 1 is complete.

**If capture fidelity was poor (A3 outcome ⚠️):**
> "I'll paste a screenshot of the live page. Reconstruct the page in Figma in the 'Sample Page' tab using auto-layout frames. Use real text from the screenshot."

(Take a full-page screenshot in the browser via DevTools → Capture full size screenshot.)

- [ ] **Step 3: Visual inspection**

Open the Figma file. Confirm the Sample Page tab shows a recognisable rendering of the dita-elements page — header, sidenav (if captured), Note/Warning/Tip/Caution/Important callouts, a table, code blocks. It does NOT need to be pixel-perfect; the designer's job is to evolve from here.

- [ ] **Step 4: No commit needed.**

---

### Task C4: Componentize each block (interactive)

**Files:** none in repo.

The Sample Page now contains *instances* of the blocks. We need to extract them into proper Figma Components on a separate Components page, with their visual properties bound to the seeded Variables.

- [ ] **Step 1: Add the Components page**

Prompt Claude:
> "In the 'POP EDS Design System' Figma file, add a new page called 'Components'."

- [ ] **Step 2: Componentize each Tier 1 + Tier 2 block, one at a time**

For each of the following block names (10 total), prompt Claude:

> "On the 'Sample Page' tab, find the first instance of a `<NAME>` block. Convert it to a Figma Component named '<NAME>' (capitalized) and move the master to the 'Components' page. Replace its fills, strokes, border-radius, padding, and text styles with bindings to the 'POP Brand' or 'Foundation' Variables we seeded earlier — match the same `var(--pop-*)` / `var(--*)` reference used in the corresponding `blocks/<name>/<name>.css` file. The instance on the Sample Page should remain (it's an instance of the master)."

Blocks (in this order, easiest visual to most complex):
1. Note
2. Warning
3. Tip
4. Caution
5. Important
6. Table
7. Minitoc
8. Header
9. Footer
10. Sidenav

For each, verify the master appears on the Components page and its style bindings are to Variables (not raw hex values).

- [ ] **Step 3: Spot-check Variable bindings**

In Figma, click on the Warning component's border. The right-hand panel should show the stroke color is bound to a Variable (`pop-warning-ring`), not a raw `#F59E0B`.

- [ ] **Step 4: No commit needed.**

---

### Task C5: Initialize `.figma-sync.json`

**Files:**
- Create: `.figma-sync.json` (at repo root)

- [ ] **Step 1: Get the Figma file's current version ID**

Prompt Claude:
> "Using the Figma MCP, report the current version ID of the 'POP EDS Design System' file. Also report the file key (the path segment after figma.com/design/)."

- [ ] **Step 2: Generate the component property snapshot**

Run this one-liner to print the components-section of the sync-state to stdout (using `parseBlockCss` from B3):

```bash
node --input-type=module -e "
import { readFile } from 'node:fs/promises';
import { parseBlockCss } from './scripts/figma/parse-block-css.mjs';
const BLOCKS = ['note','warning','tip','caution','important','table','header','footer','sidenav','minitoc'];
const out = {};
for (const b of BLOCKS) {
  const css = await readFile(\`blocks/\${b}/\${b}.css\`, 'utf8');
  const cap = b[0].toUpperCase() + b.slice(1);
  out[cap] = { blockFolder: \`blocks/\${b}\`, properties: parseBlockCss(css, b).properties };
}
console.log(JSON.stringify(out, null, 2));
"
```

Capture the output — you'll paste it into the `components` field of `.figma-sync.json` in the next step.

- [ ] **Step 3: Generate the initial `.figma-sync.json`**

Prompt Claude:
> "Generate `.figma-sync.json` at the repo root using the schema from `specs/2026-05-22-figma-mcp-bootstrap-design.md` (Phase 2 → State tracking). Use these values: `figmaFileUrl` = the URL you noted in C2, `figmaFileKey` = path segment from that URL, `lastSyncedVersionId` = the Figma version ID you just fetched, `lastSyncedAt` = current UTC ISO timestamp. For `variables`, use the current Figma Variables collection contents (same shape `parseTokens` produces). For `components`, use the JSON output we just generated above."

- [ ] **Step 4: Eyeball the result**

Open `.figma-sync.json`. Confirm:
- File URL and key are correct
- `variables` has both collections populated with realistic values
- `components` has 10 entries, each with a `blockFolder` and a `properties` map

- [ ] **Step 5: Commit**

```bash
git add .figma-sync.json
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Initialize .figma-sync.json from Phase 1 bootstrap

Captures the just-created POP EDS Design System Figma file's state
(version ID, Variable values, Component visual properties parsed from
blocks/*.css) as the baseline for Phase 2 three-way diffing.
```

---

### Task C6: Phase 1 acceptance check

**Files:** none.

- [ ] **Step 1: Run through the spec's Phase 1 acceptance criteria**

From `specs/2026-05-22-figma-mcp-bootstrap-design.md` "Acceptance tests → Phase 1":

| # | Criterion | Verified? |
|---|---|---|
| 1 | `claude mcp list` shows `figma` connected | ☐ |
| 2 | Figma file "POP EDS Design System" exists at a known URL | ☐ |
| 3 | "POP Brand" and "Foundation" collections exist; 3 spot-checks pass | ☐ |
| 4 | "Sample Page" tab visibly resembles live aem.live render | ☐ |
| 5 | 10 Components exist with the names from the spec; bindings reference Variables, not raw hex | ☐ |
| 6 | `.figma-sync.json` committed with file URL, version ID, snapshot | ☐ |

Tick each.

- [ ] **Step 2: Hand off to the designer**

Share the Figma file URL with the designer along with a one-paragraph context note: the file is a starting point built from the current EDS components; they can iterate freely; the Sample Page is reference-only; structural changes need a conversation; visual changes will sync back to code.

- [ ] **Step 3: Checkpoint — STOP here and verify with the user before proceeding to Phase 2 (Part D).**

This is the natural pause point. If Phase 1 didn't produce a usable file, regrouping now is much cheaper than building Phase 2 against an unstable baseline.

---

# Part D — Phase 2 sync engine (TDD)

Begin only after Part C checkpoint passes.

### Task D1: Sync-state reader/writer

**Files:**
- Create: `scripts/figma/sync-state.mjs`
- Create: `scripts/figma/__tests__/sync-state.test.mjs`
- Create: `scripts/figma/__tests__/fixtures/sync-state-valid.json`

- [ ] **Step 1: Create the fixture**

Create `scripts/figma/__tests__/fixtures/sync-state-valid.json`:

```json
{
  "figmaFileUrl": "https://www.figma.com/design/abc123/POP-EDS-Design-System",
  "figmaFileKey": "abc123",
  "lastSyncedVersionId": "v1",
  "lastSyncedAt": "2026-05-22T14:30:00Z",
  "variables": {
    "POP Brand": {
      "Color/primary": { "value": "#642CDB", "cssVar": "--pop-color-primary" }
    },
    "Foundation": {}
  },
  "components": {
    "Note": {
      "blockFolder": "blocks/note",
      "properties": { "background-color": "#EFF6FF" }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/figma/__tests__/sync-state.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSyncState, saveSyncState, validateSyncState } from '../sync-state.mjs';

const FIXTURE = new URL('./fixtures/sync-state-valid.json', import.meta.url);

test('loads a valid sync-state file', async () => {
  const state = await loadSyncState(FIXTURE);
  assert.equal(state.figmaFileKey, 'abc123');
  assert.equal(state.variables['POP Brand']['Color/primary'].value, '#642CDB');
});

test('validateSyncState accepts a valid shape', async () => {
  const valid = JSON.parse(await readFile(FIXTURE, 'utf8'));
  assert.doesNotThrow(() => validateSyncState(valid));
});

test('validateSyncState rejects missing required fields', () => {
  assert.throws(() => validateSyncState({}), /figmaFileKey/);
  assert.throws(() => validateSyncState({ figmaFileKey: 'x' }), /variables/);
});

test('saves and round-trips a sync-state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'figma-sync-'));
  try {
    const path = join(dir, 'state.json');
    const original = JSON.parse(await readFile(FIXTURE, 'utf8'));
    await saveSyncState(path, original);
    const reloaded = await loadSyncState(path);
    assert.deepEqual(reloaded, original);
  } finally {
    await rm(dir, { recursive: true });
  }
});
```

- [ ] **Step 3: Run the test, confirm failure**

Run: `npm test`. Expected: FAIL — module not found.

- [ ] **Step 4: Implement `sync-state.mjs`**

Create `scripts/figma/sync-state.mjs`:

```javascript
// Reads and writes .figma-sync.json. Validates shape on every read/write.

import { readFile, writeFile } from 'node:fs/promises';

const REQUIRED = ['figmaFileKey', 'figmaFileUrl', 'lastSyncedVersionId', 'lastSyncedAt', 'variables', 'components'];

export function validateSyncState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('sync-state: not an object');
  }
  for (const key of REQUIRED) {
    if (!(key in state)) throw new Error(`sync-state: missing required field "${key}"`);
  }
  if (typeof state.variables !== 'object') throw new Error('sync-state: variables must be an object');
  if (typeof state.components !== 'object') throw new Error('sync-state: components must be an object');
}

export async function loadSyncState(path) {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  validateSyncState(parsed);
  return parsed;
}

export async function saveSyncState(path, state) {
  validateSyncState(state);
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
}
```

- [ ] **Step 5: Run and confirm pass**

Run: `npm test`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/figma/sync-state.mjs scripts/figma/__tests__/sync-state.test.mjs scripts/figma/__tests__/fixtures/sync-state-valid.json
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add sync-state reader/writer with schema validation

Loads and saves .figma-sync.json with shape checks on every I/O.
Required fields enforced; missing fields throw with the field name.
```

---

### Task D2: Three-way diff — token changes

**Files:**
- Create: `scripts/figma/diff.mjs`
- Create: `scripts/figma/__tests__/diff.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `scripts/figma/__tests__/diff.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffTokens } from '../diff.mjs';

const BASE = {
  'POP Brand': {
    'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' },
    'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
  },
};

test('detects FIGMA changed, CODE unchanged → apply', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' },
      'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 1);
  assert.deepEqual(diff.apply[0], {
    collection: 'POP Brand',
    name: 'Color/primary',
    cssVar: '--pop-color-primary',
    from: '#642CDB',
    to: '#FF0000',
  });
});

test('detects FIGMA unchanged, CODE changed → drift', () => {
  const figma = BASE;
  const code = { '--pop-color-primary': '#000000', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 1);
  assert.equal(diff.drift[0].cssVar, '--pop-color-primary');
});

test('detects FIGMA and CODE both changed → conflict', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' },
      'Color/info':    { value: '#3B82F6', cssVar: '--pop-color-info' },
    },
  };
  const code = { '--pop-color-primary': '#00FF00', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.conflict.length, 1);
  assert.deepEqual(diff.conflict[0], {
    collection: 'POP Brand',
    name: 'Color/primary',
    cssVar: '--pop-color-primary',
    base: '#642CDB',
    figma: '#FF0000',
    code: '#00FF00',
  });
});

test('detects added in FIGMA → proposeAdd', () => {
  const figma = {
    'POP Brand': {
      ...BASE['POP Brand'],
      'Color/accent': { value: '#FFFF00', cssVar: '--pop-color-accent' },
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.proposeAdd.length, 1);
  assert.equal(diff.proposeAdd[0].cssVar, '--pop-color-accent');
});

test('detects removed from FIGMA → deprecated (never auto-remove)', () => {
  const figma = {
    'POP Brand': {
      'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' },
      // Color/info missing
    },
  };
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, figma, code);
  assert.equal(diff.deprecated.length, 1);
  assert.equal(diff.deprecated[0].cssVar, '--pop-color-info');
  // critically: NOT in `apply`
  assert.equal(diff.apply.length, 0);
});

test('no changes → all categories empty', () => {
  const code = { '--pop-color-primary': '#642CDB', '--pop-color-info': '#3B82F6' };
  const diff = diffTokens(BASE, BASE, code);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 0);
  assert.equal(diff.conflict.length, 0);
  assert.equal(diff.proposeAdd.length, 0);
  assert.equal(diff.deprecated.length, 0);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement `diffTokens`**

Create `scripts/figma/diff.mjs`:

```javascript
// Three-way diff for Figma Variables against the repo's CSS custom properties.
// Inputs:
//   base  — sync-state.variables (collection → name → {value, cssVar, ...})
//   figma — current Figma snapshot (same shape)
//   code  — flat map of cssVar → current value parsed from styles.css
//
// Output categories:
//   apply       — FIGMA changed, CODE unchanged. Safe to write.
//   drift       — FIGMA unchanged, CODE changed. Surface, do not touch.
//   conflict    — both changed. Surface, do not touch.
//   proposeAdd  — present in FIGMA, absent in BASE. User confirms.
//   deprecated  — present in BASE, absent in FIGMA. NEVER auto-remove.

export function diffTokens(base, figma, code) {
  const result = { apply: [], drift: [], conflict: [], proposeAdd: [], deprecated: [] };

  const baseFlat = flatten(base);
  const figmaFlat = flatten(figma);

  const allKeys = new Set([...Object.keys(baseFlat), ...Object.keys(figmaFlat)]);
  for (const key of allKeys) {
    const baseEntry = baseFlat[key];
    const figmaEntry = figmaFlat[key];

    if (baseEntry && !figmaEntry) {
      result.deprecated.push({ ...baseEntry, key });
      continue;
    }
    if (!baseEntry && figmaEntry) {
      result.proposeAdd.push({ ...figmaEntry, key });
      continue;
    }
    // Both present — compare.
    const { collection, name, cssVar } = baseEntry;
    const baseVal = baseEntry.value;
    const figmaVal = figmaEntry.value;
    const codeVal = code[cssVar];

    const figmaChanged = figmaVal !== baseVal;
    const codeChanged = codeVal !== baseVal;

    if (figmaChanged && !codeChanged) {
      result.apply.push({ collection, name, cssVar, from: baseVal, to: figmaVal });
    } else if (!figmaChanged && codeChanged) {
      result.drift.push({ collection, name, cssVar, base: baseVal, code: codeVal });
    } else if (figmaChanged && codeChanged && figmaVal !== codeVal) {
      result.conflict.push({ collection, name, cssVar, base: baseVal, figma: figmaVal, code: codeVal });
    }
    // else: no change at all
  }
  return result;
}

function flatten(state) {
  const out = {};
  for (const [collection, entries] of Object.entries(state)) {
    for (const [name, entry] of Object.entries(entries)) {
      out[`${collection}::${name}`] = { collection, name, ...entry };
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/figma/diff.mjs scripts/figma/__tests__/diff.test.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add three-way diff for Figma Variables vs styles.css

Implements the spec's diff matrix: apply (figma-only change),
drift (code-only change), conflict (both changed differently),
proposeAdd, deprecated. Deprecated entries never appear in apply —
the safety rail against accidental Variable deletion in Figma.
```

---

### Task D3: Three-way diff — component property changes

**Files:**
- Modify: `scripts/figma/diff.mjs`
- Modify: `scripts/figma/__tests__/diff.test.mjs`

- [ ] **Step 1: Add tests for `diffComponents`**

Append to `scripts/figma/__tests__/diff.test.mjs`:

```javascript
import { diffComponents } from '../diff.mjs';

const BASE_COMPS = {
  Warning: {
    blockFolder: 'blocks/warning',
    properties: {
      'border-color': 'var(--pop-warning-ring)',
      'border-radius': 'var(--pop-block-radius)',
    },
  },
};

test('component property: FIGMA changed, CODE unchanged → apply', () => {
  const figma = {
    Warning: {
      blockFolder: 'blocks/warning',
      properties: {
        'border-color': '#FF0000',
        'border-radius': 'var(--pop-block-radius)',
      },
    },
  };
  const codeByBlock = {
    Warning: {
      'border-color': 'var(--pop-warning-ring)',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.apply.length, 1);
  assert.deepEqual(diff.apply[0], {
    component: 'Warning',
    blockFolder: 'blocks/warning',
    property: 'border-color',
    from: 'var(--pop-warning-ring)',
    to: '#FF0000',
  });
});

test('component property: drift surfaces but no apply', () => {
  const figma = BASE_COMPS;
  const codeByBlock = {
    Warning: {
      'border-color': '#000',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.apply.length, 0);
  assert.equal(diff.drift.length, 1);
});

test('component property: both changed → conflict', () => {
  const figma = {
    Warning: {
      blockFolder: 'blocks/warning',
      properties: { 'border-color': '#FF0000', 'border-radius': 'var(--pop-block-radius)' },
    },
  };
  const codeByBlock = {
    Warning: {
      'border-color': '#00FF00',
      'border-radius': 'var(--pop-block-radius)',
    },
  };
  const diff = diffComponents(BASE_COMPS, figma, codeByBlock);
  assert.equal(diff.conflict.length, 1);
  assert.equal(diff.apply.length, 0);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`. Expected: FAIL — `diffComponents` not exported.

- [ ] **Step 3: Add `diffComponents` to `diff.mjs`**

Append to `scripts/figma/diff.mjs`:

```javascript
export function diffComponents(base, figma, codeByBlock) {
  const result = { apply: [], drift: [], conflict: [], proposeAdd: [], deprecated: [] };
  const allComponents = new Set([...Object.keys(base), ...Object.keys(figma)]);

  for (const compName of allComponents) {
    const baseComp = base[compName];
    const figmaComp = figma[compName];

    if (baseComp && !figmaComp) {
      result.deprecated.push({ component: compName, blockFolder: baseComp.blockFolder });
      continue;
    }
    if (!baseComp && figmaComp) {
      result.proposeAdd.push({ component: compName, blockFolder: figmaComp.blockFolder });
      continue;
    }

    const { blockFolder } = baseComp;
    const codeProps = codeByBlock[compName] || {};
    const allProps = new Set([
      ...Object.keys(baseComp.properties),
      ...Object.keys(figmaComp.properties),
    ]);

    for (const prop of allProps) {
      const baseVal = baseComp.properties[prop];
      const figmaVal = figmaComp.properties[prop];
      const codeVal = codeProps[prop];

      const figmaChanged = figmaVal !== baseVal;
      const codeChanged = codeVal !== baseVal;

      if (figmaChanged && !codeChanged) {
        result.apply.push({ component: compName, blockFolder, property: prop, from: baseVal, to: figmaVal });
      } else if (!figmaChanged && codeChanged) {
        result.drift.push({ component: compName, blockFolder, property: prop, base: baseVal, code: codeVal });
      } else if (figmaChanged && codeChanged && figmaVal !== codeVal) {
        result.conflict.push({ component: compName, blockFolder, property: prop, base: baseVal, figma: figmaVal, code: codeVal });
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`. Expected: all PASS (token tests + new component tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/figma/diff.mjs scripts/figma/__tests__/diff.test.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Extend three-way diff to component visual properties

Same diff matrix as tokens but keyed by component + property. Operates
on the whitelisted property snapshot produced by parse-block-css.
```

---

### Task D4: Safety rails — refusal predicates

**Files:**
- Create: `scripts/figma/safety.mjs`
- Create: `scripts/figma/__tests__/safety.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/figma/__tests__/safety.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCrossCollectionWrite,
  isUnmappedComponent,
  isSidenavJsWrite,
  isWhitelistedProperty,
} from '../safety.mjs';

test('cross-collection write: POP Brand writing to a foundation var is refused', () => {
  assert.equal(isCrossCollectionWrite('POP Brand', '--body-font-family'), true);
  assert.equal(isCrossCollectionWrite('Foundation', '--pop-color-primary'), true);
});

test('same-collection write is allowed', () => {
  assert.equal(isCrossCollectionWrite('POP Brand', '--pop-color-primary'), false);
  assert.equal(isCrossCollectionWrite('Foundation', '--body-font-family'), false);
});

test('unmapped component name (not in sync-state.components) is refused', () => {
  const knownComponents = ['Note', 'Warning', 'Tip'];
  assert.equal(isUnmappedComponent('Callout', knownComponents), true);
  assert.equal(isUnmappedComponent('Note', knownComponents), false);
});

test('writes to blocks/sidenav/sidenav.js are refused', () => {
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav.js'), true);
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav_data.js'), true);
  assert.equal(isSidenavJsWrite('blocks/sidenav/sidenav.css'), false);
});

test('non-whitelisted property is rejected', () => {
  assert.equal(isWhitelistedProperty('border-radius'), true);
  assert.equal(isWhitelistedProperty('color'), true);
  assert.equal(isWhitelistedProperty('box-shadow'), false);
  assert.equal(isWhitelistedProperty('transform'), false);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement `safety.mjs`**

Create `scripts/figma/safety.mjs`:

```javascript
// Centralised refusal predicates for Phase 2 sync. All return booleans.
// Higher-level callers translate `true` into an explanatory error message.

const POP_BRAND_PREFIX = '--pop-';

export function isCrossCollectionWrite(collection, cssVar) {
  if (collection === 'POP Brand') return !cssVar.startsWith(POP_BRAND_PREFIX);
  if (collection === 'Foundation') return cssVar.startsWith(POP_BRAND_PREFIX);
  // Unknown collection → always refuse.
  return true;
}

export function isUnmappedComponent(figmaCompName, knownComponents) {
  return !knownComponents.includes(figmaCompName);
}

export function isSidenavJsWrite(filePath) {
  return /^blocks\/sidenav\/sidenav(_data)?\.js$/.test(filePath);
}

const WHITELIST = new Set([
  'background-color', 'color', 'border-color',
  'border-width', 'border-style', 'border-radius',
  'padding', 'margin',
  'font-family', 'font-size', 'font-weight', 'line-height',
]);

export function isWhitelistedProperty(propName) {
  return WHITELIST.has(propName);
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/figma/safety.mjs scripts/figma/__tests__/safety.test.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add Phase 2 safety predicates

Cross-collection writes, unmapped component names, sidenav JS writes,
non-whitelisted properties — all centralised as pure predicates the
orchestrator translates into refusal errors.
```

---

### Task D5: CSS patcher — apply token updates to styles.css

**Files:**
- Create: `scripts/figma/patch.mjs`
- Create: `scripts/figma/__tests__/patch.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `scripts/figma/__tests__/patch.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchTokenInCss, patchBlockProperty } from '../patch.mjs';

test('patchTokenInCss updates a single declaration', () => {
  const css = `:root {
  --pop-color-primary: #642CDB;
  --pop-color-info:    #3B82F6;
}`;
  const out = patchTokenInCss(css, '--pop-color-primary', '#FF0000');
  assert.ok(out.includes('--pop-color-primary: #FF0000;'));
  assert.ok(out.includes('--pop-color-info:    #3B82F6;'));
});

test('patchTokenInCss preserves surrounding whitespace + trailing comments', () => {
  const css = `--pop-color-primary:   #642CDB;   /* primary accent */`;
  const out = patchTokenInCss(css, '--pop-color-primary', '#FF0000');
  assert.ok(out.includes('--pop-color-primary:   #FF0000;   /* primary accent */'));
});

test('patchTokenInCss throws when token not found', () => {
  const css = `--pop-color-primary: #642CDB;`;
  assert.throws(() => patchTokenInCss(css, '--pop-nonexistent', '#FF0000'), /not found/);
});

test('patchBlockProperty updates a property in the top-level selector', () => {
  const css = `.warning {
  border: 1px solid var(--pop-warning-ring);
  border-radius: var(--pop-block-radius);
}

.warning::before {
  color: var(--pop-warning-ring);
}`;
  const out = patchBlockProperty(css, 'warning', 'border-radius', '12px');
  assert.ok(out.includes('border-radius: 12px;'));
  // ::before block unchanged
  assert.ok(out.includes('.warning::before {\n  color: var(--pop-warning-ring);\n}'));
});

test('patchBlockProperty appends a missing property at the end of the top-level block', () => {
  const css = `.warning {
  border-radius: 8px;
}`;
  const out = patchBlockProperty(css, 'warning', 'background-color', '#FFFBEB');
  assert.ok(out.includes('background-color: #FFFBEB;'));
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement `patch.mjs`**

Create `scripts/figma/patch.mjs`:

```javascript
// Surgical edits to styles.css and blocks/<name>/<name>.css. Preserves
// formatting, comments, and whitespace as much as possible.

export function patchTokenInCss(css, cssVar, newValue) {
  // Match the declaration. Capture: name, separator (`:`+ws), old value (up to `;`).
  const escaped = cssVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped}\\s*:\\s*)([^;]+)(;)`);
  if (!re.test(css)) throw new Error(`patchTokenInCss: token ${cssVar} not found in CSS`);
  return css.replace(re, `$1${newValue}$3`);
}

export function patchBlockProperty(css, blockName, property, newValue) {
  // Find top-level selector body (same logic as parse-block-css).
  const selectorRe = new RegExp(`(\\.${blockName}\\s*\\{)([\\s\\S]*?)(\\n\\})`, 'm');
  const m = css.match(selectorRe);
  if (!m) throw new Error(`patchBlockProperty: selector .${blockName} not found`);
  const [full, open, body, close] = m;

  // Try to replace existing declaration in the top-level body only.
  const propRe = new RegExp(`(^|\\n)(\\s*)(${property})(\\s*:\\s*)([^;]+)(;)`, 'm');
  let newBody;
  if (propRe.test(body)) {
    newBody = body.replace(propRe, `$1$2$3$4${newValue}$6`);
  } else {
    // Append before the closing brace, preserving indentation from existing props.
    const indent = (body.match(/\n(\s+)\S/)?.[1]) || '  ';
    newBody = body.replace(/\n*$/, `\n${indent}${property}: ${newValue};\n`);
  }

  return css.replace(full, `${open}${newBody}${close}`);
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/figma/patch.mjs scripts/figma/__tests__/patch.test.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add surgical CSS patcher for tokens and block properties

patchTokenInCss replaces a single --pop-* / --foundation declaration
preserving surrounding formatting + trailing comments. patchBlockProperty
modifies a property inside a top-level selector body or appends it if
missing, never touching nested selectors.
```

---

### Task D6: Figma client abstraction

**Files:**
- Create: `scripts/figma/figma-client.mjs`
- Create: `scripts/figma/__tests__/figma-client.test.mjs`

This task is a thin abstraction so the orchestrator can be tested with fixtures. The real implementation calls Figma MCP tools; the test implementation returns a fixture.

- [ ] **Step 1: Write the test**

Create `scripts/figma/__tests__/figma-client.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixtureClient } from '../figma-client.mjs';

test('makeFixtureClient returns the fixture snapshot unchanged', async () => {
  const fixture = {
    versionId: 'v42',
    variables: { 'POP Brand': { 'Color/primary': { value: '#FF0000', cssVar: '--pop-color-primary' } } },
    components: {},
  };
  const client = makeFixtureClient(fixture);
  const got = await client.fetchSnapshot('any-key');
  assert.deepEqual(got, fixture);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement `figma-client.mjs`**

Create `scripts/figma/figma-client.mjs`:

```javascript
// Thin abstraction over Figma MCP reads. The orchestrator depends on this
// interface, not on MCP tool names directly — keeps tests fixture-driven
// and isolates us from MCP tool churn.

export function makeFixtureClient(snapshot) {
  return {
    async fetchSnapshot(/* fileKey */) {
      return snapshot;
    },
  };
}

// makeMcpClient is the real implementation. It is intentionally minimal
// here — the actual MCP tool calls happen via the Claude Code session,
// not from this script. This client is invoked by the orchestrator in
// "report mode" — it builds the request envelope; the human / Claude
// invokes the MCP tools and feeds the result back via stdin (see
// figma-sync.mjs Task D7).
export function makeStdinClient() {
  return {
    async fetchSnapshot(fileKey) {
      process.stderr.write(
        `Awaiting Figma snapshot on stdin for fileKey=${fileKey}…\n` +
        `Expected JSON shape: { versionId, variables, components }\n`
      );
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },
  };
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/figma/figma-client.mjs scripts/figma/__tests__/figma-client.test.mjs
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add Figma client abstraction (fixture + stdin variants)

Decouples the sync orchestrator from MCP tool specifics. Fixture client
backs unit tests; stdin client reads a snapshot piped in from a Claude
Code MCP session, so the human stays in the loop on every real fetch.
```

---

### Task D7: Sync orchestrator CLI

**Files:**
- Create: `scripts/figma-sync.mjs`
- Create: `scripts/figma/__tests__/orchestrator.test.mjs`
- Create: `scripts/figma/__tests__/fixtures/figma-snapshot-after-color-change.json`

- [ ] **Step 1: Create the snapshot fixture**

Create `scripts/figma/__tests__/fixtures/figma-snapshot-after-color-change.json`:

```json
{
  "versionId": "v2",
  "variables": {
    "POP Brand": {
      "Color/primary": { "value": "#FF0000", "cssVar": "--pop-color-primary" }
    },
    "Foundation": {}
  },
  "components": {
    "Note": {
      "blockFolder": "blocks/note",
      "properties": { "background-color": "#EFF6FF" }
    }
  }
}
```

- [ ] **Step 2: Write the orchestrator test (integration-level, fixture-driven)**

Create `scripts/figma/__tests__/orchestrator.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSync } from '../../figma-sync.mjs';
import { makeFixtureClient } from '../figma-client.mjs';

async function setupTempRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'figma-orch-'));
  // styles.css with primary token
  await mkdir(join(dir, 'styles'));
  await writeFile(join(dir, 'styles', 'styles.css'),
    `:root {\n  --pop-color-primary: #642CDB;\n}\n`);
  // blocks/note/note.css with bg
  await mkdir(join(dir, 'blocks', 'note'), { recursive: true });
  await writeFile(join(dir, 'blocks', 'note', 'note.css'),
    `.note {\n  background-color: #EFF6FF;\n}\n`);
  // .figma-sync.json baseline
  const state = {
    figmaFileUrl: 'x', figmaFileKey: 'k', lastSyncedVersionId: 'v1', lastSyncedAt: '2026-01-01T00:00:00Z',
    variables: {
      'POP Brand': { 'Color/primary': { value: '#642CDB', cssVar: '--pop-color-primary' } },
      Foundation: {},
    },
    components: {
      Note: { blockFolder: 'blocks/note', properties: { 'background-color': '#EFF6FF' } },
    },
  };
  await writeFile(join(dir, '.figma-sync.json'), JSON.stringify(state, null, 2));
  return dir;
}

test('runSync surfaces a token apply when Figma changed and code did not', async (t) => {
  const dir = await setupTempRepo();
  t.after(() => rm(dir, { recursive: true }));

  const fixture = JSON.parse(
    await readFile(new URL('./fixtures/figma-snapshot-after-color-change.json', import.meta.url), 'utf8'),
  );
  const client = makeFixtureClient(fixture);

  const result = await runSync({ repoRoot: dir, client, autoApprove: true });
  // Assert: --pop-color-primary now FF0000 in styles.css
  const css = await readFile(join(dir, 'styles', 'styles.css'), 'utf8');
  assert.ok(css.includes('--pop-color-primary: #FF0000;'), 'styles.css updated');
  // Sync-state updated with new versionId
  const newState = JSON.parse(await readFile(join(dir, '.figma-sync.json'), 'utf8'));
  assert.equal(newState.lastSyncedVersionId, 'v2');
  // No conflicts
  assert.equal(result.diff.tokens.conflict.length, 0);
  assert.equal(result.diff.tokens.apply.length, 1);
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `npm test`. Expected: FAIL.

- [ ] **Step 4: Implement the orchestrator**

Create `scripts/figma-sync.mjs`:

```javascript
#!/usr/bin/env node
// figma-sync — CLI orchestrator for Phase 2.
//
//   node scripts/figma-sync.mjs           — interactive, reads MCP via stdin
//   node scripts/figma-sync.mjs --auto    — non-interactive, exit non-zero
//                                            on conflicts. Used by tests.
//
// See specs/2026-05-22-figma-mcp-bootstrap-design.md.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSyncState, saveSyncState } from './figma/sync-state.mjs';
import { parseTokens } from './figma/parse-tokens.mjs';
import { parseBlockCss } from './figma/parse-block-css.mjs';
import { diffTokens, diffComponents } from './figma/diff.mjs';
import { patchTokenInCss, patchBlockProperty } from './figma/patch.mjs';
import { makeStdinClient } from './figma/figma-client.mjs';
import { isSidenavJsWrite } from './figma/safety.mjs';

export async function runSync({ repoRoot, client, autoApprove = false }) {
  const statePath = join(repoRoot, '.figma-sync.json');
  const state = await loadSyncState(statePath);
  const figma = await client.fetchSnapshot(state.figmaFileKey);

  // Build CODE side: parse tokens from styles.css, parse properties for each known component.
  const stylesCss = await readFile(join(repoRoot, 'styles/styles.css'), 'utf8');
  const codeTokens = flattenCssVarValues(stylesCss);

  const codeComponents = {};
  for (const [compName, info] of Object.entries(state.components)) {
    const cssPath = join(repoRoot, info.blockFolder, `${info.blockFolder.split('/').pop()}.css`);
    const blockCss = await readFile(cssPath, 'utf8');
    const parsed = parseBlockCss(blockCss, info.blockFolder.split('/').pop());
    codeComponents[compName] = parsed.properties;
  }

  const tokensDiff = diffTokens(state.variables, figma.variables, codeTokens);
  const compsDiff = diffComponents(state.components, figma.components, codeComponents);

  // Conflicts halt apply, even with --auto.
  if (!autoApprove && (tokensDiff.conflict.length || compsDiff.conflict.length)) {
    process.stderr.write('Conflicts detected; review required. No writes performed.\n');
    return { diff: { tokens: tokensDiff, components: compsDiff }, applied: false };
  }

  // Apply token changes.
  let nextStyles = stylesCss;
  for (const change of tokensDiff.apply) {
    nextStyles = patchTokenInCss(nextStyles, change.cssVar, change.to);
  }
  await writeFile(join(repoRoot, 'styles/styles.css'), nextStyles, 'utf8');

  // Apply component property changes. Refuse sidenav JS (defense in depth — we only write CSS anyway).
  const fileWrites = new Map();
  for (const change of compsDiff.apply) {
    const cssPath = join(change.blockFolder, `${change.blockFolder.split('/').pop()}.css`);
    if (isSidenavJsWrite(cssPath.replace(/\\.css$/, '.js'))) {
      // We never write JS, so this is purely a sanity guard.
      continue;
    }
    const absPath = join(repoRoot, cssPath);
    if (!fileWrites.has(absPath)) {
      fileWrites.set(absPath, await readFile(absPath, 'utf8'));
    }
    const blockName = change.blockFolder.split('/').pop();
    fileWrites.set(absPath, patchBlockProperty(fileWrites.get(absPath), blockName, change.property, change.to));
  }
  for (const [path, contents] of fileWrites) {
    await writeFile(path, contents, 'utf8');
  }

  // Update sync-state: new versionId, new variable/component snapshot.
  const newState = {
    ...state,
    lastSyncedVersionId: figma.versionId,
    lastSyncedAt: new Date().toISOString(),
    variables: figma.variables,
    components: figma.components,
  };
  await saveSyncState(statePath, newState);

  return { diff: { tokens: tokensDiff, components: compsDiff }, applied: true };
}

function flattenCssVarValues(css) {
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  const out = {};
  let m;
  while ((m = re.exec(css)) !== null) out[m[1]] = m[2].trim();
  return out;
}

// CLI entry — only runs when invoked directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = process.cwd();
  const client = makeStdinClient();
  const autoApprove = process.argv.includes('--auto');
  const result = await runSync({ repoRoot, client, autoApprove });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `npm test`. Expected: all PASS (token + comp + safety + patch + orchestrator).

- [ ] **Step 6: Commit**

```bash
git add scripts/figma-sync.mjs scripts/figma/__tests__/orchestrator.test.mjs scripts/figma/__tests__/fixtures/figma-snapshot-after-color-change.json
git commit -F /tmp/figma-commit-msg.txt
```

Commit message:
```
Add Phase 2 sync orchestrator

CLI that reads .figma-sync.json + a Figma snapshot, computes the
three-way diff for tokens and components, applies non-conflicting
changes to styles.css and blocks/*/*.css, and updates sync-state.
Conflicts halt apply with a non-zero status.
```

---

# Part E — End-to-end Phase 2 acceptance (manual)

These are the acceptance tests from the spec's "Phase 2" section. Each is a one-off manual procedure, not a `node:test` case.

### Task E1: Token-only round trip

- [ ] **Step 1: Edit a variable in Figma**

In the Figma file, change `Color/primary` in "POP Brand" from `#642CDB` to `#FF0000`.

- [ ] **Step 2: Pull the Figma snapshot via Claude + MCP**

In a Claude Code session in this repo, prompt:
> "Fetch the current Figma snapshot for the POP EDS Design System file via MCP and pipe the JSON (with `versionId`, `variables`, `components`) into `node scripts/figma-sync.mjs`. Show me the diff before applying."

- [ ] **Step 3: Verify proposed diff**

Output should show one entry in `tokens.apply`:
```
--pop-color-primary: #642CDB → #FF0000
```

- [ ] **Step 4: Approve and apply**

Run:
```bash
node scripts/figma-sync.mjs --auto < /tmp/figma-snapshot.json
```

(Where `/tmp/figma-snapshot.json` is the snapshot Claude fetched.)

- [ ] **Step 5: Verify the change**

Run:
```bash
git diff styles/styles.css .figma-sync.json
```

Expected: `styles.css` shows `--pop-color-primary: #FF0000;`, `.figma-sync.json` shows updated version ID and value.

- [ ] **Step 6: Commit and push**

```bash
git add styles/styles.css .figma-sync.json
git commit -F /tmp/figma-commit-msg.txt
git push
```

Commit message:
```
Sync from Figma: --pop-color-primary -> #FF0000
```

- [ ] **Step 7: Watch the deploy pipeline**

Watch the GitHub Action complete, then verify the change is visible at https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference (look at any element using `--pop-color-primary`).

- [ ] **Step 8: Roll back**

Change `Color/primary` back to `#642CDB` in Figma, re-sync, push, verify reverted. Confirms the round-trip is repeatable.

---

### Task E2: Component visual round trip

- [ ] **Step 1: Edit the Warning component's `border-color` in Figma**

In the Figma file, find the Warning master Component. Change its border color from the Variable binding (`pop-warning-ring`) to a literal `#FF00FF` (intentionally garish so the result is unmistakable on the live site).

- [ ] **Step 2: Sync**

Run the same fetch-and-sync flow as E1.

- [ ] **Step 3: Verify**

Expected diff: `components.apply` contains one entry for `Warning.border-color`. After apply, `blocks/warning/warning.css` has `border-color: #FF00FF;` (or whatever the equivalent literal is — note that the `border: 1px solid var(--pop-warning-ring);` shorthand may not be touched directly; the patcher writes a `border-color:` property).

If the patcher's `border` shorthand handling is wrong, fix it inline in `patch.mjs` and add a regression test.

- [ ] **Step 4: Roll back via Figma + re-sync**

Same as E1 step 8.

---

### Task E3: Conflict detection

- [ ] **Step 1: Edit Figma AND code for the same property between syncs**

In Figma: change `Color/info` from `#3B82F6` to `#000000`.
In a terminal: manually edit `styles/styles.css` to change `--pop-color-info: #FF0000;`. Don't commit.

- [ ] **Step 2: Run sync (interactive — no `--auto`)**

```bash
node scripts/figma-sync.mjs < /tmp/figma-snapshot.json
```

- [ ] **Step 3: Verify behavior**

Expected: stderr shows "Conflicts detected; review required. No writes performed." Exit code non-zero. `styles.css` and `.figma-sync.json` unchanged from the in-progress state (you'll need to manually revert your local edit).

- [ ] **Step 4: Resolve and re-sync**

Revert the manual edit to `styles.css` (`git checkout styles/styles.css`). Re-run sync. Expected: clean apply of the Figma change.

---

### Task E4: Safety rail enforcement (smoke)

- [ ] **Step 1: Add a quick smoke test**

In a Node REPL or one-off script:

```javascript
import { isSidenavJsWrite, isCrossCollectionWrite, isUnmappedComponent }
  from './scripts/figma/safety.mjs';

console.log(isSidenavJsWrite('blocks/sidenav/sidenav.js'));      // true
console.log(isCrossCollectionWrite('POP Brand', '--body-font-family')); // true
console.log(isUnmappedComponent('Callout', ['Note','Warning']));  // true
```

All three should print `true`. Already covered by `safety.test.mjs` — this is just a sanity walk.

- [ ] **Step 2: Attempt an unmapped-component scenario in Figma**

Rename a Figma component (e.g. Note → Callout). Sync. Expected behavior: the orchestrator should refuse to apply changes for the unmapped component name and surface a clear message. If it doesn't, file a follow-up to wire `isUnmappedComponent` into the orchestrator's apply step (it's currently only in `safety.mjs` for use; D7 doesn't yet call it explicitly).

Rename back to Note before continuing.

---

### Task E5: Final deploy verification

- [ ] **Step 1: Run one more deliberate token change end-to-end**

Pick a small, reversible Variable change (e.g. `--pop-block-radius` from `8px` to `4px`). Sync. Commit. Push.

- [ ] **Step 2: Watch the pipeline + verify on aem.live**

Confirm:
- GitHub Action `transform-dita.yml` runs and completes
- GitHub Pages serves the updated `/docs/`
- aem.live's html2md ingests
- Visual change appears at https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference

- [ ] **Step 3: Revert**

Change back in Figma, re-sync, push.

- [ ] **Step 4: Update project memory**

Add a memory entry noting the Figma file URL + that Phase 1 + Phase 2 are validated end-to-end.

---

## Self-review notes

After writing this plan I checked back against the spec sections:

| Spec section | Plan task(s) |
|---|---|
| Phase 1 architecture (file creation, Variables, capture, componentize) | C1–C6 |
| Phase 2 architecture (trigger, three-way diff, apply, deploy) | D1–D7, E1–E5 |
| Figma file structure (Variables, Components, Sample Page) | C2, C3, C4 |
| Naming conventions (Component → folder, Variable → cssVar) | Enforced by `parse-block-css` + `safety.isUnmappedComponent` + sync-state schema |
| Tier 1+2 component scope (10 blocks) | C4 step 2 enumerates all 10 |
| Aliased Variables description string | C2 step 2 explicitly requests `[alias: ...]` |
| Sample Page is not a sync source | Not enforced in code (orchestrator only reads `figma.components`, which by spec are masters on the Components page). Document this assumption in `figma-client.mjs`. **Action: add a comment to `figma-client.mjs` in D6 noting this contract.** |
| Three-way diff matrix | D2 (tokens), D3 (components) |
| Component-property whitelist | `parse-block-css.mjs` (B3), `safety.mjs` (D4) |
| Safety rails (cross-collection, unmapped, sidenav JS, deprecated never auto-remove) | D4 + `diffTokens.deprecated` (D2) |
| Phase 1 acceptance tests | C6 |
| Phase 2 acceptance tests | E1–E5 |

Gaps fixed inline:
- The orchestrator (D7) doesn't actively call `isUnmappedComponent` or `isCrossCollectionWrite` in the apply loop — E4 calls this out for follow-up. Decision: leave as a follow-up rather than expand D7, because the diff stage already ignores unknown component names (they appear only in `proposeAdd`, never `apply`) and cross-collection writes can't structurally occur (the diff is per-collection by construction). The predicates exist for *higher-order* checks (e.g. validating Figma payloads before trusting them); wiring them into the orchestrator can come in a hardening pass.

---

## Execution handoff

Plan complete and saved to `specs/2026-05-22-figma-mcp-bootstrap-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each task is small and self-contained, well-suited to subagent execution. The Phase 1 interactive tasks (Part C) need the human in the loop with Figma open, so those won't be subagent-friendly — execute those inline.
2. **Inline Execution** — Execute all tasks in this session using executing-plans, batch execution with checkpoints. Simpler but slower.

Which approach?
