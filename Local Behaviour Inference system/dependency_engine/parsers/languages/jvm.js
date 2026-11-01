import { extractLineColumn } from '../parserUtils.js';

export function parse(content) {
  const deps = [];
  const seen = new Set();
  const patterns = [
    { re: /^\s*import\s+([\w.]+);?/gm, type: 'IMPORT' },
    { re: /^\s*package\s+([\w.]+);?/gm, type: 'IMPORT' }
  ];

  for (const {re, type} of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1].replace(/\./g, '/');
      if (!seen.has(raw)) {
        seen.add(raw);
        const pos = extractLineColumn(content, m.index);
        deps.push({ raw, type, line: pos.line, column: pos.column });
      }
    }
  }
  return deps;
}
