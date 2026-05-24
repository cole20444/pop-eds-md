# Figma MCP integration: bootstrap and ongoing sync

**Date:** 2026-05-22
**Author:** Cole Spicer + Claude (brainstorming session)
**Status:** Approved, ready for implementation planning

## Goal

Wire the existing AEM Guides → EDS pipeline up to Figma so that:

1. **Phase 1 (one-time bootstrap):** A designer is handed a Figma file that mirrors the current POP-branded EDS components, tokens, and a representative sample page — built directly from this repo via Figma's official MCP server, with no html.to.design plugin, custom token scripts, or custom Figma plugins required.
2. **Phase 2 (ongoing):** When the designer iterates on Components or Variables in that Figma file, we pull those changes back into the repo as targeted edits to `styles/styles.css` and `blocks/<name>/<name>.css`, then deploy through the existing pipeline (GitHub → transform Action → GitHub Pages → aem.live).

Same Claude Code session drives both phases via the same MCP server.

## Non-goals

- Round-tripping JS / block structure. Component visual properties only.
- Automatic / webhook-triggered sync. Trigger is always manual.
- Designer-side tooling beyond a Figma account with sufficient privileges. No plugin install on the designer's side.
- Page-level layout changes. Sample Page exists as a designer reference, not as a sync target.
- Replacing any of the existing AEM Guides → DITA-OT → GitHub Pages → aem.live plumbing. The Figma layer sits beside it.

## Architecture

Two phases, both run from a Claude Code session inside this repo, both use Figma's official remote MCP server.

```
PHASE 1 (one-time bootstrap)
============================
1. claude plugin install figma@claude-plugins-official   (one-time, on Cole's machine)
2. OAuth into Figma                                       (one-time, browser flow)
3. Create new Figma file "POP EDS Design System"
4. Parse --pop-* and boilerplate tokens from styles/styles.css
   └→ MCP: create two Variable collections (POP Brand, Foundation)
5. Capture live aem.live render of dita-elements
   └→ MCP: editable Figma layers on a "Sample Page" tab
6. Componentize each block instance
   └→ MCP: convert to Figma Components on a "Components" page,
           bind fills/strokes/typography to seeded Variables
7. Write .figma-sync.json snapshot, commit
8. Share file URL with designer

PHASE 2 (ongoing, designer-driven iteration)
============================================
1. Designer iterates on Components + Variables in Figma
2. Designer signals "ready" out-of-band (Slack/email)
3. Cole asks Claude in this repo: "pull updates from Figma"
4. Claude reads file via MCP, three-way diffs against
   .figma-sync.json (BASE) + Figma (FIGMA) + repo (CODE)
5. Claude proposes unified patch:
     - Variable changes  → styles/styles.css (--pop-* / boilerplate updates)
     - Component visuals → blocks/<name>/<name>.css updates
6. Cole reviews diff, approves
7. Claude writes files + updates .figma-sync.json + commits
8. Existing pipeline deploys:
     GitHub push → transform Action → /docs/*.html → GitHub Pages
                 → fstab.yaml mountpoint → aem.live html2md → aem.page
```

Key design property: Phase 2 is purely visual-property sync. Structural changes (designer adds a new child element to the Note component) are flagged as "needs human translation" — Claude surfaces them but never auto-applies.

## Figma file structure

One file, three pages (Figma tabs).

