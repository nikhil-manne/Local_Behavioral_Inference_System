import { exec } from 'child_process';
import util from 'util';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'fs';
import { spawn } from 'child_process';
import * as db from './database.js';
import * as scanner from './scanner.js';
import { runCommand, spawnCommand, runCmdCommand, runStartCmdCommand, runStartPowerShellCommand } from './powershell.js';
import { parseAndExecute, findBestMatch } from './command_parser.js';
import { getBlastRadius, recordFailure, getDependencyChain, scanProjectDependencies, updateGraphForFile } from './dependency_graph.js';
import { observeAction, handleConfirmation, handleRejection, getSuggestibleWorkflows, detectCurrentIntent, runGhostJob, handleGhostReactivation } from './behavioral_memory.js';
import { narrateBlastRadius, narrateWorkflowSuggestion, narrateRejectionLearning } from './cognitive_narrator.js';
import * as watcher from './watcher.js';
import { startObserver, onSemanticEvent, emitInternalAction, emit, setRecordingMode, registerSpawnedPid, registerExecutedWorkflowCommand } from './system_observer.js';
import {
  initSequenceEngine, ingestEvent, confirmWorkflow as seConfirm,
  rejectWorkflow as seReject, getAllLearnedWorkflows,
  renameWorkflow as seRename, deleteWorkflow as seDelete
} from './sequence_engine.js';

import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let activeRecording = null;
let recordProcess = null;
let recordBuffer = '';
let isAvatarDisabled = false;

let isWorkflowRunning = false;
let shouldAbortWorkflow = false;
let currentWorkflowProcess = null;
let lastFocusedWindowTarget = null;

async function delayOrAbort(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (shouldAbortWorkflow) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return shouldAbortWorkflow;
}

