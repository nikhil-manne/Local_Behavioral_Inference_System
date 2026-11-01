import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import * as db from './database.js';
import { runCommand } from './powershell.js';
import { getBlastRadius, getDependencyChain, recordFailure, updateGraphForFile } from './dependency_graph.js';
import { narrateBlastRadius } from './cognitive_narrator.js';
import { observeAction } from './behavioral_memory.js';

// Map of directory path (normalized absolute) to active fs.FSWatcher objects
const activeWatchers = new Map();
// Set of paths that are intentionally deleted by the portal (to ignore duplicate events)
const ignoredDeletions = new Set();
// Map of file paths to active timeout objects for debouncing transient file saves
const pendingDeletions = new Map();
// Map of file paths to active timeout objects for debouncing transient file saves
const pendingSaves = new Map();
// Map of file paths (normalized absolute) to their last known modification time (mtimeMs)
const knownMtimes = new Map();

let broadcastFn = null;

// Normalise paths to lowercase and forward slashes for cross-platform matching
function normalizePath(p) {
  return p ? p.toLowerCase().replace(/\\/g, '/') : p;
}

export function setBroadcastCallback(fn) {
  broadcastFn = fn;
}

/**
 * Register a path to be ignored by the watcher (due to internal portal delete/rename action)
 * @param {string} filePath 
 */
export function ignoreDeletion(filePath) {
  const norm = normalizePath(filePath);
  ignoredDeletions.add(norm);
  // Auto-cleanup after 2 seconds as safety net
  setTimeout(() => {
    ignoredDeletions.delete(norm);
  }, 2000);
}

/**
 * Check if path should be skipped (system folders, hidden, node_modules etc.)
 * @param {string} filename 
 */
function shouldSkipPath(filename) {
  const normalized = filename.toLowerCase().replace(/\\/g, '/');
  if (
    normalized.includes('appdata') ||
    normalized.includes('temp') ||
    normalized.includes('tmp') ||
    normalized.includes('jetski') ||
    normalized.includes('recording') ||
    normalized.includes('__psscriptpolicytest')
  ) {
    return true;
  }

  const parts = normalized.split('/');
  const SKIP_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__',
    'venv', 'env', '.env', '.venv', 'vendor', 'target', 'bin', 'obj', 
    '.idea', '.vscode', '.vs', 'site-packages', 'lib', 'packages'
  ]);
  for (const part of parts) {
    if (part.startsWith('.') || SKIP_DIRS.has(part) || /^python/.test(part)) {
      return true;
    }
  }
  const ext = path.extname(filename).toLowerCase();
  if (['.db', '.db-journal', '.db-wal', '.db-shm', '.db-tmp', '.log'].includes(ext)) {
    return true;
  }
  return false;
}

/**
 * Initialises watchers for all directories in the SQLite database
 */
export function initWatchers(broadcastCallback = null) {
  if (broadcastCallback) {
    broadcastFn = broadcastCallback;
  }

  const dirs = db.getScannedDirectories();
  console.log(`[CognitiveOS Watcher] Initialising watchers for ${dirs.length} directories...`);
  for (const dir of dirs) {
    startWatching(dir.path);
  }
}

/**
 * Start recursive file watch on a directory
 * @param {string} dirPath 
 */
export function startWatching(dirPath) {
  const normalizedDir = path.resolve(dirPath);
  if (activeWatchers.has(normalizedDir)) {
    console.log(`[CognitiveOS Watcher] Already watching: ${normalizedDir}`);
    return;
  }

  try {
    console.log(`[CognitiveOS Watcher] Starting recursive watch on: ${normalizedDir}`);
    const watcher = fs.watch(normalizedDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      if (shouldSkipPath(filename)) return;

      const fullPath = path.join(normalizedDir, filename);
      const normPath = normalizePath(fullPath);
      const exists = fs.existsSync(fullPath);

      if (exists) {
        // If the file exists, it was created or modified. Clear any pending deletion alert.
        if (pendingDeletions.has(normPath)) {
          console.log(`[CognitiveOS Watcher] Ignored transient deletion (file recreated/modified): ${fullPath}`);
          clearTimeout(pendingDeletions.get(normPath));
          pendingDeletions.delete(normPath);
        }

        // Debounce creation/modification to avoid duplicate alerts during rapid saves
        if (pendingSaves.has(normPath)) {
          clearTimeout(pendingSaves.get(normPath));
        }

        const timeout = setTimeout(() => {
          pendingSaves.delete(normPath);
          handleSystemLevelSave(fullPath);
        }, 500);

        pendingSaves.set(normPath, timeout);
        return;
      }

      // If the file does not exist, check if it's a rename (potential delete)
      if (eventType === 'rename' && !exists) {
        // Clear any existing timeout for this path to avoid multiple alerts
        if (pendingDeletions.has(normPath)) {
          clearTimeout(pendingDeletions.get(normPath));
        }

        // Schedule deletion check with a debounced window
        const timeout = setTimeout(() => {
          pendingDeletions.delete(normPath);

          // Check if we intentionally triggered this deletion from the portal
          if (ignoredDeletions.has(normPath)) {
            ignoredDeletions.delete(normPath);
            return;
          }

          console.log(`[CognitiveOS Watcher] System-level deletion event confirmed: ${fullPath}`);
          handleSystemLevelDeletion(fullPath);
        }, 800); // 800ms debounce window covers slow IDE temp file operations

        pendingDeletions.set(normPath, timeout);
      }
    });

    watcher.on('error', (err) => {
      console.error(`[CognitiveOS Watcher] Watcher error for ${normalizedDir}:`, err.message);
      try {
        watcher.close();
      } catch (closeErr) {}
      activeWatchers.delete(normalizedDir);
    });

    activeWatchers.set(normalizedDir, watcher);
  } catch (err) {
    console.error(`[CognitiveOS Watcher] Failed to set up watcher for ${normalizedDir}:`, err.message);
  }
}

