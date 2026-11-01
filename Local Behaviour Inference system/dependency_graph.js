import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getDb, insertDependency, getDependentsOf, getFailuresForFile, insertFailure } from './database.js';
import { processFile, normalizePath } from './dependency_engine/engine.js';
import { getRegistryEntry } from './dependency_engine/registry.js';

let isShuttingDown = false;

// Handle Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\n[DependencyGraph] SIGINT received. Initiating graceful shutdown...');
  isShuttingDown = true;
});


const MAX_CONCURRENT_FILES = parseInt(process.env.MAX_CONCURRENT_FILES || '20', 10);
const BATCH_SIZE = 500;

async function walkDirectoryIterative(rootPath) {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']);
  const results = [];
  const stack = [rootPath];

  while (stack.length > 0) {
    if (isShuttingDown) break;
    const currentDir = stack.pop();

    const normalized = currentDir.toLowerCase().replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'c:' && parts[1] === 'users') {
      if (parts.length <= 3) continue;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          stack.push(fullPath);
        }
      } else if (entry.isFile() && getRegistryEntry(entry.name) !== null) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export async function scanProjectDependencies(rootPath) {
  const sessionId = crypto.randomUUID();
  console.log(`[DependencyGraph] Session [${sessionId}] Starting scan of ${rootPath}`);
  const startTime = Date.now();

  const allFiles = await walkDirectoryIterative(rootPath);
  const totalFiles = allFiles.length;
  
  if (isShuttingDown || totalFiles === 0) return { cancelled: isShuttingDown, scanned: 0 };

  const stats = {
    scanned: 0,
    dependencies: 0,
    resolved: 0,
    unresolved: 0,
    cacheHits: 0,
    cacheMisses: 0,
    parserFailures: 0,
    parserExecutionTimes: {}
  };

  const db = getDb();
  let pendingInserts = [];

  const flushInserts = () => {
    if (pendingInserts.length === 0) return;
    try {
      db.exec('BEGIN TRANSACTION');
      const stmt = db.prepare('INSERT OR IGNORE INTO file_dependencies (source_path, target_path, dependency_type) VALUES (?, ?, ?)');
      for (const ins of pendingInserts) {
        stmt.run(ins.source, ins.target, ins.type);
      }
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      console.error(JSON.stringify({ context: 'DependencyGraph', error: 'Failed to commit batch', message: e.message }));
    }
    pendingInserts = [];
  };

  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < totalFiles && !isShuttingDown) {
      const fileIndex = currentIndex++;
      const file = allFiles[fileIndex];

      let result = { deps: [], metrics: {} };
      try {
        result = await processFile(file);
      } catch (e) {
        console.error(JSON.stringify({ context: 'DependencyGraph', action: 'processFile', file, error: e.message }));
      }

      const { deps, metrics } = result;

      stats.scanned++;
      if (metrics.cached) {
        stats.cacheHits++;
      } else {
        stats.cacheMisses++;
        if (metrics.parseSuccess === false) stats.parserFailures++;
        if (metrics.parserId) {
          if (!stats.parserExecutionTimes[metrics.parserId]) {
            stats.parserExecutionTimes[metrics.parserId] = { total: 0, count: 0, max: 0, min: Infinity };
          }
          const t = stats.parserExecutionTimes[metrics.parserId];
          t.total += metrics.parseTimeMs;
          t.count++;
          t.max = Math.max(t.max, metrics.parseTimeMs);
          t.min = Math.min(t.min, metrics.parseTimeMs);
        }
      }

      const sourceNorm = normalizePath(file);
      for (const dep of deps) {
        stats.dependencies++;
        if (dep.resolvedPath) {
          stats.resolved++;
          pendingInserts.push({ source: sourceNorm, target: dep.resolvedPath, type: dep.type });
        } else {
          stats.unresolved++;
        }
      }

      if (pendingInserts.length >= BATCH_SIZE) {
        flushInserts();
      }

      if (stats.scanned % 100 === 0) {
        console.log(`[DependencyGraph] Progress: ${stats.scanned}/${totalFiles} (${Math.round((stats.scanned / totalFiles) * 100)}%)`);
      }
    }
  };

  const workers = Array(Math.min(MAX_CONCURRENT_FILES, totalFiles)).fill(0).map(() => worker());
  await Promise.all(workers);

  if (pendingInserts.length > 0) flushInserts();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n=== Dependency Scan Complete ===');
  console.log(`Session ID: ${sessionId}`);
  console.log(`Files Scanned: ${stats.scanned}`);
  console.log(`Dependencies: ${stats.dependencies}`);
  console.log(`Resolved: ${stats.resolved}`);
  console.log(`Unresolved: ${stats.unresolved}`);
  console.log(`Cache Hits: ${stats.cacheHits}`);
  console.log(`Cache Misses: ${stats.cacheMisses}`);
  console.log(`Parser Failures: ${stats.parserFailures}`);
  console.log(`Elapsed Time: ${elapsed} seconds`);
  
  if (Object.keys(stats.parserExecutionTimes).length > 0) {
    console.log('\n--- Parser Performance ---');
    for (const [parser, data] of Object.entries(stats.parserExecutionTimes)) {
      console.log(`${parser}: Avg ${(data.total/data.count).toFixed(2)}ms | Min ${data.min.toFixed(2)}ms | Max ${data.max.toFixed(2)}ms`);
    }
  }
  console.log('================================\n');

  return { cancelled: isShuttingDown, sessionId, elapsed, stats };
}

