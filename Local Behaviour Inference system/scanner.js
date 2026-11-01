import fs from 'fs/promises';
import path from 'path';
import { runCommand } from './powershell.js';
import * as db from './database.js';

let isScanning = false;
let currentProgress = '';
let lastUwpScanSuccess = false;

export function getScanStatus() {
  return {
    isScanning,
    currentProgress
  };
}

/**
 * Scan applications using PowerShell (Start Menu shortcuts + Registry Uninstall keys)
 */
export async function scanApps() {
  currentProgress = 'Scanning Start Menu shortcuts and Desktop links...';
  
  // 1. Scan Shortcuts (Start Menu + Desktop)
  const shortcutScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $sh = New-Object -ComObject WScript.Shell
    $shortcutDirs = @(
        "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs",
        "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
        "$env:USERPROFILE\\Desktop",
        "$env:PUBLIC\\Desktop"
    )
    $shortcuts = @()
    foreach ($dir in $shortcutDirs) {
        if (Test-Path $dir) {
            $files = Get-ChildItem -Path $dir -Recurse -Filter "*.lnk" -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                try {
                    $lnk = $sh.CreateShortcut($file.FullName)
                    $target = $lnk.TargetPath
                    if ($target -and (Test-Path $target)) {
                        $shortcuts += [PSCustomObject]@{
                            Name = $file.BaseName
                            Path = $target
                            Arguments = $lnk.Arguments
                            Description = $lnk.Description
                            Source = "shortcut"
                        }
                    }
                } catch {}
            }
        }
    }
    if ($shortcuts.Count -gt 0) {
        $shortcuts | ConvertTo-Json -Depth 3
    } else {
        "[]"
    }
  `;

  const { stdout: shortcutOut } = await runCommand(shortcutScript);
  let shortcutApps = [];
  try {
    if (shortcutOut && shortcutOut.trim()) {
      shortcutApps = JSON.parse(shortcutOut);
      if (!Array.isArray(shortcutApps)) {
        shortcutApps = [shortcutApps];
      }
    }
  } catch (err) {
    console.error('Error parsing shortcut scan JSON:', err);
  }

  // 2. Scan Registry
  currentProgress = 'Scanning system registry for installed programs...';
  const registryScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    $paths = @(
        "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",
        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"
    )
    $apps = Get-ItemProperty $paths -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -ne $null -and $_.InstallLocation -ne $null -and (Test-Path $_.InstallLocation) } |
        Select-Object DisplayName, InstallLocation, InstallDate
        
    if ($apps.Count -gt 0) {
        $apps | ConvertTo-Json -Depth 2
    } else {
        "[]"
    }
  `;

  const { stdout: registryOut } = await runCommand(registryScript);
  let registryApps = [];
  try {
    if (registryOut && registryOut.trim()) {
      registryApps = JSON.parse(registryOut);
      if (!Array.isArray(registryApps)) {
        registryApps = [registryApps];
      }
    }
  } catch (err) {
    console.error('Error parsing registry scan JSON:', err);
  }

  // 3. Scan Store/UWP Apps
  currentProgress = 'Scanning Windows Store / UWP applications...';
  const startAppsScript = `
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $apps = Get-StartApps | Select-Object Name, AppID
        if ($apps.Count -gt 0) {
            $apps | ConvertTo-Json -Depth 2
        } else {
            "[]"
        }
    } catch {
        "[]"
    }
  `;

  const { stdout: startAppsOut } = await runCommand(startAppsScript);
  let startApps = [];
  try {
    if (startAppsOut && startAppsOut.trim()) {
      startApps = JSON.parse(startAppsOut);
      if (!Array.isArray(startApps)) {
        startApps = [startApps];
      }
    }
  } catch (err) {
    console.error('Error parsing Get-StartApps JSON:', err);
  }

  // Combine results
  const appsMap = new Map();

  // Load shortcuts first (direct executable paths)
  for (const app of shortcutApps) {
    if (app.Path && app.Path.toLowerCase().endsWith('.exe')) {
      appsMap.set(app.Path.toLowerCase(), {
        name: app.Name,
        path: app.Path,
        type: 'app',
        category: 'Desktop App',
        description: app.Description || 'Launch application shortcut',
        arguments: app.Arguments || '',
        installDate: null
      });
    }
  }

  // Merge registry apps (adds install locations / metadata)
  for (const app of registryApps) {
    if (app.InstallLocation) {
      try {
        const installDir = app.InstallLocation;
        const displayName = app.DisplayName;
        
        let exists = false;
        for (const existingApp of appsMap.values()) {
          if (existingApp.name.toLowerCase() === displayName.toLowerCase() || 
              existingApp.path.toLowerCase().startsWith(installDir.toLowerCase())) {
            existingApp.installDate = app.InstallDate || null;
            existingApp.category = 'Installed Program';
            exists = true;
          }
        }
        
        if (!exists) {
          appsMap.set(installDir.toLowerCase(), {
            name: displayName,
            path: installDir,
            type: 'folder',
            category: 'Application Folder',
            description: `Installation directory for ${displayName}`,
            arguments: '',
            installDate: app.InstallDate || null
          });
        }
      } catch (e) {}
    }
  }

  // Merge Windows Store / UWP apps
  for (const app of startApps) {
    if (!app.AppID || !app.Name) continue;

    const appId = app.AppID;
    const isPhysicalPath = appId.includes(':\\') || appId.endsWith('.exe');

    if (isPhysicalPath) {
      let cleanedPath = appId;
      if (cleanedPath.startsWith('{') && cleanedPath.includes('}')) {
        const index = cleanedPath.indexOf('}');
        cleanedPath = cleanedPath.substring(index + 1).replace(/^\\/, '');
      }

      if (path.isAbsolute(cleanedPath)) {
        const pathLower = cleanedPath.toLowerCase();
        if (!appsMap.has(pathLower)) {
          appsMap.set(pathLower, {
            name: app.Name,
            path: cleanedPath,
            type: 'app',
            category: 'Desktop App',
            description: 'Application shortcut',
            arguments: '',
            installDate: null
          });
        }
      }
    } else {
      // Store / UWP app (e.g. WhatsApp, Kali Linux)
      const uwpPath = `shell:AppsFolder\\${appId}`;
      const pathLower = uwpPath.toLowerCase();
      
      if (!appsMap.has(pathLower)) {
        appsMap.set(pathLower, {
          name: app.Name,
          path: uwpPath,
          type: 'app',
          category: 'Windows Store App',
          description: 'Windows Store / Universal App',
          arguments: '',
          installDate: null
        });
      }
    }
  }

  lastUwpScanSuccess = startApps.length > 0;
  return Array.from(appsMap.values());
}

