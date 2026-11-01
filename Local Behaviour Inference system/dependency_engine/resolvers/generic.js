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
  try {
    const sourceDir = path.dirname(sourceFile);
    const resolved = path.resolve(sourceDir, depPath);
    
    let match = await fileExists(resolved);
    if (match) return { resolvedPath: match, exists: true, confidence: 1.0, resolver: 'generic' };

    return { resolvedPath: resolved, exists: false, confidence: 0.0, resolver: 'generic' };
  } catch (err) {
    return { resolvedPath: depPath, exists: false, confidence: 0.0, resolver: 'generic' };
  }
}
