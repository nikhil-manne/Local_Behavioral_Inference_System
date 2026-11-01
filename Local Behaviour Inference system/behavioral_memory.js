// behavioral_memory.js
import {
  upsertWorkflow,
  getAllWorkflows,
  insertSemanticEvent,
  getRecentEvents,
  getStaleWorkflows,
  ghostWorkflow,
  reactivateGhost
} from './database.js';
import { getCommandTriggerToken } from './sequence_engine.js';
import { randomUUID, createHash } from 'crypto';

const CONFIDENCE_THRESHOLD = 0.82;      // Minimum to suggest to user
const MIN_OBSERVATIONS = 4;             // Minimum times seen before suggesting
const SEQUENCE_IDLE_TIMEOUT = 3 * 60 * 1000; // 3 min idle = sequence ended

/**
 * Produces a short fingerprint of a sequence based on event types only.
 * Does NOT include file paths or timestamps — just the shape of the workflow.
 * Example output: "a3f2c1"
 */
function computeStepHash(steps) {
  const shape = steps
    .map(e => `${e.event_type}:${e.app || e.command?.split(' ')[0] || ''}`)
    .join('|');
  return createHash('sha1').update(shape).digest('hex').slice(0, 8);
}

let currentSequence = [];
let idleTimer = null;

// ── OBSERVE ───────────────────────────────────────────

export function observeAction(event) {
  // Store in database for persistence
  insertSemanticEvent(event);

  // Add to current in-memory sequence
  currentSequence.push({
    ...event,
    timestamp: Date.now()
  });

  // Reset idle timer
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => finalizeSequence(), SEQUENCE_IDLE_TIMEOUT);
}

function finalizeSequence() {
  if (currentSequence.length < 3) {
    currentSequence = [];
    return;
  }

  const sequence = [...currentSequence];
  currentSequence = [];

  const signature = computeSignature(sequence);
  const existing = findMatchingWorkflow(signature);

  if (existing) {
    reinforceWorkflow(existing, sequence);
  } else if (sequence.length >= 3) {
    discoverWorkflow(sequence, signature);
  }
}

// ── SIGNATURE & MATCHING ──────────────────────────────

function computeSignature(sequence) {
  // Signature = first 3 action types joined
  // e.g. "app_opened:vscode|terminal_command:git|terminal_command:npm"
  return sequence
    .slice(0, 3)
    .map(e => `${e.event_type}:${e.app || getCommandTriggerToken(e.command) || ''}`)
    .join('|');
}

function findMatchingWorkflow(signature) {
  const workflows = getAllWorkflows();
  return workflows.find(w => w.trigger_signature === signature) || null;
}

// ── DISCOVER ──────────────────────────────────────────

function discoverWorkflow(sequence, signature) {
  const id = randomUUID();
  const name = inferWorkflowName(sequence);

  const workflow = {
    id,
    name,
    trigger_signature: signature,
    steps: sequence,
    plans: [{
      label: 'A',
      steps: sequence,
      confidence: 0.1,
      times_used: 0,
      created_reason: 'initial_observation'
    }],
    times_observed: 1,
    times_confirmed: 0,
    times_rejected: 0,
    confidence: 0.1
  };

  upsertWorkflow(workflow);
  console.log(`[CognitiveOS] New workflow discovered: "${name}"`);
}

function inferWorkflowName(sequence) {
  // Try to name the workflow from its actions
  const commands = sequence
    .filter(e => e.command)
    .map(e => e.command)
    .join(', ');

  const apps = [...new Set(sequence
    .filter(e => e.app)
    .map(e => e.app))
  ].join(' + ');

  if (commands.includes('git') && commands.includes('deploy')) return 'Deploy Workflow';
  if (commands.includes('git pull')) return 'Git Sync';
  if (commands.includes('npm')) return 'Node.js Build';
  if (commands.includes('docker')) return 'Docker Workflow';
  if (apps) return `${apps} Workflow`;
  return `Workflow ${Date.now()}`;
}

// ── REINFORCE ─────────────────────────────────────────

function reinforceWorkflow(workflow, newSequence) {
  workflow.times_observed++;
  workflow.confidence = computeConfidence(workflow);

  // Update the best matching plan
  const bestPlan = workflow.plans.find(p => p.label === 'A') || workflow.plans[0];
  if (bestPlan) bestPlan.confidence = workflow.confidence;

  upsertWorkflow(workflow);

  if (workflow.confidence >= CONFIDENCE_THRESHOLD && workflow.times_observed >= MIN_OBSERVATIONS) {
    console.log(`[CognitiveOS] Workflow "${workflow.name}" ready to suggest (confidence: ${(workflow.confidence * 100).toFixed(0)}%)`);
  }
}

// ── CONFIDENCE ────────────────────────────────────────

function computeConfidence(workflow) {
  if (workflow.plans && workflow.plans.some(p => p.created_reason === 'manual_recording')) {
    return 1.0;
  }

  const observationScore = Math.min(workflow.times_observed / 10, 1.0) * 0.4;

  const totalDecisions = workflow.times_confirmed + workflow.times_rejected;
  const trustScore = totalDecisions > 0
    ? (workflow.times_confirmed / totalDecisions) * 0.4
    : 0.3; // Default trust score when no decisions have been made yet, preventing confidence deadlock

  const recencyScore = computeRecency(workflow.last_seen) * 0.2;

  return parseFloat(Math.min(observationScore + trustScore + recencyScore, 1.0).toFixed(3));
}