/**
 * Scan a directory recursively up to maxDepth
 */
export async function scanDirectoryRecursive(dirPath, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];
  const results = [];
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(fullPath);
          isDir = stat.isDirectory();
        } catch (e) {
          // If stat fails (e.g. permission or broken symlink), treat as non-directory
        }
      }

      if (isDir) {
        const entryNameLower = entry.name.toLowerCase();
        const SKIP_DIRS = new Set([
          'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__',
          'venv', 'env', '.env', '.venv', 'vendor', 'target', 'bin', 'obj', 
          '.idea', '.vscode', '.vs', 'site-packages', 'lib', 'packages'
        ]);
        if (entryNameLower.startsWith('.') || SKIP_DIRS.has(entryNameLower) || /^python/.test(entryNameLower)) {
          continue;
        }
      }
      
      let type = isDir ? 'folder' : 'other';
      let category = isDir ? 'Folder' : 'User File';
      
      if (!isDir) {
        const ext = path.extname(entry.name).toLowerCase();
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
      
      results.push({
        name: entry.name,
        path: fullPath,
        type: type,
        category: category,
        description: isDir ? `Directory containing files` : `File size unknown`,
        arguments: '',
        installDate: null
      });
      
      if (isDir && currentDepth < maxDepth) {
        const subResults = await scanDirectoryRecursive(fullPath, maxDepth, currentDepth + 1);
        results.push(...subResults);
      }
    }
  } catch (error) {
    // Silent catch for permissions/access errors
  }
  return results;
}

/**
 * Scan registered user directories
 */
export async function scanUserDirectories() {
  const dirs = db.getScannedDirectories();
  const allFiles = [];

  for (const dir of dirs) {
    currentProgress = `Crawling user folder: ${dir.alias}...`;
    const files = await scanDirectoryRecursive(dir.path, dir.depth);
    allFiles.push(...files);
    db.updateDirectoryLastScanned(dir.path);
  }

  return allFiles;
}

