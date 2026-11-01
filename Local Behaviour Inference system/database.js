import { DatabaseSync } from 'node:sqlite';
import path from 'path';

let dbInstance = null;

export function getDb() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(process.env.NODE_ENV === 'test' ? 'system_test_v3.db' : 'system_portal_v3.db');
  }
  return dbInstance;
}

export function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      app TEXT,
      filepath TEXT,
      command TEXT,
      metadata TEXT,
      occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS indexed_items (
      path TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT,
      description TEXT,
      arguments TEXT,
      install_date TIMESTAMP,
      last_scanned TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS scanned_directories (
      path TEXT PRIMARY KEY,
      alias TEXT,
      depth INTEGER DEFAULT 2
    );

    CREATE TABLE IF NOT EXISTS checkup_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT,
      file_path TEXT,
      log_message TEXT,
      occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS failure_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT,
      file_path TEXT,
      failure_description TEXT,
      caused_by TEXT,
      user_was_warned INTEGER DEFAULT 0,
      user_proceeded INTEGER DEFAULT 0,
      occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS file_dependencies (
      file_path TEXT,
      depends_on TEXT,
      FOREIGN KEY(file_path) REFERENCES indexed_items(path) ON DELETE CASCADE,
      FOREIGN KEY(depends_on) REFERENCES indexed_items(path) ON DELETE CASCADE,
      PRIMARY KEY(file_path, depends_on)
    );

    CREATE TABLE IF NOT EXISTS workflow_patterns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_signature TEXT,
      steps TEXT,
      plans TEXT,
      times_observed INTEGER DEFAULT 0,
      times_confirmed INTEGER DEFAULT 0,
      times_rejected INTEGER DEFAULT 0,
      confidence REAL DEFAULT 0,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS token_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      address TEXT NOT NULL,
      frequency INTEGER DEFAULT 1,
      first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS prefix_index (
      prefix TEXT NOT NULL,
      workflow_id TEXT NOT NULL,
      FOREIGN KEY(workflow_id) REFERENCES workflow_patterns(id) ON DELETE CASCADE,
      PRIMARY KEY(prefix, workflow_id)
    );

    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_workflows (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      scheduled_time TIMESTAMP NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(workflow_id) REFERENCES workflow_patterns(id) ON DELETE CASCADE
    );
  `);

  const migrations = [
    "ALTER TABLE workflow_patterns ADD COLUMN status TEXT DEFAULT 'active'",
    "ALTER TABLE workflow_patterns ADD COLUMN ghosted_at TIMESTAMP",
    "ALTER TABLE workflow_patterns ADD COLUMN step_count INTEGER DEFAULT 0",
    "ALTER TABLE workflow_patterns ADD COLUMN step_hash TEXT",
    "ALTER TABLE workflow_patterns ADD COLUMN pinned INTEGER DEFAULT 0",
    "ALTER TABLE workflow_patterns ADD COLUMN execution_count INTEGER DEFAULT 0",
    "ALTER TABLE workflow_patterns ADD COLUMN last_executed TIMESTAMP",
    "ALTER TABLE workflow_patterns ADD COLUMN average_execution_duration INTEGER DEFAULT 0",
    "ALTER TABLE workflow_patterns ADD COLUMN version INTEGER DEFAULT 2",
    "ALTER TABLE scheduled_workflows ADD COLUMN frequency TEXT DEFAULT 'once'",
    "ALTER TABLE scheduled_workflows ADD COLUMN days_of_week TEXT",
    "ALTER TABLE scheduled_workflows ADD COLUMN last_triggered_at TIMESTAMP"
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) { }
  }

  // Initialise storage limit to 500 MB (in bytes)
  const limitRow = db.prepare("SELECT value FROM storage_meta WHERE key = 'storage_limit_bytes'").get();
  if (!limitRow) {
    db.prepare("INSERT INTO storage_meta (key, value) VALUES ('storage_limit_bytes', ?)").run(String(500 * 1024 * 1024));
  }
}

export function enforceStorageLimit() {
  const db = getDb();
  try {
    const limitRow = db.prepare("SELECT value FROM storage_meta WHERE key = 'storage_limit_bytes'").get();
    if (!limitRow) return;
    const limitBytes = parseInt(limitRow.value, 10);
    const dbSize = getDbSizeBytes();

    if (dbSize > limitBytes) {
      console.log(`[Storage] DB Size (${(dbSize / 1024 / 1024).toFixed(2)} MB) exceeds limit (${(limitBytes / 1024 / 1024).toFixed(2)} MB). Evicting old events...`);
      db.prepare('DELETE FROM semantic_events WHERE id IN (SELECT id FROM semantic_events ORDER BY occurred_at ASC LIMIT 1000)').run();
      db.exec('VACUUM');
    }
  } catch (e) {
    console.error('[Storage] Error enforcing limit:', e);
  }
}

// Database Helpers
export function getAllItems(search = '', type = 'all', limit = 100, offset = 0) {
  const db = getDb();
  let query = 'SELECT * FROM indexed_items WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (name LIKE ? OR path LIKE ? OR description LIKE ?)';
    const searchWildcard = `%${search}%`;
    params.push(searchWildcard, searchWildcard, searchWildcard);
  }

  if (type !== 'all') {
    query += ' AND type = ?';
    params.push(type);
  }

  query += ' ORDER BY type ASC, name ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const stmt = db.prepare(query);
  return stmt.all(...params);
}

export function getItemByPath(filePath) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM indexed_items WHERE path = ? COLLATE NOCASE');
  return stmt.get(filePath);
}

export function upsertItem({ name, path: filePath, type, category = 'General', description = '', arguments: args = '', installDate = null }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO indexed_items (name, path, type, category, description, arguments, install_date, last_scanned)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      category = excluded.category,
      description = excluded.description,
      arguments = excluded.arguments,
      install_date = excluded.install_date,
      last_scanned = CURRENT_TIMESTAMP
  `);
  return stmt.run(name, filePath, type, category, description, args, installDate);
}

