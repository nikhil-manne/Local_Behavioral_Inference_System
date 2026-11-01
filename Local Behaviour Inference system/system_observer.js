import { runCommand } from './powershell.js';
import { insertSemanticEvent, getDb } from './database.js';
import { spawn, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLL_INTERVAL_MS = 3000;
const COMMAND_HISTORY_LIMIT = 15;

let observerRunning = false;
let isRecordingMode = false;
let lastSeenProcesses = new Set();
let lastSeenFiles = new Map();
let lastSeenTail = [];
let lastSeenCmdHistory = [];
let eventHandlers = [];

const cognitiveSpawnedPids = new Set();

export function registerSpawnedPid(pid) {
  cognitiveSpawnedPids.add(pid);
  console.log(`[Observer] Registered spawned process PID: ${pid}`);
}

const recentlyExecutedWorkflowCmds = new Map(); // command -> timestamp

export function registerExecutedWorkflowCommand(cmd) {
  const normalized = cmd.trim().toLowerCase();
  recentlyExecutedWorkflowCmds.set(normalized, Date.now());
  console.log(`[Observer] Registering workflow command to ignore: "${normalized}"`);
}

const recentFileAccess = new Map(); // filepath → last_logged_timestamp
const FILE_ACCESS_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour minimum between same-file logs

const WMI_SCRIPT = `
  $Query = "SELECT * FROM __InstanceCreationEvent WITHIN 0.05 WHERE TargetInstance ISA 'Win32_Process'"
  Register-CimIndicationEvent -Query $Query -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue

  try {
      while ($true) {
          $Events = Get-Event -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue
          if ($Events) {
              foreach ($Ev in $Events) {
                  $Process = $Ev.SourceEventArgs.NewEvent.TargetInstance
                  if ($Process) {
                      $ParentName = ""
                      try {
                          $Parent = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($Process.ParentProcessId)" -ErrorAction SilentlyContinue
                          if ($Parent) {
                              $ParentName = $Parent.Name
                          }
                      } catch {}
                      
                      $Out = [PSCustomObject]@{
                          Name = $Process.Name
                          CommandLine = $Process.CommandLine
                          ParentName = $ParentName
                          ParentProcessId = $Process.ParentProcessId
                          ProcessId = $Process.ProcessId
                      }
                      $Out | ConvertTo-Json -Compress | Write-Host
                  }
                  Remove-Event -SourceIdentifier $Ev.SourceIdentifier -ErrorAction SilentlyContinue
              }
          }
          Start-Sleep -Milliseconds 50
      }
  } finally {
      Unregister-Event -SourceIdentifier "ProcessStart" -ErrorAction SilentlyContinue
  }
`;

let wmiProcess = null;
const recentCommands = [];

function cleanRecentCommands() {
  const now = Date.now();
  while (recentCommands.length > 0 && now - recentCommands[0].timestamp > 500) {
    recentCommands.shift();
  }
}

function isDuplicateCommand(cmd) {
  cleanRecentCommands();
  return recentCommands.some(rc => rc.command === cmd);
}

function registerIngestedCommand(cmd) {
  recentCommands.push({ command: cmd, timestamp: Date.now() });
}

function isEditorInternalGitCommand(cmd, parent) {
  if (!cmd || !parent) return false;

  const parentLower = parent.toLowerCase();
  const editorParents = new Set([
    'code.exe',
    'cursor.exe',
    'windsurf.exe',
    'antigravity ide.exe',
    'antigravity-ide.exe'
  ]);

  if (!editorParents.has(parentLower)) return false;

  const normalized = cmd.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized.startsWith('git ')) return false;

  const noisyGitProbes = [
    ' rev-parse --show-toplevel',
    ' rev-parse --git-dir',
    ' rev-parse --git-common-dir',
    ' rev-parse --is-inside-work-tree',
    ' config --null --get core.fsmonitor',
    ' config --get core.fsmonitor',
    ' status -z -uall',
    ' for-each-ref ',
    ' check-ignore ',
    ' ls-files ',
    ' symbolic-ref --short head'
  ];

  return noisyGitProbes.some(pattern => normalized.includes(pattern));
}