```
POP EDS Design System.fig
├── 📄 Variables          ← Variables collection (no canvas content)
│   ├── Collection: POP Brand            (mapped from --pop-*)
│   │   ├── Color/
│   │   │   ├── primary           #642CDB   ← --pop-color-primary
│   │   │   ├── info              #3B82F6   ← --pop-color-info
│   │   │   ├── success           #10B981   ← --pop-color-success
│   │   │   ├── warning           #F59E0B   ← --pop-color-warning
│   │   │   ├── caution           #F97316   ← --pop-color-caution
│   │   │   └── danger            #EF4444   ← --pop-color-danger
│   │   ├── Block tints/
│   │   │   ├── note-tint, note-ring        ← --pop-note-*
│   │   │   ├── warning-tint, warning-ring  ← --pop-warning-*
│   │   │   ├── tip-tint, tip-ring          ← --pop-tip-*
│   │   │   ├── caution-tint, caution-ring  ← --pop-caution-*
│   │   │   └── important-tint, important-ring ← --pop-important-*
│   │   ├── Table/
│   │   │   ├── header-bg, header-fg, row-alt-bg, border ← --pop-table-*
│   │   └── Layout/
│   │       ├── block-radius (8px)          ← --pop-block-radius
│   │       ├── block-pad-y (14px)          ← --pop-block-pad-y
│   │       ├── block-pad-x (18px)          ← --pop-block-pad-x
│   │       └── block-gap (1.25rem)         ← --pop-block-gap
│   └── Collection: Foundation           (mapped from boilerplate)
│       ├── Typography/
│       │   ├── font-family-body, font-family-fixed
│       │   └── body-font-size-m/s/xs/xxs
│       ├── Color/link, link-hover, text, background
│       └── Sidenav/bg, title, selection, text, bullet
│
├── 📄 Components         ← One frame per block, each as a Figma Component
│   ├── Note              (POP-branded, Tier 1)
│   ├── Warning           (POP-branded, Tier 1)
│   ├── Tip               (POP-branded, Tier 1)
│   ├── Caution           (POP-branded, Tier 1)
│   ├── Important         (POP-branded, Tier 1)
│   ├── Table             (POP-branded, Tier 1)
│   ├── Header            (structural, Tier 2)
│   ├── Footer            (structural, Tier 2)
│   ├── Sidenav           (structural, Tier 2)
│   └── Minitoc           (structural, Tier 2)
│
└── 📄 Sample Page        ← Captured dita-elements aem.live render
    └── (full-page frame using Component instances above)
```

### Naming conventions (load-bearing for Phase 2 sync)

- **Component name in Figma → block folder name in repo.** `Note` → `blocks/note/`. `Warning` → `blocks/warning/`. Phase 2 sync refuses to write when a Figma component name doesn't map to an existing block folder.
- **Variable name in Figma → CSS custom property name in styles.css.** `pop-color-primary` → `--pop-color-primary`. Names derived from the CSS during Phase 1 bootstrap so the mapping starts consistent.
- **Two Variable collections, two destinations.** "POP Brand" can only write to `--pop-*` declarations. "Foundation" can only write to boilerplate declarations. Cross-collection writes refused.

### Tier classification

- **Tier 1 — POP-branded callouts (in scope, high iteration value):** Note, Warning, Tip, Caution, Important, Table.
- **Tier 2 — Structural / chrome (in scope, lower iteration frequency):** Header, Footer, Sidenav, Minitoc.
- **Tier 3 — Utility blocks (out of scope, code-only):** Container, Fragment. No visual surface to iterate on; including them just adds Figma file noise. Trivial to add later if needed.

### Aliased variables

Tokens defined as `var(--other-token)` aliases (e.g. `--pop-note-ring: var(--pop-color-info)`) are stored in Figma as the resolved value, with a description string `[alias: pop-color-info]` so the designer knows. Aliases are preserved in code regardless of what the designer does in Figma — Phase 2 never expands or collapses aliases.

## Phase 2: trigger, state tracking, conflict resolution

### Trigger

Manual, natural language in Claude Code. Designer signals "ready" out-of-band. Cole asks Claude in this repo: *"pull latest from Figma"* or similar. No polling, no webhooks, no scheduled jobs.

### Sample Page is not a sync source

Sync reads from the master Components on the "Components" page only. Component *instances* placed on the "Sample Page" tab are ignored. If the designer accidentally edits a Sample Page instance instead of the master, those overrides are surfaced as warnings (`"<Component> has unsynced overrides on Sample Page"`) but never written to code. Sample Page exists purely as designer reference / composition playground.

### State tracking: `.figma-sync.json`

A new file at the repo root, committed to git. Holds:

```json
{
  "figmaFileUrl": "https://www.figma.com/design/<key>/POP-EDS-Design-System",
  "figmaFileKey": "<key>",
  "lastSyncedVersionId": "<figma-file-version-id>",
  "lastSyncedAt": "2026-05-22T14:30:00Z",
  "variables": {
    "POP Brand": {
      "Color/primary": { "value": "#642CDB", "cssVar": "--pop-color-primary" },
      "Color/info":    { "value": "#3B82F6", "cssVar": "--pop-color-info" }
    },
    "Foundation": {
      "Typography/font-family-body": {
        "value": "Poppins, adobe-clean, …",
        "cssVar": "--body-font-family"
      }
    }
  },
  "components": {
    "Note": {
      "blockFolder": "blocks/note",
      "properties": {
        "background-color": "#EFF6FF",
        "border-color": "#3B82F6",
        "border-radius": "8px",
        "padding": "14px 18px"
      }
    }
  }
}
```

Updated atomically on every successful sync.

### Three-way diff algorithm

For each token / component property:

| FIGMA vs BASE | CODE vs BASE | Action |
|---|---|---|
| Changed | Unchanged | Apply (clean update) |
| Unchanged | Changed | No-op; surface as "code drift" |
| Changed | Changed | Conflict; surface, do not auto-apply |
| Added in FIGMA | N/A | Propose add, user confirms |
| Removed in FIGMA | N/A | Never auto-remove; surface as "deprecated in Figma" only |

The "never auto-remove" rule is deliberate: accidentally dropping a Variable in Figma must not delete a CSS custom property that other code may depend on.

### Component-property whitelist

Only these CSS properties are synced. Anything else stays code-only.

- Colors: `background-color`, `color`, `border-color`
- Borders: `border-width`, `border-style`, `border-radius`
- Spacing: `padding`, `margin` (top-level selector only, not nested rules)
- Typography: `font-family`, `font-size`, `font-weight`, `line-height`

If a Figma change implies something outside this list (drop-shadow, gradient, transform, complex layout shifts), Claude flags it as *"needs human translation"* and skips it.

### Review flow

Every sync proposes a unified diff across `styles/styles.css` and `blocks/*/*.css` before any write. Cole approves → Claude writes + updates `.figma-sync.json` + commits. Cole rejects → nothing happens.

### Safety rails

1. **Sidenav JS is hard-refused.** Writes to `blocks/sidenav/sidenav.js` or `blocks/sidenav/sidenav_data.js` are blocked with explicit error: these files are owned by AEM Guides publishes (per gotcha in `eds-integration` memory — overwritten on every publish). Only `blocks/sidenav/sidenav.css` is sync-eligible for the Sidenav component.
2. **Cross-collection writes refused.** A "POP Brand" Variable cannot somehow target a boilerplate `--body-*` var. Collection → destination mapping is fixed.
3. **Unmapped Component names refused.** Designer renames "Note" to "Callout" → sync stops at that component until Cole explicitly re-maps in `.figma-sync.json`. No guessing.
4. **Non-whitelisted properties skipped.** Surface, don't apply. See whitelist above.
5. **Deletions never auto-apply.** See three-way diff table.

## Acceptance tests

Manual verification, no automated test suite. This is integration with external tooling; honest verification beats fragile mocked tests.

### Phase 1 (one-time bootstrap)

1. `claude mcp list` shows `figma` connected.
2. Figma file "POP EDS Design System" exists at a known URL.
3. "POP Brand" and "Foundation" Variable collections exist; spot-check 3 values match raw `--pop-*` / boilerplate declarations in `styles/styles.css`.
4. "Sample Page" tab visibly resembles the live `dita-elements` aem.live render at https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference (acceptable fidelity for designer starting point; not pixel-perfect).
5. 10 Components exist on the "Components" page with the names listed in Section "Figma file structure". Each Component's fills / strokes / typography reference Variables from the seeded collections rather than raw hex values.
6. `.figma-sync.json` committed with file URL, version ID, and snapshot.

### Phase 2 (sync direction, run once before declaring done)

