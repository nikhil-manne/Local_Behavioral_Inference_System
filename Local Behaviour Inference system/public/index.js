// Pulse System Portal Frontend Javascript

let selectedItem = null;
let currentFilter = 'all';
let searchDebounceTimeout = null;
let currentCmdId = null;
let systemGraph = null;
let workflowsGraph = null;
let currentTreeItems = [];
let focusedTreePath = null;

// Event Source connection
let eventSource = null;

document.addEventListener('DOMContentLoaded', () => {
  initSSE();
  refreshStatus();
  refreshDirs();
  performSearch();
  loadLogs();

  // Initialize dynamic canvas graph
  systemGraph = new SystemGraph('graph-canvas');
  workflowsGraph = new WorkflowGraph('wf-graph-canvas');

  // Search input events
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      performSearch();
    }, 300);
  });

  // Filter tabs events
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      performSearch();
    });
  });

  // Stat cards click to filter
  const statCards = document.querySelectorAll('.stat-card');
  statCards.forEach(card => {
    card.addEventListener('click', () => {
      statCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const filterType = card.dataset.type;
      currentFilter = filterType;

      // Update tab UI
      tabs.forEach(tab => {
        if (tab.dataset.filter === filterType) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });

      performSearch();
    });
  });

  // Full scan button
  const btnScan = document.getElementById('btn-full-scan');
  btnScan.addEventListener('click', triggerFullScan);

  // Freddy Avatar Bot Toggle
  const btnToggleAvatar = document.getElementById('btn-toggle-avatar');
  if (btnToggleAvatar) {
    // Fetch initial status to set button label
    fetch('/api/cognitive/avatar/status')
      .then(res => res.json())
      .then(data => {
        btnToggleAvatar.textContent = data.disabled ? 'Enable Freddy' : 'Disable Freddy';
        btnToggleAvatar.dataset.disabled = data.disabled ? 'true' : 'false';
      });

    btnToggleAvatar.addEventListener('click', async () => {
      const isDisabled = btnToggleAvatar.dataset.disabled === 'true';
      const targetState = !isDisabled;
      const res = await fetch('/api/cognitive/avatar/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disabled: targetState })
      });
      const data = await res.json();
      btnToggleAvatar.textContent = data.disabled ? 'Enable Freddy' : 'Disable Freddy';
      btnToggleAvatar.dataset.disabled = data.disabled ? 'true' : 'false';
      showToast('Freddy Bot', data.disabled ? 'Freddy has been disabled.' : 'Freddy has been enabled!');
    });
  }

  // Add Directory Form
  const addDirForm = document.getElementById('add-dir-form');
  addDirForm.addEventListener('submit', handleAddDirectory);

  // Copy path capability
  const pathVal = document.getElementById('selected-path');
  pathVal.addEventListener('click', () => {
    if (selectedItem && selectedItem.path) {
      navigator.clipboard.writeText(selectedItem.path);
      showToast('System Info', 'Path copied to clipboard!');
    }
  });

  // Action Buttons
  document.getElementById('btn-action-open').addEventListener('click', () => runFileAction('open'));
  document.getElementById('btn-action-rename').addEventListener('click', triggerRename);
  document.getElementById('btn-action-delete').addEventListener('click', triggerDelete);

  // Console terminal trigger
  const consoleInput = document.getElementById('console-input');
  consoleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      runConsoleCommand();
    }
  });
  document.getElementById('btn-console-run').addEventListener('click', runConsoleCommand);

  // Macro Links
  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('macro-link')) {
      const template = e.target.dataset.cmd;
      if (selectedItem) {
        const cmd = template.replace(/{path}/g, selectedItem.path.replace(/\\/g, '\\\\'));
        consoleInput.value = cmd;
        runConsoleCommand();
      }
    }
  });

  // Natural language command bar events
  const naturalCmdInput = document.getElementById('natural-command-input');
  naturalCmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      executeNaturalCommand();
    }
  });
  document.getElementById('btn-run-natural-command').addEventListener('click', executeNaturalCommand);

  // Database events
  const dbTableSelect = document.getElementById('db-table-select');
  const dbSearchInput = document.getElementById('db-search-input');
  const dbRefreshBtn = document.getElementById('btn-db-refresh');
  const dbFullscreenBtn = document.getElementById('btn-db-fullscreen');
  const dbContainer = document.getElementById('db-container');

  if (dbTableSelect) {
    dbTableSelect.addEventListener('change', loadDatabaseTable);
  }
  if (dbSearchInput) {
    let dbDebounce = null;
    dbSearchInput.addEventListener('input', () => {
      clearTimeout(dbDebounce);
      dbDebounce = setTimeout(loadDatabaseTable, 300);
    });
  }
  if (dbRefreshBtn) {
    dbRefreshBtn.addEventListener('click', loadDatabaseTable);
  }
  if (dbFullscreenBtn && dbContainer) {
    dbFullscreenBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        dbContainer.requestFullscreen().catch(err => {
          console.error('Failed to enter database fullscreen:', err);
        });
      } else {
        document.exitFullscreen();
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (document.fullscreenElement === dbContainer) {
        dbFullscreenBtn.textContent = 'Exit Full Screen';
        dbContainer.classList.add('fullscreen');
      } else {
        if (dbContainer.classList.contains('fullscreen')) {
          dbFullscreenBtn.textContent = 'Full Screen';
          dbContainer.classList.remove('fullscreen');
        }
      }
    });
  }

  // Workflows Graph search events
  const wfSearchInput = document.getElementById('wf-graph-search-input');
  const wfSearchBtn = document.getElementById('btn-wf-graph-search');
  const wfClearBtn = document.getElementById('btn-wf-graph-search-clear');

  if (wfSearchBtn && wfSearchInput) {
    wfSearchBtn.addEventListener('click', () => {
      if (workflowsGraph) {
        workflowsGraph.searchWorkflows(wfSearchInput.value.trim());
      }
    });
    wfSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (workflowsGraph) {
          workflowsGraph.searchWorkflows(wfSearchInput.value.trim());
        }
      }
    });
  }

  if (wfClearBtn) {
    wfClearBtn.addEventListener('click', () => {
      if (wfSearchInput) wfSearchInput.value = '';
      if (workflowsGraph) {
        workflowsGraph.clearSearch();
      }
    });
  }
});

// INITIALIZE SERVER-SENT EVENTS
function initSSE() {
  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    console.log('SSE Stream established.');
  };

  eventSource.onerror = (err) => {
    console.error('SSE Stream error, reconnecting...', err);
  };

  // Update toggle button on external status changes
  eventSource.addEventListener('avatar-toggle', (e) => {
    try {
      const data = JSON.parse(e.data);
      const btnToggleAvatar = document.getElementById('btn-toggle-avatar');
      if (btnToggleAvatar) {
        btnToggleAvatar.textContent = data.disabled ? 'Enable Freddy' : 'Disable Freddy';
        btnToggleAvatar.dataset.disabled = data.disabled ? 'true' : 'false';
      }
    } catch (err) {}
  });

  // Live Scan progress updates
  eventSource.addEventListener('scan-progress', (e) => {
    const data = JSON.parse(e.data);
    updateScanUI(true, data.progress);
  });

  // Full scan complete
  eventSource.addEventListener('scan-complete', (e) => {
    const data = JSON.parse(e.data);
    updateScanUI(false);
    showToast('System Scan', data.message);
    refreshStatus();
    performSearch();
    loadLogs();
  });

  // Full scan error
  eventSource.addEventListener('scan-error', (e) => {
    const data = JSON.parse(e.data);
    updateScanUI(false);
    showToast('Scan Failed', data.error);
    refreshStatus();
    loadLogs();
  });

  // Dependency Scan Statistics
  eventSource.addEventListener('dependency-scan-complete', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.result && data.result.stats) {
        openDepStatsModal(data.result);
      }
    } catch (err) {
      console.error('Failed to parse dependency scan stats', err);
    }
  });

  // Folder configs change
  eventSource.addEventListener('directory-added', (e) => {
    const data = JSON.parse(e.data);
    refreshDirs();
    showToast('Scanner Config', `Scanning added directory: ${data.alias}`);
  });

  // Live updates to workflows (reinforcements / discoveries)
  eventSource.addEventListener('workflows-changed', (e) => {
    if (window.loadWorkflows) {
      window.loadWorkflows();
    }
    if (workflowsGraph) {
      workflowsGraph.loadData();
    }
  });

  // Scheduled workflow trigger alert
  eventSource.addEventListener('scheduled-trigger', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (typeof showToast === 'function') {
        showToast('Scheduled Workflow', `Triggered scheduled workflow: "${data.workflow_name}"`);
      }
      if (window.loadWorkflows) {
        window.loadWorkflows();
      }
    } catch (err) {}
  });

  // Item deletion update
  eventSource.addEventListener('item-deleted', (e) => {
    const data = JSON.parse(e.data);
    if (selectedItem && selectedItem.path === data.path) {
      closeControlCenter();
    }

    // Trigger particle explosion in visual graph if active
    if (systemGraph) {
      const node = systemGraph.nodes.find(n => n.path.toLowerCase() === data.path.toLowerCase());
      if (node) {
        systemGraph.explodeNode(node.x, node.y, '#ef4444');
      }
    }

    performSearch();
    refreshStatus();
    loadLogs();
  });

  // Item rename update
  eventSource.addEventListener('item-renamed', (e) => {
    const data = JSON.parse(e.data);
    if (selectedItem && selectedItem.path === data.oldPath) {
      selectedItem.path = data.newPath;
      selectedItem.name = data.name;
      loadItemProperties(selectedItem);
    }
    performSearch();
    loadLogs();
  });

  // Item creation update
  eventSource.addEventListener('item-created', (e) => {
    const data = JSON.parse(e.data);
    performSearch();
    refreshStatus();
    loadLogs();
    showToast('File Created', `New file detected: ${data.name}`);
  });

  // Item modification update
  eventSource.addEventListener('item-modified', (e) => {
    const data = JSON.parse(e.data);

    // Trigger a pulse ring in visual graph if active
    if (systemGraph) {
      const node = systemGraph.nodes.find(n => n.path.toLowerCase() === data.path.toLowerCase());
      if (node) {
        node.pulseRadius = 0;
        node.pulseAlpha = 1.0;
        systemGraph.wakeUp();
      }
    }

    if (selectedItem && selectedItem.path.toLowerCase() === data.path.toLowerCase()) {
      loadItemProperties(selectedItem);
    }

    performSearch();
    loadLogs();
  });

  // External system deletion warning (e.g. from File Explorer)
  eventSource.addEventListener('external-deletion-warning', (e) => {
    const data = JSON.parse(e.data);
    if (selectedItem && selectedItem.path === data.path) {
      closeControlCenter();
    }
    // Set a flag to indicate this deletion occurred externally at system level
    data.external = true;
    window.cognitiveShowWarning(data);
    performSearch();
    refreshStatus();
    loadLogs();
  });

  eventSource.addEventListener('cognitive-suggestion', (e) => {
    try {
      const data = JSON.parse(e.data);
      // Show in avatar bubble
      if (window.cognitiveShowSuggestion) {
        window.cognitiveShowSuggestion(data);
      }
      // Highlight in workflows panel if open
      if (window.cognitiveHighlightWorkflow) {
        window.cognitiveHighlightWorkflow(data.workflow_id);
      }
    } catch (err) {
      console.error('[CognitiveOS] Failed to parse suggestion event:', err);
    }
  });

  // Real-time Checkup Notifications (Requirement 3)
  eventSource.addEventListener('checkup-alert', (e) => {
    const data = JSON.parse(e.data);
    const action = data.action; // 'installed' or 'removed'
    const app = data.app;

    // Show a toaster toast notification
    const title = action === 'installed' ? 'New Installation Detected' : 'Application Uninstalled';
    showToast(title, `${app.name} has been ${action === 'installed' ? 'installed and indexed' : 'removed'}.`, action);

    // Insert into live Timeline log view
    appendTimelineLog(action, app);

    // Update inventory stats and grid search results
    refreshStatus();
    performSearch();
  });

  // Live Terminal standard stream pipe
  eventSource.addEventListener('terminal-data', (e) => {
    const data = JSON.parse(e.data);
    if (data.cmdId === currentCmdId) {
      appendConsoleLine(data.text, data.stream);
    }
  });

  // Live Terminal command exit
  eventSource.addEventListener('terminal-exit', (e) => {
    const data = JSON.parse(e.data);
    if (data.cmdId === currentCmdId) {
      appendConsoleLine(`\nProcess exited with status code: ${data.code}`, 'system');
      document.getElementById('console-input').disabled = false;
      document.getElementById('btn-console-run').disabled = false;
    }
  });
}

