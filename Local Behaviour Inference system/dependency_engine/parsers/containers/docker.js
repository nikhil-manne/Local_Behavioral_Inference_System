export function parse(content) {
  const deps = new Set();
  const patterns = [
    /^\s*(?:COPY|ADD)\s+(?:--chown=.*?\s+)?((?:[^\s]+\s+)+)[^\s]+/gm
  ];
  let m;
  while ((m = patterns[0].exec(content)) !== null) {
    const parts = m[1].trim().split(/\s+/);
    parts.forEach(p => deps.add(p));
  }
  return [...deps];
}