1. **Token-only round trip.** Manually edit `Color/primary` in "POP Brand" from `#642CDB` to `#FF0000`. Run sync. Confirm: diff proposed, approved, `styles/styles.css` `--pop-color-primary` updated, `.figma-sync.json` updated, no other files touched.
2. **Component visual round trip.** Change the Warning component's `border-color` in Figma. Run sync. Confirm: diff touches only `blocks/warning/warning.css`, the right CSS property is updated.
3. **Conflict detection.** Make a Variable change in Figma AND a manual edit to the same property in `styles.css` between syncs. Run sync. Confirm: conflict surfaced, no auto-apply, user prompted.
4. **Safety rail — sidenav JS.** Attempt to coerce a write to `blocks/sidenav/sidenav.js`. Confirm: hard-refused with explanation.
5. **Deploy.** After a successful sync, `git push`, watch the existing GitHub Action + Pages + aem.live pipeline pick up the change. Visible color/style change on the live preview at https://main--pop-eds-md--cole20444.aem.page/

## Open risks (flagged, not solved)

1. **Beta + paid-tier landing.** Figma's MCP server is in beta and will become usage-based paid. Acceptable for POC; steady-state cost story unknown.
2. **Live UI capture fidelity AND capture mechanism for public URLs.** The MCP's "capture live web app → editable Figma layers" is the bootstrap step we trust the MCP for. Two unknowns sit underneath it: (a) Figma's docs primarily show capture working against a *local* server (`"Start a local server for my app and capture the UI in a new Figma file"`); whether it works equally well against a public URL like our aem.live preview is undocumented and needs to be tested early in implementation. If public-URL capture fails or produces low-quality output, fallback options in priority order are: (i) run the site locally via the EDS dev server and capture from there, (ii) feed Claude a screenshot of the aem.live page and have it author the Figma frames from that, (iii) hand-build the Sample Page from primitives. (b) Independent of capture mechanism, layer fidelity for individual blocks may be low; if so, hand-build those Components using the seeded Variables.
3. **Variables write tier requirement.** Figma docs are silent on whether Variables-write needs Pro+ or higher. If hit mid-bootstrap, fallback is to write to local Styles (older, less powerful, available on all plans) and accept the downgrade.
4. **Block ↔ Component mapping is heuristic.** During captures, we identify "this Figma frame is a Note" by matching the rendered class name (`div.note`). If the capture mangles class names, the componentize step needs manual hand-off.
5. **`dita-elements.dita` must be published first.** Bootstrap depends on the live aem.live URL existing. As of 2026-05-22 the file is on disk at `test-dita/dita-elements.dita` and the live URL https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference is reachable per Cole. Verify reachability immediately before Phase 1 bootstrap runs; if 404, publish from AEM Guides first.

## Prerequisites and references

### Live URLs

- **aem.live preview (sample page target):** https://main--pop-eds-md--cole20444.aem.live/contents/topics/dita-element-rendering-reference
- **aem.page (pre-publish preview):** https://main--pop-eds-md--cole20444.aem.page/

### Key files in this repo

- `styles/styles.css` — source of truth for design tokens (`--pop-*` + boilerplate)
- `blocks/<name>/<name>.css` — per-block styling, Phase 2 sync targets
- `scripts/transform-dita.mjs` — existing DITA HTML → EDS-shaped HTML transform (untouched by this spec)
- `.figma-sync.json` — new, repo root, committed to git, holds sync state

### Figma MCP install (one-time)

```bash
claude plugin install figma@claude-plugins-official
```

OAuth happens via browser on first MCP use; click *Allow access*.

### External references

- [Figma blog: From Claude Code to Figma](https://www.figma.com/blog/introducing-claude-code-to-figma/)
- [Figma Help: Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559)
- [Figma Help: Claude Code and Figma — set up the MCP server](https://help.figma.com/hc/en-us/articles/39888612464151-Claude-Code-and-Figma-Set-up-the-MCP-server)
- [Figma Developer Docs: Remote server installation](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)