export function deleteItemByPath(filePath) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM indexed_items WHERE path = ?');
  return stmt.run(filePath);
}

export function deleteOrphanedItems(validPaths) {
  if (!validPaths || validPaths.length === 0) return { changes: 0 };
  const db = getDb();

  db.exec('CREATE TEMP TABLE IF NOT EXISTS valid_paths_temp (path TEXT PRIMARY KEY)');
  db.exec('DELETE FROM valid_paths_temp');

  const insertTemp = db.prepare('INSERT OR IGNORE INTO valid_paths_temp (path) VALUES (?)');
  db.exec('BEGIN TRANSACTION');
  for (const p of validPaths) {
    insertTemp.run(p);
  }
  db.exec('COMMIT');

  const deleteStmt = db.prepare(`
    DELETE FROM indexed_items 
    WHERE path NOT IN (SELECT path FROM valid_paths_temp)
    AND type != 'app'
  `);
  const result = deleteStmt.run();

  return result;
}

export function deleteOrphanedApps(validAppPaths, uwpScanSuccess = true) {
  if (!validAppPaths || validAppPaths.length === 0) return { changes: 0 };
  const db = getDb();

  db.exec('CREATE TEMP TABLE IF NOT EXISTS valid_apps_temp (path TEXT PRIMARY KEY)');
  db.exec('DELETE FROM valid_apps_temp');

  const insertTemp = db.prepare('INSERT OR IGNORE INTO valid_apps_temp (path) VALUES (?)');
  db.exec('BEGIN TRANSACTION');
  for (const p of validAppPaths) {
    insertTemp.run(p);
  }
  db.exec('COMMIT');

  let deleteQuery = `
    DELETE FROM indexed_items 
    WHERE type = 'app' 
    AND path NOT IN (SELECT path FROM valid_apps_temp)
  `;

  if (!uwpScanSuccess) {
    deleteQuery += " AND path NOT LIKE 'shell:%'";
  }

  const deleteStmt = db.prepare(deleteQuery);
  const result = deleteStmt.run();

  return result;
}

