// Transforms DITA-OT HTML output into clean semantic HTML that aem.live's
// html2md can convert into useful markdown for EDS rendering.
//
// Walks /docs/ recursively and rewrites each .htm file in place. Original
// versions remain in git history if you need them.
//
// Run locally:  node scripts/transform-dita.mjs
// Runs in CI:   .github/workflows/transform-dita.yml

import { readdir, readFile, writeFile, stat, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = 'docs';

// Inline tags we keep when extracting paragraph-content from a DITA wrapper.
// Block-level tags (div, section, etc.) are unwrapped — we grab their inner
// content and continue.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'kbd', 'mark',
  'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'var',
]);

// Block tags we leave intact (we don't recursively unwrap their children).
const KEEP_BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img',
  'hr',
]);

/**
 * Recursively find .htm files under a directory.
 */
async function findHtmFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await findHtmFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.htm')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Take a DITA wrapper (e.g. div.shortdesc or div.p whose content is wrapped
 * in N levels of <div>/<span>) and return a string of clean inline HTML,
 * suitable for wrapping in a <p>. Recursively unwraps block-level
 * containers but preserves inline elements like <a> and <code>.
 */
function extractInline($, $el, topLevel = true) {
  const parts = [];
  $el.contents().each((_, child) => {
    if (child.type === 'text') {
      parts.push(child.data);
      return;
    }
    if (child.type !== 'tag') return;
    const tag = child.tagName.toLowerCase();

    // Inline element with no DITA class: unwrap (it's just a noise wrapper)
    if (tag === 'span' && !$(child).attr('class')) {
      parts.push(extractInline($, $(child), false));
      return;
    }

    // Block wrapper: dig in for inline content
    if (!INLINE_TAGS.has(tag) && !KEEP_BLOCK_TAGS.has(tag)) {
      parts.push(extractInline($, $(child), false));
      return;
    }

    // Keep the element. Clone with cheerio so attribute cleanup runs.
    const $clone = $(child).clone();
    cleanAttrs($clone);
    parts.push($.html($clone));
  });
  const joined = parts.join('');
  // Only normalize whitespace at the top level so we don't eat inner spaces
  // that are meaningful (e.g. the trailing space before a link).
  return topLevel ? joined.replace(/\s+/g, ' ').trim() : joined;
}

/**
 * Strip DITA-specific attributes from an element (and its descendants for
 * the few attrs we expect on inline children like <a>).
 */
function cleanAttrs($el) {
  const dropAttrs = [
    'class', 'id', 'data-attr-href', 'data-attr-scope', 'data-attr-type',
    'title', 'xmlns',
  ];
  dropAttrs.forEach((attr) => $el.removeAttr(attr));
  $el.find('*').each((_, c) => {
    const $c = (typeof c === 'object' ? require('cheerio') : null);
    dropAttrs.forEach((attr) => {
      if (c.attribs && attr in c.attribs) delete c.attribs[attr];
    });
  });
}

/**
 * Replace a DITA "note" admonition (warning/note/tip/etc.) with an
 * EDS-style block table.  When aem.live's html2md runs, this becomes:
 *   | Warning |
 *   | --- |
 *   | text  |
 * which EDS renders as <div class="warning">…</div>, activating any
 * /blocks/warning/ block we ship.
 */
function rewriteNotes($) {
  $('div.note').each((_, el) => {
    const $el = $(el);

    let blockName = 'Note';
    if ($el.hasClass('note_warning') || $el.hasClass('warning')) blockName = 'Warning';
    else if ($el.hasClass('note_tip') || $el.hasClass('tip')) blockName = 'Tip';
    else if ($el.hasClass('note_caution') || $el.hasClass('caution')) blockName = 'Caution';
    else if ($el.hasClass('note_important') || $el.hasClass('important')) blockName = 'Important';

    // Body content: prefer .note__content if DITA-OT added it, otherwise
    // strip the title span and use what's left as inline content.
    const $content = $el.find('.note__content, .notebody').first();
    const bodyHtml = $content.length
      ? extractInline($, $content)
      : (() => {
        const $clone = $el.clone();
        $clone.find('.note__title, .notetitle').remove();
        return extractInline($, $clone);
      })();

    $el.replaceWith(
      `<table><tr><th>${blockName}</th></tr><tr><td>${bodyHtml}</td></tr></table>`,
    );
  });
}

/**
 * Apply the full transform pipeline to one HTML string.
 */