function parseCommandLine(cmdLine, procName) {
  if (!cmdLine) return null;
  let cmd = cmdLine.trim();

  let exePath = '';
  let args = '';
  if (cmd.startsWith('"')) {
    const nextQuote = cmd.indexOf('"', 1);
    if (nextQuote !== -1) {
      exePath = cmd.substring(1, nextQuote);
      args = cmd.substring(nextQuote + 1).trim();
    } else {
      exePath = cmd;
    }
  } else {
    const firstSpace = cmd.indexOf(' ');
    if (firstSpace !== -1) {
      exePath = cmd.substring(0, firstSpace);
      args = cmd.substring(firstSpace + 1).trim();
    } else {
      exePath = cmd;
    }
  }

  const baseExe = path.basename(exePath).toLowerCase();
  const cleanExe = baseExe.replace(/\.exe$/i, '').replace(/\.cmd$/i, '').replace(/\.bat$/i);

  if (args) {
    return `${cleanExe} ${args}`;
  }
  return cleanExe;
}

function handleWmiProcess(proc) {
  if (!proc || !proc.CommandLine) return;

  const parentPid = proc.ParentProcessId || proc.ParentProcessID;
  if (parentPid && cognitiveSpawnedPids.has(parentPid)) {
    if (proc.ProcessId) {
      cognitiveSpawnedPids.add(proc.ProcessId);
    }
    // Suppress console log output for internally spawned commands
    return;
  }

  const cmd = parseCommandLine(proc.CommandLine, proc.Name);
  if (!cmd) return;

  // List of developer tool command prefixes we want to capture system-wide
  const DEV_TOOLS = [
    'git', 'npm', 'node', 'docker', 'docker-compose', 'cargo', 'python', 'pip', 'npx', 'yarn', 'pnpm',
    'dotnet', 'java', 'javac', 'go', 'rustc', 'cmake', 'make', 'gcc', 'mvn', 'gradle',
    'kubectl', 'terraform', 'ansible', 'vagrant', 'heroku', 'vercel', 'netlify',
    'csc', 'msbuild', 'nuget', 'pip3', 'conda', 'ruby', 'gem', 'rails',
    'curl', 'wget', 'ssh', 'scp', 'tar', 'unzip', 'zip'
  ];
  // List of desktop applications to capture (with command-line arguments)
  const DESKTOP_APPS = ['chrome', 'msedge', 'firefox', 'code', 'windsurf', 'cursor', 'notepad'];

  const baseCmd = cmd.split(' ')[0].toLowerCase();

  const IGNORED_CMDS = new Set(['conhost', 'cmd', 'powershell', 'pwsh', 'wmi_watcher']);
  if (IGNORED_CMDS.has(baseCmd)) {
    return;
  }

  const parent = (proc.ParentName || '').toLowerCase();
  const isShellParent = ['cmd.exe', 'powershell.exe', 'pwsh.exe', 'windowsterminal.exe', 'openconsole.exe', 'explorer.exe'].includes(parent);

  const isDevTool = DEV_TOOLS.includes(baseCmd);
  const isDesktopApp = DESKTOP_APPS.includes(baseCmd);

  if (isEditorInternalGitCommand(cmd, parent)) {
    return;
  }

  if (isDesktopApp) {
    const cmdLower = cmd.toLowerCase();
    if (cmdLower.includes('--type=') || cmdLower.includes('-contentproc') || cmdLower.includes('--watcher')) {
      return;
    }
  }

  // If it's a dev tool or a desktop app, capture it system-wide regardless of parent!
  // Otherwise, only capture it if the parent is a standard shell
  if (!isDevTool && !isDesktopApp && !isShellParent) {
    return;
  }

  if (cmd.includes('server.js') || cmd.includes('powershell.exe') || cmd.includes('wmi_watcher') || cmd.includes('log_cmd.js')) {
    return;
  }

  if (isDuplicateCommand(cmd)) {
    return;
  }

  registerIngestedCommand(cmd);

  console.log(`[Observer] WMI captured app/command from ${proc.ParentName || 'system'}: "${cmd}"`);

  let eventType = 'terminal_command';
  let appName = 'terminal';
  let runCommand = cmd;

  if (isDesktopApp || parent === 'explorer.exe') {
    eventType = 'app_launched';
    appName = friendlyAppName(baseCmd);
    runCommand = getAppLaunchCommand(baseCmd);
  }

  const event = {
    event_type: eventType,
    command: runCommand,
    app: appName,
    metadata: { source: (isDesktopApp || parent === 'explorer.exe') ? 'wmi_watcher' : `wmi_${parent.replace('.exe', '') || 'dev_tool'}` }
  };

  emit(event);

  if (eventType === 'app_launched') {
    // Wait for the GUI window to open and fetch its coordinates
    setTimeout(async () => {
      let winX = 0, winY = 0, winW = 0, winH = 0;
      const queryName = appName || baseCmd;

      // If we are recording a workflow, automatically maximize the window as soon as it exists
      if (isRecordingMode && queryName && queryName.toLowerCase() !== 'explorer' && queryName.toLowerCase() !== 'antigravity ide') {
        try {
          const inputToolPath = path.join(__dirname, 'input_tool.exe');
          console.log(`[system_observer] Auto-maximizing ${queryName} during recording...`);
          // Run focus/maximize on the window first
          execFileSync(inputToolPath, ['--focus', queryName], { timeout: 3000, windowsHide: true });
        } catch (e) {
          console.error(`[system_observer] Auto-maximize error:`, e.message);
        }
      }

      for (let i = 0; i < 30; i++) {
        try {
          const inputToolPath = path.join(__dirname, 'input_tool.exe');
          const stdout = execFileSync(inputToolPath, ['--get-rect', queryName], { encoding: 'utf8', timeout: 500, windowsHide: true });
          const parts = stdout.trim().split(',');
          if (parts.length === 4 && parts[2] !== '0') {
            winX = parseInt(parts[0], 10);
            winY = parseInt(parts[1], 10);
            winW = parseInt(parts[2], 10);
            winH = parseInt(parts[3], 10);
            break;
          }
        } catch (e) {}
        await sleep(100);
      }

      if (winW > 0 && winH > 0) {
        event.metadata.winX = winX;
        event.metadata.winY = winY;
        event.metadata.winW = winW;
        event.metadata.winH = winH;
        console.log(`[Observer] Automatically resolved window state for ${appName}: X=${winX}, Y=${winY}, W=${winW}, H=${winH}`);
      }

      insertSemanticEvent({
        event_type: event.event_type,
        command: event.command,
        app: event.app,
        metadata: event.metadata
      });
    }, 500);
  } else {
    insertSemanticEvent({
      event_type: event.event_type,
      command: event.command,
      app: event.app,
      metadata: event.metadata
    });
  }
}