// ── BLAST RADIUS ──────────────────────────────────────

export function getBlastRadius(filepath) {
  const db = getDb();
  const normalizedPath = normalizePath(filepath);
  const direct = getDependentsOf(normalizedPath);
  
  const indirectSet = new Set();
  for (const dep of direct) {
    const secondLevel = getDependentsOf(dep);
    for (const f of secondLevel) {
      if (!direct.includes(f)) indirectSet.add(f);
    }
  }
  const indirect = [...indirectSet];
  const failures = getFailuresForFile(normalizedPath);
  const riskScore = calculateRiskScore(direct.length, indirect.length, failures.length);

  return {
    file: filepath,
    filename: path.basename(filepath),
    direct_dependents: direct,
    indirect_dependents: indirect,
    historical_failures: failures,
    risk_score: parseFloat(riskScore.toFixed(2)),
    risk_level: riskScore > 0.7 ? 'HIGH' : riskScore > 0.4 ? 'MODERATE' : 'LOW',
    recommendation: riskScore > 0.7
      ? 'DO NOT DELETE — critical dependencies exist'
      : riskScore > 0.4
        ? 'Proceed with caution — verify dependents first'
        : 'Safe to proceed',
    requires_confirmation: direct.length > 0 || failures.length > 0 || riskScore > 0.15
  };
}

function calculateRiskScore(directCount, indirectCount, failureCount) {
  const dependencyRisk = Math.min((directCount * 0.25) + (indirectCount * 0.08), 0.7);
  const failureRisk = Math.min(failureCount * 0.25, 0.4);
  return Math.min(dependencyRisk + failureRisk, 1.0);
}

export function getDependencyChain(filepath) {
  const blast = getBlastRadius(filepath);
  const filename = path.basename(filepath);

  let chain = `${filename}\n`;
  for (const dep of blast.direct_dependents) {
    chain += `  └── imported by: ${path.basename(dep)}\n`;
    const secondLevel = getDependentsOf(dep);
    for (const sl of secondLevel) {
      chain += `        └── used in: ${path.basename(sl)}\n`;
    }
  }

  if (blast.historical_failures.length > 0) {
    chain += `\n⚠️  History: Deletion of this file has failed or caused issues ${blast.historical_failures.length} time(s) in the past.`;
    chain += ` (Last failure: ${new Date(blast.historical_failures[0].occurred_at).toLocaleDateString()})`;
  }

  return chain;
}

// ── FAILURE RECORDING ─────────────────────────────────

export function recordFailure(filepath, description, causedBy = null, userWarned = false, userProceeded = false) {
  insertFailure({
    actionType: 'file_action',
    filePath: normalizePath(filepath),
    description,
    causedBy,
    userWarned: userWarned ? 1 : 0,
    userProceeded: userProceeded ? 1 : 0
  });
  console.log(`[CognitiveOS] Failure recorded permanently for: ${path.basename(filepath)}`);
}

// ── FILE WATCH INTEGRATION ────────────────────────────

export async function updateGraphForFile(filepath) {
  let result = { deps: [] };
  try {
    result = await processFile(filepath);
  } catch (e) {
    console.error(JSON.stringify({ context: 'DependencyGraph', action: 'updateGraphForFile', file: filepath, error: e.message }));
    return;
  }
  
  const { deps } = result;
  const db = getDb();
  const normalizedSource = normalizePath(filepath);

  try {
    db.exec('BEGIN TRANSACTION');
    db.prepare('DELETE FROM file_dependencies WHERE source_path = ?').run(normalizedSource);
    
    const stmt = db.prepare('INSERT OR IGNORE INTO file_dependencies (source_path, target_path, dependency_type) VALUES (?, ?, ?)');
    for (const dep of deps) {
      if (dep.resolvedPath) {
        stmt.run(normalizedSource, dep.resolvedPath, dep.type);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    console.error(JSON.stringify({ context: 'DependencyGraph', action: 'updateGraphForFile', error: 'Transaction failed', message: e.message }));
  }
}
