import fs from 'fs/promises';
import path from 'path';

async function fileExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isFile() ? p : null;
  } catch {
    return null;
  }
}

export async function resolve(sourceFile, depPath) {
  const sourceDir = path.dirname(sourceFile);
  const resolved = path.resolve(sourceDir, depPath);
  
  let match = await fileExists(resolved + '.rs');
  if (match) return { resolvedPath: match, exists: true, confidence: 0.95, resolver: 'rust' };
  match = await fileExists(path.join(resolved, 'mod.rs'));
  if (match) return { resolvedPath: match, exists: true, confidence: 0.9, resolver: 'rust' };
  
  return { resolvedPath: resolved, exists: false, confidence: 0.0, resolver: 'rust' };
}
