// public/workflows_panel.js
(function () {
  'use strict';

  const panelHTML = `
    <div id="workflowsPanel" style="
      position:fixed; top:0; right:-380px; width:360px; height:100vh;
      background:#ffffff;
      border-left:2px solid #16a34a;
      z-index:99998; transition:right 0.3s cubic-bezier(0.4,0,0.2,1);
      display:flex; flex-direction:column;
      font-family:system-ui,sans-serif;
      box-shadow:-8px 0 40px rgba(22,163,74,0.15);
    ">
      <div style="padding:20px; border-bottom:1px solid #d1fae5;
        display:flex; align-items:center; justify-content:space-between; background:#f0fdf4;">
        <div>
          <div style="color:#14532d;font-size:15px;font-weight:700;">Learned Workflows</div>
          <div id="wfSubtitle" style="color:#16a34a;font-size:12px;margin-top:2px;">Loading...</div>
        </div>
        <button onclick="toggleWorkflowPanel()" style="background:none;border:none;
          color:#6b7280;cursor:pointer;font-size:18px;padding:4px 8px;border-radius:6px;">✕</button>
      </div>

      <!-- Manual Workflow Creator Section -->
      <div id="workflowCreatorSection" style="padding:15px 20px; border-bottom:1px solid #d1fae5; background:#f0fdf4;">
        <div id="creatorIdleState">
          <button id="btnStartRecord" onclick="startRecordingWorkflow()" style="
            width:100%; padding:10px; border-radius:8px; border:1px dashed #16a34a;
            background:#dcfce7; color:#15803d; font-weight:600; cursor:pointer;
            display:flex; align-items:center; justify-content:center; gap:8px; transition:all 0.2s;">
            <span style="color:#ef4444; font-size:14px; animation: blink 1.5s infinite;">●</span>
            Record Manual Workflow
          </button>
        </div>
        <div id="creatorActiveState" style="display:none; flex-direction:column; gap:10px;">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <span style="color:#ef4444; font-size:12px; font-weight:600; animation: blink 1s infinite; display:flex; align-items:center; gap:6px;">
              ● RECORDING
            </span>
            <span id="recordingStepCount" style="color:#6b7280; font-size:11px;">0 steps captured</span>
          </div>
          
          <!-- Live steps list preview -->
          <div id="recordingStepsPreview" style="max-height:80px; overflow-y:auto; background:#f0fdf4;
            border-radius:6px; padding:6px; font-family:monospace; font-size:10px; color:#16a34a;
            display:flex; flex-direction:column; gap:4px; scrollbar-width:none; border:1px solid #bbf7d0;">
            <div style="color:#9ca3af; text-align:center;">Perform actions to record steps...</div>
          </div>

          <input type="text" id="workflowRecordName" placeholder="Enter Workflow Name (e.g. Deploy Site)" style="
            width:100%; padding:8px 12px; border-radius:6px; border:1px solid #86efac;
            background:#ffffff; color:#111827; font-size:12px; outline:none;">
          
          <div style="display:flex; gap:8px;">
            <button onclick="stopRecordingWorkflow()" style="
              flex:1; padding:8px; border-radius:6px; border:none;
              background:#16a34a; color:white; font-size:12px; font-weight:600; cursor:pointer;">
              💾 Stop & Save
            </button>
            <button onclick="cancelRecordingWorkflow()" style="
              padding:8px 12px; border-radius:6px; border:1px solid #d1d5db;
              background:#f9fafb; color:#6b7280; font-size:12px; cursor:pointer;">
              Cancel
            </button>
          </div>
        </div>
      </div>
      
      <!-- Search Input Section -->
      <div style="padding: 10px 20px; border-bottom: 1px solid #d1fae5; background: #ffffff;">
        <input type="text" id="wfSearchInput" placeholder="🔍 Search workflows..." style="
          width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid #86efac;
          background: #f0fdf4; color: #111827; font-size: 13px; outline: none;
          transition: all 0.2s;" onfocus="this.style.borderColor='#16a34a'; this.style.background='#dcfce7'" onblur="this.style.borderColor='#86efac'; this.style.background='#f0fdf4'">
      </div>

      <div id="workflowList" style="flex:1;overflow-y:auto;padding:12px;
        scrollbar-width:thin;scrollbar-color:#86efac transparent; background:#ffffff;">
        <div style="color:#9ca3af;font-size:13px;text-align:center;margin-top:40px;">
          Loading workflows...
        </div>
      </div>

      <div style="padding:12px 20px;border-top:1px solid #d1fae5;
        font-size:11px;color:#6b7280;text-align:center; background:#f0fdf4;">
        Workflows are learned automatically from your behavior
      </div>
    </div>

    <button id="workflowToggleBtn" style="
      position:fixed; top:50%; right:0; transform:translateY(-50%);
      background:#16a34a; border:none; color:white;
      padding:12px 6px; border-radius:8px 0 0 8px; cursor:pointer;
      z-index:99997; box-shadow:-4px 0 20px rgba(22,163,74,0.35);
      transition:background 0.2s; writing-mode:vertical-rl;
      font-size:11px; font-weight:700; letter-spacing:1px;">WORKFLOWS</button>

    <style>
      .wfCard { background:#ffffff; border:1px solid #d1fae5;
        border-radius:12px; padding:14px; margin-bottom:10px; transition:border-color 0.2s, box-shadow 0.2s; }
      .wfCard:hover { border-color:#16a34a; box-shadow:0 2px 12px rgba(22,163,74,0.1); }
      .wfCard.suggestible { border-color:#16a34a; background:#f0fdf4; }
      .wfCard.pinned { border-color:#f59e0b; background:#fffbeb; }
      .wfCard.highlighted { border-color:#16a34a !important;
        box-shadow:0 0 20px rgba(22,163,74,0.25) !important; }
      .wfBadge { display:inline-block; padding:2px 8px; border-radius:20px;
        font-size:10px; font-weight:600; letter-spacing:0.5px; }
      .wfBadgeHigh { background:#dcfce7; color:#15803d; border:1px solid #86efac; }
      .wfBadgeMed  { background:#fef9c3; color:#a16207; border:1px solid #fde047; }
      .wfBadgeLow  { background:#f1f5f9; color:#64748b; border:1px solid #cbd5e1; }
      .wfPlanTag { display:inline-block; background:#dcfce7; color:#15803d;
        border-radius:4px; padding:1px 6px; font-size:10px; margin-right:4px; margin-top:4px;
        border:1px solid #86efac; }
      .wfBtn { padding:5px 10px; border-radius:6px; border:1px solid #d1d5db;
        background:#f9fafb; color:#374151; font-size:11px; cursor:pointer; transition:all 0.15s; }
      .wfBtn:hover { background:#f0fdf4; border-color:#16a34a; color:#15803d; }
      .wfBtn.primary { background:#16a34a; color:#ffffff; border-color:#16a34a; }
      .wfBtn.primary:hover { background:#15803d; }
      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    </style>
  `;

  const modalHTML = `
    <div id="workflowDetailsModal" style="
      position:fixed; top:0; left:0; width:100vw; height:100vh;
      background:rgba(0,0,0,0.45); backdrop-filter:blur(6px);
      z-index:99999; display:none; align-items:center; justify-content:center;
      font-family:system-ui,sans-serif;
    ">
      <div style="
        background:#ffffff;
        border:2px solid #16a34a;
        box-shadow:0 25px 50px -12px rgba(0,0,0,0.2), 0 0 30px rgba(22,163,74,0.1);
        border-radius:16px; width:520px; max-width:92%; max-height:85vh;
        display:flex; flex-direction:column; color:#111827;
        animation: wfModalFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      ">
        <!-- Header -->
        <div style="padding:20px; border-bottom:1px solid #d1fae5;
          display:flex; align-items:center; justify-content:space-between; background:#f0fdf4; border-radius:14px 14px 0 0;">
          <div style="flex:1; min-width:0; margin-right:12px;">
            <h2 id="modalWfName" style="margin:0; font-size:17px; font-weight:700; color:#14532d;
              overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Workflow Details</h2>
            <div id="modalWfSub" style="font-size:11px; color:#16a34a; margin-top:2px;">Sub</div>
          </div>
          <button onclick="closeWorkflowDetailsModal()" style="background:none; border:none;
            color:#6b7280; cursor:pointer; font-size:18px; padding:4px 8px; border-radius:6px; transition:color 0.2s;">✕</button>
        </div>

        <!-- Scrollable content -->
        <div id="modalWfContent" style="flex:1; overflow-y:auto; padding:20px; scrollbar-width:thin;
          scrollbar-color:#86efac transparent;">
          <!-- Filled dynamically -->
        </div>

        <!-- Footer Actions -->
        <div id="modalWfFooter" style="padding:15px 20px; border-top:1px solid #d1fae5;
          background:#f0fdf4; border-radius:0 0 14px 14px; display:flex; justify-content:end; gap:8px;">
          <!-- Filled dynamically -->
        </div>
      </div>
    </div>

    <style>
      @keyframes wfModalFadeIn {
        from { opacity:0; transform:scale(0.95) translateY(10px); }
        to { opacity:1; transform:scale(1) translateY(0); }
      }
      #workflowDetailsModal button:hover {
        filter: brightness(1.15);
      }
      .modalTimelineStep {
        display:flex; gap:12px; position:relative; padding-bottom:20px;
      }
      .modalTimelineStep:last-child {
        padding-bottom:0;
      }
      .modalTimelineStep::after {
        content:''; position:absolute; left:11px; top:24px; bottom:0; width:2px;
        background:#bbf7d0;
      }
      .modalTimelineStep:last-child::after {
        display:none;
      }
      .modalStepDot {
        width:24px; height:24px; border-radius:50%; background:#dcfce7;
        border:1.5px solid #16a34a; display:flex; align-items:center;
        justify-content:center; font-size:10px; font-weight:700; color:#15803d; z-index:2;
        flex-shrink: 0;
      }
      .modalStepBody {
        flex:1; background:#f9fafb; border:1px solid #e5e7eb;
        border-radius:8px; padding:10px 12px; min-width:0; color:#111827;
      }
    </style>
  `;

  document.body.insertAdjacentHTML('beforeend', panelHTML);
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  let panelOpen = false;
  let cachedWorkflows = [];
  let cachedSchedules = [];

  function formatScheduleText(s) {
    if (s.frequency === 'daily') {
      return `🔁 Everyday at ${s.scheduled_time}`;
    }
    if (s.frequency === 'weekly') {
      const dayNames = (s.days_of_week || '').split(',')
        .map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parseInt(d, 10)])
        .filter(Boolean)
        .join(', ');
      return `🔁 Weekly (${dayNames}) at ${s.scheduled_time}`;
    }
    return `📅 Scheduled: ${new Date(s.scheduled_time).toLocaleString()}`;
  }

  function getScheduleFormHTML(wfId, prefix) {
    const freqId = `${prefix}ScheduleFreq_${wfId}`;
    const onceContainerId = `${prefix}OnceContainer_${wfId}`;
    const timeContainerId = `${prefix}TimeContainer_${wfId}`;
    const daysContainerId = `${prefix}DaysContainer_${wfId}`;
    const inputOnceId = `${prefix}ScheduleInputOnce_${wfId}`;
    const inputTimeId = `${prefix}ScheduleInputTime_${wfId}`;
    const confirmFn = prefix === 'modal' ? `modalWfConfirmSchedule('${wfId}')` : `wfConfirmSchedule('${wfId}')`;

    return `
      <div style="font-size:11px; color:#15803d; font-weight:600; margin-bottom:8px;">Configure Schedule Plan:</div>
      <div style="display:flex; flex-direction:column; gap:8px;">
        <!-- Frequency Selection -->
        <div style="display:flex; gap:6px;">
        <select id="${freqId}" onchange="wfOnFrequencyChange('${wfId}', '${prefix}')" style="background:#ffffff; border:1px solid #86efac; border-radius:6px; color:#111827; padding:4px 8px; font-size:11px; outline:none; cursor:pointer; width:100%;">
            <option value="once" style="background:#fff; color:#111; font-size:13px;">Once</option>
            <option value="daily" style="background:#fff; color:#111; font-size:13px;">Everyday</option>
            <option value="weekly" style="background:#fff; color:#111; font-size:13px;">Specific Days</option>
          </select>
        </div>

        <!-- Once Target (Datetime) -->
        <div id="${onceContainerId}" style="display:block;">
          <input type="datetime-local" id="${inputOnceId}" style="width:100%; background:#ffffff; border:1px solid #86efac; border-radius:6px; color:#111827; padding:4px 8px; font-size:12px; outline:none; box-sizing:border-box;">
        </div>

        <!-- Everyday/Weekly Target (Time) -->
        <div id="${timeContainerId}" style="display:none;">
          <input type="time" id="${inputTimeId}" style="width:100%; background:#ffffff; border:1px solid #86efac; border-radius:6px; color:#111827; padding:4px 8px; font-size:12px; outline:none; box-sizing:border-box;">
        </div>

        <!-- Weekly Days Checkboxes -->
        <div id="${daysContainerId}" style="display:none; background:#f0fdf4; border-radius:6px; padding:8px; border:1px solid #bbf7d0;">
          <div style="font-size:10px; color:#15803d; font-weight:600; margin-bottom:6px;">Days of Week:</div>
          <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px;">
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="1" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Mon
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="2" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Tue
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="3" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Wed
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="4" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Thu
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="5" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Fri
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="6" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Sat
            </label>
            <label style="display:flex; align-items:center; gap:4px; font-size:10px; color:#374151; cursor:pointer;">
              <input type="checkbox" value="0" class="${prefix}DayCheckbox_${wfId}" style="accent-color:#16a34a;"> Sun
            </label>
          </div>
        </div>

        <button class="wfBtn primary" style="padding:6px 12px; font-size:12px; align-self:flex-end;" onclick="${confirmFn}">Save Plan</button>
      </div>
    `;
  }

  const searchInput = document.getElementById('wfSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        displayWorkflows(cachedWorkflows);
        return;
      }
      const filtered = cachedWorkflows.filter(wf => {
        const nameMatch = wf.name?.toLowerCase().includes(query);
        const stepsMatch = (wf.steps || []).some(s =>
          s.command?.toLowerCase().includes(query) ||
          s.app?.toLowerCase().includes(query)
        );
        return nameMatch || stepsMatch;
      });
      displayWorkflows(filtered, query);
    });
  }

  window.toggleWorkflowPanel = function () {
    panelOpen = !panelOpen;
    const panel = document.getElementById('workflowsPanel');
    const side = localStorage.getItem('workflows_side') || 'right';
    if (side === 'left') {
      panel.style.left = panelOpen ? '0' : '-380px';
    } else {
      panel.style.right = panelOpen ? '0' : '-380px';
    }
    if (panelOpen) {
      loadWorkflows();
      checkActiveRecordingOnOpen();
    }
  };

  window.closeWorkflowDetailsModal = function () {
    document.getElementById('workflowDetailsModal').style.display = 'none';
  };

  window.showWorkflowDetails = async function (workflowId) {
    try {
      const res = await fetch('/api/cognitive/workflows');
      const data = await res.json();
      const wf = (data.workflows || []).find(w => w.id === workflowId);
      if (!wf) return;

      const modal = document.getElementById('workflowDetailsModal');
      const modalWfName = document.getElementById('modalWfName');
      const modalWfSub = document.getElementById('modalWfSub');
      const modalWfContent = document.getElementById('modalWfContent');
      const modalWfFooter = document.getElementById('modalWfFooter');

      const isPinned = !!wf.is_pinned;
      const pinColor = isPinned ? '#fbbf24' : '#475569';
      modalWfName.innerHTML = `
        <span style="display:inline-flex; align-items:center; gap:8px;">
          ${esc(wf.name)}
          <button onclick="modalWfTogglePin('${wf.id}', ${isPinned})" style="
            background:none; border:none; color:${pinColor}; cursor:pointer; font-size:16px;
            padding:2px; transition:color 0.15s; outline:none;" title="${isPinned ? 'Unpin Workflow' : 'Pin Workflow'}">
            📌
          </button>
        </span>
      `;
      modalWfName.title = wf.name;

      const pct = wf.confidence_pct || 0;
      const isReady = wf.is_suggestible || (pct >= 82 && wf.times_observed >= 4);
      const isLearning = !isReady && wf.times_observed >= 3;
      const badgeClass = isReady ? 'wfBadgeHigh' : isLearning ? 'wfBadgeMed' : 'wfBadgeLow';
      const badgeLabel = isReady ? '✓ READY' : isLearning ? '~ LEARNING' : '◌ OBSERVING';

      modalWfSub.textContent = `ID: ${wf.id}`;

      // Stats Section
      let contentHTML = `
        <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:20px;">
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px; text-align:center;">
            <div style="font-size:10px; color:#64748b;">Confidence</div>
            <div style="font-size:15px; font-weight:700; color:#16a34a; margin-top:2px;">${pct}%</div>
          </div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px; text-align:center;">
            <div style="font-size:10px; color:#64748b;">Observations</div>
            <div style="font-size:15px; font-weight:700; color:#111827; margin-top:2px;">${wf.times_observed}x</div>
          </div>
          <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:8px; text-align:center;">
            <div style="font-size:10px; color:#15803d;">Executed</div>
            <div style="font-size:15px; font-weight:700; color:#16a34a; margin-top:2px;">${wf.execution_count || 0}x</div>
          </div>
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:8px; text-align:center; display:flex; flex-direction:column; justify-content:center; align-items:center;">
            <div style="font-size:10px; color:#64748b; margin-bottom:2px;">Status</div>
            <span class="wfBadge ${badgeClass}" style="margin:0;">${badgeLabel}</span>
          </div>
        </div>
      `;

      if (wf.version >= 3 && wf.plans && wf.plans[0]?.graph) {
        const branches = wf.plans.length;
        const totalNodes = Object.keys(wf.plans[0].graph.nodes || {}).length;
        contentHTML += `<div style="margin-bottom:15px; padding:10px; background:#e0e7ff; border:1px solid #c7d2fe; border-radius:8px;">
          <div style="font-size:12px; font-weight:600; color:#3730a3; margin-bottom:4px;">V3 Graph Traversal Pattern</div>
          <div style="font-size:11px; color:#4f46e5;">Contains ${branches} known branch(es) with ${totalNodes} recorded states.</div>
        </div>`;
      }

      contentHTML += `
        <h3 style="font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:#94a3b8; margin:0 0 12px 0;">Workflow Sequence</h3>
        <div style="display:flex; flex-direction:column; gap:0;">
      `;

      // Timeline Steps Section
      const steps = wf.active_plan?.steps || wf.steps || [];
      if (!steps.length) {
        contentHTML += `<div style="color:#64748b; font-size:12px; font-style:italic; text-align:center; padding:15px 0;">No steps recorded.</div>`;
      } else {
        steps.forEach((step, idx) => {
          let typeLabel = 'Action';
          let typeColor = '#6d28d9';
          let typeBg = 'rgba(109,40,217,0.1)';
          let stepContent = '';

          if (step.event_type === 'terminal_command' || step.command) {
            typeLabel = 'CMD';
            typeColor = '#059669';
            typeBg = 'rgba(5,150,105,0.1)';
            stepContent = `<code style="font-family:monospace; font-size:11px; color:#111827; background:rgba(0,0,0,0.05); padding:2px 4px; border-radius:4px; word-break:break-all; display:block;">${esc(step.command || '')}</code>`;
          } else if (step.event_type === 'natural_command') {
            typeLabel = 'PULSE';
            typeColor = '#2563eb';
            typeBg = 'rgba(37,99,235,0.1)';
            stepContent = `<div style="font-size:12px; color:#1e3a8a; font-style:italic;">"${esc(step.command || '')}"</div>`;
          } else if (step.app) {
            typeLabel = 'APP';
            typeColor = '#db2777';
            typeBg = 'rgba(219,39,119,0.1)';
            stepContent = `<div style="font-size:12px; font-weight:500; color:#111827;">Focus app: <span style="color:#db2777;">${esc(step.app)}</span></div>`;
          } else {
            typeLabel = step.event_type ? step.event_type.toUpperCase() : 'EVENT';
            typeColor = '#475569';
            stepContent = `<div style="font-size:11px; color:#111827; font-family:monospace; word-break:break-all;">${esc(JSON.stringify(step))}</div>`;
          }

          contentHTML += `
            <div class="modalTimelineStep">
              <div class="modalStepDot" style="border-color:${typeColor}; color:${typeColor}; background:${typeBg};">${idx + 1}</div>
              <div class="modalStepBody">
                <div style="display:flex; justify-content:space-between; margin-bottom:4px; align-items:center;">
                  <span style="font-size:10px; font-weight:700; color:${typeColor}; text-transform:uppercase; letter-spacing:0.5px;">${typeLabel}</span>
                  ${step.app && step.event_type === 'terminal_command' ? `<span style="font-size:9px; color:#64748b;">in ${esc(step.app)}</span>` : ''}
                </div>
                <div>${stepContent}</div>
              </div>
            </div>
          `;
        });
      }

      contentHTML += `</div>`;

      // Check if there is an active schedule
      const activeSchedule = (cachedSchedules || []).find(s => s.workflow_id === wf.id && s.status === 'pending');
      let scheduleSectionHTML = '';
      if (activeSchedule) {
        const text = formatScheduleText(activeSchedule);
        scheduleSectionHTML = `
          <div style="margin-top:15px; padding:12px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <div style="font-size:11px; color:#d97706; font-weight:600;">📅 Upcoming Execution</div>
              <div style="font-size:13px; color:#111827; margin-top:2px;">${text}</div>
            </div>
            <button class="wfBtn" style="padding:5px 10px; font-size:11px; border-color:rgba(239,68,68,0.3); color:#dc2626;" onclick="modalWfCancelSchedule('${activeSchedule.id}', '${wf.id}')">Cancel</button>
          </div>
        `;
      } else {
        scheduleSectionHTML = `
          <div id="modalScheduleForm_${wf.id}" style="display:none; margin-top:15px; padding:12px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px;" onclick="event.stopPropagation();">
            ${getScheduleFormHTML(wf.id, 'modal')}
          </div>
        `;
      }

      contentHTML += scheduleSectionHTML;
      modalWfContent.innerHTML = contentHTML;

      // Footer Section
      let footerHTML = `
        <button onclick="closeWorkflowDetailsModal()" class="wfBtn" style="padding:7px 14px; font-size:12px;">
          Close
        </button>
        ${!activeSchedule ? `
        <button onclick="modalWfToggleScheduleForm('${wf.id}')" class="wfBtn" style="padding:7px 14px; font-size:12px; color:#a78bfa; border-color:rgba(124,58,237,0.2);">
          📅 Schedule
        </button>
        ` : ''}
        <button onclick="modalWfRename('${wf.id}', '${esc(wf.name)}')" class="wfBtn" style="padding:7px 14px; font-size:12px; color:#fbbf24; border-color:rgba(245,158,11,0.2);">
          ✏ Rename
        </button>
        <button onclick="modalWfDelete('${wf.id}')" class="wfBtn" style="padding:7px 14px; font-size:12px; color:#ef4444; border-color:rgba(239,68,68,0.2);">
          🗑 Forget
        </button>
      `;

      if (wf.is_suggestible) {
        footerHTML += `
          <button onclick="modalWfRun('${wf.id}')" class="wfBtn primary" style="padding:7px 14px; font-size:12px;">
            ▶ Run Now
          </button>
        `;
      }
      modalWfFooter.innerHTML = footerHTML;

      modal.style.display = 'flex';
    } catch (err) {
      console.error('Failed to render workflow details:', err);
    }
  };

  window.modalWfRun = function (id) {
    window.wfRun(id);
    window.closeWorkflowDetailsModal();
  };

  window.modalWfRename = async function (id, current) {
    const name = prompt('Rename workflow:', current);
    if (!name || name === current) return;
    try {
      const res = await fetch('/api/cognitive/workflow-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workflow_id: id, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to rename workflow.');
      }
    } catch (err) {
      alert('Error renaming workflow: ' + err.message);
    }
    // Refresh parent panel
    loadWorkflows();
    // Refresh modal title
    const modalWfName = document.getElementById('modalWfName');
    if (modalWfName) {
      modalWfName.textContent = name;
      modalWfName.title = name;
    }
  };

  window.modalWfDelete = async function (id) {
    if (!confirm('Forget this workflow? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/cognitive/workflow-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workflow_id: id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete workflow.');
      }
    } catch (err) {
      alert('Error deleting workflow: ' + err.message);
    }
    loadWorkflows();
    window.closeWorkflowDetailsModal();
  };

  async function loadWorkflows() {
    try {
      const schedRes = await fetch('/api/cognitive/schedules');
      const schedData = await schedRes.json();
      cachedSchedules = schedData.schedules || [];

      const res = await fetch('/api/cognitive/workflows');
      const data = await res.json();
      cachedWorkflows = data.workflows || [];
      const searchVal = document.getElementById('wfSearchInput')?.value || '';
      if (searchVal) {
        const query = searchVal.toLowerCase().trim();
        const filtered = cachedWorkflows.filter(wf => {
          const nameMatch = wf.name?.toLowerCase().includes(query);
          const stepsMatch = (wf.steps || []).some(s =>
            s.command?.toLowerCase().includes(query) ||
            s.app?.toLowerCase().includes(query)
          );
          return nameMatch || stepsMatch;
        });
        displayWorkflows(filtered, query);
      } else {
        displayWorkflows(cachedWorkflows);
      }
    } catch {
      document.getElementById('workflowList').innerHTML =
        `<div style="color:#ef4444;font-size:13px;text-align:center;margin-top:40px;">
          Failed to load workflows</div>`;
    }
  }

  function renderWorkflows(workflows) {
    cachedWorkflows = workflows;
    displayWorkflows(workflows);
  }

  function displayWorkflows(workflows, query = '') {
    const list = document.getElementById('workflowList');
    const subtitle = document.getElementById('wfSubtitle');

    if (!workflows.length) {
      if (query) {
        list.innerHTML = `
          <div style="color:#64748b;font-size:13px;text-align:center;margin-top:40px;">
            No workflows match "${esc(query)}"
          </div>`;
      } else {
        list.innerHTML = `
          <div style="color:#475569;font-size:13px;text-align:center;margin-top:40px;line-height:1.8;">
            No workflows learned yet.<br>
            <span style="font-size:11px;">Use your computer normally.<br>
            Patterns appear here automatically.</span>
          </div>`;
      }
      subtitle.textContent = '0 workflows';
      return;
    }

    const suggestible = workflows.filter(w => w.is_suggestible).length;
    subtitle.textContent = `${workflows.length} learned · ${suggestible} ready to automate`;

    list.innerHTML = [...workflows]
      .sort((a, b) => {
        if (a.is_pinned && !b.is_pinned) return -1;
        if (!a.is_pinned && b.is_pinned) return 1;
        return b.confidence - a.confidence;
      })
      .map(wf => renderCard(wf))
      .join('');
  }

  function renderCard(wf) {
    const pct = wf.confidence_pct || 0;
    const isReady = wf.is_suggestible || (pct >= 82 && wf.times_observed >= 4);
    const isLearning = !isReady && wf.times_observed >= 3;
    const badgeClass = isReady ? 'wfBadgeHigh' : isLearning ? 'wfBadgeMed' : 'wfBadgeLow';
    const badgeLabel = isReady ? '✓ READY' : isLearning ? '~ LEARNING' : '◌ OBSERVING';

    const barColor = isReady
      ? 'linear-gradient(90deg,#16a34a,#15803d)'
      : isLearning ? 'linear-gradient(90deg,#d97706,#b45309)' : '#d1d5db';

    const planTags = (wf.plans || [])
      .map(p => `<span class="wfPlanTag">Plan ${p.label} (${Math.round((p.confidence || 0) * 100)}%)</span>`)
      .join('');

    const steps = (wf.active_plan?.steps || wf.steps || [])
      .slice(0, 4)
      .map(s => s?.command || s?.app || s?.event_type || '')
      .filter(Boolean)
      .join(' → ');

    const eid = wf.id.replace(/-/g, '_');
    const pinColor = wf.is_pinned ? '#d97706' : '#9ca3af';

    const activeSchedule = (cachedSchedules || []).find(s => s.workflow_id === wf.id && s.status === 'pending');
    let scheduleBanner = '';
    if (activeSchedule) {
      const schedText = formatScheduleText(activeSchedule);
      scheduleBanner = `
        <div style="margin-top:10px; padding:6px 10px; background:#fef9c3; border:1px solid #fde047; border-radius:8px; display:flex; justify-content:space-between; align-items:center;" onclick="event.stopPropagation();">
          <span style="font-size:11px; color:#a16207;">${schedText}</span>
          <button class="wfBtn" style="padding:2px 6px; font-size:10px; border-color:#fca5a5; color:#dc2626;" onclick="wfCancelSchedule('${activeSchedule.id}')">Cancel</button>
        </div>
      `;
    }

    return `
      <div class="wfCard ${wf.is_pinned ? 'pinned' : wf.is_suggestible ? 'suggestible' : ''}" id="wfCard_${wf.id}" onclick="showWorkflowDetails('${wf.id}')" style="cursor:pointer;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;">
          <div style="color:#111827;font-size:13px;font-weight:600;flex:1;margin-right:8px; display:inline-flex; align-items:center; gap:6px;">
            ${esc(wf.name)}
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            ${wf.version >= 3 ? `<span class="wfBadge" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">V3 Graph</span>` : ''}
            <button onclick="event.stopPropagation(); wfTogglePin('${wf.id}', ${wf.is_pinned})" style="
              background:none; border:none; color:${pinColor}; cursor:pointer; font-size:14px;
              padding:2px; transition:color 0.15s; outline:none;" title="${wf.is_pinned ? 'Unpin Workflow' : 'Pin Workflow'}">
              📌
            </button>
            <span class="wfBadge ${badgeClass}">${badgeLabel}</span>
          </div>
        </div>
        <div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span style="color:#6b7280;font-size:11px;">Confidence</span>
            <span style="color:#374151;font-size:11px;font-weight:600;">${pct}%</span>
          </div>
          <div style="background:#e5e7eb;border-radius:4px;height:4px;overflow:hidden;">
            <div style="background:${barColor};height:100%;width:${pct}%;border-radius:4px;transition:width 0.5s;"></div>
          </div>
        </div>
        ${steps ? `<div style="color:#6b7280;font-size:11px;margin-bottom:8px;font-family:monospace;
          background:#f0fdf4;border-radius:6px;padding:6px 8px;border:1px solid #bbf7d0;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(steps)}</div>` : ''}
        <div style="display:flex;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
          <span style="color:#6b7280;font-size:10px;" title="Times Observed">👁 ${wf.times_observed}x</span>
          <span style="color:#6b7280;font-size:10px;" title="Times Confirmed">✓ ${wf.times_confirmed}</span>
          <span style="color:#6b7280;font-size:10px;" title="Times Rejected">✗ ${wf.times_rejected}</span>
          ${wf.version >= 3 ? `<span style="color:#15803d;font-size:10px;font-weight:600;" title="Execution Count">▶ Executed: ${wf.execution_count || 0}x</span>` : ''}
          ${wf.average_execution_duration ? `<span style="color:#6b7280;font-size:10px;" title="Average Execution Duration">⏱ ${Math.round(wf.average_execution_duration)}ms</span>` : ''}
        </div>
        ${planTags ? `<div style="margin-bottom:10px;">${planTags}</div>` : ''}
        ${scheduleBanner}
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;">
          ${wf.is_suggestible ? `<button class="wfBtn primary" onclick="event.stopPropagation(); wfRun('${wf.id}')">▶ Run Now</button>` : ''}
          <button class="wfBtn" onclick="event.stopPropagation(); wfToggleScheduleForm('${wf.id}')">📅 Schedule</button>
          <button class="wfBtn" onclick="event.stopPropagation(); wfRename('${wf.id}','${esc(wf.name)}')">✏ Rename</button>
          <button class="wfBtn" onclick="event.stopPropagation(); wfDelete('${wf.id}')">🗑 Forget</button>
        </div>
        
        <!-- Inline Schedule Form -->
        <div id="scheduleForm_${wf.id}" style="display:none; margin-top:10px; padding:10px; background:#f0fdf4; border-radius:8px; border:1px solid #bbf7d0;" onclick="event.stopPropagation();">
          ${getScheduleFormHTML(wf.id, 'card')}
        </div>
      </div>`;
  }

  window.wfRun = async function (id) {
    const res = await fetch('/api/cognitive/workflow-response', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow_id: id, response: 'yes' })
    });
    const data = await res.json();
    if (window.cognitiveShowSuccess) window.cognitiveShowSuccess(data.message || 'Done!');
  };

  window.wfRename = async function (id, current) {
    const name = prompt('Rename workflow:', current);
    if (!name || name === current) return;
    try {
      const res = await fetch('/api/cognitive/workflow-rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workflow_id: id, name })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to rename workflow.');
      }
    } catch (err) {
      alert('Error renaming workflow: ' + err.message);
    }
    loadWorkflows();
  };

  window.wfDelete = async function (id) {
    if (!confirm('Forget this workflow? This cannot be undone.')) return;
    try {
      const res = await fetch('/api/cognitive/workflow-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workflow_id: id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to delete workflow.');
      } else if (window.cognitiveShowSuccess) {
        window.cognitiveShowSuccess('Workflow forgotten.');
      }
    } catch (err) {
      alert('Error deleting workflow: ' + err.message);
    }
    loadWorkflows();
  };

  window.wfTogglePin = async function (id, currentPinned) {
    try {
      const res = await fetch('/api/cognitive/workflow-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, workflow_id: id, pinned: !currentPinned })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        alert(data.error || 'Failed to update pin state.');
      }
    } catch (err) {
      alert('Error updating pin state: ' + err.message);
    }
    loadWorkflows();
  };

  window.modalWfTogglePin = async function (id, currentPinned) {
    await window.wfTogglePin(id, currentPinned);
    // Refresh the modal to reflect the new state
    setTimeout(() => {
      window.showWorkflowDetails(id);
    }, 100);
  };

  window.wfOnFrequencyChange = function (id, prefix) {
    const freqEl = document.getElementById(`${prefix}ScheduleFreq_${id}`);
    const freq = freqEl ? freqEl.value : 'once';
    const onceEl = document.getElementById(`${prefix}OnceContainer_${id}`);
    const timeEl = document.getElementById(`${prefix}TimeContainer_${id}`);
    const daysEl = document.getElementById(`${prefix}DaysContainer_${id}`);

    if (onceEl) onceEl.style.display = freq === 'once' ? 'block' : 'none';
    if (timeEl) timeEl.style.display = freq !== 'once' ? 'block' : 'none';
    if (daysEl) daysEl.style.display = freq === 'weekly' ? 'block' : 'none';
  };

  function collectScheduleData(id, prefix) {
    const freqEl = document.getElementById(`${prefix}ScheduleFreq_${id}`);
    const freq = freqEl ? freqEl.value : 'once';

    if (freq === 'once') {
      const inputOnce = document.getElementById(`${prefix}ScheduleInputOnce_${id}`);
      if (!inputOnce || !inputOnce.value) {
        alert('Please select a valid date and time.');
        return null;
      }
      return { scheduled_time: new Date(inputOnce.value).toISOString(), frequency: 'once', days_of_week: null };
    } else {
      const inputTime = document.getElementById(`${prefix}ScheduleInputTime_${id}`);
      if (!inputTime || !inputTime.value) {
        alert('Please select a time.');
        return null;
      }
      if (freq === 'weekly') {
        const checkboxes = document.querySelectorAll(`.${prefix}DayCheckbox_${id}:checked`);
        if (checkboxes.length === 0) {
          alert('Please select at least one day of the week.');
          return null;
        }
        const days = Array.from(checkboxes).map(cb => cb.value).join(',');
        return { scheduled_time: inputTime.value, frequency: 'weekly', days_of_week: days };
      }
      // daily
      return { scheduled_time: inputTime.value, frequency: 'daily', days_of_week: null };
    }
  }

  window.wfToggleScheduleForm = function (id) {
    const el = document.getElementById(`scheduleForm_${id}`);
    if (el) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
  };

  window.wfConfirmSchedule = async function (id) {
    const data = collectScheduleData(id, 'card');
    if (!data) return;
    try {
      const res = await fetch('/api/cognitive/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: id, ...data })
      });
      const resData = await res.json();
      if (resData.success) {
        if (window.cognitiveShowSuccess) {
          window.cognitiveShowSuccess('Schedule saved!');
        }
        loadWorkflows();
      } else {
        alert('Failed to schedule: ' + (resData.error || 'unknown error'));
      }
    } catch (err) {
      alert('Error scheduling workflow: ' + err.message);
    }
  };

  window.wfCancelSchedule = async function (scheduleId) {
    if (!confirm('Are you sure you want to cancel this schedule?')) return;
    try {
      const res = await fetch('/api/cognitive/schedule/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: scheduleId })
      });
      const resData = await res.json();
      if (resData.success) {
        loadWorkflows();
      } else {
        alert('Failed to cancel schedule: ' + (resData.error || 'unknown error'));
      }
    } catch (err) {
      alert('Error cancelling schedule: ' + err.message);
    }
  };

  window.modalWfToggleScheduleForm = function (id) {
    const el = document.getElementById(`modalScheduleForm_${id}`);
    if (el) {
      el.style.display = el.style.display === 'none' ? 'block' : 'none';
    }
  };

  window.modalWfConfirmSchedule = async function (id) {
    const data = collectScheduleData(id, 'modal');
    if (!data) return;
    try {
      const res = await fetch('/api/cognitive/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow_id: id, ...data })
      });
      const resData = await res.json();
      if (resData.success) {
        await loadWorkflows();
        await showWorkflowDetails(id);
      } else {
        alert('Failed to schedule: ' + (resData.error || 'unknown error'));
      }
    } catch (err) {
      alert('Error scheduling workflow: ' + err.message);
    }
  };

  window.modalWfCancelSchedule = async function (scheduleId, workflowId) {
    if (!confirm('Are you sure you want to cancel this schedule?')) return;
    try {
      const res = await fetch('/api/cognitive/schedule/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_id: scheduleId })
      });
      const resData = await res.json();
      if (resData.success) {
        await loadWorkflows();
        await showWorkflowDetails(workflowId);
      } else {
        alert('Failed to cancel schedule: ' + (resData.error || 'unknown error'));
      }
    } catch (err) {
      alert('Error cancelling schedule: ' + err.message);
    }
  };

  // Called by avatar.js when a suggestion fires — highlight card in panel
  window.cognitiveHighlightWorkflow = function (workflowId) {
    if (!panelOpen) return;
    const card = document.getElementById(`wfCard_${workflowId}`);
    if (!card) return;
    card.classList.add('highlighted');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => card.classList.remove('highlighted'), 3000);
  };

  let recordingInterval = null;

  window.startRecordingWorkflow = async function () {
    try {
      const res = await fetch('/api/cognitive/recording/start', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        document.getElementById('creatorIdleState').style.display = 'none';
        document.getElementById('creatorActiveState').style.display = 'flex';
        document.getElementById('workflowRecordName').value = '';
        document.getElementById('recordingStepsPreview').innerHTML = '<div style="color:#475569; text-align:center;">Perform actions to record steps...</div>';
        document.getElementById('recordingStepCount').textContent = '0 steps captured';

        // Start polling for recording status/steps to update preview
        if (recordingInterval) clearInterval(recordingInterval);
        recordingInterval = setInterval(updateRecordingStatus, 1500);
      }
    } catch (err) {
      alert('Failed to start recording: ' + err.message);
    }
  };

  async function updateRecordingStatus() {
    try {
      const res = await fetch('/api/cognitive/recording/status');
      const data = await res.json();
      if (data.isRecording) {
        const preview = document.getElementById('recordingStepsPreview');
        const countSpan = document.getElementById('recordingStepCount');
        countSpan.textContent = `${data.eventCount} steps captured`;

        if (data.events && data.events.length > 0) {
          preview.innerHTML = data.events.map(e => {
            const desc = e.command || e.filepath || e.app || e.event_type;
            const typeLabel = e.event_type === 'terminal_command' ? 'CMD' :
              e.event_type === 'natural_command' ? 'PULSE' : 'ACT';
            return `<div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              <span style="color:#34d399;font-weight:600;">[${typeLabel}]</span> ${esc(desc)}
            </div>`;
          }).join('');
          // Scroll to bottom of preview
          preview.scrollTop = preview.scrollHeight;
        } else {
          preview.innerHTML = '<div style="color:#475569; text-align:center;">Perform actions to record steps...</div>';
        }
      } else {
        resetRecordingUI();
      }
    } catch (err) {
      console.error('Failed to get recording status:', err);
    }
  }

  function resetRecordingUI() {
    if (recordingInterval) {
      clearInterval(recordingInterval);
      recordingInterval = null;
    }
    document.getElementById('creatorIdleState').style.display = 'block';
    document.getElementById('creatorActiveState').style.display = 'none';
  }

  window.cancelRecordingWorkflow = async function () {
    try {
      await fetch('/api/cognitive/recording/cancel', { method: 'POST' });
      resetRecordingUI();
    } catch (err) {
      console.error('Failed to cancel recording:', err);
    }
  };

  window.stopRecordingWorkflow = async function () {
    const nameInput = document.getElementById('workflowRecordName');
    const name = nameInput.value.trim();
    if (!name) {
      alert('Please enter a name for the workflow.');
      nameInput.focus();
      return;
    }

    try {
      const res = await fetch('/api/cognitive/recording/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (window.cognitiveShowSuccess) {
          window.cognitiveShowSuccess(`Saved workflow "${name}" successfully!`);
        } else if (window.showToast) {
          window.showToast('Workflow Saved', `Saved manual workflow "${name}"`);
        } else {
          alert(`Saved workflow "${name}" successfully!`);
        }
        resetRecordingUI();
        loadWorkflows();
      } else {
        alert(data.error || 'Failed to save workflow.');
      }
    } catch (err) {
      alert('Failed to stop recording: ' + err.message);
    }
  };

  async function checkActiveRecordingOnOpen() {
    try {
      const res = await fetch('/api/cognitive/recording/status');
      const data = await res.json();
      if (data.isRecording) {
        document.getElementById('creatorIdleState').style.display = 'none';
        document.getElementById('creatorActiveState').style.display = 'flex';
        document.getElementById('recordingStepCount').textContent = `${data.eventCount} steps captured`;

        if (recordingInterval) clearInterval(recordingInterval);
        recordingInterval = setInterval(updateRecordingStatus, 1500);
        updateRecordingStatus();
      } else {
        resetRecordingUI();
      }
    } catch (err) {
      console.error(err);
    }
  }

  function esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Workflows panel side manager
  let currentSide = localStorage.getItem('workflows_side') || 'right';

  window.setWorkflowsSide = function (side) {
    currentSide = side;
    localStorage.setItem('workflows_side', side);

    const panel = document.getElementById('workflowsPanel');
    const toggleBtn = document.getElementById('workflowToggleBtn');

    if (side === 'left') {
      panel.style.right = 'auto';
      panel.style.borderLeft = 'none';
      panel.style.borderRight = '1px solid rgba(120,80,255,0.3)';
      panel.style.left = panelOpen ? '0' : '-380px';

      toggleBtn.style.right = 'auto';
      toggleBtn.style.left = '0';
      toggleBtn.style.borderRadius = '0 8px 8px 0';
    } else {
      panel.style.left = 'auto';
      panel.style.borderRight = 'none';
      panel.style.borderLeft = '1px solid rgba(120,80,255,0.3)';
      panel.style.right = panelOpen ? '0' : '-380px';

      toggleBtn.style.left = 'auto';
      toggleBtn.style.right = '0';
      toggleBtn.style.borderRadius = '8px 0 0 8px';
    }
  };

  // Dragging logic for the toggle button
  const toggleBtn = document.getElementById('workflowToggleBtn');
  let isDraggingToggle = false;
  let toggleOffsetX = 0;
  let toggleStartX = 0;
  let toggleStartY = 0;

  toggleBtn.addEventListener('mousedown', (e) => {
    isDraggingToggle = true;
    toggleStartX = e.clientX;
    toggleStartY = e.clientY;

    const rect = toggleBtn.getBoundingClientRect();
    toggleOffsetX = e.clientX - rect.left;

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingToggle) return;

    let x = e.clientX - toggleOffsetX;
    x = Math.max(0, Math.min(x, window.innerWidth - 30));

    toggleBtn.style.left = `${x}px`;
    toggleBtn.style.right = 'auto';
  });

  document.addEventListener('mouseup', (e) => {
    if (isDraggingToggle) {
      isDraggingToggle = false;

      const x = e.clientX;
      const isLeft = x < window.innerWidth / 2;
      window.setWorkflowsSide(isLeft ? 'left' : 'right');
    }
  });

  // Overwrite toggle click to check drag threshold
  toggleBtn.removeAttribute('onclick');
  toggleBtn.addEventListener('click', (e) => {
    if (Math.abs(e.clientX - toggleStartX) > 5 || Math.abs(e.clientY - toggleStartY) > 5) {
      return;
    }
    toggleWorkflowPanel();
  });

  // Initialize side on start
  window.setWorkflowsSide(currentSide);

  // Expose loadWorkflows globally to allow real-time updates
  window.loadWorkflows = loadWorkflows;

  console.log('[CognitiveOS] Workflows panel initialized');
})();
