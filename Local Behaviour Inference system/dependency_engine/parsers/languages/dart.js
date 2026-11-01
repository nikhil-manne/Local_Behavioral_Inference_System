export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*import\s+['"](.+?)['"]/gm,
    /^\s*export\s+.*?\s+from\s+['"](.+?)['"]/gm,
    /^\s*part\s+['"](.+?)['"]/gm,
    /^\s*part\s+of\s+['"](.+?)['"]/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) deps.add(m[1]);
  }
  return [...deps];
}
