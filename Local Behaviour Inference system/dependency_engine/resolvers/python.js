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
  
  let match = await fileExists(resolved + '.py');
  if (match) return { resolvedPath: match, exists: true, confidence: 0.95, resolver: 'python' };
  match = await fileExists(path.join(resolved, '__init__.py'));
  if (match) return { resolvedPath: match, exists: true, confidence: 0.9, resolver: 'python' };
  match = await fileExists(resolved);
  if (match) return { resolvedPath: match, exists: true, confidence: 1.0, resolver: 'python' };

  const rootResolved = path.resolve(process.cwd(), depPath);
  match = await fileExists(rootResolved + '.py');
  if (match) return { resolvedPath: match, exists: true, confidence: 0.8, resolver: 'python' };
  match = await fileExists(path.join(rootResolved, '__init__.py'));
  if (match) return { resolvedPath: match, exists: true, confidence: 0.8, resolver: 'python' };

  return { resolvedPath: resolved, exists: false, confidence: 0.0, resolver: 'python' };
}
