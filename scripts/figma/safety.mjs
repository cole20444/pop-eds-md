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
