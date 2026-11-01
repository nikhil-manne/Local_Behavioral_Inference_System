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

async function dirExists(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory() ? p : null;
  } catch {
    return null;
  }
}

export async function resolve(sourceFile, depPath) {
  const sourceDir = path.dirname(sourceFile);
  const resolved = path.resolve(sourceDir, depPath);
  
  let match = await fileExists(resolved);
  if (match) return { resolvedPath: match, exists: true, confidence: 1.0, resolver: 'javascript' };

  const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];
  for (const ext of extensions) {
    match = await fileExists(resolved + ext);
    if (match) return { resolvedPath: match, exists: true, confidence: 0.95, resolver: 'javascript' };
  }

  const isDir = await dirExists(resolved);
  if (isDir) {
    for (const ext of extensions) {
      match = await fileExists(path.join(resolved, 'index' + ext));
      if (match) return { resolvedPath: match, exists: true, confidence: 0.9, resolver: 'javascript' };
    }
  }

  return { resolvedPath: resolved, exists: false, confidence: 0.0, resolver: 'javascript' };
}
