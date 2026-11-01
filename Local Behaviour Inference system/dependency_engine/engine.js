import fs from 'fs/promises';
import path from 'path';
import { getRegistryEntry } from './registry.js';
import { parserRegistry } from './parserRegistry.js';
import { resolverRegistry } from './resolverRegistry.js';
import { dependencyCache } from './cache/dependencyCache.js';
import { performance } from 'perf_hooks';

const moduleCache = new Map();

export const DependencyType = {
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  REQUIRE: 'REQUIRE',
  DYNAMIC_IMPORT: 'DYNAMIC_IMPORT',
  ASSET: 'ASSET',
  INCLUDE: 'INCLUDE',
  USE: 'USE'
};

export function normalizePath(p) {
  return p ? p.toLowerCase().replace(/\\/g, '/') : p;
}

async function loadModule(type, id) {
  const cacheKey = type + ':' + id;
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey);

  const registry = type === 'parser' ? parserRegistry : resolverRegistry;
  const modPath = registry[id];
  if (!modPath) return null;

  try {
    const mod = await import(modPath);
    moduleCache.set(cacheKey, mod);
    return mod;
  } catch (err) {
    console.error(JSON.stringify({
      context: 'DependencyEngine',
      action: 'loadModule',
      type,
      id,
      error: err.message
    }));
    moduleCache.set(cacheKey, null);
    return null;
  }
}

export async function processFile(filepath) {
  let fileStat = null;
  try {
    fileStat = await fs.stat(filepath);
  } catch {
    return { deps: [], metrics: {} };
  }

  // Check cache
  const cached = dependencyCache.get(filepath);
  if (cached && cached.mtime === fileStat.mtimeMs) {
    return { deps: cached.deps, metrics: { cached: true } };
  }

  const registryEntry = getRegistryEntry(filepath);
  if (!registryEntry) return { deps: [], metrics: {} };

  const { parser: parserId, resolver: resolverId } = registryEntry;
  
  const parserMod = await loadModule('parser', parserId);
  if (!parserMod || !parserMod.parse) return { deps: [], metrics: {} };

  let content = '';
  try {
    content = await fs.readFile(filepath, 'utf8');
  } catch {
    return { deps: [], metrics: {} };
  }

  let rawDeps = [];
  const startParse = performance.now();
  let parseSuccess = false;
  
  try {
    const parsePromise = Promise.resolve().then(() => parserMod.parse(content, filepath));
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Parser timeout (30s)')), 30000)
    );
    rawDeps = await Promise.race([parsePromise, timeoutPromise]);
    parseSuccess = true;
  } catch (e) {
    console.error(JSON.stringify({
      context: 'DependencyEngine',
      action: 'parse',
      file: filepath,
      parser: parserId,
      error: e.message
    }));
  }

  const parseTime = performance.now() - startParse;

  // Deduplicate
  const uniqueDepsMap = new Map();
  for (const dep of rawDeps) {
    if (!uniqueDepsMap.has(dep.raw)) {
      uniqueDepsMap.set(dep.raw, dep);
    }
  }
  const uniqueRawDeps = Array.from(uniqueDepsMap.values());

  const resolverMod = await loadModule('resolver', resolverId);
  const resolvedDeps = [];

  for (const dep of uniqueRawDeps) {
    let resolved = null;
    let confidence = 0.5;

    if (resolverMod && resolverMod.resolve) {
      try {
        const result = await resolverMod.resolve(filepath, dep.raw);
        if (result && result.exists) {
          resolved = result.resolvedPath;
          confidence = result.confidence;
        }
      } catch (e) {
        console.error(JSON.stringify({
          context: 'DependencyEngine',
          action: 'resolve',
          file: filepath,
          resolver: resolverId,
          dependency: dep.raw,
          error: e.message
        }));
      }
    }

    if (!resolved) {
      try {
        const sourceDir = path.dirname(filepath);
        const fallbackPath = path.resolve(sourceDir, dep.raw);
        const stat = await fs.stat(fallbackPath);
        if (stat.isFile()) {
          resolved = fallbackPath;
          confidence = 0.8;
        }
      } catch {}
    }

    if (resolved) {
      resolvedDeps.push({
        raw: dep.raw,
        resolvedPath: normalizePath(resolved),
        type: dep.type || DependencyType.IMPORT,
        line: dep.line || 1,
        column: dep.column || 1,
        confidence: confidence
      });
    }
  }

  // Deduplicate resolved dependencies
  const uniqueResolvedMap = new Map();
  for (const dep of resolvedDeps) {
    if (!uniqueResolvedMap.has(dep.resolvedPath)) {
      uniqueResolvedMap.set(dep.resolvedPath, dep);
    }
  }
  const finalResolvedDeps = Array.from(uniqueResolvedMap.values());

  // Update Cache
  dependencyCache.set(filepath, {
    mtime: fileStat.mtimeMs,
    deps: finalResolvedDeps
  });

  return {
    deps: finalResolvedDeps,
    metrics: {
      cached: false,
      parseTimeMs: parseTime,
      parserId,
      parseSuccess
    }
  };
}
