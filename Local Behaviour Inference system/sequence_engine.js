// sequence_engine.js
import {
  upsertWorkflow,
  getAllWorkflows,
  getDb,
  upsertToken,
  indexWorkflowPrefixes,
  queryPrefixIndex,
  removeWorkflowPrefixes,
  enforceStorageLimit
} from './database.js';
import { randomUUID } from 'crypto';

// ── CONFIG ────────────────────────────────────────────

const CONFIG = {
  CONFIDENCE_THRESHOLD: 0.82,
  MIN_OBSERVATIONS: 4,
  SEQUENCE_IDLE_MS: 15 * 1000,   // 15 seconds gap = new session (for fast feedback)
  MIN_SEQUENCE_LENGTH: 3,
  MAX_PLAN_COUNT: 5,
};

// ── STATE ─────────────────────────────────────────────

let currentSession = [];
let sessionTimer = null;
let suggestionCallback = null;
let updateCallback = null;

// Prevent suggesting same workflow twice within 30 minutes
const recentSuggestions = new Map();

// ── V3 WORKFLOW INTELLIGENCE STATE ────────────────────
let rootContextApp = null;
let activeApps = new Set();
let candidateWorkflows = []; // Array of TraversalState objects


// ── PUBLIC API ────────────────────────────────────────

export function initSequenceEngine(onSuggestion, onUpdate) {
  suggestionCallback = onSuggestion;
  updateCallback = onUpdate;
  console.log('[SequenceEngine] Initialized');
}

export function ingestEvent(event) {
  // Track Active Apps
  if (event.event_type === 'app_launched' && event.app) {
    activeApps.add(event.app);
    if (!rootContextApp) {
      rootContextApp = event.app;
    }
  } else if (event.event_type === 'app_closed' && event.app) {
    activeApps.delete(event.app);
    if (event.app === rootContextApp && activeApps.size === 0) {
      // Application lifecycle ended, finalize immediately!
      finalizeSession();
      return;
    }
  }

  currentSession.push({
    ...event,
    timestamp: Date.now()
  });

  // V3 Progressive Elimination
  if (currentSession.length === 3) {
    populateCandidates();
  } else if (currentSession.length > 3) {
    advanceCandidates(event);
  }

  // Check for exact matches to auto-run background tasks or confirm workflows
  checkRealtimeMatch();

  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(finalizeSession, CONFIG.SEQUENCE_IDLE_MS);
}

export function confirmWorkflow(workflowId, planLabel = 'A') {
  const workflows = getAllWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return;

  wf.times_confirmed++;
  const plan = wf.plans.find(p => p.label === planLabel);
  if (plan) {
    plan.times_used = (plan.times_used || 0) + 1;
    plan.confidence = computeConfidence(wf);
  }
  wf.confidence = computeConfidence(wf);
  upsertWorkflow(wf);

  console.log(`[SequenceEngine] "${wf.name}" confirmed. `
    + `Confidence: ${(wf.confidence * 100).toFixed(0)}%`);
}

