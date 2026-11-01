import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';

// Clean up obsolete, repeated, or unused files
const obsoleteFiles = [
  'system_portal.db',
  'system_portal.db-journal',
  'system_portal.db-wal',
  'system_portal.db-shm',
  'system_test_v3.db'
];
for (const file of obsoleteFiles) {
  const filePath = path.join(process.cwd(), file);
  if (existsSync(filePath)) {
    try {
      unlinkSync(filePath);
      console.log(`[Bootstrap] Cleaned up obsolete file: ${file}`);
    } catch (err) {
      console.warn(`[Bootstrap] Notice: Could not remove ${file}:`, err.message);
    }
  }
}

console.log('[Bootstrap] Checking dependencies...');
try {
  // Check if node_modules exists to optimize startup time
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    console.log('[Bootstrap] First time setup detected. Installing dependencies...');
    execSync('npm install', { stdio: 'inherit' });
    console.log('[Bootstrap] Dependencies installed successfully.');
  } else {
    console.log('[Bootstrap] Dependencies already installed.');
  }
} catch (e) {
  console.error('[Bootstrap] Failed to install dependencies.', e);
  process.exit(1);
}

console.log('[Bootstrap] Initializing database...');
// Dynamically import database.js to trigger database creation/initialization
const { getDb } = await import('./database.js');
const db = getDb();
console.log('[Bootstrap] Database initialized.');

console.log('[Bootstrap] Starting server...');
await import('./server.js');