function startWmiWatcher() {
  if (wmiProcess) return;

  const psArgs = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-Command',
    WMI_SCRIPT
  ];

  wmiProcess = spawn('powershell.exe', psArgs, { windowsHide: true });
  let buffer = '';

  wmiProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    let lines = buffer.split(/\r?\n/);
    buffer = lines.pop();

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'Watcher Started') continue;
      try {
        const proc = JSON.parse(trimmed);
        handleWmiProcess(proc);
      } catch (err) {
        // ignore malformed lines
      }
    }
  });

  wmiProcess.stderr.on('data', (data) => {
    console.error('[WMI Watcher Error]:', data.toString());
  });

  wmiProcess.on('close', (code) => {
    console.warn(`[WMI Watcher] Process exited with code ${code}. Will restart in 1s...`);
    wmiProcess = null;
    if (observerRunning) {
      setTimeout(() => {
        console.log('[WMI Watcher] Restarting...');
        startWmiWatcher();
      }, 1000);
    }
  });
}

// ── PUBLIC API ────────────────────────────────────────

export function startObserver() {
  if (observerRunning) return;
  observerRunning = true;
  console.log('[Observer] System-wide observer started');
  startWmiWatcher();
  observerLoop();
}

export function stopObserver() {
  observerRunning = false;
  if (wmiProcess) {
    wmiProcess.kill();
    wmiProcess = null;
  }
}