// REST API WRAPPERS

// Fetch and display status and inventory statistics
async function refreshStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Update indicator
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');

    if (data.isScanning) {
      dot.className = 'status-dot orange';
      text.textContent = 'Scanning...';
      updateScanUI(true, data.currentProgress);
    } else {
      dot.className = 'status-dot green';
      text.textContent = 'Ready';
      updateScanUI(false);
    }

    // Update statistics panel
    document.getElementById('stat-total').textContent = data.stats.total;
    document.getElementById('stat-apps').textContent = data.stats.apps;
    document.getElementById('stat-files').textContent = data.stats.files;
    document.getElementById('stat-folders').textContent = data.stats.folders;
  } catch (err) {
    console.error('Error fetching portal status:', err);
  }
}

// Fetch configured folders
async function refreshDirs() {
  try {
    const res = await fetch('/api/dirs');
    const data = await res.json();
    const list = document.getElementById('directory-list');
    list.innerHTML = '';

    data.directories.forEach(dir => {
      const item = document.createElement('div');
      item.className = 'dir-item';
      item.innerHTML = `
        <div class="dir-info">
          <span class="dir-alias">${dir.alias} (D:${dir.depth})</span>
          <span class="dir-path" title="${dir.path}">${dir.path}</span>
        </div>
        <button class="btn-remove-dir" data-path="${dir.path}" title="Remove Folder">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      `;

      // Remove folder listener
      item.querySelector('.btn-remove-dir').addEventListener('click', (e) => {
        const pathToRemove = e.currentTarget.dataset.path;
        handleDeleteDirectory(pathToRemove);
      });

      list.appendChild(item);
    });
  } catch (err) {
    console.error('Error loading folders:', err);
  }
}

// Fetch checkup timeline log feed
async function loadLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    const feed = document.getElementById('logger-feed');
    feed.innerHTML = '';

    if (data.logs.length === 0) {
      feed.innerHTML = `<div style="color:var(--text-muted); font-size:0.7rem; text-align:center; padding:10px;">No recent scanner logs.</div>`;
      return;
    }

    data.logs.forEach(log => {
      const item = document.createElement('div');
      item.className = `feed-item ${log.action_type || 'info'}`;

      const time = new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      item.innerHTML = `
        <span class="feed-time">${time}</span>
        <span class="feed-msg">${log.message}</span>
      `;
      feed.appendChild(item);
    });
  } catch (err) {
    console.error('Error fetching logs:', err);
  }
}

