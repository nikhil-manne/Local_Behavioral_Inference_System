export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*(?:source|\.)\s+['"]?(.+?)['"]?$/gm,
    /^\s*(?:bash|python|node|ruby|sh)\s+['"]?(.+?)['"]?/gm,
    /^\s*(\.\/[\w.\-/]+)/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) deps.add(m[1]);
  }
  return [...deps];
}