export function onSemanticEvent(handler) {
  eventHandlers.push(handler);
}

// Call this from server.js for every internal tool action
// (file delete, rename, terminal command run through the UI)
export function emitInternalAction(action) {
  const event = {
    event_type: action.type,
    app: action.app || 'tool_executor',
    filepath: action.filepath || null,
    command: action.command || null,
    metadata: { source: 'internal', ...action.metadata }
  };
  emit(event);
  insertSemanticEvent({
    event_type: event.event_type,
    app: event.app,
    filepath: event.filepath,
    command: event.command,
    metadata: event.metadata
  });
}

// ── MAIN POLL LOOP ────────────────────────────────────

async function observerLoop() {
  while (observerRunning) {
    try {
      await Promise.allSettled([
        pollRunningProcesses(),
        pollRecentFiles(),
        pollTerminalHistory(),
        pollCmdHistory(),
        pollWindowTitles()
      ]);
    } catch (err) {
      console.error('[Observer] Poll error:', err.message);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── PROCESS OBSERVER ──────────────────────────────────

async function pollRunningProcesses() {
  const script = `
    try {
      Get-Process |
      Where-Object { $_.MainWindowTitle -ne '' -and $_.Name -ne '' } |
      Select-Object -First 20 Name |
      ConvertTo-Json -Compress
    } catch { Write-Output '[]' }
  `;

  const result = await runCommand(script);
  if (result.code !== 0 || !result.stdout?.trim()) return;

  let processes;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    processes = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return; }

  const currentNames = new Set(
    processes.map(p => (p.Name || '').toLowerCase()).filter(Boolean)
  );

  // Newly launched apps
  const DESKTOP_APPS = ['chrome', 'msedge', 'firefox', 'code', 'windsurf', 'cursor', 'notepad'];
  for (const name of currentNames) {
    if (!lastSeenProcesses.has(name)) {
      if (DESKTOP_APPS.includes(name.toLowerCase())) {
        continue;
      }
      const appName = friendlyAppName(name);
      const event = {
        event_type: 'app_launched',
        app: appName,
        metadata: { source: 'system_observer', raw_process: name }
      };
      emit(event);
      insertSemanticEvent({
        event_type: event.event_type,
        app: event.app,
        metadata: event.metadata
      });
    }
  }

  // Closed apps
  for (const name of lastSeenProcesses) {
    if (!currentNames.has(name)) {
      const event = {
        event_type: 'app_closed',
        app: friendlyAppName(name),
        metadata: { source: 'system_observer' }
      };
      emit(event);
      insertSemanticEvent({
        event_type: event.event_type,
        app: event.app,
        metadata: event.metadata
      });
    }
  }

  lastSeenProcesses = currentNames;
}

// ── RECENT FILES OBSERVER ─────────────────────────────

async function pollRecentFiles() {
  const script = `
    try {
      $recentPath = [System.IO.Path]::Combine($env:APPDATA, 'Microsoft', 'Windows', 'Recent')
      Get-ChildItem $recentPath -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 5 Name, LastWriteTime, FullName |
      ConvertTo-Json -Compress
    } catch { Write-Output '[]' }
  `;

  const result = await runCommand(script);
  if (result.code !== 0 || !result.stdout?.trim()) return;

  let files;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    files = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return; }

  for (const file of files) {
    if (!file?.FullName) continue;
    const lastSeen = lastSeenFiles.get(file.FullName);
    const modTime = new Date(file.LastWriteTime).getTime();

    if (!lastSeen || lastSeen < modTime) {
      const cleanName = (file.Name || '').replace(/\.lnk$/i, '');

      // ── DEDUP: only log if not seen within cooldown period ──
      const lastLogged = recentFileAccess.get(cleanName);
      if (lastLogged && (Date.now() - lastLogged) < FILE_ACCESS_COOLDOWN_MS) {
        lastSeenFiles.set(file.FullName, modTime); // update seen time, skip logging
        continue;
      }
      recentFileAccess.set(cleanName, Date.now());
      // ── END DEDUP ──

      const event = {
        event_type: 'file_accessed',
        filepath: cleanName,
        metadata: { source: 'recent_files' }
      };
      emit(event);
      insertSemanticEvent({
        event_type: event.event_type,
        filepath: event.filepath,
        metadata: event.metadata
      });
      lastSeenFiles.set(file.FullName, modTime);
    }
  }
}

// ── LBIS ADDITION: window title observer ──────────────────────────────────
let lastWindowTitles = new Map();

async function pollWindowTitles() {
  const script = `
    try {
      Get-Process |
      Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowTitle -ne $null } |
      Select-Object Name, MainWindowTitle |
      ConvertTo-Json -Compress
    } catch { Write-Output '[]' }
  `;

  const result = await runCommand(script);
  if (result.code !== 0 || !result.stdout?.trim()) return;

  let procs;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    procs = Array.isArray(parsed) ? parsed : [parsed];
  } catch { return; }

  for (const proc of procs) {
    const name = (proc.Name || '').toLowerCase();
    const title = (proc.MainWindowTitle || '').trim();
    if (!title || title.length < 3) continue;

    const prev = lastWindowTitles.get(name);
    if (prev === title) continue;   // No change

    lastWindowTitles.set(name, title);

    // Extract meaningful context from title
    // e.g. "DSA Algorithms - YouTube — Google Chrome" → topic: "DSA Algorithms"
    let topic = title;
    const browserSuffixes = [
      'google chrome',
      'mozilla firefox',
      'microsoft edge',
      'chrome',
      'firefox',
      'edge'
    ];
    let titleLower = title.toLowerCase();
    for (const suffix of browserSuffixes) {
      const idx = titleLower.lastIndexOf(' - ' + suffix);
      if (idx !== -1) {
        topic = topic.substring(0, idx);
        titleLower = titleLower.substring(0, idx);
        break;
      }
      const idx2 = titleLower.lastIndexOf(' — ' + suffix);
      if (idx2 !== -1) {
        topic = topic.substring(0, idx2);
        titleLower = titleLower.substring(0, idx2);
        break;
      }
    }

    const ytIdx = titleLower.lastIndexOf(' - youtube');
    if (ytIdx !== -1) {
      topic = topic.substring(0, ytIdx);
    } else {
      const ytIdx2 = titleLower.lastIndexOf(' — youtube');
      if (ytIdx2 !== -1) {
        topic = topic.substring(0, ytIdx2);
      }
    }

    if (!titleLower.includes('youtube')) {
      topic = topic.split(/[-–—|]/)[0];
    }
    topic = topic.trim().replace(/^\([^)]+\)\s*/, '');

    let winX = 0, winY = 0, winW = 0, winH = 0;
    try {
      const inputToolPath = path.join(__dirname, 'input_tool.exe');
      const stdout = execFileSync(inputToolPath, ['--get-rect', title], { encoding: 'utf8', timeout: 500, windowsHide: true });
      const parts = stdout.trim().split(',');
      if (parts.length === 4) {
        winX = parseInt(parts[0], 10);
        winY = parseInt(parts[1], 10);
        winW = parseInt(parts[2], 10);
        winH = parseInt(parts[3], 10);
      }
    } catch (e) {
      // ignore
    }

    const event = {
      event_type: 'context_changed',
      app: friendlyAppName(name),
      command: topic,                // Topic becomes the "command" for prefix matching
      metadata: {
        source: 'window_title',
        raw_title: title,
        process: name,
        ...(winW > 0 && winH > 0 ? { winX, winY, winW, winH } : {})
      }
    };

    emit(event);
    insertSemanticEvent({
      event_type: event.event_type,
      app: event.app,
      command: event.command,
      metadata: event.metadata
    });
  }
}
// ── END ADDITION ──────────────────────────────────────────────────────────

