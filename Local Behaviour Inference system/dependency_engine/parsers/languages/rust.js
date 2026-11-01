import { extractLineColumn } from '../parserUtils.js';

export function parse(content) {
  const deps = [];
  const seen = new Set();
  const patterns = [
    { re: /^\s*use\s+([\w:{}]+)/gm, type: 'IMPORT' },
    { re: /^\s*(?:pub\s+)?mod\s+([\w]+)/gm, type: 'IMPORT' }
  ];

  for (const {re, type} of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      let raw = m[1];
      if (raw.includes('crate::')) raw = raw.replace('crate::', '');
      if (raw.includes('super::')) raw = raw.replace('super::', '../');
      raw = raw.replace(/::/g, '/');
      
      if (!seen.has(raw)) {
        seen.add(raw);
        const pos = extractLineColumn(content, m.index);
        deps.push({ raw, type, line: pos.line, column: pos.column });
      }
    }
  }
  return deps;
}