// Helper to render items directly in the main grid
function renderGridData(items, emptyMessage = 'No matching applications or files found.', dependencies = []) {
  currentTreeItems = items || [];
  const grid = document.getElementById('results-grid');
  grid.classList.remove('tree-mode');
  grid.innerHTML = '';

  const graphContainer = document.getElementById('graph-container');
  const wfGraphContainer = document.getElementById('wf-graph-container');
  const dbContainer = document.getElementById('db-container');

  if (currentFilter === 'db') {
    grid.style.display = 'none';
    graphContainer.classList.add('hidden');
    if (wfGraphContainer) wfGraphContainer.classList.add('hidden');
    if (systemGraph) systemGraph.stop();
    if (workflowsGraph) workflowsGraph.stop();
    if (dbContainer) {
      dbContainer.classList.remove('hidden');
      loadDatabaseTable();
    }
    return;
  } else {
    if (dbContainer) dbContainer.classList.add('hidden');
  }

  if (currentFilter === 'graph') {
    grid.style.display = 'none';
    graphContainer.classList.remove('hidden');
    if (wfGraphContainer) wfGraphContainer.classList.add('hidden');
    if (workflowsGraph) workflowsGraph.stop();
    if (systemGraph) {
      systemGraph.start();
      systemGraph.updateData(items || [], dependencies || []);
    }
    return;
  } else {
    graphContainer.classList.add('hidden');
    if (systemGraph) {
      systemGraph.stop();
    }
  }

  if (currentFilter === 'wf_graph') {
    grid.style.display = 'none';
    graphContainer.classList.add('hidden');
    if (systemGraph) systemGraph.stop();
    if (wfGraphContainer) wfGraphContainer.classList.remove('hidden');
    if (workflowsGraph) {
      workflowsGraph.start();
    }
    return;
  } else {
    if (wfGraphContainer) wfGraphContainer.classList.add('hidden');
    if (workflowsGraph) {
      workflowsGraph.stop();
    }
  }

  if (currentFilter === 'tree') {
    renderTree();
    return;
  }

  if (!items || items.length === 0) {
    grid.style.display = 'block';
    grid.innerHTML = `<div class="loading-spinner">${emptyMessage}</div>`;
    return;
  }

  grid.style.display = 'grid';

  items.forEach(item => {
    const card = document.createElement('div');
    card.className = `item-card ${selectedItem && selectedItem.path === item.path ? 'selected' : ''}`;

    const typeClass = item.type;
    card.innerHTML = `
      <div class="item-icon ${typeClass}">
        ${getIconSvg(item.type)}
      </div>
      <div class="item-info">
        <span class="item-name" title="${item.name}">${item.name}</span>
        <span class="item-desc" title="${item.category}">${item.category}</span>
        <span class="item-meta" title="${item.path}">${item.path}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      document.querySelectorAll('.item-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      openControlCenter(item);
    });

    grid.appendChild(card);
  });
}

// Search and render items
async function performSearch() {
  const searchInput = document.getElementById('search-input');
  const query = searchInput.value;
  const grid = document.getElementById('results-grid');

  grid.innerHTML = `<div class="loading-spinner">Querying index database...</div>`;

  const fetchFilter = currentFilter === 'tree' ? 'all' : currentFilter;
  const limitParam = (currentFilter === 'tree' || currentFilter === 'graph') ? '&limit=10000' : '';

  try {
    const res = await fetch(`/api/items?search=${encodeURIComponent(query)}&type=${fetchFilter}${limitParam}`);
    const data = await res.json();
    renderGridData(data.items, 'No matching applications or files found. Click "Run System Scan" to re-index.', data.dependencies || []);
  } catch (err) {
    console.error('Search failed:', err);
    grid.innerHTML = `<div class="loading-spinner" style="color:var(--accent-red)">Search operation failed: ${err.message}</div>`;
  }
}

// Execute natural language pulse commands
async function executeNaturalCommand() {
  const input = document.getElementById('natural-command-input');
  const cmd = input.value.trim();
  if (!cmd) return;

  const btn = document.getElementById('btn-run-natural-command');
  input.disabled = true;
  btn.disabled = true;

  // Extract active parent directory context from selected item
  let activeDir = '';
  if (selectedItem) {
    activeDir = selectedItem.type === 'folder' ? selectedItem.path : selectedItem.path.substring(0, selectedItem.path.lastIndexOf('\\'));
  }

  try {
    const res = await fetch('/api/command/natural', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd, dir: activeDir })
    });

    const result = await res.json();
    if (!result.success) {
      showToast('Command Failed', result.error || 'Parsing error');
      if (selectedItem) {
        appendConsoleLine(`\nCommand: ${cmd}\nError: ${result.error}`, 'error');
      }
    } else {
      showToast('Command Success', `Action: ${result.action.toUpperCase()}`);

      // Auto-select and load target properties
      if (result.target) {
        openControlCenter(result.target);
      }

      // Append logs to timeline
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const feed = document.getElementById('logger-feed');
      const feedItem = document.createElement('div');
      feedItem.className = `feed-item terminal`;
      feedItem.innerHTML = `
        <span class="feed-time">${time}</span>
        <span class="feed-msg">Executed command: "${cmd}"</span>
      `;
      feed.insertBefore(feedItem, feed.firstChild);

      // Append text content to console if output returned
      if (result.output) {
        appendConsoleLine(`\n[PULSE COMMAND]: ${cmd}\n${result.output}`, 'system');
      }

      // If action was 'list', display folders/files directly in the grid
      if (result.action === 'list' && result.subitems) {
        renderGridData(result.subitems, 'This folder is empty.');
      }

      // Automatically refresh search results for creation or deletion actions
      if (['create_file', 'create_folder', 'delete'].includes(result.action)) {
        performSearch();
      }

      // Refresh status indicators and database logs
      refreshStatus();
      loadLogs();
    }
  } catch (err) {
    showToast('Network Error', err.message);
  } finally {
    input.value = '';
    input.disabled = false;
    btn.disabled = false;
  }
}

// Trigger background system indexer
async function triggerFullScan() {
  try {
    updateScanUI(true, 'Initiating full scan sequence...');
    const res = await fetch('/api/scan/run', { method: 'POST' });
    const data = await res.json();
    showToast('Scan Initiated', data.message);
  } catch (err) {
    showToast('Scan Fail', err.message);
    updateScanUI(false);
  }
}

// Add scanned directory configuration
async function handleAddDirectory(e) {
  e.preventDefault();
  const pathInput = document.getElementById('dir-path');
  const aliasInput = document.getElementById('dir-alias');
  const depthInput = document.getElementById('dir-depth');

  const payload = {
    path: pathInput.value,
    alias: aliasInput.value,
    depth: parseInt(depthInput.value)
  };

  try {
    const res = await fetch('/api/dirs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.error) {
      showToast('Config Error', data.error);
    } else {
      pathInput.value = '';
      aliasInput.value = '';
      refreshDirs();
      showToast('Success', 'Directory added. Triggering scan...');
      triggerFullScan();
    }
  } catch (err) {
    showToast('Config Error', err.message);
  }
}

// Delete directory configuration
async function handleDeleteDirectory(dirPath) {
  if (!confirm(`Are you sure you want to stop indexing files in: ${dirPath}? All indexed items under this directory path will be removed from search.`)) {
    return;
  }

  try {
    const res = await fetch('/api/dirs', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dirPath })
    });
    const data = await res.json();
    if (data.error) {
      showToast('Config Error', data.error);
    } else {
      refreshDirs();
      showToast('Success', 'Directory removed from scans.');
      performSearch();
      refreshStatus();
    }
  } catch (err) {
    showToast('Config Error', err.message);
  }
}

// CONTROL PANEL INTERACTIONS

function openControlCenter(item) {
  selectedItem = item;

  document.getElementById('control-placeholder').classList.add('hidden');
  const panel = document.getElementById('control-panel');
  panel.classList.remove('hidden');

  // Basic values
  document.getElementById('selected-name').textContent = item.name;
  document.getElementById('selected-name').title = item.name;
  document.getElementById('selected-path').textContent = item.path;
  document.getElementById('selected-path').title = item.path;

  const badge = document.getElementById('selected-badge');
  badge.textContent = item.category || item.type;

  // Show / Hide arguments row
  const argsRow = document.getElementById('prop-args-row');
  if (item.arguments) {
    argsRow.classList.remove('hidden');
    document.getElementById('selected-args').textContent = item.arguments;
  } else {
    argsRow.classList.add('hidden');
  }

  // Dynamic large icon
  document.getElementById('selected-icon').innerHTML = getIconSvg(item.type, true);

  // Set defaults and load dynamic powershell properties
  document.getElementById('selected-size').textContent = 'Fetching properties...';
  document.getElementById('selected-modified').textContent = 'Fetching properties...';
  document.getElementById('selected-owner').textContent = 'Fetching properties...';

  loadItemProperties(item);

  // Setup CLI console prompt
  let dirName = 'C:\\';
  if (item.path && !item.path.toLowerCase().startsWith('shell:')) {
    dirName = item.type === 'folder' ? item.path : item.path.substring(0, item.path.lastIndexOf('\\'));
  }
  document.querySelector('.console-prompt').textContent = `PS ${dirName}>`;

  // Clear terminal screen
  const screen = document.getElementById('console-screen');
  screen.innerHTML = `<div class="console-line system">Terminal context set to: ${dirName}. Custom commands will execute inside this directory folder.</div>`;
}

function closeControlCenter() {
  selectedItem = null;
  document.getElementById('control-panel').classList.add('hidden');
  document.getElementById('control-placeholder').classList.remove('hidden');
}

// Query physical file properties over API
async function loadItemProperties(item) {
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: item.path,
        action: 'properties'
      })
    });

    if (res.ok) {
      const props = await res.json();
      if (props.IsDirectory) {
        document.getElementById('selected-size').textContent = '-- (Directory)';
      } else {
        document.getElementById('selected-size').textContent = formatBytes(props.Size);
      }
      document.getElementById('selected-modified').textContent = props.LastWriteTime;
      document.getElementById('selected-owner').textContent = props.Owner;
    } else {
      const err = await res.json();
      document.getElementById('selected-size').textContent = 'N/A (System Locked)';
      document.getElementById('selected-modified').textContent = 'N/A';
      document.getElementById('selected-owner').textContent = 'N/A';
    }
  } catch (err) {
    console.error('Failed to query properties:', err);
  }
}

// Execute file control actions (open, rename, delete)
async function runFileAction(action, value = '') {
  if (!selectedItem) return;

  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: selectedItem.path,
        action,
        value
      })
    });

    const result = await res.json();
    if (result.code !== 0 && result.error) {
      showToast('Action Failed', result.error);
    } else {
      if (action === 'open') {
        showToast('App/File Open', `Successfully ran action on: ${selectedItem.name}`);
      }
    }
    return result;
  } catch (err) {
    showToast('Action Error', err.message);
  }
}

// Rename dialog handler
async function triggerRename() {
  if (!selectedItem) return;
  const newName = prompt(`Enter a new name for "${selectedItem.name}":`, selectedItem.name);
  if (newName && newName.trim() && newName.trim() !== selectedItem.name) {
    const result = await runFileAction('rename', newName.trim());
    if (result && result.code === 0) {
      showToast('Item Renamed', `Renamed file to ${newName}`);
    }
  }
}

// Delete dialog handler
async function triggerDelete() {
  if (!selectedItem) return;
  const confirmation = confirm(`WARNING: Are you sure you want to permanently delete: ${selectedItem.path}?\nThis action runs 'Remove-Item -Force' and cannot be undone.`);
  if (confirmation) {
    const result = await runFileAction('delete');

    // CognitiveOS: If server returned a warning, let the avatar handle it — don't proceed
    if (result && result.cognitive_warning) {
      // Avatar's fetch interceptor will pick this up and show the warning bubble
      // Don't show any toast — the avatar is handling the UX
      return;
    }

    if (result && result.code === 0) {
      showToast('Item Deleted', `Successfully deleted: ${selectedItem.name}`);
    }
  }
}

// Custom PowerShell console runner
async function runConsoleCommand() {
  if (!selectedItem) return;

  const consoleInput = document.getElementById('console-input');
  const command = consoleInput.value.trim();
  if (!command) return;

  const inputField = document.getElementById('console-input');
  const runBtn = document.getElementById('btn-console-run');

  // Disable inputs while running
  inputField.disabled = true;
  runBtn.disabled = true;

  const cmdId = 'cmd_' + Date.now();
  currentCmdId = cmdId;

  // Print command to console
  appendConsoleLine(`\nPS> ${command}`, 'system');
  consoleInput.value = '';

  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: selectedItem.path,
        action: 'terminal',
        value: command,
        cmdId
      })
    });

    if (!res.ok) {
      const data = await res.json();
      appendConsoleLine(`Failed to spawn shell: ${data.error}`, 'error');
      inputField.disabled = false;
      runBtn.disabled = false;
    }
  } catch (err) {
    appendConsoleLine(`Network error executing script: ${err.message}`, 'error');
    inputField.disabled = false;
    runBtn.disabled = false;
  }
}

// UI GENERAL HELPERS

function appendConsoleLine(text, stream = 'output') {
  const screen = document.getElementById('console-screen');
  const line = document.createElement('div');
  line.className = `console-line ${stream}`;
  line.textContent = text;
  screen.appendChild(line);

  // Auto-scroll
  screen.scrollTop = screen.scrollHeight;
}

function updateScanUI(isScanning, message = '') {
  const btn = document.getElementById('btn-full-scan');
  const container = document.getElementById('scan-progress-container');
  const fill = document.getElementById('scan-progress-bar');
  const msg = document.getElementById('progress-message');

  if (isScanning) {
    btn.disabled = true;
    btn.textContent = 'Scanning System...';
    container.classList.remove('hidden');
    // Animate progress bar locally if we don't have absolute percentage (we just let it sweep)
    fill.style.width = '60%';
    fill.style.animation = 'sweep 2s infinite alternate ease-in-out';
    msg.textContent = message;
  } else {
    btn.disabled = false;
    btn.textContent = 'Run System Scan';
    container.classList.add('hidden');
    fill.style.width = '0%';
    fill.style.animation = 'none';
    msg.textContent = '';
  }
}

// Auto-Checkup timeline insertion helper
function appendTimelineLog(action, app) {
  const feed = document.getElementById('logger-feed');
  const item = document.createElement('div');
  item.className = `feed-item ${action}`;

  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const msgText = action === 'installed'
    ? `New installation detected: ${app.name} -> ${app.path}`
    : `Application removal detected: ${app.name}`;

  item.innerHTML = `
    <span class="feed-time">${time}</span>
    <span class="feed-msg">${msgText}</span>
  `;

  // Insert at top of feed
  feed.insertBefore(item, feed.firstChild);
}

// Global toaster message pops
function showToast(title, message, type = 'info') {
  const portal = document.getElementById('toast-portal');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  toast.innerHTML = `
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  portal.appendChild(toast);

  // Remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'slide-in 0.3s reverse forwards';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 5000);
}

// Byte formatter
function formatBytes(bytes, decimals = 2) {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Inline SVGs for types
function getIconSvg(type, large = false) {
  const size = large ? '24' : '18';
  if (type === 'app') {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
        <path d="M10 4v16"></path>
        <path d="M2 10h20"></path>
        <path d="m6 15 2-2-2-2"></path>
      </svg>
    `;
  } else if (type === 'document') {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    `;
  } else if (type === 'folder') {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
    `;
  } else {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
        <polyline points="13 2 13 9 20 9"></polyline>
      </svg>
    `;
  }
}

// Build folder hierarchy tree from database search items
function buildTree(items) {
  const root = { name: 'C:', path: 'C:', type: 'folder', children: {} };

  items.forEach(item => {
    const pathParts = item.path.replace(/\\/g, '/').toLowerCase().split('/');
    if (pathParts.includes('node_modules')) {
      return;
    }

    let cleanPath = item.path.replace(/\\/g, '/');
    let relativePath = cleanPath;

    if (cleanPath.toLowerCase().startsWith('c:/')) {
      relativePath = cleanPath.substring(3);
    } else if (cleanPath.toLowerCase().startsWith('c:')) {
      relativePath = cleanPath.substring(2);
    }

    const parts = relativePath.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLeaf = (i === parts.length - 1);

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: cleanPath.substring(0, cleanPath.indexOf(part) + part.length).replace(/\//g, '\\'),
          type: isLeaf ? item.type : 'folder',
          children: {},
          item: isLeaf ? item : null
        };
      }

      if (isLeaf) {
        current.children[part].item = item;
      }

      current = current.children[part];
    }
  });

  return root;
}

function findTreeNode(root, path) {
  if (!path) return root;
  const cleanSearchPath = path.replace(/\\/g, '/').toLowerCase();

  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current.path.replace(/\\/g, '/').toLowerCase() === cleanSearchPath) {
      return current;
    }
    for (const key in current.children) {
      queue.push(current.children[key]);
    }
  }
  return null;
}