function psSingleQuote(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function psDoubleQuote(value) {
  return String(value ?? '').replace(/`/g, '``').replace(/"/g, '`"');
}

function requestWorkflowAbort() {
  shouldAbortWorkflow = true;
  if (currentWorkflowProcess && !currentWorkflowProcess.killed) {
    currentWorkflowProcess.kill();
  }
}

function runWorkflowCommand(command) {
  return new Promise((resolve) => {
    if (shouldAbortWorkflow) {
      resolve({ stdout: '', stderr: 'Workflow aborted before command started', code: 130 });
      return;
    }

    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `$ErrorActionPreference = 'Stop'; try { ${command} } catch { Write-Error $_.Exception.Message; exit 1 }`
    ];

    const child = spawn('powershell.exe', psArgs, { windowsHide: true });
    currentWorkflowProcess = child;
    registerSpawnedPid(child.pid);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', (code, signal) => {
      if (currentWorkflowProcess === child) currentWorkflowProcess = null;
      resolve({
        stdout,
        stderr: stderr || (signal ? `Process killed by ${signal}` : ''),
        code: shouldAbortWorkflow ? 130 : (code ?? 0)
      });
    });
    child.on('error', (err) => {
      if (currentWorkflowProcess === child) currentWorkflowProcess = null;
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

function normalizeRecordedInput(raw) {
  if (!raw || !raw.type) return null;

  const metadata = { source: 'input_recorder', timestamp: Date.now() };
  for (const [key, value] of Object.entries(raw)) {
    if (key !== 'type') metadata[key] = value;
  }

  const app = raw.winProcess ? String(raw.winProcess).toLowerCase() : null;

  if (raw.type === 'terminal_command') {
    return {
      event_type: 'terminal_command',
      app: 'terminal',
      command: raw.command || '',
      metadata
    };
  }

  if (raw.type === 'key_sequence') {
    return {
      event_type: 'key_sequence',
      app,
      command: raw.text || '',
      metadata
    };
  }

  if (raw.type === 'key_press') {
    return {
      event_type: 'key_press',
      app,
      command: raw.key || '',
      metadata
    };
  }

  if (raw.type === 'mouse_click' || raw.type === 'mouse_drag') {
    return {
      event_type: raw.type,
      app,
      command: raw.type === 'mouse_click' ? (raw.button || 'left') : 'drag',
      metadata
    };
  }

  return null;
}

function handleRecorderLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const raw = JSON.parse(trimmed);
    const event = normalizeRecordedInput(raw);
    if (!event) return;
    emit(event);
    db.insertSemanticEvent({
      event_type: event.event_type,
      app: event.app,
      filepath: event.filepath,
      command: event.command,
      metadata: event.metadata
    });
  } catch (err) {
    console.error('[CognitiveOS] Recorder parse error:', err.message);
  }
}

function startInputRecording() {
  if (recordProcess) return;

  const inputToolPath = path.join(__dirname, 'input_tool.exe');
  if (!existsSync(inputToolPath)) {
    throw new Error('input_tool.exe is missing. Restart the server so it can compile input_tool.cs.');
  }

  recordBuffer = '';
  recordProcess = spawn(inputToolPath, ['--record'], { windowsHide: true });
  registerSpawnedPid(recordProcess.pid);

  recordProcess.stdout.on('data', (data) => {
    recordBuffer += data.toString();
    const lines = recordBuffer.split(/\r?\n/);
    recordBuffer = lines.pop() || '';
    for (const line of lines) handleRecorderLine(line);
  });

  recordProcess.stderr.on('data', (data) => {
    const text = data.toString().trim();
    if (text) console.log(`[CognitiveOS Recorder] ${text}`);
  });

  recordProcess.on('close', (code) => {
    if (recordBuffer.trim()) handleRecorderLine(recordBuffer);
    recordBuffer = '';
    recordProcess = null;
    if (activeRecording !== null) {
      console.warn(`[CognitiveOS Recorder] Stopped unexpectedly with code ${code}`);
      setRecordingMode(false);
      activeRecording = null;
      broadcastEvent('recording-stopped', { reason: 'recorder_exit', code });
    }
  });
}

function stopInputRecording() {
  if (!recordProcess) return;
  const proc = recordProcess;
  recordProcess = null;
  proc.kill();
}

function buildLinearGraph(steps, workflowId) {
  const graph = { nodes: {}, edges: [], rootNodeId: null };
  let prevNodeId = null;

  steps.forEach((step, i) => {
    const nodeId = 'node_' + i;
    if (i === 0) graph.rootNodeId = nodeId;
    graph.nodes[nodeId] = {
      id: nodeId,
      event_type: step.event_type,
      app: step.app,
      filepath: step.filepath,
      command: step.command,
      metadata: step.metadata,
      parentNodeId: prevNodeId,
      parentWorkflowId: workflowId,
      is_leaf: i === steps.length - 1,
      enabled: true
    };
    if (prevNodeId) graph.edges.push({ from: prevNodeId, to: nodeId });
    prevNodeId = nodeId;
  });

  return graph;
}

function isNoisyRecordedFocus(event) {
  const app = String(event?.app || '').toLowerCase();
  const rawProcess = String(event?.metadata?.raw_process || event?.metadata?.process || event?.metadata?.winProcess || '').toLowerCase();
  const noisyApps = new Set([
    'msedgewebview2',
    'applicationframehost',
    'textinputhost',
    'whatsapp.root',
    'electron',
    'dwm',
    'system'
  ]);

  return ['app_launched', 'context_changed', 'app_closed'].includes(event?.event_type)
    && (noisyApps.has(app) || noisyApps.has(rawProcess));
}

function isDuplicateClick(prev, event) {
  if (!prev || prev.event_type !== 'mouse_click' || event.event_type !== 'mouse_click') return false;
  if ((prev.metadata?.button || 'left') !== (event.metadata?.button || 'left')) return false;

  const prevX = Number(prev.metadata?.x);
  const prevY = Number(prev.metadata?.y);
  const x = Number(event.metadata?.x);
  const y = Number(event.metadata?.y);
  if (![prevX, prevY, x, y].every(Number.isFinite)) return false;

  const distance = Math.hypot(prevX - x, prevY - y);
  const prevTime = Number(prev.metadata?.timestamp || 0);
  const time = Number(event.metadata?.timestamp || 0);
  // Only discard true hardware debounce duplicates (< 50ms). Do not discard double-clicks!
  const closeInTime = prevTime && time && (time - prevTime) < 50;

  return distance <= 3 && closeInTime;
}

function isDuplicateFocus(prev, event) {
  if (!prev || prev.event_type !== event.event_type) return false;
  if (!['app_launched', 'context_changed'].includes(event.event_type)) return false;
  return prev.app === event.app && prev.command === event.command;
}

function cleanRecordedSequence(sequence) {
  const cleaned = [];

  for (const event of sequence) {
    if (!event || isNoisyRecordedFocus(event)) continue;

    const prev = cleaned[cleaned.length - 1];
    if (isDuplicateClick(prev, event) || isDuplicateFocus(prev, event)) {
      continue;
    }

    cleaned.push(event);
  }

  return cleaned;
}

function getInputToolArgs(step) {
  if (!step) return null;
  const meta = step.metadata || {};

  if (step.event_type === 'mouse_click') {
    const x = meta.x !== undefined ? Number(meta.x) : NaN;
    const y = meta.y !== undefined ? Number(meta.y) : NaN;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      console.warn('[CognitiveOS] Skipping mouse_click step with invalid coordinates:', step);
      return null;
    }
    return ['--click', String(Math.round(x)), String(Math.round(y)), meta.button || 'left'];
  }

  if (step.event_type === 'mouse_drag') {
    const x1 = Number(meta.startX);
    const y1 = Number(meta.startY);
    const x2 = Number(meta.endX);
    const y2 = Number(meta.endY);
    if (![x1, y1, x2, y2].every(Number.isFinite)) {
      console.warn('[CognitiveOS] Skipping mouse_drag step with invalid coordinates:', step);
      return null;
    }
    return [
      '--drag',
      String(Math.round(x1)),
      String(Math.round(y1)),
      String(Math.round(x2)),
      String(Math.round(y2))
    ];
  }

  if (step.event_type === 'key_sequence') {
    const text = meta.text || step.command || '';
    if (!text) return null;
    return ['--type', text];
  }

  if (step.event_type === 'key_press') {
    const key = meta.key || step.command || '';
    if (!key) return null;
    return ['--key', key, String(meta.repeat || 1)];
  }

  return null;
}

async function ensureWindowFocused(step) {
  if (!['mouse_click', 'mouse_drag', 'key_sequence', 'key_press'].includes(step?.event_type)) {
    return;
  }

  const meta = step.metadata || {};
  const targetTitle = meta.winTitle || meta.winProcess || step.app || '';
  const targetProc = meta.winProcess || step.app || '';
  const focusTarget = targetTitle || targetProc;
  if (!focusTarget) return;

  if (lastFocusedWindowTarget === focusTarget) {
    return;
  }

  const inputToolPath = path.join(__dirname, 'input_tool.exe');
  if (!existsSync(inputToolPath)) return;

  const winX = Number(meta.winX);
  const winY = Number(meta.winY);
  const winW = Number(meta.winW);
  const winH = Number(meta.winH);

  let focusArgs;
  if ([winX, winY, winW, winH].every(Number.isFinite) && winW > 50 && winH > 50) {
    focusArgs = ['--focus', focusTarget, String(Math.round(winX)), String(Math.round(winY)), String(Math.round(winW)), String(Math.round(winH))];
  } else {
    focusArgs = ['--focus', focusTarget];
  }

  console.log(`[CognitiveOS] Focusing window for input playback: ${focusTarget}`);
  await new Promise((resolve) => {
    const child = spawn(inputToolPath, focusArgs, { windowsHide: true });
    registerSpawnedPid(child.pid);
    child.on('close', resolve);
    child.on('error', resolve);
  });

  lastFocusedWindowTarget = focusTarget;
  await delayOrAbort(350);
}

function runInputToolStep(step) {
  const args = getInputToolArgs(step);
  if (!args) {
    console.log(`[CognitiveOS] Skipping input step (no valid arguments): ${step?.event_type}`);
    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
  }

  return new Promise((resolve) => {
    if (shouldAbortWorkflow) {
      resolve({ stdout: '', stderr: 'Workflow aborted before input event', code: 130 });
      return;
    }

    const inputToolPath = path.join(__dirname, 'input_tool.exe');
    if (!existsSync(inputToolPath)) {
      console.error(`[CognitiveOS] input_tool.exe is missing at: ${inputToolPath}`);
      resolve({ stdout: '', stderr: 'input_tool.exe is missing', code: 1 });
      return;
    }

    const child = spawn(inputToolPath, args, { windowsHide: true });
    currentWorkflowProcess = child;
    registerSpawnedPid(child.pid);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => { stdout += data.toString(); });
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.on('close', (code, signal) => {
      if (currentWorkflowProcess === child) currentWorkflowProcess = null;
      resolve({
        stdout,
        stderr: stderr || (signal ? `Process killed by ${signal}` : ''),
        code: shouldAbortWorkflow ? 130 : (code ?? 0)
      });
    });
    child.on('error', (err) => {
      if (currentWorkflowProcess === child) currentWorkflowProcess = null;
      console.error('[CognitiveOS] Input tool process error:', err.message);
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
}

function getDelayForStep(step, rawCommand = '') {
  if (['mouse_click', 'mouse_drag', 'key_press'].includes(step?.event_type)) {
    return 90;
  }
  if (step?.event_type === 'key_sequence') {
    const len = (step.metadata?.text || step.command || '').length;
    return Math.min(600, 80 + len * 12);
  }
  return getDelayForCommand(rawCommand);
}

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();
db.initDb();
const PORT = process.env.PORT || 5050;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// Server-Sent Events clients
let sseClients = [];

// Helper to broadcast SSE events
function broadcastEvent(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(payload));
}

// SSE Event Stream Endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  res.write('\n');
  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// GET Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// GET Status
app.get('/api/status', (req, res) => {
  const scanStatus = scanner.getScanStatus();
  const dbInstance = db.getDb();

  let totalApps = 0;
  let totalFiles = 0;
  let totalFolders = 0;

  try {
    const counts = dbInstance.prepare(`
      SELECT 
        SUM(CASE WHEN type = 'app' THEN 1 ELSE 0 END) as apps,
        SUM(CASE WHEN type = 'file' OR type = 'document' OR type = 'other' THEN 1 ELSE 0 END) as files,
        SUM(CASE WHEN type = 'folder' THEN 1 ELSE 0 END) as folders
      FROM indexed_items
    `).get();

    totalApps = counts.apps || 0;
    totalFiles = counts.files || 0;
    totalFolders = counts.folders || 0;
  } catch (err) {
    console.error('Error getting counts:', err);
  }

  res.json({
    ...scanStatus,
    stats: {
      apps: totalApps,
      files: totalFiles,
      folders: totalFolders,
      total: totalApps + totalFiles + totalFolders
    }
  });
});

// GET Storage Stats
app.get('/api/storage', (req, res) => {
  try {
    res.json(db.getStorageStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Run Full Scan
app.post('/api/scan/run', (req, res) => {
  if (scanner.getScanStatus().isScanning) {
    return res.status(400).json({ error: 'Scan is already running' });
  }

  // Run async
  scanner.runFullScan((progressMsg) => {
    broadcastEvent('scan-progress', { progress: progressMsg });
  }).then(() => {
    broadcastEvent('scan-complete', { message: 'Full scan completed successfully' });
  }).catch(err => {
    broadcastEvent('scan-error', { error: err.message });
  });

  res.json({ message: 'Scan started in background' });
});

// GET Search Items
app.get('/api/items', (req, res) => {
  const { search = '', type = 'all', limit = 100, offset = 0 } = req.query;
  try {
    let items;
    const parsedLimit = parseInt(limit);
    if (type === 'graph') {
      const graphLimit = req.query.limit ? parsedLimit : 10000;
      items = db.getAllItems(search, 'all', graphLimit, parseInt(offset));
      const dependencies = db.getAllDependencies();
      return res.json({ items, dependencies });
    } else {
      items = db.getAllItems(search, type, parsedLimit, parseInt(offset));
      return res.json({ items });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Database Table Data
app.get('/api/db/:table', (req, res) => {
  const { table } = req.params;
  const { search = '' } = req.query;

  const ALLOWED_TABLES = new Set([
    'indexed_items',
    'scanned_directories',
    'file_dependencies',
    'failure_history',
    'checkup_logs'
  ]);

  if (!ALLOWED_TABLES.has(table)) {
    return res.status(400).json({ error: `Invalid or restricted database table: ${table}` });
  }

  try {
    const dbInstance = db.getDb();
    let query = `SELECT * FROM ${table}`;
    const params = [];

    if (search) {
      if (table === 'indexed_items') {
        query += ' WHERE name LIKE ? OR path LIKE ? OR category LIKE ?';
        const w = `%${search}%`;
        params.push(w, w, w);
      } else if (table === 'scanned_directories') {
        query += ' WHERE path LIKE ? OR alias LIKE ?';
        const w = `%${search}%`;
        params.push(w, w);
      } else if (table === 'file_dependencies') {
        query += ' WHERE source_path LIKE ? OR target_path LIKE ?';
        const w = `%${search}%`;
        params.push(w, w);
      } else if (table === 'failure_history') {
        query += ' WHERE file_path LIKE ? OR failure_description LIKE ?';
        const w = `%${search}%`;
        params.push(w, w);
      } else if (table === 'checkup_logs') {
        query += ' WHERE message LIKE ? OR item_name LIKE ?';
        const w = `%${search}%`;
        params.push(w, w);
      }
    }

    const stmt = dbInstance.prepare(query);
    const rows = stmt.all(...params);
    res.json({ rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Directories Configuration
app.get('/api/dirs', (req, res) => {
  try {
    const dirs = db.getScannedDirectories();
    res.json({ directories: dirs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Add Directory
app.post('/api/dirs', async (req, res) => {
  const { path: dirPath, alias, depth = 1 } = req.body;
  if (!dirPath || !alias) {
    return res.status(400).json({ error: 'Path and Alias are required' });
  }

  // Validate path exists on disk
  if (!existsSync(dirPath)) {
    return res.status(400).json({ error: 'Directory path does not exist on this system' });
  }

  try {
    db.addScannedDirectory(dirPath, alias, parseInt(depth));
    db.addCheckupLog(`Added new directory path to scans: ${alias} (${dirPath})`, alias, 'info');

    // Dynamically start watching the new directory
    watcher.startWatching(dirPath);

    // Proactively scan this new directory
    broadcastEvent('directory-added', { path: dirPath, alias });
    res.json({ success: true, message: 'Directory added successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE Directory
app.delete('/api/dirs', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  try {
    db.deleteScannedDirectory(dirPath);
    db.addCheckupLog(`Removed directory path from scans: ${dirPath}`, 'System', 'info');

    // Dynamically stop watching the removed directory
    watcher.stopWatching(dirPath);

    res.json({ success: true, message: 'Directory removed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET Checkup Logs
app.get('/api/logs', (req, res) => {
  try {
    const logs = db.getCheckupLogs(50);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Control File/Application via PowerShell
app.post('/api/control', async (req, res) => {
  const { path: targetPath, action, value = '', cmdId = 'cmd_' + Date.now() } = req.body;

  if (!targetPath && action !== 'global_terminal') {
    return res.status(400).json({ error: 'Target path is required for this action' });
  }

  let targetDir = process.env.USERPROFILE;
  if (targetPath && !targetPath.toLowerCase().startsWith('shell:')) {
    targetDir = path.dirname(targetPath);
  }

  try {
    switch (action) {
      case 'open': {
        // Open file or start application
        db.addCheckupLog(`Executing launch command for: ${path.basename(targetPath)}`, targetPath, 'execute');
        const item = db.getItemByPath(targetPath);
        const argsParam = (item && item.arguments) ? `-ArgumentList '${item.arguments}'` : '';

        const isShellApp = targetPath.toLowerCase().startsWith('shell:');
        const workingDirParam = isShellApp ? '' : `-WorkingDirectory "${targetDir}"`;
        const script = `Start-Process -FilePath "${targetPath}" ${argsParam} ${workingDirParam}`;

        const result = await runCommand(script);
        emitInternalAction({ type: 'app_launched', app: path.basename(targetPath, path.extname(targetPath)), filepath: targetPath });
        return res.json(result);
      }

      case 'delete': {
        // ── COGNITIVE OS: CHECK BLAST RADIUS FIRST ──
        console.log(`[CognitiveOS DEBUG] Delete requested for: ${targetPath}`);
        let blast;
        try {
          blast = getBlastRadius(targetPath);
          console.log(`[CognitiveOS DEBUG] Blast radius result:`, JSON.stringify({
            direct: blast.direct_dependents.length,
            indirect: blast.indirect_dependents.length,
            risk_score: blast.risk_score,
            requires_confirmation: blast.requires_confirmation
          }));
        } catch (blastErr) {
          console.error(`[CognitiveOS DEBUG] getBlastRadius CRASHED:`, blastErr);
          blast = { requires_confirmation: false, direct_dependents: [], indirect_dependents: [], historical_failures: [] };
        }

        if (blast.requires_confirmation) {
          console.log(`[CognitiveOS DEBUG] Confirmation required — returning warning to frontend`);
          // Get LLM to narrate the risk in human language
          const warningMessage = await narrateBlastRadius(blast);
          const chain = getDependencyChain(targetPath);

          // Log that we warned the user
          db.addCheckupLog(
            `CognitiveOS warning shown for deletion of: ${path.basename(targetPath)} (risk: ${blast.risk_level})`,
            targetPath,
            'cognitive_warning'
          );

          // RETURN WARNING — do NOT execute delete yet
          return res.json({
            requires_confirmation: true,
            cognitive_warning: true,
            risk_level: blast.risk_level,
            risk_score: blast.risk_score,
            recommendation: blast.recommendation,
            warning_message: warningMessage,
            dependency_chain: chain,
            direct_dependents: blast.direct_dependents,
            indirect_dependents: blast.indirect_dependents,
            historical_failures: blast.historical_failures,
            path: targetPath
          });
        }

        console.log(`[CognitiveOS DEBUG] No confirmation needed — proceeding with delete`);
        // ── SAFE TO DELETE — PROCEED AS NORMAL ──
        db.addCheckupLog(`Deleting item: ${path.basename(targetPath)}`, targetPath, 'delete');

        // Ignore watcher deletion event
        watcher.ignoreDeletion(targetPath);

        const script = `Remove-Item -Path "${targetPath}" -Force -Recurse`;
        const result = await runCommand(script);

        if (result.code === 0) {
          db.deleteItemByPath(targetPath);
          broadcastEvent('item-deleted', { path: targetPath });
          // Log semantic event for behavioral memory
          observeAction({ event_type: 'file_deleted', filepath: targetPath });
        } else {
          // Record failure permanently
          recordFailure(targetPath, `Delete failed: ${result.stderr}`, 'powershell_error', false, false);
        }

        return res.json(result);
      }

      case 'rename': {
        // Rename item
        const newName = value.trim();
        if (!newName) return res.status(400).json({ error: 'New name is required' });

        db.addCheckupLog(`Renaming item ${path.basename(targetPath)} to ${newName}`, targetPath, 'rename');

        // Ignore watcher deletion event
        watcher.ignoreDeletion(targetPath);

        const script = `Rename-Item -Path "${targetPath}" -NewName "${newName}" -PassThru`;
        const result = await runCommand(script);

        if (result.code === 0) {
          emitInternalAction({ type: 'file_renamed', filepath: targetPath });
          // Resolve new path
          const newPath = path.join(targetDir, newName);
          const item = db.getItemByPath(targetPath);
          if (item) {
            item.name = newName;
            item.path = newPath;
            db.deleteItemByPath(targetPath);
            db.upsertItem(item);
            broadcastEvent('item-renamed', { oldPath: targetPath, newPath, name: newName });
          }
        }
        return res.json(result);
      }

      case 'properties': {
        // Get metadata using PowerShell
        const script = `
          $item = Get-Item -Path "${targetPath}" -ErrorAction Stop
          $owner = (Get-Acl $item.FullName).Owner
          $size = $item.Length
          if ($item.PSIsContainer) {
              $size = 0
          }
          [PSCustomObject]@{
              Name = $item.Name
              FullName = $item.FullName
              Size = $size
              CreationTime = $item.CreationTime.ToString("yyyy-MM-dd HH:mm:ss")
              LastWriteTime = $item.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
              Attributes = $item.Attributes.ToString()
              Owner = $owner
              IsDirectory = $item.PSIsContainer
          } | ConvertTo-Json
        `;
        const result = await runCommand(script);
        if (result.code === 0) {
          return res.json(JSON.parse(result.stdout));
        } else {
          return res.status(500).json({ error: result.stderr });
        }
      }

      case 'terminal':
      case 'global_terminal': {
        // Custom PowerShell CLI console execution with live SSE output streaming
        const customCmd = value.trim();
        if (!customCmd) return res.status(400).json({ error: 'Command string is empty' });

        // Navigate to working directory first
        const fullCommand = `Set-Location -Path '${targetDir}'; ${customCmd}`;
        db.addCheckupLog(`Running PowerShell command: "${customCmd}" in directory "${targetDir}"`, targetPath || 'Global', 'terminal');
        emitInternalAction({ type: 'terminal_command', command: customCmd, app: 'terminal' });

        // Spawn command asynchronously
        spawnCommand(fullCommand, {
          onStdout: (data) => {
            broadcastEvent('terminal-data', { cmdId, text: data, stream: 'stdout' });
          },
          onStderr: (data) => {
            broadcastEvent('terminal-data', { cmdId, text: data, stream: 'stderr' });
          },
          onClose: (code) => {
            broadcastEvent('terminal-exit', { cmdId, code });
          }
        });

        return res.json({ success: true, message: 'Command spawned', cmdId });
      }

      default:
        return res.status(400).json({ error: 'Unsupported action: ' + action });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Natural language command execution
app.post('/api/command/natural', async (req, res) => {
  const { command, dir = '' } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Command is required' });
  }

  try {
    emitInternalAction({ type: 'natural_command', command: command, app: 'pulse_portal' });
    const result = await parseAndExecute(command, dir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Resolve name to system path
app.post('/api/resolve', async (req, res) => {
  const { name, type = 'any' } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const item = await findBestMatch(name);
    if (!item) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (type !== 'any' && item.type !== type) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET System context summary for LLM prompt injection
app.get('/api/context', (req, res) => {
  try {
    const dbInstance = db.getDb();

    // Get app names (limit 200, sorted alphabetically)
    const appsStmt = dbInstance.prepare(
      "SELECT name FROM indexed_items WHERE type = 'app' ORDER BY name ASC LIMIT 200"
    );
    const apps = appsStmt.all().map(row => row.name);

    // Get indexed directories
    const dirs = db.getScannedDirectories();
    const indexedDirectories = dirs.map(d => ({ path: d.path, alias: d.alias }));

    // Get stats
    const countsStmt = dbInstance.prepare(`
      SELECT 
        SUM(CASE WHEN type = 'app' THEN 1 ELSE 0 END) as apps,
        SUM(CASE WHEN type = 'file' OR type = 'document' OR type = 'other' THEN 1 ELSE 0 END) as files,
        SUM(CASE WHEN type = 'folder' THEN 1 ELSE 0 END) as folders
      FROM indexed_items
    `);
    const counts = countsStmt.get();

    res.json({
      installedApps: apps,
      indexedDirectories,
      stats: {
        apps: counts.apps || 0,
        files: counts.files || 0,
        folders: counts.folders || 0
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST Batch execute multiple natural language commands
app.post('/api/batch', async (req, res) => {
  const { commands, dir = '' } = req.body;
  if (!commands || !Array.isArray(commands) || commands.length === 0) {
    return res.status(400).json({ error: 'Commands array is required' });
  }

  try {
    const results = [];
    for (const command of commands) {
      try {
        const result = await parseAndExecute(command, dir);
        results.push({ command, result });
      } catch (err) {
        results.push({ command, result: { success: false, error: err.message } });
      }
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dynamically discover custom folders on the system root drive (like Z, TOOL EXECUTOR, etc.)
async function discoverRootDirectories() {
  try {
    const systemDrive = process.env.SystemDrive || 'C:';
    const rootPath = systemDrive + path.sep; // resolves to C:\
    const entries = await fs.readdir(rootPath, { withFileTypes: true });

    // Standard system folders to ignore
    const systemFolderNames = new Set([
      'windows',
      'program files',
      'program files (x86)',
      'programdata',
      'system volume information',
      'recovery',
      'perflogs',
      'users',
      'inetpub',
      'onedrivetemp',
      'documents and settings'
    ]);

    for (const entry of entries) {
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(path.join(rootPath, entry.name));
          isDir = stat.isDirectory();
        } catch (e) { }
      }

      if (isDir) {
        const nameLower = entry.name.toLowerCase();
        // Ignore system folders and folders starting with '$' or '.'
        if (!systemFolderNames.has(nameLower) && !nameLower.startsWith('$') && !nameLower.startsWith('.')) {
          const fullPath = path.join(rootPath, entry.name);
          console.log(`Auto-discovered root folder: ${entry.name} (${fullPath})`);
          // Register with scan depth 2 (so we index the folder and its immediate children!)
          db.addScannedDirectory(fullPath, entry.name, 2);
        }
      }
    }
  } catch (err) {
    console.error('Error discovering root directories:', err);
  }
}

// ── COGNITIVE OS: CONFIRM DELETE AFTER WARNING ────────
app.post('/api/control/confirm-delete', async (req, res) => {
  const { path: targetPath } = req.body;
  if (!targetPath) return res.status(400).json({ error: 'Path required' });

  db.addCheckupLog(
    `Force delete confirmed by user: ${path.basename(targetPath)}`,
    targetPath,
    'force_delete'
  );

  // Ignore watcher deletion event
  watcher.ignoreDeletion(targetPath);

  const script = `Remove-Item -Path "${targetPath}" -Force -Recurse`;
  const result = await runCommand(script);

  if (result.code === 0) {
    db.deleteItemByPath(targetPath);
    broadcastEvent('item-deleted', { path: targetPath });
    observeAction({ event_type: 'file_deleted', filepath: targetPath, metadata: { forced: true } });
  } else {
    // Record failure — user proceeded despite warning
    recordFailure(targetPath, `Delete failed even after user confirmed: ${result.stderr}`, 'confirmed_delete', true, true);
  }

  return res.json(result);
});

// ── COGNITIVE OS: GET BLAST RADIUS FOR A FILE ─────────
app.get('/api/cognitive/blast-radius', async (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'Path required' });

  try {
    const blast = getBlastRadius(filePath);
    const chain = getDependencyChain(filePath);
    const warning = blast.requires_confirmation ? await narrateBlastRadius(blast) : null;

    res.json({ blast, chain, warning });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COGNITIVE OS: SCAN DEPENDENCIES FOR A FOLDER ──────
app.post('/api/cognitive/scan-dependencies', async (req, res) => {
  const { path: rootPath } = req.body;
  if (!rootPath) return res.status(400).json({ error: 'Path required' });

  try {
    const result = await scanProjectDependencies(rootPath);
    broadcastEvent('dependency-scan-complete', { path: rootPath, result });
    res.json({ success: true, files_scanned: result.stats.scanned });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COGNITIVE OS: WORKFLOW SUGGESTIONS ────────────────
app.get('/api/cognitive/suggestions', async (req, res) => {
  try {
    const workflows = getAllLearnedWorkflows().filter(w => w.is_suggestible);
    const suggestions = await Promise.all(
      workflows.map(async wf => {
        const bestPlan = wf.active_plan;
        const message = await narrateWorkflowSuggestion(
          { name: wf.name, times_observed: wf.times_observed, confidence: wf.confidence },
          { steps: bestPlan?.steps || [] }
        );
        return {
          workflow_id: wf.id,
          name: wf.name,
          confidence: wf.confidence,
          times_observed: wf.times_observed,
          suggested_plan: bestPlan,
          message
        };
      })
    );
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function translateStepToCommand(step) {
  // ── TERMINAL COMMANDS ──────────────────────────────
  if (step.event_type === 'terminal_command' && step.command) {
    const cmd = step.command.trim();
    if (cmd.startsWith('shell:')) {
      return `Start-Process "${cmd}"`;
    }
    return cmd;
  }

  // ── APP LAUNCHES ───────────────────────────────────
  if (step.event_type === 'app_launched') {
    if (step.command) {
      const cmd = step.command.trim();
      if (cmd.startsWith('shell:')) {
        return `Start-Process "${cmd}"`;
      }
      return `Start-Process "${cmd}"`;
    }
    if (step.app) {
      const app = step.app.trim().toLowerCase();
      const rawProcess = step.metadata?.raw_process || '';
      const skipApps = new Set(['textinputhost', 'applicationframehost', 'msedgewebview2', 'electron', 'dwm', 'explorer', 'system']);
      if (skipApps.has(app) || skipApps.has(rawProcess)) return null;
      const uwpMap = {
        'whatsapp': 'shell:AppsFolder\\5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App',
        'spotify': 'shell:AppsFolder\\SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
        'calculator': 'calc', 'notepad': 'notepad', 'paint': 'mspaint',
        'settings': 'ms-settings:', 'camera': 'microsoft.windows.camera:',
        'windowscamera': 'microsoft.windows.camera:', 'photos': 'ms-photos:',
        'store': 'ms-windows-store:', 'terminal': 'wt',
      };
      if (uwpMap[app]) return `Start-Process "${uwpMap[app]}"`;
      const launchName = rawProcess || app;
      return `Start-Process "${launchName}" -ErrorAction SilentlyContinue`;
    }
    return null;
  }

  // ── CONTEXT CHANGES (web navigation) ───────────────
  if (step.event_type === 'context_changed' && step.command) {
    const rawTitle = (step.metadata?.raw_title || '').toLowerCase();
    const topic = step.command.trim().replace(/^\\([^)]+\\)\\s*/, '');
    if (rawTitle.includes('youtube')) {
      if (topic && topic.toLowerCase() !== 'youtube') {
        const query = encodeURIComponent(topic);
        return `start "" "https://www.youtube.com/results?search_query=${query}"`;
      } else { return 'start "" "https://www.youtube.com"'; }
    }
    if (rawTitle.includes('chatgpt')) return 'start "" "https://chatgpt.com"';
    if (rawTitle.includes('gemini')) return 'start "" "https://gemini.google.com"';
    if (rawTitle.includes('claude')) return 'start "" "https://claude.ai"';
    if (rawTitle.includes('copilot')) return 'start "" "https://copilot.microsoft.com"';
    if (rawTitle.includes('github')) return 'start "" "https://github.com"';
    if (rawTitle.includes('stackoverflow')) return 'start "" "https://stackoverflow.com"';
    if (rawTitle.includes('google search') || rawTitle.includes('google.com') || (rawTitle.includes('google') && !rawTitle.includes('gmail'))) {
      if (topic && topic.toLowerCase() !== 'google') {
        const query = encodeURIComponent(topic);
        return `start "" "https://www.google.com/search?q=${query}"`;
      } else { return 'start "" "https://www.google.com"'; }
    }
  }

  // ── INPUT TOOL EVENTS ──────────────────────────────
  const inputToolPath = path.join(__dirname, 'input_tool.exe');
  if (step.event_type === 'mouse_click' && step.metadata) {
    return `& "${inputToolPath}" --click ${step.metadata.x} ${step.metadata.y} ${step.metadata.button || 'left'}`;
  }
  if (step.event_type === 'mouse_drag' && step.metadata) {
    return `& "${inputToolPath}" --drag ${step.metadata.startX} ${step.metadata.startY} ${step.metadata.endX} ${step.metadata.endY}`;
  }
  if (step.event_type === 'key_sequence' && step.metadata) {
    const escapedText = psDoubleQuote(step.metadata.text || step.command || '');
    return `& "${inputToolPath}" --type "${escapedText}"`;
  }
  if (step.event_type === 'key_press' && step.metadata) {
    const repeat = step.metadata.repeat || 1;
    const key = psDoubleQuote(step.metadata.key || step.command || '');
    return `& "${inputToolPath}" --key "${key}" ${repeat}`;
  }

  // ── SKIP: app_closed, file_accessed, etc. ──────────
  return null;
}

function getDelayForCommand(cmd) {
  const cmdLower = cmd.toLowerCase();
  if (cmdLower.includes('start-process') || cmdLower.includes('start "" ')) {
    return 4000;
  }
  if (cmdLower.includes('--type')) {
    return 1800;
  }
  if (cmdLower.includes('--key lwin') || cmdLower.includes('--key win')) {
    return 1000;
  }
  if (cmdLower.includes('--key enter')) {
    return 1500;
  }
  return 500;
}

app.post('/api/cognitive/workflow/abort', (req, res) => {
  if (isWorkflowRunning) {
    requestWorkflowAbort();
    console.log('[CognitiveOS] User requested abort of active workflow run');
    return res.json({ success: true, message: 'Abort request received' });
  }
  if (activeExecutionSession) {
    clearExecutionSession();
    activeExecutionSession = null;
    shouldAbortWorkflow = false;
    broadcastEvent('workflow-stopped', { reason: 'session_aborted' });
    return res.json({ success: true, message: 'Paused workflow session cleared' });
  }
  res.json({ success: true, message: 'No workflow is currently running' });
});

// ── V3 EXECUTION SESSION ──────────────────────────────
const EXEC_SESSION_FILE = path.join(__dirname, '.execution_session.json');

function saveExecutionSession(session) {
  writeFileSync(EXEC_SESSION_FILE, JSON.stringify(session, null, 2));
}

function loadExecutionSession() {
  if (existsSync(EXEC_SESSION_FILE)) {
    try {
      return JSON.parse(readFileSync(EXEC_SESSION_FILE, 'utf8'));
    } catch (e) {}
  }
  return null;
}

function clearExecutionSession() {
  if (existsSync(EXEC_SESSION_FILE)) unlinkSync(EXEC_SESSION_FILE);
}

let activeExecutionSession = loadExecutionSession();

async function runWorkflowAsync(workflow_id, matched_steps = 0) {
  if (isWorkflowRunning) {
    console.log('[CognitiveOS] A workflow is already running. Ignoring play request.');
    return false;
  }

  isWorkflowRunning = true;
  shouldAbortWorkflow = false;
  lastFocusedWindowTarget = null;
  broadcastEvent('workflow-started', { workflow_id });

  try {
    const workflows = getAllLearnedWorkflows();
    const wf = workflows.find(w => w.id === workflow_id);
    if (!wf || !wf.plans || wf.plans.length === 0) {
      console.error('[CognitiveOS] Workflow or plans not found.');
      isWorkflowRunning = false;
      return false;
    }

    const plan = wf.active_plan || wf.plans[0];
    const graph = plan.graph;
    
    // Fallback for V2 (legacy linear plans) if graph isn't populated
    if (!graph || !graph.nodes) {
       console.log('[CognitiveOS] Falling back to V2 linear execution');
       for (const step of plan.steps) {
         if (shouldAbortWorkflow) break;
         await ensureWindowFocused(step);
         const rawCommand = translateStepToCommand(step);
         if (step.event_type === 'natural_command') {
           console.log(`[CognitiveOS] Executing natural command: ${step.command}`);
           try { await parseAndExecute(step.command); } catch(e) { console.error(e); }
         } else if (getInputToolArgs(step)) {
           console.log(`[CognitiveOS] Executing input event: ${step.event_type}`);
           await runInputToolStep(step);
           if (await delayOrAbort(getDelayForStep(step))) break;
         } else if (rawCommand) {
           console.log(`[CognitiveOS] Executing raw command: ${rawCommand}`);
           await runWorkflowCommand(rawCommand);
           if (await delayOrAbort(getDelayForStep(step, rawCommand))) break;
         } else {
           console.log(`[CognitiveOS] Skipping non-executable step: ${step.event_type} (${step.app || step.command || ''})`);
         }
       }
       if (shouldAbortWorkflow) {
         console.log('[CognitiveOS] Workflow aborted by user.');
       } else {
         console.log('[CognitiveOS] V2 linear workflow execution completed successfully.');
       }
       if (shouldAbortWorkflow) {
         clearExecutionSession();
         activeExecutionSession = null;
       }
       isWorkflowRunning = false;
       shouldAbortWorkflow = false;
       lastFocusedWindowTarget = null;
       broadcastEvent('workflow-stopped', { workflow_id });
       return true;
    }

    // Initialize or resume ExecutionSession
    if (!activeExecutionSession || activeExecutionSession.workflowId !== workflow_id) {
      let startNodeId = graph.rootNodeId;
      // Skip matched_steps nodes
      let curr = startNodeId;
      for (let i = 0; i < matched_steps; i++) {
         const edge = graph.edges.find(e => e.from === curr);
         if (edge) curr = edge.to;
      }
      
      activeExecutionSession = {
        workflowId: workflow_id,
        graph: graph,
        currentNodeId: curr,
        branchStack: [],
        paused: false
      };
      saveExecutionSession(activeExecutionSession);
    }
    
    // Execution Loop over V3 Graph
    let currentNodeId = activeExecutionSession.currentNodeId;
    
    while (currentNodeId) {
      if (shouldAbortWorkflow) {
        console.log('[CognitiveOS] Workflow aborted by user.');
        break;
      }

      if (activeExecutionSession.paused) {
        console.log('[CognitiveOS] Execution paused at branch.');
        isWorkflowRunning = false;
        return true; // Wait for resume
      }

      const node = graph.nodes[currentNodeId];
      if (!node.enabled) {
        console.log(`[CognitiveOS] Skipping disabled node: ${currentNodeId}`);
      } else {
        await ensureWindowFocused(node);
        // Run natural command or terminal command
        const rawCommand = translateStepToCommand(node);
        if (node.event_type === 'natural_command') {
          console.log(`[CognitiveOS] Executing natural command: ${node.command}`);
          try {
            await parseAndExecute(node.command);
          } catch(e) { console.error(e); }
        } else if (getInputToolArgs(node)) {
          console.log(`[CognitiveOS] Executing input event: ${node.event_type}`);
          await runInputToolStep(node);
          if (await delayOrAbort(getDelayForStep(node))) break;
        } else if (rawCommand) {
          console.log(`[CognitiveOS] Executing raw command: ${rawCommand}`);
          await runWorkflowCommand(rawCommand);
          if (await delayOrAbort(getDelayForStep(node, rawCommand))) break;
        } else {
          console.log(`[CognitiveOS] Skipping non-executable step: ${node.event_type} (${node.app || node.command || ''})`);
        }
      }

      // Progress graph
      const outgoingEdges = graph.edges.filter(e => e.from === currentNodeId);
      
      if (outgoingEdges.length === 0) {
        // Leaf node reached
        currentNodeId = null;
      } else if (outgoingEdges.length === 1) {
        currentNodeId = outgoingEdges[0].to;
      } else {
        // Branch point
        console.log(`[CognitiveOS] Branch point reached at node ${currentNodeId}. Pausing session.`);
        activeExecutionSession.paused = true;
        activeExecutionSession.branchStack.push(currentNodeId);
        // Do not update currentNodeId yet, wait for user selection via API
      }

      activeExecutionSession.currentNodeId = currentNodeId;
      saveExecutionSession(activeExecutionSession);
    }

    if (!shouldAbortWorkflow && !activeExecutionSession.paused) {
       console.log(`[CognitiveOS] Workflow ${workflow_id} execution completed successfully.`);
       
       // Update metadata
       wf.execution_count = (wf.execution_count || 0) + 1;
       wf.last_executed = Date.now();
       db.upsertWorkflow(wf);
       
       clearExecutionSession();
       activeExecutionSession = null;
    }

  } catch (err) {
    console.error('[CognitiveOS] Error during workflow run:', err);
  } finally {
    lastFocusedWindowTarget = null;
    if (shouldAbortWorkflow) {
      clearExecutionSession();
      activeExecutionSession = null;
    }
    if (!activeExecutionSession || !activeExecutionSession.paused) {
      isWorkflowRunning = false;
      shouldAbortWorkflow = false;
      currentWorkflowProcess = null;
      broadcastEvent('workflow-stopped', { workflow_id });
    }
  }
}

app.post('/api/workflow/resume', (req, res) => {
  const { branchEdgeToId } = req.body;
  if (!activeExecutionSession || !activeExecutionSession.paused) {
    return res.status(400).json({ error: 'No paused session to resume.' });
  }
  
  if (branchEdgeToId) {
    activeExecutionSession.currentNodeId = branchEdgeToId;
  }
  
  activeExecutionSession.paused = false;
  saveExecutionSession(activeExecutionSession);
  
  // Fire off async resume
  runWorkflowAsync(activeExecutionSession.workflowId, 0).catch(console.error);
  
  res.json({ success: true, message: 'Execution resumed.' });
});

app.post('/api/workflow/reactivate-ghost', (req, res) => {
  const { workflowId } = req.body;
  if (!workflowId) return res.status(400).json({ error: 'workflowId required' });

  handleGhostReactivation(workflowId);
  res.json({ success: true, message: 'Ghost reactivated. Re-learning in progress.' });
});


app.get('/api/cognitive/workflows', (req, res) => {
  res.json({ workflows: getAllLearnedWorkflows() });
});

app.post('/api/cognitive/workflow-rename', (req, res) => {
  const id = req.body.workflow_id || req.body.id;
  const name = req.body.name;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  try {
    seRename(id, name);
    broadcastEvent('workflows-changed', { action: 'renamed', workflow_id: id, name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cognitive/workflow-delete', (req, res) => {
  const id = req.body.workflow_id || req.body.id;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    seDelete(id);
    if (activeExecutionSession && activeExecutionSession.workflowId === id) {
      clearExecutionSession();
      activeExecutionSession = null;
    }
    broadcastEvent('workflows-changed', { action: 'deleted', workflow_id: id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cognitive/workflow-pin', (req, res) => {
  const id = req.body.workflow_id || req.body.id;
  const { pinned } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });
  try {
    db.setWorkflowPinned(id, pinned);
    broadcastEvent('workflows-changed', { action: 'pinned', workflow_id: id, pinned });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cognitive/recording/start', (req, res) => {
  try {
    if (activeRecording !== null) {
      return res.json({ success: true, alreadyRecording: true });
    }
    activeRecording = [];
    setRecordingMode(true);
    startInputRecording();
    res.json({ success: true });
  } catch (err) {
    activeRecording = null;
    setRecordingMode(false);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cognitive/recording/status', (req, res) => {
  res.json({
    isRecording: activeRecording !== null,
    eventCount: activeRecording ? activeRecording.length : 0
  });
});

app.post('/api/cognitive/recording/cancel', (req, res) => {
  setRecordingMode(false);
  activeRecording = null;
  stopInputRecording();
  res.json({ success: true });
});

app.post('/api/cognitive/recording/stop', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Workflow name required' });
  
  setRecordingMode(false);
  const rawSequence = activeRecording || [];
  const sequence = cleanRecordedSequence(rawSequence);
  activeRecording = null;
  stopInputRecording();

  if (sequence.length === 0) {
    return res.status(400).json({ error: 'No actions captured in recording.' });
  }

  const workflowId = randomUUID();
  const steps = sequence.map(s => ({
    event_type: s.event_type,
    app: s.app,
    filepath: s.filepath,
    command: s.command,
    metadata: s.metadata
  }));
  const plan = {
    label: 'A',
    confidence: 1.0,
    steps,
    graph: buildLinearGraph(steps, workflowId),
    times_used: 0,
    is_active: true,
    created_reason: 'manual_recording',
    created_at: Date.now()
  };

  const workflow = {
    id: workflowId,
    name: name,
    trigger_signature: sequence[0]?.event_type + ':' + (sequence[0]?.app || sequence[0]?.command || ''),
    steps,
    plans: [plan],
    times_observed: 1,
    times_confirmed: 1,
    times_rejected: 0,
    confidence: 1.0,
    version: 3
  };

  try {
    db.upsertWorkflow(workflow);
    broadcastEvent('workflows-changed', { action: 'discovered', workflow });
    res.json({
      success: true,
      workflow_id: workflowId,
      raw_step_count: rawSequence.length,
      saved_step_count: steps.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


app.get('/api/cognitive/avatar/status', (req, res) => {
  res.json({ disabled: isAvatarDisabled });
});

app.post('/api/cognitive/avatar/toggle', (req, res) => {
  const { disabled } = req.body;
  isAvatarDisabled = !!disabled;
  broadcastEvent('avatar-toggle', { disabled: isAvatarDisabled });
  res.json({ disabled: isAvatarDisabled });
});

app.post('/api/cognitive/workflow-response', (req, res) => {
  const { workflow_id, response } = req.body;
  if (!workflow_id) return res.status(400).json({ error: 'workflow_id is required' });
  
  if (response === 'yes') {
    console.log(`[CognitiveOS] User confirmed execution for workflow: ${workflow_id}`);
    runWorkflowAsync(workflow_id).catch(err => {
      console.error('[CognitiveOS] Error running workflow:', err);
    });
    res.json({ success: true, message: 'Workflow started! 🚀' });
  } else {
    console.log(`[CognitiveOS] User rejected execution for workflow: ${workflow_id}`);
    handleRejection(workflow_id);
    res.json({ success: true, message: 'Workflow execution cancelled.' });
  }
});



app.get('/api/cognitive/schedules', (req, res) => {
  try {
    res.json({ schedules: db.getAllSchedules() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COGNITIVE OS: SCHEDULE ENGINE ─────────────────────
const activeTriggerPrompts = new Map(); // scheduleId -> timeoutId

function isScheduleDue(sched, now) {
  const freq = (sched.frequency || 'once').toLowerCase();

  const isTriggeredToday = () => {
    if (!sched.last_triggered_at) return false;
    const last = new Date(sched.last_triggered_at);
    if (isNaN(last.getTime())) return false;
    return (
      last.getFullYear() === now.getFullYear() &&
      last.getMonth() === now.getMonth() &&
      last.getDate() === now.getDate()
    );
  };

  if (freq === 'once') {
    const target = new Date(sched.scheduled_time);
    if (isNaN(target.getTime())) return false;
    return now.getTime() >= target.getTime();
  }

  if (freq === 'daily' || freq === 'weekly') {
    if (freq === 'weekly') {
      const todayDay = now.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
      const allowedDays = (sched.days_of_week || '')
        .split(',')
        .map(d => parseInt(d.trim(), 10))
        .filter(d => !isNaN(d));

      if (allowedDays.length > 0 && !allowedDays.includes(todayDay)) {
        return false;
      }
    }

    if (isTriggeredToday()) {
      return false;
    }

    let targetHour = 0;
    let targetMinute = 0;

    if (typeof sched.scheduled_time === 'string' && sched.scheduled_time.includes(':')) {
      const parts = sched.scheduled_time.split(':');
      if (parts[0].includes('T')) {
        const timePart = parts[0].split('T')[1];
        targetHour = parseInt(timePart, 10);
        targetMinute = parseInt(parts[1], 10);
      } else {
        targetHour = parseInt(parts[0], 10);
        targetMinute = parseInt(parts[1], 10);
      }
    } else {
      return false;
    }

    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    const currentMins = currentHour * 60 + currentMinute;
    const targetMins = targetHour * 60 + targetMinute;

    // If created today and target time had already passed prior to creation, don't trigger retroactively
    if (sched.created_at) {
      const created = new Date(sched.created_at);
      if (
        !isNaN(created.getTime()) &&
        created.getFullYear() === now.getFullYear() &&
        created.getMonth() === now.getMonth() &&
        created.getDate() === now.getDate()
      ) {
        const createdMins = created.getHours() * 60 + created.getMinutes();
        if (targetMins < createdMins) {
          return false;
        }
      }
    }

    return currentMins >= targetMins && (currentMins - targetMins) <= 60;
  }

  return false;
}

async function checkScheduledWorkflows() {
  try {
    const pending = db.getPendingSchedules();
    if (!pending || pending.length === 0) return;

    const now = new Date();

    for (const sched of pending) {
      if (activeTriggerPrompts.has(sched.id)) continue;

      if (isScheduleDue(sched, now)) {
        console.log(`[CognitiveOS Scheduler] Schedule ${sched.id} ("${sched.workflow_name}") is DUE! Triggering...`);

        // Record trigger time immediately to prevent multiple triggers in this cycle
        db.updateScheduleTriggerTime(sched.id, now.toISOString());

        // Notify UI and Freddy
        broadcastEvent('scheduled-trigger', {
          schedule_id: sched.id,
          workflow_id: sched.workflow_id,
          workflow_name: sched.workflow_name,
          frequency: sched.frequency
        });

        // Automatically execute if no user interaction occurs within 15 seconds
        const autoRunTimer = setTimeout(async () => {
          activeTriggerPrompts.delete(sched.id);
          console.log(`[CognitiveOS Scheduler] Auto-running scheduled workflow: "${sched.workflow_name}"`);

          if (sched.frequency === 'once') {
            db.updateScheduleStatus(sched.id, 'executed');
            broadcastEvent('workflows-changed', { action: 'schedule-updated' });
          }

          try {
            await runWorkflowAsync(sched.workflow_id);
          } catch (err) {
            console.error('[CognitiveOS Scheduler] Error running scheduled workflow:', err);
          }
        }, 15000);

        activeTriggerPrompts.set(sched.id, autoRunTimer);
      }
    }
  } catch (err) {
    console.error('[CognitiveOS Scheduler] Error checking schedules:', err);
  }
}

app.post('/api/cognitive/schedule', (req, res) => {
  const { workflow_id, scheduled_time, frequency = 'once', days_of_week = null } = req.body;
  if (!workflow_id || !scheduled_time) {
    return res.status(400).json({ error: 'workflow_id and scheduled_time are required' });
  }
  try {
    const id = randomUUID();
    db.addWorkflowSchedule(id, workflow_id, scheduled_time, frequency, days_of_week);
    broadcastEvent('workflows-changed', { action: 'schedule-added' });
    setTimeout(checkScheduledWorkflows, 100);
    res.json({ success: true, scheduleId: id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cognitive/schedule/delete', (req, res) => {
  const schedule_id = req.body.schedule_id || req.body.id;
  if (!schedule_id) {
    return res.status(400).json({ error: 'schedule_id is required' });
  }
  if (activeTriggerPrompts.has(schedule_id)) {
    clearTimeout(activeTriggerPrompts.get(schedule_id));
    activeTriggerPrompts.delete(schedule_id);
  }
  try {
    db.deleteSchedule(schedule_id);
    broadcastEvent('workflows-changed', { action: 'schedule-deleted' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cognitive/schedule/response', (req, res) => {
  const { schedule_id, response } = req.body;
  if (!schedule_id || !response) {
    return res.status(400).json({ error: 'schedule_id and response are required' });
  }

  // Cancel any pending auto-run timer
  if (activeTriggerPrompts.has(schedule_id)) {
    clearTimeout(activeTriggerPrompts.get(schedule_id));
    activeTriggerPrompts.delete(schedule_id);
  }

  try {
    const schedules = db.getAllSchedules();
    const sched = schedules.find(s => s.id === schedule_id);
    if (sched) {
      if (response === 'yes') {
        console.log(`[CognitiveOS] User confirmed execution for scheduled workflow: ${sched.workflow_id}`);
        runWorkflowAsync(sched.workflow_id).catch(err => {
          console.error('[CognitiveOS] Error running scheduled workflow:', err);
        });
      } else {
        console.log(`[CognitiveOS] User skipped execution for scheduled workflow: ${sched.workflow_id}`);
      }

      if (sched.frequency === 'once') {
        db.updateScheduleStatus(schedule_id, response === 'yes' ? 'executed' : 'ignored');
        broadcastEvent('workflows-changed', { action: 'schedule-updated' });
      } else {
        db.updateScheduleTriggerTime(schedule_id, new Date().toISOString());
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`System Control Portal running on http://localhost:${PORT}`);

  // Compile keyboard/mouse recorder
  await compileInputTool();

  // Make sure database is initialised
  db.getDb();

  // Restore correct confidence values for workflows

  // Run root folder auto-discovery first
  await discoverRootDirectories();

  // Initialize filesystem watchers
  watcher.initWatchers(broadcastEvent);

  // CognitiveOS: Scan dependencies for all registered directories
  const registeredDirs = db.getScannedDirectories();
  for (const dir of registeredDirs) {
    scanProjectDependencies(dir.path)
      .then(result => {
        if (!result.cancelled) {
          broadcastEvent('dependency-scan-complete', { path: dir.path, result });
        }
      })
      .catch(err =>
        console.error(`[CognitiveOS] Dependency scan error for ${dir.alias}:`, err.message)
      );
  }
  console.log('[CognitiveOS] Dependency graph scan started in background...');

  // ── START BEHAVIORAL LEARNING LAYER ──────────────────
  initSequenceEngine(
    async (suggestion) => {
      // Called when engine detects a known workflow starting
      // Narrate it and push to all connected browser clients via SSE
      const message = await narrateWorkflowSuggestion(
        { name: suggestion.workflow_name, times_observed: suggestion.times_observed, confidence: suggestion.confidence },
        { steps: suggestion.steps }
      );
      broadcastEvent('cognitive-suggestion', { ...suggestion, message });
      console.log(`[SequenceEngine] Suggestion pushed to UI: "${suggestion.workflow_name}"`);
    },
    (update) => {
      // Broadcast SSE update event when a workflow is reinforced or discovered
      broadcastEvent('workflows-changed', update);
    }
  );

  // Every OS event from observer feeds into the sequence engine
  onSemanticEvent((event) => {
    if (activeRecording) {
      const recordableTypes = [
        'terminal_command', 'natural_command', 'app_launched', 'file_accessed',
        'file_deleted', 'file_renamed', 'context_changed',
        'mouse_click', 'mouse_drag', 'key_sequence', 'key_press'
      ];
      if (recordableTypes.includes(event.event_type)) {
        // Filter out background history/WMI command polling to prevent sequence contamination
        const source = event.metadata?.source;
        if (source === 'ps_history' || source === 'cmd_history' || source === 'wmi_powershell' || source === 'wmi_cmd') {
          // Skip background polling events
        } else {
          activeRecording.push({
            event_type: event.event_type,
            app: event.app || null,
            filepath: event.filepath || null,
            command: event.command || null,
            metadata: event.metadata || null
          });
        }
      }
    }
    ingestEvent(event);
  });

  // Start polling the OS every 5 seconds
  startObserver();
  console.log('[CognitiveOS] Behavioral learning layer active');

  // Initial background scan on server startup so the DB isn't empty
  console.log('Starting initial system scan in the background...');
  scanner.runFullScan().then(() => {
    console.log('Initial scan complete.');
  }).catch(err => {
    console.error('Initial scan error:', err);
  });

  // Setup periodic background checkup (polls registry and shortcuts for installations/uninstalls)
  // Set interval to every 60 seconds for active updates in this demo!
  setInterval(async () => {
    await scanner.runBackgroundCheckup((action, app) => {
      broadcastEvent('checkup-alert', { action, app });
    });
  }, 60000);

  runGhostJob();
  setInterval(() => {
    runGhostJob();
  }, 24 * 60 * 60 * 1000);

  // Clean up obsolete/unwanted legacy files
  const obsoleteFiles = ['system_portal.db', 'system_portal.db-journal', 'system_portal.db-wal', 'system_portal.db-shm', 'system_test_v3.db'];
  for (const f of obsoleteFiles) {
    const fp = path.join(__dirname, f);
    if (existsSync(fp)) {
      try { unlinkSync(fp); console.log(`[CognitiveOS] Cleaned up legacy file: ${f}`); } catch {}
    }
  }

  // Background scheduler checking for pending schedules every 10 seconds
  console.log('[CognitiveOS] Starting schedule background runner...');
  checkScheduledWorkflows();
  setInterval(checkScheduledWorkflows, 10000);

  // Spawning Electron desktop overlay on port bind
  console.log('[CognitiveOS] Spawning Electron desktop overlay...');
  const electronBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const electronProc = spawn(electronBin, ['electron', 'electron_app.js'], {
    detached: true,
    stdio: 'ignore',
    shell: true
  });
  electronProc.unref();
});



const execPromise = util.promisify(exec);

async function compileInputTool() {
  const csPath = path.join(__dirname, 'input_tool.cs');
  const exePath = path.join(__dirname, 'input_tool.exe');

  if (!existsSync(csPath)) {
    return;
  }

  // Check if executable exists and is up to date with input_tool.cs
  if (existsSync(exePath)) {
    try {
      const csStat = statSync(csPath);
      const exeStat = statSync(exePath);
      if (exeStat.mtime >= csStat.mtime) {
        return;
      }
      console.log('[CognitiveOS] input_tool.cs has been updated. Recompiling input_tool.exe...');
    } catch {
      // If stat check fails, proceed to compile
    }
  } else {
    console.log('[CognitiveOS] Compiling input_tool.cs...');
  }

  try {
    const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (existsSync(cscPath)) {
      const refs = [
        'System.dll',
        'System.Windows.Forms.dll',
        'WindowsBase.dll',
        'UIAutomationClient.dll',
        'UIAutomationTypes.dll'
      ].map(r => `/r:"${r}"`).join(' ');

      await execPromise(`"${cscPath}" /nologo ${refs} /out:"${exePath}" "${csPath}"`);
      console.log('[CognitiveOS] input_tool.exe compiled successfully.');
    } else {
      console.warn('csc.exe not found. input_tool.cs will not be compiled automatically.');
    }
  } catch (err) {
    console.error('Failed to compile input_tool.cs:', err.message);
  }
}