// ── TERMINAL HISTORY OBSERVER ─────────────────────────

async function pollTerminalHistory() {
  const script = `
    try {
      $histPath = Join-Path $env:APPDATA "Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt"
      if (Test-Path $histPath) {
        $lines = Get-Content $histPath -Tail ${COMMAND_HISTORY_LIMIT} -ErrorAction SilentlyContinue
        [string[]]$lines | ConvertTo-Json -Compress
      } else { Write-Output '[]' }
    } catch { Write-Output '[]' }
  `;

  const result = await runCommand(script);
  if (result.code !== 0 || !result.stdout?.trim()) return;

  let commands;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    commands = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch { return; }

  // Standardize commands, supporting both raw strings and object shapes
  commands = commands.map(cmd => {
    if (typeof cmd === 'string') return cmd.trim();
    if (cmd && typeof cmd === 'object' && cmd.value) return String(cmd.value).trim();
    return '';
  }).filter(Boolean);

  // Initialize lastSeenTail on first poll without emitting past commands
  if (lastSeenTail.length === 0 && commands.length > 0) {
    lastSeenTail = commands;
    return;
  }

  // Find longest overlap suffix of lastSeenTail that is a prefix of commands
  let overlapIndex = 0;
  for (let len = Math.min(lastSeenTail.length, commands.length); len > 0; len--) {
    const suffix = lastSeenTail.slice(-len);
    const prefix = commands.slice(0, len);
    if (JSON.stringify(suffix) === JSON.stringify(prefix)) {
      overlapIndex = len;
      break;
    }
  }

  const newCommands = commands.slice(overlapIndex);
  for (const cmd of newCommands) {
    if (cmd.toLowerCase().includes('input_tool')) continue;

    const normalized = cmd.trim().toLowerCase();
    const lastExecuted = recentlyExecutedWorkflowCmds.get(normalized);
    if (lastExecuted && (Date.now() - lastExecuted) < 30000) {
      console.log(`[Observer] Suppressed workflow command from PS history: "${cmd}"`);
      recentlyExecutedWorkflowCmds.delete(normalized);
      continue;
    }

    if (isDuplicateCommand(cmd)) continue;
    registerIngestedCommand(cmd);

    console.log(`[Observer] PS history detected command: "${cmd}"`);
    const event = {
      event_type: 'terminal_command',
      command: cmd,
      app: 'terminal',
      metadata: { source: 'ps_history' }
    };
    emit(event);
    insertSemanticEvent({
      event_type: event.event_type,
      command: event.command,
      app: event.app,
      metadata: event.metadata
    });
  }

  lastSeenTail = commands;
}