function transform(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // ── 1. Pull a usable page title ────────────────────────────────────
  let pageTitle = ($('head > title').text() || '').trim();
  if (!pageTitle) {
    pageTitle = ($('body h1, body h1.title').first().text() || '').trim();
  }

  const $body = $('body').first();
  if (!$body.length) return html;

  // ── 2. Drop noise ──────────────────────────────────────────────────
  $body.find('link').remove();                              // _rhdefault.css etc.
  $body.find('div.breadcrumbs, div.familylinks').remove();  // we'll provide nav via EDS
  $body.removeAttr('id').removeAttr('class').removeAttr('lang');

  // Idempotency: if a previous run already wrapped content in <main>, unwrap
  // so we don't end up with <main><main>…</main></main>.
  $body.find('main').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // ── 3. EDS-block structures (do these first to preserve them) ──────

  rewriteNotes($);

  // div.codeblock > pre  →  <pre>
  $body.find('div.codeblock, div.fig.codeblock').each((_, el) => {
    const $el = $(el);
    const $pre = $el.find('pre').first();
    if ($pre.length) $el.replaceWith($pre);
  });

  // ── 4. Headings: <h1 class="title"> → <h1> (and friends) ───────────
  $body.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).removeAttr('class').removeAttr('id');
  });

  // ── 5. DITA paragraph wrappers ─────────────────────────────────────
  // div.shortdesc / div.p — DITA-OT wraps content in nested divs around
  // a span of text. Extract the inline content cleanly and wrap in <p>.
  $body.find('div.shortdesc, div.p, div.lq').each((_, el) => {
    const $el = $(el);
    const inline = extractInline($, $el);
    $el.replaceWith(inline ? `<p>${inline}</p>` : '');
  });

  // div.section — promote children up (no wrapper needed)
  $body.find('div.section').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // ── 6. Step lists ──────────────────────────────────────────────────
  $body.find('ol.steps, ol.steps-unordered, ul.steps-unordered').removeAttr('class');
  $body.find('li.step, li.substep, li.stepxmp, li.choice').each((_, el) => {
    const $el = $(el);
    $el.removeAttr('class');
    // Unwrap span.cmd / span.info wrappers that DITA-OT loves
    $el.find('span.cmd, span.info, span.itemgroup').each((__, span) => {
      const $span = $(span);
      $span.replaceWith($span.contents());
    });
  });

  // ── 7. Cross-references and inline span wrappers ───────────────────
  $body.find('a').each((_, el) => {
    const $a = $(el);
    ['class', 'data-attr-href', 'data-attr-scope', 'data-attr-type', 'title']
      .forEach((attr) => $a.removeAttr(attr));
  });

  $body.find('span.ph, span.keyword, span.uicontrol, span.term, span.wintitle, span.menucascade')
    .each((_, el) => $(el).removeAttr('class'));

  // ── 8. Strip residual class/id on non-table elements ───────────────
  $body.find('[class], [id]').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    // Tables encode EDS blocks; keep their structure.
    if (['table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(tag)) return;
    $(el).removeAttr('class').removeAttr('id');
  });

  // ── 9. Aggressive recursive unwrap of class-less <div> and <span> ──
  // After classes are stripped, almost every DITA <div> is just noise.
  // Unwrap until the tree is stable.
  let changed = true;
  while (changed) {
    changed = false;
    $body.find('div, span').each((_, el) => {
      const $el = $(el);
      const tag = el.tagName.toLowerCase();
      if ($el.attr('class') || $el.attr('id')) return;
      // Don't unwrap divs inside tables — they preserve cell structure.
      if ($el.closest('table').length) return;
      // For span: always unwrap class-less span (its content is inline)
      // For div: unwrap if its children would be valid where the div was
      //          (we'll let cheerio handle DOM validity)
      if (tag === 'span' || tag === 'div') {
        $el.replaceWith($el.contents());
        changed = true;
      }
    });
  }

  // ── 10. Cleanup: drop empty paragraphs and divs ────────────────────
  $body.find('p, div').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.children().length === 0) {
      $el.remove();
    }
  });

  // ── 11. Emit cleaned HTML doc ──────────────────────────────────────
  // No explicit <main> wrapper — aem.live's html2md works best on standard
  // body content (it adds the EDS frame itself).
  const bodyHtml = $body.html() || '';

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    `<title>${pageTitle}</title>`,
    '</head>',
    '<body>',
    bodyHtml.trim(),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

async function main() {
  try {
    await stat(ROOT);
  } catch {
    console.log(`No '${ROOT}/' directory; nothing to do.`);
    return;
  }

  const files = await findHtmFiles(ROOT);
  if (files.length === 0) {
    console.log(`No .htm files under '${ROOT}/'.`);
    return;
  }

  let changed = 0;
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const cleaned = transform(original);
    // Always write to .html and delete the .htm source — aem.live appends no
    // extension when fetching from our GitHub Pages mountpoint, and Pages
    // resolves extension-less URLs to .html (but not .htm).
    const htmlPath = file.replace(/\.htm$/, '.html');
    await writeFile(htmlPath, cleaned);
    await unlink(file);
    console.log(`✓ ${relative('.', file)} → ${relative('.', htmlPath)}`);
    changed += 1;
  }

  console.log(`\nTransformed ${changed} / ${files.length} file(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
