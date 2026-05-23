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
