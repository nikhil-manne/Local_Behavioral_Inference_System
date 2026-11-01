export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*(?:use|require)\s+([\w:]+)/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) deps.add(m[1].replace(/::/g, '/'));
  }
  return [...deps];
}
