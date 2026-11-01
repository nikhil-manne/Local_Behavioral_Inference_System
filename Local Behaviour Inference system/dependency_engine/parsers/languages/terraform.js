export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*module\s+["'](.+?)["']\s*{[\s\S]*?source\s*=\s*["'](.+?)["']/gm
  ];
  let m;
  while ((m = patterns[0].exec(content)) !== null) deps.add(m[2]);
  return [...deps];
}