export function rejectWorkflow(workflowId, actualSequence) {
  const workflows = getAllWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return;

  wf.times_rejected++;
  wf.confidence = computeConfidence(wf);

  // Store what user actually did as a new plan (Plan B, C, D...)
  if (actualSequence?.length >= 2
      && wf.plans.length < CONFIG.MAX_PLAN_COUNT) {
    const nextLabel = String.fromCharCode(65 + wf.plans.length);
    const prevLabel = wf.plans[wf.plans.length - 1].label;

    // V3: Build Graph for new plan
    const graph = {
      nodes: {},
      edges: [],
      rootNodeId: null
    };
    
    let prevNodeId = null;
    actualSequence.forEach((step, i) => {
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
        parentWorkflowId: wf.id,
        is_leaf: i === actualSequence.length - 1,
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

    wf.plans.push({
      label: nextLabel,
      steps: actualSequence,
      graph: graph,
      confidence: 0.1,
      times_used: 0,
      is_active: true,
      created_reason: `User rejected Plan ${prevLabel}`,
      created_at: Date.now()
    });

    console.log(`[SequenceEngine] Learned Plan ${nextLabel} for "${wf.name}"`);
  }

  upsertWorkflow(wf);
}

export function getAllLearnedWorkflows() {
  return getAllWorkflows().map(wf => ({
    ...wf,
    confidence_pct: Math.round(wf.confidence * 100),
    is_suggestible: (wf.confidence >= CONFIG.CONFIDENCE_THRESHOLD
                    && wf.times_observed >= CONFIG.MIN_OBSERVATIONS) || !!wf.pinned || (wf.times_confirmed >= 1), // pinned and user-confirmed/manual workflows are always suggestible/runnable!
    is_pinned: !!wf.pinned,
    active_plan: wf.plans
      ?.filter(p => p.is_active !== false)
      ?.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]
      || wf.plans?.[0]
      || null
  }));
}

export function renameWorkflow(workflowId, newName) {
  const workflows = getAllWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return false;
  wf.name = newName;
  upsertWorkflow(wf);
  return true;
}

export function deleteWorkflow(workflowId) {
  removeWorkflowPrefixes(workflowId);    // ← LBIS ADDITION
  try {
    getDb().prepare(`DELETE FROM scheduled_workflows WHERE workflow_id = ?`).run(workflowId);
  } catch (e) {
    console.error('[SequenceEngine] Error clearing scheduled_workflows for deleted workflow:', e);
  }
  getDb().prepare(`DELETE FROM workflow_patterns WHERE id = ?`).run(workflowId);
}

// ── EARLY TRIGGER (suggest before user finishes) ──────

function populateCandidates() {
  if (currentSession.length !== 3) return;
  const signature = computeSignature(currentSession);
  
  const workflows = getAllWorkflows();
  candidateWorkflows.length = 0;
  console.log("Populating candidates! Found DB Workflows:", workflows.length, "Sig:", signature);
  
  for (const wf of workflows) {
    const isSug = isSuggestible(wf);
    const isRec = recentlySuggested(wf.id);
    const isSig = wf.trigger_signature === signature;
    const hasGraph = !!(wf.plans[0] && wf.plans[0].graph && wf.plans[0].graph.rootNodeId);
    console.log(`Checking ${wf.id}: sug=${isSug}, rec=${isRec}, sig=${isSig}, graph=${hasGraph}`);
    if (!isSuggestible(wf)) continue;
    if (recentlySuggested(wf.id)) continue;
    
    // Check if the workflow's trigger signature matches the first 3 events
    if (wf.trigger_signature === signature) {
      for (const plan of (wf.plans || [])) {
        if (!plan.graph || !plan.graph.rootNodeId) continue;
        
        candidateWorkflows.push({
          workflowId: wf.id,
          workflow: wf,
          plan: plan,
          graph: plan.graph,
          currentNodeId: findNodeAtDepth(plan.graph, 2), // We are at 3rd event (depth 2)
          matchedCount: 3,
          eliminated: false,
          probability: wf.confidence
        });
      }
    }
  }
  
  // Try to suggest immediately if there's a strong candidate
  checkCandidatesForSuggestion();
}

function findNodeAtDepth(graph, depth) {
  let curr = graph.rootNodeId;
  for (let i = 0; i < depth; i++) {
    const edge = graph.edges.find(e => e.from === curr);
    if (!edge) return null;
    curr = edge.to;
  }
  return curr;
}

function advanceCandidates(event) {
  for (const candidate of candidateWorkflows) {
    if (candidate.eliminated) continue;
    
    // Find valid outgoing edges from currentNodeId
    const edges = candidate.graph.edges.filter(e => e.from === candidate.currentNodeId);
    let matchedNextNodeId = null;
    
    for (const edge of edges) {
      const nextNode = candidate.graph.nodes[edge.to];
      if (matchEventToNode(event, nextNode)) {
        matchedNextNodeId = nextNode.id;
        break;
      }
    }
    
    if (matchedNextNodeId) {
      candidate.currentNodeId = matchedNextNodeId;
      candidate.matchedCount++;
    } else {
      candidate.eliminated = true;
    }
  }
  
  checkCandidatesForSuggestion();
}

function matchEventToNode(event, node) {
  if (!node) return false;
  if (node.event_type !== event.event_type) return false;
  if (node.app && node.app !== event.app) return false;
  
  if (node.command && event.command) {
    if (!event.command.toLowerCase().startsWith(node.command.toLowerCase())) return false;
  }
  return true;
}

function checkCandidatesForSuggestion() {
  const activeCandidates = candidateWorkflows.filter(c => !c.eliminated);
  if (activeCandidates.length === 0) return;
  
  // Pick the highest probability candidate that hasn't been suggested
  activeCandidates.sort((a, b) => b.probability - a.probability);
  
  const best = activeCandidates[0];
  if (!recentlySuggested(best.workflowId)) {
    markSuggested(best.workflowId);
    suggest(best.workflow, best.plan, best.matchedCount);
  }
}

function resetSessionState() {
  currentSession = [];
  candidateWorkflows = [];
  rootContextApp = null;
  activeApps.clear();
}

// ── SESSION FINALIZATION ──────────────────────────────

function finalizeSession() {
  const session = [...currentSession];
  resetSessionState();

  if (session.length < CONFIG.MIN_SEQUENCE_LENGTH) return;

  const deduped = deduplicateSequence(session);
  const match = findBestMatch(deduped);

  if (match) {
    reinforceWorkflow(match.workflow, deduped, match.planIndex);
  } else {
    discoverWorkflow(deduped);
  }
}

// ── WORKFLOW DISCOVERY ────────────────────────────────

function discoverWorkflow(sequence) {
  // Enforce storage limit before writing
  enforceStorageLimit();

  const sig = computeSignature(sequence);

  // Don't create duplicate
  const exists = getAllWorkflows().find(w => w.trigger_signature === sig);
  if (exists) {
    reinforceWorkflow(exists, sequence, 0);
    return;
  }

  const name = inferName(sequence);
  const workflowId = randomUUID();
  
  // V3: Build initial Graph
  const graph = {
    nodes: {},
    edges: [],
    rootNodeId: null
  };
  
  let prevNodeId = null;
  sequence.forEach((step, i) => {
    const nodeId = 'node_' + i;
    if (i === 0) graph.rootNodeId = nodeId;
    
    graph.nodes[nodeId] = {
      id: nodeId,
      event_type: step.event_type,
      app: step.app,
      command: step.command,
      filepath: step.filepath,
      parentNodeId: prevNodeId,
      parentWorkflowId: workflowId,
      is_leaf: i === sequence.length - 1,
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

  const workflow = {
    id: workflowId,
    name,
    trigger_signature: sig,
    steps: sequence, // Keep legacy steps for backward compat
    plans: [{
      label: 'A',
      steps: sequence, // Keep legacy steps for backward compat
      graph: graph,    // V3 Graph Payload
      confidence: 0.1,
      times_used: 0,
      is_active: true,
      created_reason: 'initial_observation',
      created_at: Date.now()
    }],
    times_observed: 1,
    times_confirmed: 0,
    times_rejected: 0,
    confidence: 0.1,
    execution_count: 0,
    average_execution_duration: 0,
    version: 3
  };

  upsertWorkflow(workflow);
  if (updateCallback) updateCallback({ type: 'discovered', workflow });

  // Index command tokens and cumulative prefixes for the discovered workflow
  for (const event of sequence) {
    if (event?.command) {
      const tokens = event.command.trim().split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        upsertToken(token);
      }
      indexWorkflowPrefixes(workflow.id, event.command);
    }
  }

  console.log(`[SequenceEngine] Discovered: "${name}" (${sequence.length} steps)`);
}

// ── WORKFLOW REINFORCEMENT ────────────────────────────

function reinforceWorkflow(workflow, sequence, planIndex = 0) {
  workflow.times_observed++;
  workflow.confidence = computeConfidence(workflow);

  const plan = workflow.plans[planIndex] || workflow.plans[0];
  if (plan) plan.confidence = workflow.confidence;

  upsertWorkflow(workflow);
  if (updateCallback) updateCallback({ type: 'reinforced', workflow });

  const pct = (workflow.confidence * 100).toFixed(0);
  console.log(`[SequenceEngine] Reinforced: "${workflow.name}" `
    + `(${workflow.times_observed}x observed, ${pct}% confidence)`);
}

// ── SUGGEST ───────────────────────────────────────────

function suggest(workflow, plan, matchedSteps = 0) {
  if (!suggestionCallback) return;

  console.log(`[SequenceEngine] Suggesting: "${workflow.name}" `
    + `Plan ${plan.label} (${(workflow.confidence * 100).toFixed(0)}% confidence)`);

  suggestionCallback({
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    plan_label: plan.label,
    steps: plan.steps,
    confidence: workflow.confidence,
    times_observed: workflow.times_observed,
    matched_steps: matchedSteps
  });
}

// ── PATTERN MATCHING ──────────────────────────────────

function findBestMatch(sequence) {
  const workflows = getAllWorkflows();
  let bestScore = 0;
  let bestMatch = null;

  for (const wf of workflows) {
    for (let pi = 0; pi < (wf.plans || []).length; pi++) {
      const plan = wf.plans[pi];
      if (!plan?.steps) continue;
      const score = computeSimilarity(sequence, plan.steps);

      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = { workflow: wf, planIndex: pi, score };
      }
    }
  }

  return bestMatch;
}

export function getCommandTriggerToken(commandString) {
  if (!commandString) return '';
  const tokens = commandString.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  
  const first = tokens[0].toLowerCase();
  const CLI_TOOLS_WITH_SUBCOMMANDS = new Set([
    'git', 'npm', 'docker', 'docker-compose', 'cargo', 'pip', 'pip3', 'npx', 'yarn', 'pnpm', 
    'go', 'dotnet', 'aws', 'kubectl', 'terraform', 'gcloud', 'vagrant', 'heroku', 'node', 
    'python', 'python3', 'ruby'
  ]);
  
  if (CLI_TOOLS_WITH_SUBCOMMANDS.has(first) && tokens.length > 1) {
    const second = tokens[1].toLowerCase();
    const GENERIC_SUBCOMMANDS = new Set(['run', 'exec', 'subcmd', 'cmd', 'manage', 'execute', 'start', 'stop', 'go']);
    if (GENERIC_SUBCOMMANDS.has(second) && tokens.length > 2) {
      return `${first} ${second} ${tokens[2].toLowerCase()}`;
    }
    return `${first} ${second}`;
  }
  
  return first;
}

function computeSimilarity(seqA, seqB) {
  if (!seqA?.length || !seqB?.length) return 0;
  const minLen = Math.min(seqA.length, seqB.length);
  const maxLen = Math.max(seqA.length, seqB.length);
  let matches = 0;

  for (let i = 0; i < minLen; i++) {
    const a = seqA[i];
    const b = seqB[i];
    if (!a || !b) continue;
    if (a.event_type === b.event_type) {
      matches++;
      if (a.app && a.app === b.app) matches += 0.5;
      if (a.command && b.command &&
          getCommandTriggerToken(a.command) === getCommandTriggerToken(b.command)) {
        matches += 0.5;
      }
    }
  }

  return matches / maxLen;
}

function computeSignature(sequence) {
  return sequence
    .slice(0, 3)
    .map(e => {
      const cmd = getCommandTriggerToken(e?.command);
      const app = e?.app || '';
      return `${e?.event_type || ''}:${app}:${cmd}`;
    })
    .join('|');
}

// ── CONFIDENCE FORMULA ────────────────────────────────

function computeConfidence(wf) {
  if (wf.plans && wf.plans.some(p => p.created_reason === 'manual_recording')) {
    return 1.0;
  }

  const obsScore = Math.min(wf.times_observed / 10, 1.0) * 0.4;

  const total = (wf.times_confirmed || 0) + (wf.times_rejected || 0);
  const trustScore = total > 0
    ? ((wf.times_confirmed || 0) / total) * 0.4
    : 0.3; // Default trust score when no decisions have been made yet, preventing confidence deadlock

  const recencyScore = computeRecency(wf.last_seen) * 0.2;

  return parseFloat(
    Math.min(obsScore + trustScore + recencyScore, 1.0).toFixed(3)
  );
}

function computeRecency(lastSeen) {
  if (!lastSeen) return 0.5;
  const days = (Date.now() - new Date(lastSeen).getTime())
               / (1000 * 60 * 60 * 24);
  if (days < 1)  return 1.0;
  if (days < 7)  return 0.8;
  if (days < 30) return 0.5;
  return 0.2;
}

// ── HELPERS ───────────────────────────────────────────

function isSuggestible(wf) {
  return wf.confidence >= CONFIG.CONFIDENCE_THRESHOLD
      && wf.times_observed >= CONFIG.MIN_OBSERVATIONS;
}

function deduplicateSequence(sequence) {
  return sequence.filter((event, i) => {
    if (i === 0) return true;
    const prev = sequence[i - 1];
    
    // Different event types or apps are not duplicates
    if (event.event_type !== prev.event_type || event.app !== prev.app) {
      return true;
    }
    
    // Different commands are not duplicates
    if (event.command !== prev.command) {
      return true;
    }
    
    // Different filepaths are not duplicates
    if (event.filepath !== prev.filepath) {
      return true;
    }
    
    return false;
  });
}

function inferName(sequence) {
  const commands = sequence
    .filter(e => e?.command)
    .map(e => e.command.toLowerCase());

  const apps = [...new Set(
    sequence
      .filter(e => e?.app && e.app !== 'tool_executor')
      .map(e => e.app)
  )];

  if (commands.some(c => c.includes('deploy')))        return 'Deploy Workflow';
  if (commands.some(c => c.includes('git push')))      return 'Git Push Workflow';
  if (commands.some(c => c.includes('git pull')))      return 'Git Sync Workflow';
  if (commands.some(c => c.includes('npm run build'))) return 'Build Workflow';
  if (commands.some(c => c.includes('npm test')))      return 'Test Workflow';
  if (commands.some(c => c.includes('docker')))        return 'Docker Workflow';
  if (commands.some(c => c.includes('npm run dev')))   return 'Dev Start Workflow';
  if (apps.length > 0) return `${apps.slice(0, 2).join(' + ')} Workflow`;
  return `Workflow ${new Date().toLocaleDateString()}`;
}

function recentlySuggested(workflowId) {
  const last = recentSuggestions.get(workflowId);
  if (!last) return false;
  return (Date.now() - last) < 30 * 60 * 1000; // 30 minutes
}

function markSuggested(workflowId) {
  recentSuggestions.set(workflowId, Date.now());
}

// ── REAL-TIME EXACT SEQUENCE MATCHING ────────────────
function checkRealtimeMatch() {
  const workflows = getAllWorkflows();
  const session = [...currentSession];

  for (const wf of workflows) {
    for (let pi = 0; pi < (wf.plans || []).length; pi++) {
      const plan = wf.plans[pi];
      if (!plan?.steps?.length) continue;

      const len = plan.steps.length;
      if (session.length < len) continue;

      const recent = session.slice(-len);
      if (isExactMatch(recent, plan.steps)) {
        console.log(`[SequenceEngine] Real-time match completed: "${wf.name}"`);
        reinforceWorkflow(wf, recent, pi);
        currentSession = currentSession.slice(0, -len);
        return; // Prevent multiple matches on single event
      }
    }
  }
}

function isExactMatch(seqA, seqB) {
  if (seqA.length !== seqB.length) return false;
  for (let i = 0; i < seqA.length; i++) {
    const a = seqA[i];
    const b = seqB[i];
    if (a.event_type !== b.event_type) return false;
    if (a.app !== b.app) return false;
    if (a.filepath !== b.filepath) return false;

    const cmdA = getCommandTriggerToken(a.command);
    const cmdB = getCommandTriggerToken(b.command);
    if (cmdA !== cmdB) return false;
  }
  return true;
}

// Test exports
export function getCandidateWorkflows() { return candidateWorkflows; }
export function getSequence() { return currentSequence; }

// Test exports
export function resetSequence() { currentSession.length = 0; candidateWorkflows.length = 0; activeApps.clear(); }
