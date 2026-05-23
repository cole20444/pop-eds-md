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
