import { extractLineColumn } from '../parserUtils.js';

export function parse(content) {
  const deps = [];
  const seen = new Set();
  
  const singleRe = /^\s*import\s+["'](.+?)["']/gm;
  const blockRe = /^\s*import\s*\(([\s\S]*?)\)/gm;

  let m;
  while ((m = singleRe.exec(content)) !== null) {
    const raw = m[1];
    if (!seen.has(raw)) {
      seen.add(raw);
      const pos = extractLineColumn(content, m.index);
      deps.push({ raw, type: 'IMPORT', line: pos.line, column: pos.column });
    }
  }

  while ((m = blockRe.exec(content)) !== null) {
    const block = m[1];
    const strMatch = block.matchAll(/["'](.+?)["']/g);
    for (const sm of strMatch) {
      const raw = sm[1];
      if (!seen.has(raw)) {
        seen.add(raw);
        // Approximation of line inside block
        const pos = extractLineColumn(content, m.index);
        deps.push({ raw, type: 'IMPORT', line: pos.line, column: pos.column });
      }
    }
  }
  return deps;
}