/**
 * Stop file watch on a directory
 * @param {string} dirPath 
 */
export function stopWatching(dirPath) {
  const normalizedDir = path.resolve(dirPath);
  const watcher = activeWatchers.get(normalizedDir);
  if (watcher) {
    console.log(`[CognitiveOS Watcher] Stopping watch on: ${normalizedDir}`);
    watcher.close();
    activeWatchers.delete(normalizedDir);
  }
}

/**
 * Handle deletion of a tracked file outside the portal
 * @param {string} filePath 
 */
async function handleSystemLevelDeletion(filePath) {
  const filename = path.basename(filePath);
  const normalizedPath = normalizePath(filePath);
  knownMtimes.delete(normalizedPath);

  // Check if file was indexed in the database (we only protect tracked files)
  const dbItem = db.getItemByPath(filePath);
  if (!dbItem) {
    // Not tracked or already deleted from database index
    return;
  }

  // Calculate blast radius
  let blast;
  try {
    blast = getBlastRadius(filePath);
  } catch (err) {
    console.error(`[CognitiveOS Watcher] getBlastRadius failed for ${filePath}:`, err.message);
    blast = { requires_confirmation: false };
  }

  if (blast.requires_confirmation) {
    console.log(`[CognitiveOS Watcher] File has dependents! Preparing Yes/No confirmation prompt...`);

    // Get natural language explanation
    const warningMessage = await narrateBlastRadius(blast);
    const chain = getDependencyChain(filePath);

    const parentDir = path.dirname(filePath);
    const cleanParentDir = parentDir.replace(/\\/g, '/').toLowerCase();

    const text = `CRITICAL WARNING: Aiden noticed you deleted "${filename}" directly from the file manager!\n\n${warningMessage}\n\nDependency chain:\n${chain}\n\nDo you want to proceed with deleting this file?\n(Clicking "No" will immediately undo this delete and restore the file.)`;

    // Escape double quotes and dollar signs so they don't break PowerShell double-quoted string parsing
    const escapedText = text.replace(/"/g, '`"').replace(/\$/g, '`$');

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $result = [System.Windows.Forms.MessageBox]::Show("${escapedText}", "CognitiveOS - Deletion Risk Alert", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
      if ($result -eq [System.Windows.Forms.DialogResult]::No) {
        # User requested restore - find the item in Recycle Bin matching original directory
        $sh = New-Object -ComObject Shell.Application
        $bin = $sh.Namespace(0xa)
        $item = $bin.Items() | Where-Object { 
          $_.Name -eq '${filename}' -and ($bin.GetDetailsOf($_, 1).Replace('/', '\\').ToLower() -eq '${cleanParentDir}'.Replace('/', '\\').ToLower())
        } | Select-Object -First 1
        
        if ($item) {
          $item.Verbs() | Where-Object { $_.Name -replace '&','' -eq 'Restore' } | ForEach-Object { $_.DoIt() }
          Start-Sleep -Seconds 2
          Write-Host "RESTORED"
        } else {
          Write-Host "RESTORE_FAILED"
        }
      } else {
        Write-Host "PROCEEDED"
      }
    `;

    // Spawn powershell.exe without -NonInteractive so it can show the GUI Yes/No dialog
    execFile('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      script
    ], { windowsHide: true }, (error, stdout) => {
      if (error) {
        console.error(`[CognitiveOS Watcher] Failed running confirmation script:`, error.message);
        return;
      }

      const output = (stdout || '').trim();

      if (output.includes('RESTORED')) {
        console.log(`[CognitiveOS Watcher] User aborted deletion. File "${filename}" successfully restored.`);
        db.addCheckupLog(
          `System level deletion aborted by user. File restored: ${filename}`,
          filePath,
          'info'
        );

        // Notify UI that the deletion was cancelled/restored
        if (broadcastFn) {
          broadcastFn('checkup-alert', {
            action: 'restored',
            app: { name: filename, path: filePath }
          });
        }
      } else if (output.includes('RESTORE_FAILED')) {
        console.log(`[CognitiveOS Watcher] User aborted deletion of "${filename}" but restore failed (Shift+Delete or already purged).`);
        db.addCheckupLog(
          `System level deletion aborted by user but restore failed (Shift+Delete): ${filename}`,
          filePath,
          'error'
        );

        // Deletion confirmed by failure to restore, so clean database index
        db.deleteItemByPath(filePath);
        if (broadcastFn) {
          broadcastFn('item-deleted', { path: filePath });
        }
      } else {
        // PROCEEDED (Clicked Yes)
        console.log(`[CognitiveOS Watcher] User confirmed deletion of "${filename}". Proceeding...`);

        // Record failure history
        recordFailure(
          filePath,
          `File deleted directly from file manager: ${warningMessage}`,
          'system_level_delete',
          true,
          true
        );

        // Add checkup log
        db.addCheckupLog(
          `System level deletion confirmed for ${filename} (risk: ${blast.risk_level})`,
          filePath,
          'cognitive_warning'
        );

        // Broadcast warning to UI (so avatar displays warning bubble)
        if (broadcastFn) {
          broadcastFn('external-deletion-warning', {
            cognitive_warning: true,
            risk_level: blast.risk_level,
            risk_score: blast.risk_score,
            recommendation: blast.recommendation,
            warning_message: `[System Alert] Aiden noticed you deleted this file from the file manager: ${warningMessage}`,
            dependency_chain: chain,
            direct_dependents: blast.direct_dependents,
            indirect_dependents: blast.indirect_dependents,
            historical_failures: blast.historical_failures,
            path: filePath
          });
        }

        // Record action for behavioral memory
        observeAction({
          event_type: 'file_deleted',
          filepath: filePath,
          metadata: { system_level: true, forced: true, warned: true }
        });

        // Delete from database index since deletion is confirmed
        db.deleteItemByPath(filePath);
      }
    });

  } else {
    // No dependents, standard clean delete
    console.log(`[CognitiveOS Watcher] Deleted file has no dependents. Cleaning up index.`);
    db.addCheckupLog(`File deleted from filesystem: ${filename}`, filePath, 'delete');

    db.deleteItemByPath(filePath);
    if (broadcastFn) {
      broadcastFn('item-deleted', { path: filePath });
    }
  }
}

