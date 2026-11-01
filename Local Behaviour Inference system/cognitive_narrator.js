// cognitive_narrator.js

// ── CONFIGURE YOUR LOCAL LLM HERE ────────────────────
// Replace these with actual endpoint and format from existing project
const LLM_ENDPOINT = process.env.LLM_ENDPOINT || 'http://localhost:11434/api/generate';
const LLM_MODEL = process.env.LLM_MODEL || 'qwen3:1.7b';

async function callLLM(prompt) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 600); // 600ms timeout for instant responsiveness

  try {
    const response = await fetch(LLM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_predict: 100 }
      })
    });

    clearTimeout(id);

    if (!response.ok) throw new Error(`LLM error: ${response.status}`);
    const data = await response.json();

    // Handle both Ollama and OpenAI-style responses
    const text = data.response
      || data.choices?.[0]?.message?.content
      || data.content
      || data.text;

    return text || null;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      console.log('[CognitiveOS] LLM narrator timed out. Falling back to template.');
    } else {
      console.error('[CognitiveOS] LLM narrator error:', err.message);
    }
    // Fallback to template-based message if LLM fails
    return null;
  }
}

// ── WARNING NARRATOR ──────────────────────────────────

export async function narrateBlastRadius(blastData) {
  const { filename, direct_dependents, indirect_dependents, historical_failures, risk_score } = blastData;

  // Fallback template if LLM unavailable
  const fallback = buildFallbackWarning(blastData);

  const prompt = `You are a helpful computer assistant. Convert this technical data into ONE clear, friendly warning sentence. Be specific. No jargon. No markdown. Plain text only.

File: ${filename}
Files directly importing it: ${direct_dependents.length} (${direct_dependents.slice(0,3).map(f => f.split(/[/\\]/).pop()).join(', ')})
Indirectly affected files: ${indirect_dependents.length}
Past failures: ${historical_failures.length} times
Risk level: ${risk_score > 0.7 ? 'HIGH' : risk_score > 0.4 ? 'MODERATE' : 'LOW'}

Output one sentence warning only:`;

  const response = await callLLM(prompt);
  return response || fallback;
}

function buildFallbackWarning(blastData) {
  const { filename, direct_dependents, indirect_dependents, historical_failures } = blastData;

  if (historical_failures.length > 0) {
    return `Deleting ${filename} has caused failures before with ${historical_failures.length} times, and ${direct_dependents.length} file(s) still depend on it.`;
  }

  if (direct_dependents.length > 0) {
    const names = direct_dependents.slice(0, 2).map(f => f.split(/[/\\]/).pop()).join(' and ');
    return `Deleting ${filename} will break ${names}${indirect_dependents.length > 0 ? ` and ${indirect_dependents.length} other file(s)` : ''}.`;
  }

  return `Are you sure you want to delete ${filename}?`;
}

// ── SUGGESTION NARRATOR ───────────────────────────────

export async function narrateWorkflowSuggestion(workflow, plan) {
  const stepSummary = plan.steps
    .slice(0, 4)
    .map(s => s.command || s.app || s.event_type)
    .filter(Boolean)
    .join(' → ');

  const fallback = `I've seen you run "${workflow.name}" ${workflow.times_observed} times. Want me to run it for you? (${stepSummary})`;

  const prompt = `You are a friendly computer assistant. Write ONE casual, friendly sentence asking if the user wants you to automate a task you've seen them do repeatedly. No markdown. Plain text only.

Task name: ${workflow.name}
Steps involved: ${stepSummary}
Times observed: ${workflow.times_observed}
Confidence: ${(workflow.confidence * 100).toFixed(0)}%

One sentence only:`;

  const response = await callLLM(prompt);
  return response || fallback;
}

// ── REJECTION NARRATOR ────────────────────────────────

export async function narrateRejectionLearning(workflow, newPlanLabel) {
  return `Got it — I've saved your approach as Plan ${newPlanLabel} for "${workflow.name}". I'll suggest it next time I see you start this workflow.`;
}