function generateGradientPath(ctx, startX, startY, endX, endY, startColor, endColor) {
  const grad = ctx.createLinearGradient(startX, startY, endX, endY);
  grad.addColorStop(0, startColor);
  grad.addColorStop(1, endColor);
  return grad;
}

// ==========================================
// DEPENDENCY SCAN STATS UI
// ==========================================
function closeDepStatsModal() {
  document.getElementById('dep-stats-modal').style.display = 'none';
}

function openDepStatsModal(result) {
  const { sessionId, elapsed, stats } = result;
  
  document.getElementById('ds-session-id').textContent = sessionId || 'N/A';
  document.getElementById('ds-elapsed').textContent = elapsed || '0.00';
  document.getElementById('ds-scanned').textContent = stats.scanned || 0;
  document.getElementById('ds-deps').textContent = stats.dependencies || 0;
  document.getElementById('ds-resolved').textContent = stats.resolved || 0;
  document.getElementById('ds-unresolved').textContent = stats.unresolved || 0;
  document.getElementById('ds-hits').textContent = stats.cacheHits || 0;
  document.getElementById('ds-misses').textContent = stats.cacheMisses || 0;

  const tbody = document.getElementById('ds-parser-table');
  tbody.innerHTML = '';
  
  if (stats.parserExecutionTimes && Object.keys(stats.parserExecutionTimes).length > 0) {
    for (const [parser, data] of Object.entries(stats.parserExecutionTimes)) {
      const tr = document.createElement('tr');
      const avg = (data.total / data.count).toFixed(2);
      const min = data.min.toFixed(2);
      const max = data.max.toFixed(2);
      
      tr.innerHTML = `
        <td>${parser}</td>
        <td>${avg}</td>
        <td>${min}</td>
        <td>${max}</td>
      `;
      tbody.appendChild(tr);
    }
  } else {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No parser metrics recorded</td></tr>';
  }

  document.getElementById('dep-stats-modal').style.display = 'flex';
  
  // Auto-close after 12 seconds
  setTimeout(() => {
    closeDepStatsModal();
  }, 12000);
}

function renderTree() {
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  grid.style.display = 'block';
  grid.classList.add('tree-mode');

  const treeContainer = document.createElement('div');
  treeContainer.className = 'tree-container';

  // 1. Breadcrumbs Header
  const headerDiv = document.createElement('div');
  headerDiv.className = 'tree-header-wrapper';

  const breadcrumbs = document.createElement('div');
  breadcrumbs.className = 'tree-breadcrumbs';

  const rootBc = document.createElement('span');
  rootBc.className = 'breadcrumb-item';
  rootBc.textContent = 'Root (C:)';
  rootBc.addEventListener('click', () => {
    focusedTreePath = null;
    renderTree();
  });
  breadcrumbs.appendChild(rootBc);

  if (focusedTreePath) {
    const cleanPath = focusedTreePath.replace(/\\/g, '/');
    let parts = cleanPath.split('/').filter(Boolean);
    if (parts[0] && parts[0].toLowerCase() === 'c:') {
      parts.shift();
    }

    let accumulatedPath = 'C:';
    parts.forEach(part => {
      accumulatedPath += '\\' + part;
      const separator = document.createElement('span');
      separator.className = 'breadcrumb-separator';
      separator.textContent = ' ❯ ';
      breadcrumbs.appendChild(separator);

      const bc = document.createElement('span');
      bc.className = 'breadcrumb-item';
      bc.textContent = part;
      const targetPath = accumulatedPath;
      bc.addEventListener('click', () => {
        focusedTreePath = targetPath;
        renderTree();
      });
      breadcrumbs.appendChild(bc);
    });
  }
  headerDiv.appendChild(breadcrumbs);
  treeContainer.appendChild(headerDiv);

  // 2. Build full tree
  const fullTree = buildTree(currentTreeItems);

  // 3. Find startNode
  let startNode = fullTree;
  if (focusedTreePath) {
    const found = findTreeNode(fullTree, focusedTreePath);
    if (found) {
      startNode = found;
    } else {
      focusedTreePath = null;
    }
  }

  // 4. Render Focus Folder Header
  const rootChildren = document.createElement('div');
  rootChildren.className = 'tree-children';
  rootChildren.style.display = 'block';
  treeContainer.appendChild(rootChildren);

  if (focusedTreePath) {
    const focusedHeader = document.createElement('div');
    focusedHeader.className = 'tree-item-row folder root-header focused';
    focusedHeader.innerHTML = `
      <span class="tree-toggle">▼</span>
      <span class="tree-icon folder">${getIconSvg('folder')}</span>
      <span class="tree-name" style="font-weight: 700;">${startNode.name}</span>
    `;
    focusedHeader.addEventListener('click', () => {
      const isCollapsed = rootChildren.style.display === 'none' || !rootChildren.style.display;
      rootChildren.style.display = isCollapsed ? 'block' : 'none';
      focusedHeader.querySelector('.tree-toggle').innerHTML = isCollapsed ? '▼' : '▶';
    });
    treeContainer.insertBefore(focusedHeader, rootChildren);
  } else {
    // Standard Root C: Header
    const rootHeader = document.createElement('div');
    rootHeader.className = 'tree-item-row folder root-header';
    rootHeader.innerHTML = `
      <span class="tree-toggle">▼</span>
      <span class="tree-icon folder">${getIconSvg('folder')}</span>
      <span class="tree-name" style="font-weight: 700;">C: Drive (Main Root)</span>
    `;
    rootHeader.addEventListener('click', () => {
      const isCollapsed = rootChildren.style.display === 'none' || !rootChildren.style.display;
      rootChildren.style.display = isCollapsed ? 'block' : 'none';
      rootHeader.querySelector('.tree-toggle').innerHTML = isCollapsed ? '▼' : '▶';
    });
    treeContainer.insertBefore(rootHeader, rootChildren);
  }

  // 5. Render subtree nodes
  renderTreeNode(startNode, rootChildren, 0);

  grid.appendChild(treeContainer);
}

