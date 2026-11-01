import fs from 'fs/promises';
import path from 'path';

async function dirExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory() ? p : null;
  } catch {
    return null;
  }
}

export async function resolve(sourceFile, depPath) {
  if (!depPath.startsWith('.')) return { resolvedPath: depPath, exists: false, confidence: 0.0, resolver: 'go' };
  const sourceDir = path.dirname(sourceFile);
  const resolved = path.resolve(sourceDir, depPath);
  
  const isDir = await dirExists(resolved);
  if (isDir) {
    return { resolvedPath: resolved, exists: true, confidence: 0.9, resolver: 'go' };
  }
  return { resolvedPath: resolved, exists: false, confidence: 0.0, resolver: 'go' };
}
