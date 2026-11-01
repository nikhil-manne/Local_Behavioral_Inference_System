export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*using\s+([\w]+)/gm,
    /^\s*include\s*\(\s*['"](.+?)['"]\s*\)/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) deps.add(m[1]);
  }
  return [...deps];
}