function renderTreeNode(node, element, depth = 0) {
  const keys = Object.keys(node.children).sort((a, b) => {
    const aType = node.children[a].type;
    const bType = node.children[b].type;
    if (aType === 'folder' && bType !== 'folder') return -1;
    if (aType !== 'folder' && bType === 'folder') return 1;
    return a.localeCompare(b);
  });

  if (keys.length === 0) return;

  const ul = document.createElement('ul');
  ul.className = 'tree-list';
  if (depth > 0) ul.style.display = 'none';

  keys.forEach(key => {
    const child = node.children[key];
    const li = document.createElement('li');
    li.className = 'tree-item';

    const itemRow = document.createElement('div');
    itemRow.className = `tree-item-row ${child.type}`;
    if (selectedItem && selectedItem.path === child.path) {
      itemRow.classList.add('selected');
    }

    const hasChildren = Object.keys(child.children).length > 0;

    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tree-toggle';
    if (hasChildren) {
      toggleSpan.innerHTML = '▶';
      toggleSpan.classList.add('has-children');
    } else {
      toggleSpan.innerHTML = '&nbsp;&nbsp;';
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = `tree-icon ${child.type}`;
    iconSpan.innerHTML = getIconSvg(child.type);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-name';
    nameSpan.textContent = child.name;
    nameSpan.title = child.path;

    itemRow.appendChild(toggleSpan);
    itemRow.appendChild(iconSpan);
    itemRow.appendChild(nameSpan);

    li.appendChild(itemRow);

    const childContainer = document.createElement('div');
    childContainer.className = 'tree-children';
    li.appendChild(childContainer);

    itemRow.addEventListener('click', (e) => {
      e.stopPropagation();

      if (hasChildren && e.target.classList.contains('tree-toggle')) {
        const isCollapsed = childContainer.style.display === 'none' || !childContainer.style.display;
        childContainer.style.display = isCollapsed ? 'block' : 'none';
        toggleSpan.innerHTML = isCollapsed ? '▼' : '▶';
        return;
      }

      if (child.type === 'folder') {
        focusedTreePath = child.path;
        renderTree();

        const folderItem = child.item || {
          name: child.name,
          path: child.path,
          type: 'folder',
          category: 'Folder',
          description: 'Folder directory structure'
        };
        openControlCenter(folderItem);
      } else {
        let parentPath = child.path.substring(0, child.path.lastIndexOf('\\'));
        if (parentPath.endsWith(':')) parentPath += '\\';
        focusedTreePath = parentPath;
        renderTree();

        if (child.item) {
          openControlCenter(child.item);
        }
      }
    });

    if (hasChildren) {
      renderTreeNode(child, childContainer, depth + 1);
    }

    ul.appendChild(li);
  });

  element.appendChild(ul);
}

// ── VISUAL CANVAS FORCE-DIRECTED PHYSICS GRAPH ────────
class SystemGraph {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.nodes = [];
    this.links = [];
    this.dependencyLinks = [];
    this.particles = [];
    this.dashOffset = 0;
    this.draggedNode = null;
    this.hoveredNode = null;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
    this.animationFrameId = null;

    // Physics parameters
    this.kRepulsion = 4000; // Repulsion factor
    this.kAttraction = 0.05; // Link attraction spring constant
    this.gravity = 0.005;   // Gravity pulling towards center
    this.damping = 0.8;     // Friction/velocity loss

    // Pan & Zoom parameters
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.mouseDownX = 0;
    this.mouseDownY = 0;
    this.focusedNodeId = null;
    this.searchedNodeId = null;

    this.initEvents();
  }

  initEvents() {
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', () => this.handleMouseUp());
    this.canvas.addEventListener('mouseleave', () => this.handleMouseUp());
    this.canvas.addEventListener('click', (e) => this.handleClick(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    // Auto resize
    window.addEventListener('resize', () => this.resize());

    // Reset layout macro
    const resetBtn = document.getElementById('btn-graph-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => this.resetPositions());
    }

    // Fullscreen toggler
    const fullscreenBtn = document.getElementById('btn-graph-fullscreen');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
    }

    // Graph search
    const searchInput = document.getElementById('graph-search-input');
    const searchBtn = document.getElementById('btn-graph-search');
    const clearBtn = document.getElementById('btn-graph-search-clear');
    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', () => this.searchGraph(searchInput.value.trim()));
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.searchGraph(searchInput.value.trim());
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        this.searchedNodeId = null;
        this.focusedNodeId = null;
      });
    }

    document.addEventListener('fullscreenchange', () => {
      const container = document.getElementById('graph-container');
      if (document.fullscreenElement === container) {
        if (fullscreenBtn) fullscreenBtn.textContent = 'Exit Full Screen';
        container.classList.add('fullscreen');
      } else {
        if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
        container.classList.remove('fullscreen');
      }
      setTimeout(() => this.resize(), 100);
    });
  }

  toggleFullscreen() {
    const container = document.getElementById('graph-container');
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        console.error('Failed to enter fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  }

  resize() {
    if (!this.canvas || !this.canvas.parentElement) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    this.width = this.canvas.width;
    this.height = this.canvas.height;
  }

  resetPositions() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1.0;
    this.focusedNodeId = null;
    this.searchedNodeId = null;
    this.closeDependencyPanel();
    this.calculateTargetPositions();
    this.nodes.forEach(node => {
      if (node.targetX !== undefined && node.targetY !== undefined) {
        node.x = node.targetX + (Math.random() - 0.5) * 5;
        node.y = node.targetY + (Math.random() - 0.5) * 5;
      } else {
        const targetY = 50 + (node.depth || 0) * 80;
        node.x = this.width / 2 + (Math.random() - 0.5) * 200;
        node.y = targetY + (Math.random() - 0.5) * 10;
      }
      node.vx = 0;
      node.vy = 0;
    });
  }

  searchGraph(query) {
    if (!query) {
      this.searchedNodeId = null;
      this.focusedNodeId = null;
      this.calculateTargetPositions();
      return;
    }
    const q = query.toLowerCase();
    const found = this.nodes.find(n =>
      n.label.toLowerCase().includes(q) ||
      (n.path && n.path.toLowerCase().includes(q))
    );
    if (found) {
      this.searchedNodeId = found.id;
      this.focusedNodeId = found.id;
      // Pan view to center on found node
      const targetScreenX = this.width / 2;
      const targetScreenY = this.height / 2;
      this.offsetX = targetScreenX - found.x * this.scale;
      this.offsetY = targetScreenY - found.y * this.scale;
      this.calculateTargetPositions();
    } else {
      this.searchedNodeId = null;
      this.focusedNodeId = null;
      this.calculateTargetPositions();
    }
  }

  getConnectedDependencyNodes(nodeId) {
    const connected = new Set();
    const queue = [nodeId.toLowerCase()];
    while (queue.length > 0) {
      const currentId = queue.shift();
      if (this.dependencyLinks) {
        this.dependencyLinks.forEach(link => {
          const srcId = link.source.id.toLowerCase();
          const tgtId = link.target.id.toLowerCase();
          // Upstream: files that import currentId
          if (tgtId === currentId && !connected.has(srcId)) {
            connected.add(srcId);
            queue.push(srcId);
          }
          // Downstream: files that currentId imports
          if (srcId === currentId && !connected.has(tgtId)) {
            connected.add(tgtId);
            queue.push(tgtId);
          }
        });
      }
    }
    return connected;
  }

  buildFocusCache() {
    this._focusCacheId = this.focusedNodeId;
    this._focusVisibleSet = new Set();
    
    if (!this.focusedNodeId) return;

    const focusedId = this.focusedNodeId.toLowerCase();
    const focusedNode = this.nodes.find(n => n.id.toLowerCase() === focusedId);
    if (!focusedNode) {
      this.focusedNodeId = null;
      this._focusCacheId = null;
      return;
    }

    const nodeMap = new Map();
    this.nodes.forEach(n => nodeMap.set(n.id.toLowerCase(), n));

    const connected = focusedNode.type !== 'folder' 
      ? this.getConnectedDependencyNodes(this.focusedNodeId) 
      : new Set();

    this.nodes.forEach(node => {
      const nodeIdLower = node.id.toLowerCase();
      if (nodeIdLower === focusedId) {
        this._focusVisibleSet.add(nodeIdLower);
        return;
      }

      if (focusedNode.type === 'folder') {
        let curr = focusedNode;
        while (curr && curr.parentId) {
          if (curr.parentId.toLowerCase() === nodeIdLower) {
            this._focusVisibleSet.add(nodeIdLower);
            return;
          }
          curr = nodeMap.get(curr.parentId.toLowerCase());
        }
        curr = node;
        while (curr && curr.parentId) {
          if (curr.parentId.toLowerCase() === focusedId) {
            this._focusVisibleSet.add(nodeIdLower);
            return;
          }
          curr = nodeMap.get(curr.parentId.toLowerCase());
        }
        return;
      }

      let curr = focusedNode;
      while (curr && curr.parentId) {
        if (curr.parentId.toLowerCase() === nodeIdLower) {
          this._focusVisibleSet.add(nodeIdLower);
          return;
        }
        curr = nodeMap.get(curr.parentId.toLowerCase());
      }

      if (connected.has(nodeIdLower)) {
        this._focusVisibleSet.add(nodeIdLower);
        return;
      }

      for (const depId of connected) {
        const depNode = nodeMap.get(depId);
        if (depNode) {
          let c = depNode;
          while (c && c.parentId) {
            if (c.parentId.toLowerCase() === nodeIdLower) {
              this._focusVisibleSet.add(nodeIdLower);
              return;
            }
            c = nodeMap.get(c.parentId.toLowerCase());
          }
        }
      }
    });
  }

  isNodeInFocusTree(node) {
    if (!this.focusedNodeId) return true;
    if (this._focusCacheId !== this.focusedNodeId) {
      this.buildFocusCache();
    }
    return this._focusVisibleSet.has(node.id.toLowerCase());
  }

  calculateTargetPositions() {
    const focusActive = !!this.focusedNodeId;
    
    // Clear old targets
    this.nodes.forEach(n => {
      n.targetX = undefined;
      n.targetY = undefined;
    });

    const childrenMap = new Map();
    this.nodes.forEach(n => {
      if (n.parentId) {
        if (!childrenMap.has(n.parentId)) {
          childrenMap.set(n.parentId, []);
        }
        childrenMap.get(n.parentId).push(n);
      }
    });

    // Sort children
    for (const [pid, kids] of childrenMap.entries()) {
      kids.sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return a.label.localeCompare(b.label);
      });
    }

    if (focusActive) {
      const focusedNode = this.nodes.find(n => n.id.toLowerCase() === this.focusedNodeId.toLowerCase());
      if (focusedNode) {
        // 1. Position focused node in the center-left
        focusedNode.targetX = 250;
        focusedNode.targetY = this.height / 2;

        // 2. Position ancestors horizontally to the left
        let curr = focusedNode;
        let ancestorLevel = 1;
        while (curr && curr.parentId) {
          const parentNode = this.nodes.find(n => n.id.toLowerCase() === curr.parentId.toLowerCase());
          if (parentNode) {
            parentNode.targetX = 250 - ancestorLevel * 200;
            parentNode.targetY = this.height / 2;
            ancestorLevel++;
          }
          curr = parentNode;
        }

        // 3. Position descendants horizontally to the right
        const layoutDescendantsHorizontal = (parent, level, yMin, yMax) => {
          const kids = childrenMap.get(parent.id) || [];
          const visibleKids = kids.filter(k => this.nodes.some(n => n.id === k.id) && this.isNodeInFocusTree(k));
          if (visibleKids.length === 0) return;

          const count = visibleKids.length;
          const colWidth = 220;
          const startX = 250;

          visibleKids.forEach((kid, idx) => {
            kid.targetX = startX + level * colWidth;

            // Divide vertical space evenly
            const segHeight = (yMax - yMin) / count;
            const kidYMin = yMin + idx * segHeight;
            const kidYMax = kidYMin + segHeight;
            kid.targetY = (kidYMin + kidYMax) / 2;

            layoutDescendantsHorizontal(kid, level + 1, kidYMin, kidYMax);
          });
        };

        layoutDescendantsHorizontal(focusedNode, 1, 50, this.height - 50);
      }
    } else {
      // Standard circular/radial layout centered on the root
      const roots = this.nodes.filter(n => !n.parentId || !this.nodes.some(p => p.id === n.parentId));
      if (roots.length > 0) {
        const cx = this.width / 2;
        const cy = this.height / 2;

        // Position the root nodes in the center
        roots.forEach((root, idx) => {
          if (roots.length === 1) {
            root.targetX = cx;
            root.targetY = cy;
          } else {
            const angle = (idx / roots.length) * 2 * Math.PI;
            const r = 40;
            root.targetX = cx + Math.cos(angle) * r;
            root.targetY = cy + Math.sin(angle) * r;
          }
        });

        // Recursively layout children in a circle around their parent outward from the center
        const layoutChildren = (parent) => {
          const kids = childrenMap.get(parent.id) || [];
          const visibleKids = kids.filter(k => this.nodes.some(n => n.id === k.id));
          if (visibleKids.length === 0) return;

          const count = visibleKids.length;
          let r = 120;
          if (parent.depth === 1) r = 130;
          else if (parent.depth === 2) r = 90;
          else if (parent.depth >= 3) r = 60;

          const parentAngle = (parent.targetX === cx && parent.targetY === cy)
            ? 0
            : Math.atan2(parent.targetY - cy, parent.targetX - cx);

          visibleKids.forEach((kid, idx) => {
            const isCenter = (parent.targetX === cx && parent.targetY === cy);
            let angle;
            if (isCenter) {
              angle = (idx / count) * 2 * Math.PI;
            } else {
              const spread = Math.min(Math.PI * 1.2, count * 0.4);
              angle = parentAngle + (count > 1 ? (idx / (count - 1) - 0.5) * spread : 0);
            }

            kid.targetX = parent.targetX + Math.cos(angle) * r;
            kid.targetY = parent.targetY + Math.sin(angle) * r;

            layoutChildren(kid);
          });
        };

        roots.forEach(root => {
          layoutChildren(root);
        });
      }
    }

    // Set fallback targets and initial positions if unset
    const cx = this.width / 2;
    const cy = this.height / 2;
    this.nodes.forEach(node => {
      if (node.targetX === undefined || isNaN(node.targetX)) {
        node.targetX = cx;
        node.targetY = cy;
      }
      if (node.x === undefined || isNaN(node.x)) {
        node.x = node.targetX;
        node.y = node.targetY;
        node.vx = 0;
        node.vy = 0;
      }
    });
  }

  updateData(items, dependencies = []) {
    this._focusCacheId = null;
    const newNodesMap = new Map();

    items.forEach(item => {
      if (item.type === 'app' || item.path.toLowerCase().includes('.exe') || (item.name && item.name.toLowerCase().includes('.exe'))) {
        return;
      }
      const pathParts = item.path.replace(/\\/g, '/').toLowerCase().split('/');
      if (pathParts.includes('node_modules') || pathParts.includes('users')) {
        return;
      }

      let cleanPath = item.path.replace(/\\/g, '/');
      let relativePath = cleanPath;
      if (cleanPath.toLowerCase().startsWith('c:/')) {
        relativePath = cleanPath.substring(3);
      } else if (cleanPath.toLowerCase().startsWith('c:')) {
        relativePath = cleanPath.substring(2);
      }

      const parts = relativePath.split('/').filter(Boolean);
      let currentPath = 'C:';

      if (!newNodesMap.has('C:')) {
        newNodesMap.set('C:', {
          id: 'C:',
          label: 'C: Drive',
          type: 'folder',
          path: 'C:',
          radius: 20,
          depth: 0
        });
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        const parentPath = currentPath;
        currentPath = currentPath + '/' + part;
        const isLeaf = (i === parts.length - 1);
        const resolvedPath = currentPath.replace(/\//g, '\\');

        if (!newNodesMap.has(currentPath)) {
          newNodesMap.set(currentPath, {
            id: currentPath,
            label: part,
            type: isLeaf ? item.type : 'folder',
            path: resolvedPath,
            radius: isLeaf ? (item.type === 'app' ? 12 : 10) : 15,
            item: isLeaf ? item : null,
            parentId: parentPath,
            depth: i + 1
          });
        }
      }
    });

    const newNodes = Array.from(newNodesMap.values());
    const currentNodesMap = new Map(this.nodes.map(n => [n.id, n]));

    this.nodes = newNodes.map(node => {
      const existing = currentNodesMap.get(node.id);
      if (existing) {
        node.x = existing.x;
        node.y = existing.y;
        node.vx = existing.vx;
        node.vy = existing.vy;
        node.pulseRadius = existing.pulseRadius;
        node.pulseAlpha = existing.pulseAlpha;
        node.opacity = existing.opacity;
        node.depth = existing.depth;
      } else {
        const targetY = 50 + (node.depth || 0) * 80;
        let spawnX = this.width / 2 + (Math.random() - 0.5) * 150;
        let spawnY = targetY + (Math.random() - 0.5) * 20;
        if (node.parentId) {
          const parent = currentNodesMap.get(node.parentId);
          if (parent) {
            spawnX = parent.x + (Math.random() - 0.5) * 40;
          }
        }
        node.x = spawnX;
        node.y = spawnY;
        node.vx = (Math.random() - 0.5) * 1;
        node.vy = 0;
        node.pulseRadius = 0;
        node.pulseAlpha = 1.0;
        node.opacity = 0;
      }
      return node;
    });

    this.links = [];
    this.nodes.forEach(node => {
      if (node.parentId) {
        const parent = this.nodes.find(n => n.id === node.parentId);
        if (parent) {
          this.links.push({
            source: parent,
            target: node,
            length: node.type === 'folder' ? 60 : 40
          });
        }
      }
    });

    this.dependencyLinks = [];
    dependencies.forEach(dep => {
      const srcPath = dep.source_path.toLowerCase().replace(/\\/g, '/');
      const tgtPath = dep.target_path.toLowerCase().replace(/\\/g, '/');

      const sourceNode = this.nodes.find(n => n.path && n.path.toLowerCase().replace(/\\/g, '/') === srcPath);
      const targetNode = this.nodes.find(n => n.path && n.path.toLowerCase().replace(/\\/g, '/') === tgtPath);

      if (sourceNode && targetNode) {
        this.dependencyLinks.push({
          source: sourceNode,
          target: targetNode,
          type: dep.dependency_type || 'imports'
        });
      }
    });

    this.calculateTargetPositions();
  }

  tick() {
    // Build a set of visible node IDs when a focus is active
    const focusActive = !!this.focusedNodeId;
    const isVisible = (node) => !focusActive || this.isNodeInFocusTree(node);

    this.nodes.forEach(node => {
      if (node === this.draggedNode) return;
      if (!isVisible(node)) return; // skip hidden nodes
      if (node.targetX !== undefined && node.targetY !== undefined) {
        const dx = node.targetX - node.x;
        const dy = node.targetY - node.y;
        node.vx += dx * 0.2;
        node.vy += dy * 0.2;
      }
    });

    for (let i = 0; i < this.nodes.length; i++) {
      const n1 = this.nodes[i];
      if (!isVisible(n1)) continue; // hidden nodes exert no repulsion
      for (let j = i + 1; j < this.nodes.length; j++) {
        const n2 = this.nodes[j];
        if (!isVisible(n2)) continue;
        const dx = n2.x - n1.x;
        const dy = n2.y - n1.y;
        const distSq = dx * dx + dy * dy + 200;
        const dist = Math.sqrt(distSq);

        if (dist < 250) {
          const force = this.kRepulsion / distSq;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (!n1.fixed) { n1.vx -= fx; n1.vy -= fy; }
          if (!n2.fixed) { n2.vx += fx; n2.vy += fy; }
        }
      }
    }

    this.links.forEach(link => {
      // Skip if either end is hidden
      if (!isVisible(link.source) || !isVisible(link.target)) return;
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const diff = dist - link.length;

      const force = diff * this.kAttraction;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      if (!link.source.fixed) { link.source.vx += fx; link.source.vy += fy; }
      if (!link.target.fixed) { link.target.vx -= fx; link.target.vy -= fy; }
    });

    // Increment dashOffset for dependency links flow animation
    this.dashOffset = (this.dashOffset + 0.3) % 1000;

    // Apply attraction forces for dependency links
    if (this.dependencyLinks) {
      this.dependencyLinks.forEach(link => {
        // Skip force if nodes are currently filtered out by focusedNodeId
        if (this.focusedNodeId && (!this.isNodeInFocusTree(link.source) || !this.isNodeInFocusTree(link.target))) {
          return;
        }
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const diff = dist - 85; // rest length for dependency links

        const force = diff * 0.015; // gentler attraction force
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!link.source.fixed) { link.source.vx += fx; link.source.vy += fy; }
        if (!link.target.fixed) { link.target.vx -= fx; link.target.vy -= fy; }
      });
    }

    const cx = this.width / 2;
    this.nodes.forEach(node => {
      if (node === this.draggedNode) return;
      if (!isVisible(node)) return; // no gravity on hidden nodes
      const dx = cx - node.x;
      node.vx += dx * this.gravity;
    });

    this.nodes.forEach(node => {
      if (node === this.draggedNode) {
        node.vx = 0;
        node.vy = 0;
        return;
      }

      // Hidden nodes: freeze in place — no movement, no velocity bleed
      if (!isVisible(node)) {
        node.vx = 0;
        node.vy = 0;
        return;
      }

      node.vx *= this.damping;
      node.vy *= this.damping;

      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      const maxSpeed = 8;
      if (speed > maxSpeed) {
        node.vx = (node.vx / speed) * maxSpeed;
        node.vy = (node.vy / speed) * maxSpeed;
      }

      node.x += node.vx;
      node.y += node.vy;

      node.x = Math.max(20, Math.min(this.width - 20, node.x));
      node.y = Math.max(20, Math.min(this.height - 20, node.y));

      if (node.opacity < 1) node.opacity += 0.05;

      if (node.pulseAlpha > 0) {
        node.pulseRadius += 0.8;
        node.pulseAlpha -= 0.02;
      }
    });

    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;
      return p.alpha > 0;
    });
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    this.ctx.save();
    this.ctx.translate(this.offsetX, this.offsetY);
    this.ctx.scale(this.scale, this.scale);

    this.ctx.lineWidth = 1;
    this.links.forEach(link => {
      if (this.focusedNodeId && (!this.isNodeInFocusTree(link.source) || !this.isNodeInFocusTree(link.target))) {
        return;
      }
      const opacity = Math.min(link.source.opacity, link.target.opacity) * 0.15;
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
      this.ctx.beginPath();
      this.ctx.moveTo(link.source.x, link.source.y);
      this.ctx.lineTo(link.target.x, link.target.y);
      this.ctx.stroke();
    });

    // Draw dependency links (imports/usages)
    if (this.dependencyLinks) {
      this.dependencyLinks.forEach(link => {
        if (this.focusedNodeId && (!this.isNodeInFocusTree(link.source) || !this.isNodeInFocusTree(link.target))) {
          return;
        }

        const isSourceHovered = this.hoveredNode && this.hoveredNode.id === link.source.id;
        const isTargetHovered = this.hoveredNode && this.hoveredNode.id === link.target.id;
        const isSourceFocused = this.focusedNodeId && this.focusedNodeId === link.source.id;
        const isTargetFocused = this.focusedNodeId && this.focusedNodeId === link.target.id;

        const isActive = isSourceHovered || isTargetHovered || isSourceFocused || isTargetFocused;
        const hasFocusContext = this.hoveredNode || this.focusedNodeId;

        let opacity = Math.min(link.source.opacity, link.target.opacity);
        if (hasFocusContext) {
          opacity *= isActive ? 0.95 : 0.1;
        } else {
          opacity *= 0.45;
        }

        if (opacity <= 0.02) return;

        // Custom styling: active uses bright neon pink/red, inactive uses translucent rose
        const color = isActive ? `rgba(239, 68, 68, ${opacity})` : `rgba(244, 63, 94, ${opacity})`;

        this.ctx.save();
        this.ctx.lineWidth = isActive ? 2.0 : 1.2;
        this.ctx.strokeStyle = color;

        if (isActive) {
          this.ctx.shadowBlur = 8;
          this.ctx.shadowColor = '#ef4444';
        }

        // Draw animated dashed line
        this.ctx.setLineDash([6, 5]);
        this.ctx.lineDashOffset = -this.dashOffset;

        this.ctx.beginPath();
        this.ctx.moveTo(link.source.x, link.source.y);
        this.ctx.lineTo(link.target.x, link.target.y);
        this.ctx.stroke();

        // Draw solid arrow head at the target node boundary
        this.ctx.setLineDash([]);
        this.ctx.shadowBlur = 0;

        const x1 = link.source.x;
        const y1 = link.source.y;
        const x2 = link.target.x;
        const y2 = link.target.y;
        const angle = Math.atan2(y2 - y1, x2 - x1);

        const targetRadius = link.target.radius + 6;
        const arrowX = x2 - targetRadius * Math.cos(angle);
        const arrowY = y2 - targetRadius * Math.sin(angle);

        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(arrowX, arrowY);
        this.ctx.lineTo(arrowX - 7 * Math.cos(angle - Math.PI / 6), arrowY - 7 * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(arrowX - 7 * Math.cos(angle + Math.PI / 6), arrowY - 7 * Math.sin(angle + Math.PI / 6));
        this.ctx.closePath();
        this.ctx.fill();

        this.ctx.restore();
      });
    }

    this.nodes.forEach(node => {
      if (this.focusedNodeId && !this.isNodeInFocusTree(node)) {
        return;
      }
      this.ctx.save();
      this.ctx.globalAlpha = node.opacity;

      let color = '#a855f7';
      if (node.type === 'folder') color = '#eab308';
      else if (node.type === 'app') color = '#00f0ff';
      else if (node.path && /\.(png|jpe?g|gif|bmp|webp|svg|mp4|mkv|avi|mov|webm)$/i.test(node.path)) color = '#00f0ff';
      else if (node.type === 'other') color = '#9ca3af';

      if (node.pulseAlpha > 0) {
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = node.pulseAlpha;
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius + node.pulseRadius, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.globalAlpha = node.opacity;
      }

      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = color;
      this.ctx.fillStyle = `rgba(${this.hexToRgb(color)}, 0.15)`;
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 1.5;

      this.ctx.beginPath();
      this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;

      // Search highlight ring
      if (this.searchedNodeId && node.id === this.searchedNodeId) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.85 + 0.15 * Math.sin(Date.now() * 0.005);
        this.ctx.strokeStyle = '#fbbf24';
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowBlur = 18;
        this.ctx.shadowColor = '#fbbf24';
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
      }

      this.ctx.fillStyle = '#fff';
      this.ctx.font = '500 9px "Inter", sans-serif';
      this.ctx.textAlign = 'center';

      const shortLabel = node.label.length > 15 ? node.label.substring(0, 12) + '...' : node.label;
      this.ctx.fillText(shortLabel, node.x, node.y + node.radius + 14);

      this.ctx.fillStyle = color;
      this.ctx.font = '900 10px sans-serif';
      let symbol = '📄';
      if (node.type === 'folder') symbol = '📁';
      else if (node.type === 'app') symbol = '⚙️';
      this.ctx.fillText(symbol, node.x, node.y + 3.5);

      this.ctx.restore();
    });

    this.particles.forEach(p => {
      this.ctx.save();
      this.ctx.globalAlpha = p.alpha;
      this.ctx.fillStyle = p.color;
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.restore();
    });

    this.ctx.restore();

    if (this.hoveredNode && (!this.focusedNodeId || this.isNodeInFocusTree(this.hoveredNode))) {
      const screenX = this.hoveredNode.x * this.scale + this.offsetX;
      const screenY = this.hoveredNode.y * this.scale + this.offsetY;
      const screenRadius = this.hoveredNode.radius * this.scale;

      this.ctx.fillStyle = 'rgba(7, 9, 19, 0.85)';
      this.ctx.strokeStyle = 'rgba(0, 240, 255, 0.3)';
      this.ctx.lineWidth = 1;
      this.ctx.shadowBlur = 15;
      this.ctx.shadowColor = '#00f0ff';

      const text = `${this.hoveredNode.label} (${this.hoveredNode.type.toUpperCase()})`;
      const sub = this.hoveredNode.path;

      this.ctx.font = '600 10px "Inter", sans-serif';
      const w1 = this.ctx.measureText(text).width;
      this.ctx.font = '500 8px "Fira Code", monospace';
      const w2 = this.ctx.measureText(sub).width;
      const boxWidth = Math.max(w1, w2) + 20;

      const bx = Math.min(this.width - boxWidth - 10, Math.max(10, screenX - boxWidth / 2));
      const by = Math.max(10, screenY - screenRadius - 45);

      this.ctx.beginPath();
      this.ctx.roundRect(bx, by, boxWidth, 34, 6);
      this.ctx.fill();
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;

      this.ctx.fillStyle = '#fff';
      this.ctx.font = '600 10px "Inter", sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.fillText(text, bx + 10, by + 14);

      this.ctx.fillStyle = 'rgba(255,255,255,0.6)';
      this.ctx.font = '500 8px "Fira Code", monospace';
      this.ctx.fillText(sub, bx + 10, by + 26);
    }
  }

  animate() {
    this.tick();
    this.draw();

    // Energy calculation to allow physics sleep
    let totalEnergy = 0;
    this.nodes.forEach(n => {
      totalEnergy += Math.abs(n.vx) + Math.abs(n.vy);
    });

    const hasPulses = this.nodes.some(n => n.pulseAlpha > 0);
    const hasParticles = this.particles.length > 0;
    const isInteracting = this.draggedNode || this.isPanning;

    // Keep animating only if nodes are still moving, active effects are playing, or user is interacting
    if (totalEnergy > 0.05 || hasPulses || hasParticles || isInteracting) {
      this.animationFrameId = requestAnimationFrame(() => this.animate());
    } else {
      this.animationFrameId = null;
    }
  }

  wakeUp() {
    if (!this.animationFrameId) {
      this.animate();
    }
  }

  start() {
    this.resize();
    this.resetPositions();
    this.wakeUp();
  }

  stop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  explodeNode(x, y, color = '#ef4444') {
    this.wakeUp();
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2.5;
      this.particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3,
        color: color,
        alpha: 1.0,
        decay: 0.02 + Math.random() * 0.03
      });
    }
  }

  handleMouseDown(e) {
    this.wakeUp();
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;
    this.mouseDownX = clientX;
    this.mouseDownY = clientY;

    const mx = (clientX - rect.left - this.offsetX) / this.scale;
    const my = (clientY - rect.top - this.offsetY) / this.scale;

    this.draggedNode = this.nodes.find(node => {
      if (this.focusedNodeId && !this.isNodeInFocusTree(node)) return false;
      const dx = node.x - mx;
      const dy = node.y - my;
      return (dx * dx + dy * dy) < (node.radius * node.radius);
    }) || null;

    if (this.draggedNode) {
      this.draggedNode.fixed = true;
    } else {
      this.isPanning = true;
      this.panStartX = clientX - this.offsetX;
      this.panStartY = clientY - this.offsetY;
    }
  }

  handleMouseMove(e) {
    this.wakeUp();
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    if (this.isPanning) {
      this.offsetX = clientX - this.panStartX;
      this.offsetY = clientY - this.panStartY;
      return;
    }

    const mx = (clientX - rect.left - this.offsetX) / this.scale;
    const my = (clientY - rect.top - this.offsetY) / this.scale;

    if (this.draggedNode) {
      this.draggedNode.x = mx;
      this.draggedNode.y = my;
    } else {
      this.hoveredNode = this.nodes.find(node => {
        if (this.focusedNodeId && !this.isNodeInFocusTree(node)) return false;
        const dx = node.x - mx;
        const dy = node.y - my;
        return (dx * dx + dy * dy) < (node.radius * node.radius);
      }) || null;

      this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'default';
    }
  }

  handleMouseUp() {
    this.wakeUp();
    if (this.draggedNode) {
      // Keep the node pinned at where user dropped it
      // Clear the spring target so physics won't pull it back
      this.draggedNode.targetX = undefined;
      this.draggedNode.targetY = undefined;
      this.draggedNode.fixed = false;
      this.draggedNode.vx = 0;
      this.draggedNode.vy = 0;
      this.draggedNode = null;
    }
    this.isPanning = false;
  }

  handleClick(e) {
    this.wakeUp();
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const dragDist = Math.hypot(clientX - this.mouseDownX, clientY - this.mouseDownY);
    if (dragDist > 5) return;

    const mx = (clientX - rect.left - this.offsetX) / this.scale;
    const my = (clientY - rect.top - this.offsetY) / this.scale;

    const clicked = this.nodes.find(node => {
      if (this.focusedNodeId && !this.isNodeInFocusTree(node)) return false;
      const dx = node.x - mx;
      const dy = node.y - my;
      return (dx * dx + dy * dy) < (node.radius * node.radius);
    });

    if (clicked) {
      if (this.focusedNodeId === clicked.id) {
        this.focusedNodeId = null;
        focusedTreePath = null;
        this.closeDependencyPanel();
      } else {
        this.focusedNodeId = clicked.id;
        focusedTreePath = clicked.path;
        if (clicked.type !== 'folder') {
          this.showDependencyPanel(clicked);
        } else {
          this.closeDependencyPanel();
        }
      }
      this.calculateTargetPositions();

      if (clicked.item) {
        openControlCenter(clicked.item);
      } else if (clicked.type === 'folder') {
        const folderItem = clicked.item || {
          name: clicked.label,
          path: clicked.path,
          type: 'folder',
          category: 'Folder',
          description: 'Folder directory structure'
        };
        openControlCenter(folderItem);
      }
    } else {
      this.focusedNodeId = null;
      this.closeDependencyPanel();
      this.calculateTargetPositions();
    }
  }

  showDependencyPanel(node) {
    const panel = document.getElementById('graph-dep-panel');
    if (!panel) return;

    // Populate header
    const filenameEl = document.getElementById('gdp-filename');
    if (filenameEl) filenameEl.textContent = node.label;

    // Set icon based on type
    const iconEl = panel.querySelector('.gdp-icon');
    if (iconEl) iconEl.textContent = node.type === 'folder' ? '📁' : '📄';

    // Compute imports (files this node depends on — it is the source)
    const imports = this.dependencyLinks
      .filter(l => l.source.id === node.id)
      .map(l => l.target.label || l.target.id);

    // Compute dependents (files that depend on this node — it is the target)
    const dependents = this.dependencyLinks
      .filter(l => l.target.id === node.id)
      .map(l => l.source.label || l.source.id);

    // Render imports list
    const importsList = document.getElementById('gdp-imports-list');
    const importsCount = document.getElementById('gdp-imports-count');
    if (importsList) {
      if (imports.length === 0) {
        importsList.innerHTML = '<li class="gdp-empty">No dependencies</li>';
      } else {
        importsList.innerHTML = imports.map((name, i) =>
          `<li class="imports-item" style="animation-delay:${i * 0.04}s" title="${name}">${name}</li>`
        ).join('');
      }
    }
    if (importsCount) importsCount.textContent = imports.length;

    // Render dependents list
    const dependentsList = document.getElementById('gdp-dependents-list');
    const dependentsCount = document.getElementById('gdp-dependents-count');
    if (dependentsList) {
      if (dependents.length === 0) {
        dependentsList.innerHTML = '<li class="gdp-empty">No dependents</li>';
      } else {
        dependentsList.innerHTML = dependents.map((name, i) =>
          `<li class="dependents-item" style="animation-delay:${i * 0.04}s" title="${name}">${name}</li>`
        ).join('');
      }
    }
    if (dependentsCount) dependentsCount.textContent = dependents.length;

    panel.classList.remove('hidden');

    // Wire close button (idempotent)
    const closeBtn = document.getElementById('btn-gdp-close');
    if (closeBtn && !closeBtn._gdpWired) {
      closeBtn._gdpWired = true;
      closeBtn.addEventListener('click', () => {
        this.focusedNodeId = null;
        this.closeDependencyPanel();
      });
    }

    // Trigger resize so canvas fills remaining space
    setTimeout(() => this.resize(), 50);
  }

  closeDependencyPanel() {
    const panel = document.getElementById('graph-dep-panel');
    if (panel) panel.classList.add('hidden');
    setTimeout(() => this.resize(), 50);
  }

  handleWheel(e) {
    this.wakeUp();
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const zoomFactor = 1.1;
    let newScale = this.scale;
    if (e.deltaY < 0) {
      newScale *= zoomFactor;
    } else {
      newScale /= zoomFactor;
    }

    newScale = Math.max(0.1, Math.min(5.0, newScale));

    this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale);
    this.offsetY = my - (my - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;
  }

  hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ?
      `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` :
      '255, 255, 255';
  }
}