// Checkup Logs
export function addCheckupLog(message, filePath = null, actionType = 'info') {
  const db = getDb();
  db.prepare(`
    INSERT INTO checkup_logs (action_type, file_path, message)
    VALUES (?, ?, ?)
  `).run(actionType, filePath, message);
}

export function getCheckupLogs(limit = 100) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM checkup_logs ORDER BY occurred_at DESC LIMIT ?
  `).all(limit);
}

// Failure History
export function recordFailure(filePath, description, actionType = 'execute', causedBy = 'unknown', userWarned = false, userProceeded = false) {
  const db = getDb();
  db.prepare(`
    INSERT INTO failure_history 
    (action_type, file_path, failure_description, caused_by, user_was_warned, user_proceeded)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(actionType, filePath, description, causedBy, userWarned ? 1 : 0, userProceeded ? 1 : 0);
}

export function getFailuresForFile(filePath) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM failure_history 
    WHERE file_path = ? COLLATE NOCASE
    ORDER BY occurred_at DESC
  `).all(filePath);
}

// ── WORKFLOW PATTERN HELPERS ──────────────────────────

export function upsertWorkflow(workflow) {
  const db = getDb();
  db.prepare(`
    INSERT INTO workflow_patterns 
    (id, name, trigger_signature, steps, plans, times_observed, times_confirmed, times_rejected, confidence, last_seen, execution_count, last_executed, average_execution_duration, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      times_observed = excluded.times_observed,
      times_confirmed = excluded.times_confirmed,
      times_rejected = excluded.times_rejected,
      confidence = excluded.confidence,
      plans = excluded.plans,
      execution_count = excluded.execution_count,
      last_executed = excluded.last_executed,
      average_execution_duration = excluded.average_execution_duration,
      version = excluded.version,
      last_seen = CURRENT_TIMESTAMP
  `).run(
    workflow.id,
    workflow.name,
    workflow.trigger_signature,
    JSON.stringify(workflow.steps),
    JSON.stringify(workflow.plans),
    workflow.times_observed,
    workflow.times_confirmed,
    workflow.times_rejected,
    workflow.confidence,
    workflow.execution_count || 0,
    workflow.last_executed || null,
    workflow.average_execution_duration || 0,
    workflow.version || 2
  );
}

export function getAllWorkflows() {
  const db = getDb();
  return db.prepare(`SELECT * FROM workflow_patterns ORDER BY confidence DESC`).all().map(w => {
    let steps = JSON.parse(w.steps || '[]');
    let plans = JSON.parse(w.plans || '[]');
    let version = w.version || 2;

    // V3 Lazy Migration
    if (version < 3) {
      plans = plans.map(plan => {
        // Convert linear steps to a single-branch V3 graph
        if (!plan.graph && plan.steps) {
          const graph = {
            nodes: {},
            edges: [],
            rootNodeId: null
          };

          let prevNodeId = null;
          plan.steps.forEach((step, i) => {
            const nodeId = 'node_' + i;
            if (i === 0) graph.rootNodeId = nodeId;

            graph.nodes[nodeId] = {
              id: nodeId,
              event_type: step.event_type,
              app: step.app,
              command: step.command,
              filepath: step.filepath,
              metadata: step.metadata,
              parentNodeId: prevNodeId,
              parentWorkflowId: w.id,
              is_leaf: i === plan.steps.length - 1,
              enabled: true
            };

            if (prevNodeId) {
              graph.edges.push({
                from: prevNodeId,
                to: nodeId
              });
            }
            prevNodeId = nodeId;
          });

          plan.graph = graph;
        }
        return plan;
      });
    }

    // Ensure all graph nodes have metadata populated from plan.steps if missing
    plans = plans.map(plan => {
      if (plan.graph && plan.graph.nodes && Array.isArray(plan.steps)) {
        plan.steps.forEach((step, i) => {
          const nodeId = 'node_' + i;
          if (plan.graph.nodes[nodeId]) {
            if (!plan.graph.nodes[nodeId].metadata && step.metadata) {
              plan.graph.nodes[nodeId].metadata = step.metadata;
            }
          }
        });
      }
      return plan;
    });

    return {
      ...w,
      steps,
      plans,
      version: version < 3 ? 3 : version // Mark as upgraded in-memory
    };
  });
}

// ── SEMANTIC EVENT HELPERS ────────────────────────────

export function insertSemanticEvent({ eventType, event_type, app = null, filepath = null, command = null, metadata = null }) {
  const finalType = eventType || event_type;
  const db = getDb();
  db.prepare(`
    INSERT INTO semantic_events (event_type, app, filepath, command, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(finalType, app, filepath, command, metadata ? JSON.stringify(metadata) : null);
}

export function getRecentEvents(limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM semantic_events ORDER BY occurred_at DESC LIMIT ?
  `).all(limit);
}

const MAX_SEMANTIC_EVENTS = 5000;

// ── TOKEN INDEX HELPERS ───────────────────────────────────────────────────

export function upsertToken(token) {
  const db = getDb();
  const existing = db.prepare('SELECT id, address FROM token_index WHERE token = ?').get(token);
  if (existing) {
    db.prepare('UPDATE token_index SET frequency = frequency + 1, last_seen = CURRENT_TIMESTAMP WHERE token = ?').run(token);
    return existing.address;
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM token_index').get().c;
  const address = '0x' + (count + 1).toString(16).padStart(4, '0');
  db.prepare('INSERT INTO token_index (token, address) VALUES (?, ?)').run(token, address);
  return address;
}

export function getTokenAddress(token) {
  const db = getDb();
  const row = db.prepare('SELECT address FROM token_index WHERE token = ?').get(token);
  return row ? row.address : null;
}

export function resolveAddress(address) {
  const db = getDb();
  const row = db.prepare('SELECT token FROM token_index WHERE address = ?').get(address);
  return row ? row.token : null;
}

// ── PREFIX INDEX HELPERS ──────────────────────────────────────────────────

export function indexWorkflowPrefixes(workflowId, commandString) {
  const db = getDb();
  const insertPrefix = db.prepare('INSERT OR IGNORE INTO prefix_index (prefix, workflow_id) VALUES (?, ?)');
  const cleanCmd = commandString.trim();
  for (let i = 1; i <= cleanCmd.length; i++) {
    const prefix = cleanCmd.slice(0, i).toLowerCase();
    insertPrefix.run(prefix, workflowId);
  }
}

export function queryPrefixIndex(prefix) {
  const db = getDb();
  const rows = db.prepare('SELECT workflow_id FROM prefix_index WHERE prefix = ?').all(prefix.toLowerCase());
  return { count: rows.length, workflow_ids: rows.map(r => r.workflow_id) };
}

export function removeWorkflowPrefixes(workflowId) {
  const db = getDb();
  db.prepare('DELETE FROM prefix_index WHERE workflow_id = ?').run(workflowId);
}

// ── STORAGE BUDGET HELPERS ────────────────────────────────────────────────

export function getStorageLimitBytes() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM storage_meta WHERE key = 'storage_limit_bytes'").get();
  return row ? parseInt(row.value, 10) : 500 * 1024 * 1024;
}

export function getDbSizeBytes() {
  const db = getDb();
  const pageCount = db.prepare('PRAGMA page_count').get()['page_count'];
  const pageSize = db.prepare('PRAGMA page_size').get()['page_size'];
  return pageCount * pageSize;
}

export function getTableBreakdown() {
  const db = getDb();
  const counts = { semantic_events: 0, workflow_patterns: 0, indexed_items: 0, token_index: 0, prefix_index: 0, other: 0 };
  const tables = ['semantic_events', 'workflow_patterns', 'indexed_items', 'token_index', 'prefix_index'];
  for (const t of tables) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()?.c || 0; } catch (e) { counts[t] = 0; }
  }
  const otherTables = ['scanned_directories', 'checkup_logs', 'failure_history', 'file_dependencies', 'storage_meta'];
  for (const t of otherTables) {
    try { counts.other += db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()?.c || 0; } catch (e) { }
  }
  const weights = { semantic_events: 150, workflow_patterns: 1000, indexed_items: 250, token_index: 40, prefix_index: 30, other: 150 };
  const estimatedSizes = {
    semantic_events: counts.semantic_events * weights.semantic_events,
    workflow_patterns: counts.workflow_patterns * weights.workflow_patterns,
    indexed_items: counts.indexed_items * weights.indexed_items,
    token_index: counts.token_index * weights.token_index,
    prefix_index: counts.prefix_index * weights.prefix_index,
    other: counts.other * weights.other
  };
  const totalEstimated = Object.values(estimatedSizes).reduce((a, b) => a + b, 0);
  if (totalEstimated === 0) return [0, 0, 0, 0, 0, 100];
  return [
    +(estimatedSizes.semantic_events / totalEstimated * 100).toFixed(2),
    +(estimatedSizes.workflow_patterns / totalEstimated * 100).toFixed(2),
    +(estimatedSizes.indexed_items / totalEstimated * 100).toFixed(2),
    +(estimatedSizes.token_index / totalEstimated * 100).toFixed(2),
    +(estimatedSizes.prefix_index / totalEstimated * 100).toFixed(2),
    +(estimatedSizes.other / totalEstimated * 100).toFixed(2),
  ];
}

export function getStorageStats() {
  const usedBytes = getDbSizeBytes();
  const limitBytes = getStorageLimitBytes();
  return {
    used_bytes: usedBytes,
    limit_bytes: limitBytes,
    used_mb: +(usedBytes / (1024 * 1024)).toFixed(3),
    limit_mb: +(limitBytes / (1024 * 1024)).toFixed(1),
    percent_used: +((usedBytes / limitBytes) * 100).toFixed(2),
    remaining_mb: +((limitBytes - usedBytes) / (1024 * 1024)).toFixed(3),
    over_limit: usedBytes >= limitBytes,
    table_pcts: getTableBreakdown()
  };
}

export function getStaleWorkflows(days = 60) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare(`SELECT * FROM workflow_patterns WHERE status = 'active' AND last_seen < ? AND (times_confirmed = 0 OR times_observed < 4)`).all(cutoff).map(w => ({
    ...w,
    steps: JSON.parse(w.steps || '[]'),
    plans: JSON.parse(w.plans || '[]')
  }));
}

export function ghostWorkflow(workflowId, stepCount, stepHash) {
  const db = getDb();
  db.prepare(`UPDATE workflow_patterns SET status = 'ghost', ghosted_at = CURRENT_TIMESTAMP, step_count = ?, step_hash = ?, steps = '[]', plans = '[]' WHERE id = ?`).run(stepCount, stepHash, workflowId);
  db.prepare('DELETE FROM prefix_index WHERE workflow_id = ?').run(workflowId);
}

export function reactivateGhost(workflowId, newSequence, previousConfidence, previousPlans) {
  const db = getDb();
  const reactivatedPlans = [{ label: 'A', steps: newSequence, confidence: previousConfidence, times_used: 0, created_reason: 'ghost_reactivation' }];
  db.prepare(`UPDATE workflow_patterns SET status = 'active', ghosted_at = NULL, step_count = 0, step_hash = NULL, steps = ?, plans = ?, times_observed = times_observed + 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?`).run(JSON.stringify(newSequence), JSON.stringify(reactivatedPlans), workflowId);
}

export function getGhostWorkflows() {
  const db = getDb();
  return db.prepare(`SELECT id, name, trigger_signature, times_observed, times_confirmed, confidence, last_seen, ghosted_at, step_count FROM workflow_patterns WHERE status = 'ghost' ORDER BY last_seen DESC`).all();
}

export function setWorkflowPinned(workflowId, pinned) {
  const db = getDb();
  return db.prepare(`UPDATE workflow_patterns SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, workflowId);
}