// ── CMD HISTORY OBSERVER ─────────────────────────────

async function pollCmdHistory() {
  // Use doskey /history from all running cmd.exe processes via wmic
  const script = `
    try {
      # Read the cmd_wrapper log file if it exists
      $logPath = "${path.join(__dirname, 'cmd_history.log')}"
      if (Test-Path $logPath) {
        $lines = Get-Content $logPath -Tail ${COMMAND_HISTORY_LIMIT} -ErrorAction SilentlyContinue
        [string[]]$lines | ConvertTo-Json -Compress
      } else { Write-Output '[]' }
    } catch { Write-Output '[]' }
  `;

  const result = await runCommand(script);
  if (result.code !== 0 || !result.stdout?.trim()) return;

  let commands;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    commands = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);
  } catch { return; }

  commands = commands.map(cmd => {
    if (typeof cmd === 'string') return cmd.trim();
    if (cmd && typeof cmd === 'object' && cmd.value) return String(cmd.value).trim();
    return '';
  }).filter(Boolean);

  if (lastSeenCmdHistory.length === 0 && commands.length > 0) {
    lastSeenCmdHistory = commands;
    return;
  }

  let overlapIndex = 0;
  for (let len = Math.min(lastSeenCmdHistory.length, commands.length); len > 0; len--) {
    const suffix = lastSeenCmdHistory.slice(-len);
    const prefix = commands.slice(0, len);
    if (JSON.stringify(suffix) === JSON.stringify(prefix)) {
      overlapIndex = len;
      break;
    }
  }

  const newCommands = commands.slice(overlapIndex);
  for (const cmd of newCommands) {
    if (cmd.toLowerCase().includes('input_tool')) continue;

    const normalized = cmd.trim().toLowerCase();
    const lastExecuted = recentlyExecutedWorkflowCmds.get(normalized);
    if (lastExecuted && (Date.now() - lastExecuted) < 30000) {
      console.log(`[Observer] Suppressed workflow command from CMD history: "${cmd}"`);
      recentlyExecutedWorkflowCmds.delete(normalized);
      continue;
    }

    if (isDuplicateCommand(cmd)) continue;
    registerIngestedCommand(cmd);

    console.log(`[Observer] CMD history detected command: "${cmd}"`);
    const event = {
      event_type: 'terminal_command',
      command: cmd,
      app: 'terminal',
      metadata: { source: 'cmd_history' }
    };
    emit(event);
    insertSemanticEvent({
      event_type: event.event_type,
      command: event.command,
      app: event.app,
      metadata: event.metadata
    });
  }

  lastSeenCmdHistory = commands;
}

