export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*require\s+['"](.+?)['"]/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) deps.add(m[1]);
  }
  return [...deps];
}
