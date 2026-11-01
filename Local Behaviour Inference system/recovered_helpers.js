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
  const pageSize  = db.prepare('PRAGMA page_size').get()['page_size'];
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
    try { counts.other += db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get()?.c || 0; } catch (e) {}
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

export function enforceStorageLimit() {
  const stats = getStorageStats();
  if (stats.over_limit) {
    console.warn(`[Storage] LIMIT REACHED — ${stats.used_mb} MB / ${stats.limit_mb} MB`);
    const db = getDb();
    const targetBytes = stats.limit_bytes * 0.9;
    let current = getDbSizeBytes();
    let pruned = 0;
    while (current > targetBytes) {
      const deleted = db.prepare('DELETE FROM semantic_events WHERE id IN (SELECT id FROM semantic_events ORDER BY occurred_at ASC LIMIT 500)').run();
      if (deleted.changes === 0) break;
      pruned += deleted.changes;
      current = getDbSizeBytes();
    }
    console.log(`[Storage] Pruned ${pruned} old events. Now ${(current/(1024*1024)).toFixed(2)} MB`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return getDbSizeBytes() < stats.limit_bytes;
  }
  return true;
}

// ── GHOST RECORD HELPERS ──────────────────────────────────────────────────

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