// ── HELPERS ───────────────────────────────────────────

export function emit(event) {
  for (const handler of eventHandlers) {
    try { handler(event); } catch (e) {
      console.error('[Observer] Handler error:', e.message);
    }
  }
}

function friendlyAppName(processName) {
  const MAP = {
    'code': 'VS Code',
    'chrome': 'Chrome',
    'msedge': 'Edge',
    'firefox': 'Firefox',
    'windowsterminal': 'Terminal',
    'powershell': 'PowerShell',
    'cmd': 'Command Prompt',
    'notepad': 'Notepad',
    'explorer': 'File Explorer',
    'slack': 'Slack',
    'discord': 'Discord',
    'spotify': 'Spotify',
    'node': 'Node.js',
    'python': 'Python',
    'docker desktop': 'Docker',
    'cursor': 'Cursor',
    'windsurf': 'Windsurf',
    'whatsapp.root': 'WhatsApp',
    'whatsapp': 'WhatsApp'
  };
  return MAP[processName?.toLowerCase()] || processName;
}

function getAppLaunchCommand(baseCmd) {
  try {
    const db = getDb();
    let cleanName = baseCmd.replace(/\.exe$/i, '').toLowerCase();
    if (cleanName.endsWith('.root')) {
      cleanName = cleanName.substring(0, cleanName.length - 5);
    }
    
    // Query database indexed_items table for matching app shortcut path
    const match = db.prepare(`
      SELECT path FROM indexed_items 
      WHERE type = 'app' 
        AND (LOWER(name) = ? OR LOWER(path) LIKE ?)
      LIMIT 1
    `).get(cleanName, `%${cleanName}%`);
    
    if (match && match.path) {
      return match.path;
    }
  } catch (e) {
    console.error('[Observer] Error looking up launch command:', e);
  }
  return baseCmd;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function setRecordingMode(enabled) {
  isRecordingMode = enabled;
  console.log(`[Observer] Recording mode set to: ${enabled}`);
}