/**
 * Execute full scan
 */
export async function runFullScan(onStep = null) {
  if (isScanning) return;
  isScanning = true;
  db.addCheckupLog('Full system file and application scan started', 'System', 'scan_started');
  
  try {
    // 1. Scan installed apps
    if (onStep) onStep('Scanning system applications...');
    const apps = await scanApps();
    
    // 2. Scan user folders
    if (onStep) onStep('Scanning user directories...');
    const files = await scanUserDirectories();

    // 3. Save to database
    if (onStep) onStep('Saving scan results to database...');
    
    const validAppPaths = [];
    const validFilePaths = [];
    
    // Batch inserts for performance
    const database = db.getDb();
    database.exec('BEGIN TRANSACTION');
    try {
      for (const app of apps) {
        db.upsertItem(app);
        validAppPaths.push(app.path);
      }
      
      // Index the root directories themselves so they can be matched exactly by name/path
      const registeredDirs = db.getScannedDirectories();
      for (const dir of registeredDirs) {
        const rootItem = {
          name: dir.alias,
          path: dir.path,
          type: 'folder',
          category: 'Scanned Root Directory',
          description: `Root scan directory source`,
          arguments: '',
          installDate: null
        };
        db.upsertItem(rootItem);
        validFilePaths.push(dir.path);
      }

      for (const file of files) {
        db.upsertItem(file);
        validFilePaths.push(file.path);
      }
      database.exec('COMMIT');
    } catch (dbErr) {
      database.exec('ROLLBACK');
      throw dbErr;
    }

    // 4. Clean up items that were deleted or uninstalled
    if (onStep) onStep('Cleaning up outdated records...');
    db.deleteOrphanedApps(validAppPaths, lastUwpScanSuccess);
    db.deleteOrphanedItems(validFilePaths);

    db.addCheckupLog('Full scan completed successfully. Indexed ' + (apps.length + files.length) + ' items.', 'System', 'scan_completed');
  } catch (error) {
    console.error('Scan failed:', error);
    db.addCheckupLog('System scan failed: ' + error.message, 'System', 'error');
  } finally {
    isScanning = false;
    currentProgress = '';
  }
}

/**
 * Run quick checkup scan for new/removed applications
 * Triggers change events if changes are detected
 */
export async function runBackgroundCheckup(onAppChange = null) {
  try {
    const freshApps = await scanApps();
    const dbInstance = db.getDb();
    
    // Fetch current app list in database
    const stmt = dbInstance.prepare("SELECT name, path FROM indexed_items WHERE type = 'app' OR category = 'Application Folder'");
    const dbApps = stmt.all();
    
    const dbAppsMap = new Map();
    dbApps.forEach(app => dbAppsMap.set(app.path.toLowerCase(), app));
    
    const freshAppsMap = new Map();
    freshApps.forEach(app => freshAppsMap.set(app.path.toLowerCase(), app));
    
    const installed = [];
    const uninstalled = [];

    // Find new apps
    for (const freshApp of freshApps) {
      const pathKey = freshApp.path.toLowerCase();
      if (!dbAppsMap.has(pathKey)) {
        // New installation!
        db.upsertItem(freshApp);
        db.addCheckupLog(`New application detected and indexed: ${freshApp.name}`, freshApp.name, 'installed');
        installed.push(freshApp);
        if (onAppChange) onAppChange('installed', freshApp);
      }
    }

    // Find uninstalled apps
    for (const dbApp of dbApps) {
      const pathKey = dbApp.path.toLowerCase();
      // Skip UWP app check if UWP scanning failed in this run (headless environment session limit)
      if (dbApp.path.toLowerCase().startsWith('shell:') && !lastUwpScanSuccess) {
        continue;
      }
      if (!freshAppsMap.has(pathKey)) {
        // App was removed!
        db.deleteItemByPath(dbApp.path);
        db.addCheckupLog(`Application removal detected: ${dbApp.name}`, dbApp.name, 'removed');
        uninstalled.push(dbApp);
        if (onAppChange) onAppChange('removed', dbApp);
      }
    }

    if (installed.length > 0 || uninstalled.length > 0) {
      console.log(`Background checkup complete. Installed: ${installed.length}, Removed: ${uninstalled.length}`);
    }
    
    return { installed, uninstalled };
  } catch (error) {
    console.error('Background checkup error:', error);
  }
}
