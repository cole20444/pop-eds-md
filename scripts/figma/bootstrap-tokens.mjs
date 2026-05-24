// One-off CLI: parse styles/styles.css and print the Variable-collection
// JSON to stdout. Used during Phase 1 bootstrap to hand the structure
// to Claude + Figma MCP.

import { readFile } from 'node:fs/promises';
import { parseTokens } from './parse-tokens.mjs';

const css = await readFile(new URL('../../styles/styles.css', import.meta.url), 'utf8');
const result = parseTokens(css);
console.log(JSON.stringify(result, null, 2));
