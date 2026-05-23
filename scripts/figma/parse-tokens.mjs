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

// NOTE: `alias` records only the immediate var() reference in `rawValue`
// (correct for 1-hop chains like --pop-note-ring: var(--pop-color-info), which
// is all styles.css contains today). For 2+ hop chains the recorded alias
// is still the outermost var(), not the chain's terminal source. Revisit if
// styles.css ever introduces multi-hop aliases.
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