export function addWorkflowSchedule(id, workflowId, scheduledTime, frequency = 'once', daysOfWeek = null) {
  const db = getDb();
  return db.prepare(`INSERT INTO scheduled_workflows (id, workflow_id, scheduled_time, status, frequency, days_of_week) VALUES (?, ?, ?, 'pending', ?, ?)`).run(id, workflowId, scheduledTime, frequency, daysOfWeek);
}

export function getPendingSchedules() {
  const db = getDb();
  return db.prepare(`SELECT s.id, s.workflow_id, s.scheduled_time, s.status, s.frequency, s.days_of_week, s.last_triggered_at, w.name AS workflow_name FROM scheduled_workflows s JOIN workflow_patterns w ON s.workflow_id = w.id WHERE s.status = 'pending' ORDER BY s.scheduled_time ASC`).all();
}

export function getAllSchedules() {
  const db = getDb();
  return db.prepare(`SELECT s.id, s.workflow_id, s.scheduled_time, s.status, s.frequency, s.days_of_week, s.last_triggered_at, w.name AS workflow_name FROM scheduled_workflows s JOIN workflow_patterns w ON s.workflow_id = w.id ORDER BY s.scheduled_time ASC`).all();
}

export function updateScheduleStatus(scheduleId, status) {
  const db = getDb();
  return db.prepare(`UPDATE scheduled_workflows SET status = ? WHERE id = ?`).run(status, scheduleId);
}

