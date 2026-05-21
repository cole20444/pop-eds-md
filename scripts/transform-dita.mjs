// Transforms DITA-OT HTML output into clean semantic HTML that aem.live's
// helix-html2md will accept and convert to useful markdown.
//
// Walks /docs/ recursively and rewrites each .htm/.html file in place.
// Originals remain in git history.
//
// helix-html2md REQUIRES this exact shape (verified against the lib source
// at github.com/adobe/helix-html2md src/html2md.js):
//   <main>
//     <div>...semantic content...</div>
//   </main>
// • If there's no <main>, html2md returns an empty string.
// • createSections() removes any non-<div> direct children of <main>.
// • The first <div> inside <main> is unwrapped (its children become the
//   first "section").
//
// Run locally:  node scripts/transform-dita.mjs
// Runs in CI:   .github/workflows/transform-dita.yml

import {
  readdir, readFile, writeFile, stat, unlink,
} from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = 'docs';

const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'kbd', 'mark',
  'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'var',
]);

const KEEP_BLOCK_TAGS = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'pre', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'figure', 'figcaption', 'img',
  'hr',
]);

async function findHtmFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await findHtmFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.htm') || entry.name.endsWith('.html'))) {
      out.push(full);
    }
  }
  return out;
}

function cleanAttrs($el) {
  const drop = [
    'class', 'id', 'data-attr-href', 'data-attr-scope', 'data-attr-type',
    'data-attr-format', 'data-attr-outputclass', 'data-attr-xml:space',
    'title', 'xmlns', 'lang',
  ];
  drop.forEach((a) => $el.removeAttr(a));
}

function extractInline($, $el, topLevel = true) {
  const parts = [];
  $el.contents().each((_, child) => {
    if (child.type === 'text') {
      parts.push(child.data);
      return;
    }
    if (child.type !== 'tag') return;
    const tag = child.tagName.toLowerCase();

    if (tag === 'span' && !$(child).attr('class')) {
      parts.push(extractInline($, $(child), false));
      return;
    }
    if (!INLINE_TAGS.has(tag) && !KEEP_BLOCK_TAGS.has(tag)) {
      parts.push(extractInline($, $(child), false));
      return;
    }
    const $clone = $(child).clone();
    cleanAttrs($clone);
    parts.push($.html($clone));
  });
  const joined = parts.join('');
  return topLevel ? joined.replace(/\s+/g, ' ').trim() : joined;
}

/**
 * Convert DITA-OT's <code class="...codeblock... pre ..."> to a proper
 * <pre><code class="language-X">…</code></pre>. DITA-OT uses inline <code>
 * with class-based block styling, <br> for newlines (often doubled), and
 * &nbsp; for indentation.
 */
function rewriteCodeblocks($) {
  $('code.codeblock, code[data-attr-outputclass]').each((_, el) => {
    const $el = $(el);
    const outputclass = $el.attr('data-attr-outputclass') || '';
    const lang = (outputclass.match(/language-[\w-]+/) || [])[0]
      || ($el.attr('class') || '').split(/\s+/).find((c) => c.startsWith('language-'))
      || '';

    // Reduce <br><br> pairs → single newline (DITA-OT doubles them)
    $el.find('br').each((__, brEl) => {
      const $br = $(brEl);
      const next = brEl.next;
      if (next && next.type === 'tag' && next.tagName === 'br') {
        $br.replaceWith('\n');
        $(next).remove();
      } else {
        $br.replaceWith('\n');
      }
    });

    // Get text content (so &nbsp; become normal spaces, etc.)
    let text = $el.text().replace(/ /g, ' ');
    // DITA-OT emits <br><br> AND a literal newline in source for each
    // codeblock line. After <br>->\n replacement we have \n\n. Collapse
    // any run of newlines (with only whitespace between) into one.
    text = text.replace(/\n\s*\n/g, '\n');
    // Trim leading newline and trailing whitespace/newlines.
    text = text.replace(/^\n+/, '').replace(/[\s\n]+$/, '');

    const codeAttr = lang ? ` class="${lang}"` : '';
    $el.replaceWith(`<pre><code${codeAttr}>${text}</code></pre>`);
  });
}