function computeRecency(lastSeen) {
  const daysSince = (Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 1)  return 1.0;
  if (daysSince < 7)  return 0.8;
  if (daysSince < 30) return 0.5;
  return 0.2;
}

// ── USER RESPONSE ─────────────────────────────────────

export function handleConfirmation(workflowId) {
  const workflows = getAllWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);
  if (!workflow) return;

  workflow.times_confirmed++;
  workflow.confidence = computeConfidence(workflow);

  const bestPlan = workflow.plans.find(p => p.label === 'A') || workflow.plans[0];
  if (bestPlan) bestPlan.times_used++;

  upsertWorkflow(workflow);
  console.log(`[CognitiveOS] Workflow "${workflow.name}" confirmed. Confidence: ${(workflow.confidence * 100).toFixed(0)}%`);
}

export function handleRejection(workflowId, actualSequence) {
  const workflows = getAllWorkflows();
  const workflow = workflows.find(w => w.id === workflowId);
  if (!workflow) return;

  workflow.times_rejected++;
  workflow.confidence = computeConfidence(workflow);

  // Store what the user ACTUALLY did as a new plan
  if (actualSequence && actualSequence.length > 0) {
    const nextLabel = String.fromCharCode(65 + workflow.plans.length); // A=65
    workflow.plans.push({
      label: nextLabel,
      steps: actualSequence,
      confidence: 0.1,
      times_used: 0,
      created_reason: `User rejected Plan ${workflow.plans[workflow.plans.length - 1].label}`
    });
    console.log(`[CognitiveOS] Learned Plan ${nextLabel} for "${workflow.name}"`);
  }

  upsertWorkflow(workflow);
}

// ── SUGGESTIONS ───────────────────────────────────────

export function getSuggestibleWorkflows() {
  return getAllWorkflows().filter(w =>
    w.confidence >= CONFIDENCE_THRESHOLD &&
    w.times_observed >= MIN_OBSERVATIONS
  );
}

export function getWorkflowById(id) {
  return getAllWorkflows().find(w => w.id === id) || null;
}

export function detectCurrentIntent() {
  // Look at last few actions and match against known workflow signatures
  const recentEvents = getRecentEvents(10);
  if (recentEvents.length < 2) return null;

  const recentSignature = recentEvents
    .slice(0, 3)
    .map(e => `${e.event_type}:${e.app || getCommandTriggerToken(e.command) || ''}`)
    .join('|');

  const workflows = getAllWorkflows();

  for (const wf of workflows) {
    if (wf.trigger_signature !== recentSignature) continue;

    // ── Ghost match: system recognises but can't execute ──
    if (wf.status === 'ghost') {
      console.log(`[CognitiveOS] Ghost match: "${wf.name}" — seen ${wf.times_observed}x before`);
      return {
        workflow:       wf,
        confidence:     wf.confidence,
        is_ghost:       true,
        suggested_plan: null,   // no plan — steps were wiped
        ghost_hint: `You've done this ${wf.times_observed} time(s) before. Want me to re-learn it?`
      };
    }

    // ── Active match: normal suggestion path ──
    if (wf.confidence >= CONFIDENCE_THRESHOLD) {
      return {
        workflow:       wf,
        confidence:     wf.confidence,
        is_ghost:       false,
        suggested_plan: wf.plans.sort((a, b) => b.confidence - a.confidence)[0]
      };
    }
  }

  return null;
}

/**
 * Nightly ghost job.
 * Converts stale, low-value workflows to ghost records to reclaim storage.
 */
export function runGhostJob() {
  const stale = getStaleWorkflows(60);
  if (stale.length === 0) {
    console.log('[CognitiveOS Ghost] No stale workflows to ghost today.');
    return { ghosted: 0 };
  }

  let count = 0;
  for (const wf of stale) {
    const stepCount = wf.steps.length;
    const stepHash  = computeStepHash(wf.steps);
    ghostWorkflow(wf.id, stepCount, stepHash);
    console.log(`[CognitiveOS Ghost] Ghosted: "${wf.name}" (last seen: ${wf.last_seen})`);
    count++;
  }

  console.log(`[CognitiveOS Ghost] Job complete. Ghosted ${count} workflows.`);
  return { ghosted: count };
}

/**
 * Called when a ghost workflow is re-triggered and the user wants re-learning.
 * Reactivates the ghost with inherited stats so confidence rebuilds faster.
 */
export function handleGhostReactivation(workflowId) {
  const workflows = getAllWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf || wf.status !== 'ghost') return;

  // Start capturing a fresh sequence — reuse the current in-memory buffer
  // The next finalizeSequence() call will reinforce this workflow naturally.
  // Here we just restore the record so reinforceWorkflow() can find it.
  reactivateGhost(workflowId, currentSequence, wf.confidence, wf.plans);

  console.log(`[CognitiveOS] Ghost reactivated: "${wf.name}". Re-learning in progress.`);
}