/**
 * Handle creation or modification of a file outside the portal
 * @param {string} filePath 
 */
async function handleSystemLevelSave(filePath) {
  const filename = path.basename(filePath);
  const normalizedPath = normalizePath(filePath);

  try {
    if (!fs.existsSync(filePath)) return;
    const stat = await fs.promises.stat(filePath);
    const isDir = stat.isDirectory();

    const dbItem = db.getItemByPath(filePath);
    const isNew = !dbItem;

    if (isDir) {
      if (!isNew) {
        // Ignore directory modification events, directories don't have user-modifiable contents themselves
        return;
      }
    } else {
      // File modification check
      const mtimeMs = stat.mtimeMs;
      if (knownMtimes.has(normalizedPath)) {
        if (knownMtimes.get(normalizedPath) === mtimeMs) {
          // Spurious event, no modification occurred
          return;
        }
        knownMtimes.set(normalizedPath, mtimeMs);
      } else {
        knownMtimes.set(normalizedPath, mtimeMs);
        if (!isNew) {
          // If already tracked and first time seeing it since startup, check if it was recently modified (within 2s)
          const isRecent = (Date.now() - mtimeMs) < 2000;
          if (!isRecent) {
            return;
          }
        }
      }
    }

    // Classify file type
    let type = isDir ? 'folder' : 'other';
    let category = isDir ? 'Folder' : 'User File';

    if (!isDir) {
      const ext = path.extname(filename).toLowerCase();
      if (['.exe', '.lnk', '.bat', '.cmd', '.ps1', '.msi'].includes(ext)) {
        type = 'app';
        category = 'Executable Script';
      } else if (['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.html', '.css', '.js'].includes(ext)) {
        type = 'document';
        category = 'Document';
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.mp3', '.mp4', '.wav', '.zip', '.rar'].includes(ext)) {
        type = 'other';
        category = 'Media/Archive File';
      }
    }

    // Save/upsert to database index
    db.upsertItem({
      name: filename,
      path: filePath,
      type: type,
      category: category,
      description: isDir ? `Directory containing files` : `File size: ${stat.size} bytes`,
      arguments: '',
      installDate: null
    });

    // Re-scan dependencies if it is a code file
    try {
      await updateGraphForFile(filePath);
    } catch (err) {
      console.error(`[CognitiveOS Watcher] Failed updating graph dependencies for ${filePath}:`, err.message);
    }

    if (isNew) {
      console.log(`[CognitiveOS Watcher] System-level creation event confirmed: ${filePath}`);
      db.addCheckupLog(`File created on filesystem: ${filename}`, filePath, 'create');
      
      if (broadcastFn) {
        broadcastFn('item-created', {
          name: filename,
          path: filePath,
          type: type,
          category: category
        });
      }
    } else {
      console.log(`[CognitiveOS Watcher] System-level modification event confirmed: ${filePath}`);
      if (broadcastFn) {
        broadcastFn('item-modified', {
          name: filename,
          path: filePath,
          type: type,
          category: category
        });
      }
    }
  } catch (err) {
    console.error(`[CognitiveOS Watcher] Error handling filesystem save for ${filePath}:`, err.message);
  }
}
// End of watcher file
