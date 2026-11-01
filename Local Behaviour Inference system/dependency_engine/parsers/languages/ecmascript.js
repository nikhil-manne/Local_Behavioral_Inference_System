import { extractLineColumn } from '../parserUtils.js';

export function parse(content) {
  const deps = [];
  const seen = new Set();
  const patterns = [
    { re: /import\s+.*?\s+from\s+['"](.+?)['"]/g, type: 'IMPORT' },
    { re: /import\s*\(\s*['"](.+?)['"]\s*\)/g, type: 'DYNAMIC_IMPORT' },
    { re: /require\s*\(\s*['"](.+?)['"]\s*\)/g, type: 'REQUIRE' },
    { re: /export\s+.*?\s+from\s+['"](.+?)['"]/g, type: 'EXPORT' },
    { re: /import\s+type\s+.*?\s+from\s+['"](.+?)['"]/g, type: 'IMPORT' },
    { re: /['"]([^'"]+\.(?:png|jpg|jpeg|gif|svg|webp|ico|mp4|webm|mp3|wav|ttf|woff|woff2))['"]/gi, type: 'ASSET' }
  ];

  for (const {re, type} of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const raw = m[1];
      if (!seen.has(raw)) {
        seen.add(raw);
        const pos = extractLineColumn(content, m.index);
        deps.push({ raw, type, line: pos.line, column: pos.column });
      }
    }
  }
  return deps;
}
