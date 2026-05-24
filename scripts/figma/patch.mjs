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