// Fetch and render database table records
async function loadDatabaseTable() {
  const selectEl = document.getElementById('db-table-select');
  const searchEl = document.getElementById('db-search-input');
  const tableEl = document.getElementById('db-table');
  if (!selectEl || !tableEl) return;

  const table = selectEl.value;
  const search = searchEl ? searchEl.value : '';
  const thead = tableEl.querySelector('thead');
  const tbody = tableEl.querySelector('tbody');

  thead.innerHTML = '<tr><th colspan="100%">Loading database records...</th></tr>';
  tbody.innerHTML = '';

  try {
    const res = await fetch(`/api/db/${table}?search=${encodeURIComponent(search)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
    const data = await res.json();
    const rows = data.rows || [];

    if (rows.length === 0) {
      thead.innerHTML = '';
      tbody.innerHTML = '<tr><td colspan="100%" class="db-empty-row">No records found in this table.</td></tr>';
      return;
    }

    // Get headers from first row keys
    const headers = Object.keys(rows[0]);
    thead.innerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;

    tbody.innerHTML = rows.map(row => {
      return `<tr>${headers.map(h => {
        const val = row[h];
        const displayVal = val === null ? '<span style="color:var(--text-muted)">NULL</span>' : val;
        return `<td>${displayVal}</td>`;
      }).join('')}</tr>`;
    }).join('');

  } catch (err) {
    thead.innerHTML = '';
    tbody.innerHTML = `<tr><td colspan="100%" class="db-empty-row" style="color:var(--accent-red)">Failed to load data: ${err.message}</td></tr>`;
  }
}
