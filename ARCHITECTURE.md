# Architecture — AEM Guides → EDS POC

This is the canonical reference for how the POC works end-to-end.
See [`handoff-microservice-config.md`](handoff-microservice-config.md) for the AEM-side cloud configuration that enabled this pipeline.

## Live URLs

| | URL |
|---|---|
| Preview | https://main--pop-eds-md--cole20444.aem.page/ |
| Live | https://main--pop-eds-md--cole20444.aem.live/ |
| GitHub repo (EDS frontend + content) | https://github.com/cole20444/pop-eds-md |
| GitHub Pages source (what aem.live reads) | https://cole20444.github.io/pop-eds-md/ |

## Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│ AUTHORING                                                            │
│                                                                      │
│  AEM Guides (POP AEMaaCS dev)                                        │
│    └─ DITA topics + ditamap in DAM                                   │
│    └─ Map console → EDS output preset → Generate Output (Push live)  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  HTTPS + IMS access token (Adobe-internal)
┌──────────────────────────────────────────────────────────────────────┐
│ PUBLISHING                                                           │
│                                                                      │
│  Adobe-hosted publishing microservice                                │
│    └─ Runs DITA-OT in an isolated container                          │
│    └─ Writes HTML files to /docs/ in the GitHub repo                 │
│    └─ Writes navigation tree to /blocks/sidenav/sidenav.js +         │
│       sidenav_data.js (ditamap structure baked in as JS constants)   │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  `Publishing for franklin` commits land
┌──────────────────────────────────────────────────────────────────────┐
│ TRANSFORM                                                            │
│                                                                      │
│  GitHub repo  cole20444/pop-eds-md                                   │
│    ↓                                                                 │
│  GitHub Action  .github/workflows/transform-dita.yml                 │
│    └─ Triggers on push to docs/**.htm / docs/**.html                 │
│    └─ Runs  scripts/transform-dita.mjs  (cheerio-based)              │
│       • strips DITA-OT cruft (prolog, breadcrumbs, prefix labels)    │
│       • rewrites div-based tables → <div class="table"> EDS blocks   │
│       • <code class=codeblock> → <pre><code> with normalized newlines│
│       • <div class=note ...> → <div class=warning|tip|caution|...>   │
│       • span.uicontrol → <b>, span.filepath → <code>                 │
│       • wraps body in helix-html2md's required <main><div>…</div>    │
│       • renames .htm → .html (GitHub Pages needs .html for clean URL │
│         resolution)                                                  │
│    └─ Commits cleaned HTML back to /docs/                            │
│       Commit message: "Clean DITA HTML for EDS rendering"            │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  Push lands on main
┌──────────────────────────────────────────────────────────────────────┐
│ HOSTING                                                              │
│                                                                      │
│  GitHub Pages  https://cole20444.github.io/pop-eds-md/               │
│    └─ Serves /docs/ at the github.io URL                             │
│    └─ Extension-less URLs resolve to .html files                     │
│    └─ ~30s build/deploy lag after each push                          │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  fstab.yaml mountpoint, type: markup
┌──────────────────────────────────────────────────────────────────────┐
│ DELIVERY                                                             │
│                                                                      │
│  aem.live                                                            │
│    └─ Fetches HTML from GitHub Pages on each preview/publish trigger │
│    └─ helix-html2md converts HTML → markdown                         │
│    └─ content-bus caches the markdown per webPath                    │
│    └─ Page render: markdown → HTML with EDS framing                  │
│       (<header>, <main><div class="section">…</div></main>, <footer>)│
│    └─ Client-side: scripts/scripts.js + /blocks/<name>/<name>.js     │
│       run, decorating blocks and injecting the sidenav.              │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
                          End user's browser
```

## Why this shape (the architectural choices)

### Why GitHub Pages instead of Adobe's `dita-franklin-worker`

Adobe's hosted worker that's *supposed* to serve our DITA-published HTML returns Cloudflare error 1042 — its internal architecture violates Cloudflare's same-zone fetch restriction. Adobe-side fix only. Until they fix it, GitHub Pages is a free, reliable alternative that we control.

Trade-off: an extra `~30s` between AEM publish and aem.live picking up the change (GitHub Pages build time + aem.live's source-modified check).

### Why a transform Action instead of letting `html2md` see DITA-OT output directly

`helix-html2md` requires `<main><div>…</div></main>` as the exact body shape. DITA-OT's HTML has none of that — bare `<h1>` and `<p>` children of `<body>`, with `<div class="note note_warning">` blocks (not `<div class="warning">`), `<table class="table-headcount-N">` for data tables (not `<table>`), and a lot of DITA-specific class noise. Without the transform, html2md returns empty markdown.

The transform also flattens DITA wrappers (`<div class="p">`, `<div class="shortdesc">`, nested span/div soup) into clean semantic HTML — much smaller surface area for aem.live to break on.

### Why `<div class="table">` for tables instead of `<table>`

aem.live treats every `<table>` (and gridtable) as a BLOCK, using the first cell text as the class name. A data table whose first column header is "Metric" becomes `<div class="metric">…` and the header row gets consumed as the block name.

By wrapping ALL DITA tables as `<div class="table">` (with rows as nested divs), we get a CONSISTENT block name across every data table. The first row (column headers) is preserved as the first data row. `/blocks/table/table.js` then promotes the structure into a real `<table>` with `<thead>` + `<tbody>` for accessibility and styling.

## File-level map

```
pop-eds-md/                              ← GitHub repo (the EDS frontend)
├── .github/workflows/transform-dita.yml ← Action that cleans DITA HTML
├── scripts/
│   ├── scripts.js                       ← entry point; injects sidenav, decorates blocks
│   ├── aem.js                           ← EDS runtime (from boilerplate, unchanged)
│   └── delayed.js                       ← deferred analytics (boilerplate)
├── scripts/transform-dita.mjs           ← (note: outside the repo) the DITA → EDS transform
├── styles/
│   ├── styles.css                       ← boilerplate base + POP modernization layer at the end
│   ├── fonts.css
│   └── lazy-styles.css
├── blocks/
│   ├── note/        ← POP-branded (built fresh)
│   ├── warning/
│   ├── tip/
│   ├── caution/
│   ├── important/
│   ├── table/       ← with table.js to promote <div class=table> → <table>
│   ├── sidenav/     ← AEM-overwritten on each publish; contains the ditamap data
│   ├── header/      ← boilerplate, used for top bar
│   ├── footer/      ← boilerplate
│   ├── container/   ← boilerplate, generic
│   ├── fragment/    ← boilerplate, generic
│   └── minitoc/     ← boilerplate, for in-page TOC (not currently triggered)
├── docs/                                ← AEM Guides publishes here
│   ├── index.html                       ← map homepage
│   ├── nav.html / footer.html           ← boilerplate site chrome (auto-overwritten on publish)
│   └── contents/topics/*.html           ← topic pages (auto-overwritten on publish)
├── fstab.yaml                           ← mountpoint: GitHub Pages URL, type: markup
├── head.html                            ← <head> content for all pages
└── test-dita/                           ← source DITA used for testing (concept + task + ditamap)
```

## Operational notes

- **To edit block CSS/JS:** edit locally → `git push` → ~5-15s later it's served on aem.page (block files bypass our transform Action and go through aem.live's code-bus directly). Hard-refresh (Cmd+Shift+R) to see changes.
- **To edit a topic's content:** must be done in AEM Guides authoring (it's the CCMS). Then Generate Output → wait ~1-2 min for the full pipeline.
- **To preview locally without pushing:** `aem up` in the repo dir runs a proxy at localhost:3000 that serves your local /blocks/, /styles/, /scripts/ files but proxies content from the live aem.page.
- **Multi-map limitation:** `/blocks/sidenav/*` is overwritten by AEM on every publish, so the nav only shows the most recently published map. If you publish multiple maps to this repo, the older maps' navigation disappears. Use a master ditamap with `<mapref>`s for multi-doc sites.
- **Cache propagation:** when in doubt, force a preview via the admin API: `curl -X POST https://admin.hlx.page/preview/cole20444/pop-eds-md/main/<path> -H "Content-Length: 0"`.

## Cleanup / hygiene to-do

| Item | Why | Owner |
|---|---|---|
| Rotate POP Adobe OAuth `client_secret` | Leaked in chat 2026-05-20 — see memory feedback note | Cole |
| Archive abandoned repos (`kyndryl-guides-eds`, `pop-guides-eds`, `pop-eds-docs`, `pop-eds`) | Reduce confusion about which is current | Cole |
| Swap brand tokens in `styles/styles.css` to official POP palette | Currently placeholder hex values | Whoever owns POP brand |
| Add mobile hamburger toggle for sidenav | Boilerplate hides it < 900px; no mobile nav | future |
| Adobe support ticket for `dita-franklin-worker` 1042 error | We're working around a real bug | Cole/Adobe |