/**
 * DITA-OT renders tables as nested <div>s (class="table-headcount-N") not
 * real <table>s. Convert to a proper <table>; first row becomes <thead>.
 */
function rewriteDitaTables($) {
  $('div[class*="table-headcount"], div.table').each((_, el) => {
    const $el = $(el);
    // Each direct-child div is a row; each grandchild div is a cell.
    const $rows = $el.children('div');
    if (!$rows.length) return;

    const tableRows = [];
    $rows.each((idx, rowEl) => {
      const cells = [];
      $(rowEl).children('div').each((__, cellEl) => {
        cells.push($(cellEl).html() || '');
      });
      if (cells.length) tableRows.push({ idx, cells });
    });
    if (!tableRows.length) return;

    const [head, ...rest] = tableRows;
    const thead = `<thead><tr>${head.cells.map((c) => `<th>${c}</th>`).join('')}</tr></thead>`;
    const tbody = `<tbody>${
      rest.map((r) => `<tr>${r.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
    }</tbody>`;

    $el.replaceWith(`<table>${thead}${tbody}</table>`);
  });
}

/**
 * Replace DITA-OT note blocks with EDS-style block tables.
 *   <table><tr><th>Warning</th></tr><tr><td>…body…</td></tr></table>
 * html2md converts this to a markdown block table that EDS renders as
 * <div class="warning"> on the page, activating /blocks/warning/.
 */
function rewriteNotes($) {
  $('div.note').each((_, el) => {
    const $el = $(el);

    let blockName = 'Note';
    // DITA-OT classes: just "note" for default; "warning note" / "tip note" etc. for typed
    if ($el.hasClass('warning') || $el.hasClass('note_warning')) blockName = 'Warning';
    else if ($el.hasClass('tip') || $el.hasClass('note_tip')) blockName = 'Tip';
    else if ($el.hasClass('caution') || $el.hasClass('note_caution')) blockName = 'Caution';
    else if ($el.hasClass('important') || $el.hasClass('note_important')) blockName = 'Important';
    else if ($el.hasClass('remember') || $el.hasClass('note_remember')) blockName = 'Remember';
    else if ($el.hasClass('attention') || $el.hasClass('note_attention')) blockName = 'Attention';

    // Strip the DITA-OT "Note: " / "Warning: " label and any title spans
    $el.find('span.prefix-content, .note__title, .notetitle').remove();

    const bodyHtml = extractInline($, $el);
    $el.replaceWith(
      `<table><tr><th>${blockName}</th></tr><tr><td>${bodyHtml}</td></tr></table>`,
    );
  });
}

function transform(html) {
  const $ = cheerio.load(html, { decodeEntities: false });

  // ── 1. Page title ──────────────────────────────────────────────────
  let pageTitle = ($('head > title').text() || '').trim();
  if (!pageTitle) {
    pageTitle = ($('body h1, body h1.title').first().text() || '').trim();
  }

  const $body = $('body').first();
  if (!$body.length) return html;

  // ── 2. Drop noise that DITA-OT injects ────────────────────────────
  $body.find('link').remove();
  $body.find('div.breadcrumbs, div.familylinks').remove();

  // The "Prolog information" block (author, metadata, keywords as visible body content)
  $body.find('div.collapsible-tags, div.prolog').remove();

  // All visible DITA-OT labels: "Note: ", "Warning: ", "PREREQUISITE ",
  // "ADDITIONAL INFORMATION: ", "STEP RESULT: ", "AFTER COMPLETING THE TASK", etc.
  $body.find('span.prefix-content').remove();

  $body.removeAttr('id').removeAttr('class').removeAttr('lang');

  // Idempotency: unwrap any prior <main> wrappers
  $body.find('main').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // ── 3. EDS-block / structural rewrites FIRST (before unwrap step) ─
  rewriteCodeblocks($);
  rewriteDitaTables($);
  rewriteNotes($);

  // ── 4. Headings: drop classes ─────────────────────────────────────
  $body.find('h1, h2, h3, h4, h5, h6').each((_, el) => {
    $(el).removeAttr('class').removeAttr('id');
  });

  // ── 5. DITA paragraph wrappers → <p> ──────────────────────────────
  $body.find('div.shortdesc, div.p, div.lq').each((_, el) => {
    const $el = $(el);
    const inline = extractInline($, $el);
    $el.replaceWith(inline ? `<p>${inline}</p>` : '');
  });

  // div.section → unwrap (promote children up)
  $body.find('div.section').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // ── 6. Step lists & task structures ───────────────────────────────
  $body.find('ol.steps, ol.substeps, ul.choices, ul.steps-unordered').removeAttr('class');
  $body.find('li.step, li.substep, li.choice, li.stepxmp').each((_, el) => {
    const $el = $(el);
    $el.removeAttr('class');
    // span.cmd / span.info / span.itemgroup wrap step contents — unwrap them
    $el.find('span.cmd, span.info, span.itemgroup').each((__, span) => {
      const $span = $(span);
      $span.replaceWith($span.contents());
    });
  });
  // div.itemgroup (info, stepresult, etc.): unwrap; their label was already
  // stripped via span.prefix-content
  $body.find('div.itemgroup').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // ── 7. Inline DITA elements ───────────────────────────────────────
  // filepath: monospace text → <code>
  $body.find('span.filepath, span.ph.filepath').each((_, el) => {
    const $el = $(el);
    const text = $el.text();
    $el.replaceWith(`<code>${text}</code>`);
  });
  // uicontrol: bold UI label → <b>
  $body.find('span.uicontrol, span.ph.uicontrol').each((_, el) => {
    const $el = $(el);
    const inner = $el.html() || '';
    $el.replaceWith(`<b>${inner}</b>`);
  });

  // ── 8. Cross-references and other anchors ─────────────────────────
  $body.find('a').each((_, el) => {
    const $a = $(el);
    ['class', 'data-attr-href', 'data-attr-scope', 'data-attr-type',
      'data-attr-format', 'title'].forEach((attr) => $a.removeAttr(attr));
  });

  // ── 9. Strip residual class/id (leave table structure intact) ─────
  $body.find('[class], [id]').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (['table', 'thead', 'tbody', 'tr', 'th', 'td'].includes(tag)) return;
    $(el).removeAttr('class').removeAttr('id');
  });

  // ── 10. Aggressive recursive unwrap of class-less <div>/<span> ────
  let changed = true;
  while (changed) {
    changed = false;
    $body.find('div, span').each((_, el) => {
      const $el = $(el);
      const tag = el.tagName.toLowerCase();
      if ($el.attr('class') || $el.attr('id')) return;
      if ($el.closest('table').length) return; // preserve table internals
      $el.replaceWith($el.contents());
      changed = true;
    });
  }

  // ── 11. Drop empty paragraphs/divs ────────────────────────────────
  $body.find('p, div').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.children().length === 0) $el.remove();
  });

  // ── 12. Emit cleaned HTML doc in helix-html2md magic shape ────────
  const bodyHtml = $body.html() || '';

  return [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    `<title>${pageTitle}</title>`,
    '</head>',
    '<body>',
    '<main>',
    '<div>',
    bodyHtml.trim(),
    '</div>',
    '</main>',
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
    console.log(`No .htm / .html files under '${ROOT}/'.`);
    return;
  }

  let changed = 0;
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const cleaned = transform(original);
    const htmlPath = file.endsWith('.html') ? file : file.replace(/\.htm$/, '.html');

    if (cleaned === original && htmlPath === file) {
      console.log(`· ${relative('.', file)} (no change)`);
      continue;
    }

    await writeFile(htmlPath, cleaned);
    if (htmlPath !== file) {
      await unlink(file);
      console.log(`✓ ${relative('.', file)} → ${relative('.', htmlPath)}`);
    } else {
      console.log(`✓ ${relative('.', file)}`);
    }
    changed += 1;
  }

  console.log(`\nTransformed ${changed} / ${files.length} file(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