export function updateScheduleTriggerTime(scheduleId, timestamp) {
  const db = getDb();
  return db.prepare(`UPDATE scheduled_workflows SET last_triggered_at = ? WHERE id = ?`).run(timestamp, scheduleId);
}

export function deleteSchedule(scheduleId) {
  const db = getDb();
  return db.prepare(`DELETE FROM scheduled_workflows WHERE id = ?`).run(scheduleId);
}

export function getDependentsOf(filePath) {
  try {
    const stmt = getDb().prepare(`SELECT source_path FROM file_dependencies WHERE target_path = ?`);
    const rows = stmt.all(filePath);
    return rows.map(r => r.source_path);
  } catch (err) {
    console.error('DB Error getting dependents:', err);
    return [];
  }
}

export function insertFailure({ actionType, filePath, description, causedBy, userWarned = 0, userProceeded = 0 }) {
  try {
    const stmt = getDb().prepare(`
      INSERT INTO failure_history 
      (action_type, file_path, failure_description, caused_by, user_was_warned, user_proceeded) 
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(actionType, filePath, description, causedBy, userWarned, userProceeded);
  } catch (err) {
    console.error('DB Error inserting failure:', err);
  }
}

export function insertDependency(filePath, dependsOn) {
  try {
    const stmt = getDb().prepare(`INSERT OR IGNORE INTO file_dependencies (file_path, depends_on) VALUES (?, ?)`);
    stmt.run(filePath, dependsOn);
  } catch (e) {
    // ignore
  }
}


export function addScannedDirectory(rootPath, alias, maxDepth = 2) {
  try {
    const stmt = getDb().prepare(`INSERT OR IGNORE INTO scanned_directories (path, alias, depth) VALUES (?, ?, ?)`);
    stmt.run(rootPath, alias, maxDepth);
  } catch (e) { console.error('DB Error adding scanned dir:', e); }
}



export function getScannedDirectories() {
  try {
    return getDb().prepare(`SELECT * FROM scanned_directories`).all();
  } catch (e) {
    console.error('DB Error getting scanned dirs:', e);
    return [];
  }
}


export function updateDirectoryLastScanned(path) {
  try {
    getDb().prepare("UPDATE scanned_directories SET last_scanned = CURRENT_TIMESTAMP WHERE path = ?").run(path);
  } catch (e) { console.error("DB Error updateDirectoryLastScanned:", e); }
}

export function getAllDependencies() {
  try {
    return getDb().prepare('SELECT source_path as source, target_path as target, dependency_type as type FROM file_dependencies').all();
  } catch (e) {
    console.error('DB Error getAllDependencies:', e);
    return [];
  }
}
