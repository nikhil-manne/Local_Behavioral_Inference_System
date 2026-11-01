// public/workflows_graph.js
(function () {
  'use strict';

  class WorkflowGraph {
    constructor(canvasId) {
      this.canvas = document.getElementById(canvasId);
      this.ctx = this.canvas.getContext('2d');
      this.nodes = [];
      this.links = [];          // Structural parent-child links
      this.sequenceLinks = [];   // Directed sequential step links
      this.width = this.canvas.width;
      this.height = this.canvas.height;
      this.animationFrameId = null;

      // Interaction State
      this.draggedNode = null;
      this.hoveredNode = null;
      this.scale = 1.0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.isPanning = false;
      this.panStartX = 0;
      this.panStartY = 0;

      // Physics Settings
      this.kRepulsion = 6000;
      this.kAttraction = 0.08;
      this.gravity = 0.005;
      this.damping = 0.75;

      // Animation variables
      this.dashOffset = 0;
      this.flowProgress = 0; // For moving dots along sequence paths

      // Collapsible state
      this.expandedWorkflows = new Set();
      this.lastWorkflowsData = [];
      this.searchQuery = '';
      this.focusedWorkflowId = null;

      this.initEvents();
    }

    initEvents() {
      this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      this.canvas.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
      this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

      window.addEventListener('resize', () => this.resize());

      const resetBtn = document.getElementById('btn-wf-graph-reset');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => this.resetPositions());
      }

      const fullscreenBtn = document.getElementById('btn-wf-graph-fullscreen');
      if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
      }

      document.addEventListener('fullscreenchange', () => {
        const container = document.getElementById('wf-graph-container');
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
      const container = document.getElementById('wf-graph-container');
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
      this.wakeUp();
    }

    resetPositions() {
      this.scale = 1.0;
      this.offsetX = 0;
      this.offsetY = 0;
      this.focusedWorkflowId = null;
      this.searchQuery = '';
      const searchInput = document.getElementById('wf-graph-search-input');
      if (searchInput) searchInput.value = '';
      this.buildGraph(this.lastWorkflowsData);
      this.nodes.forEach(n => {
        n.x = this.width / 2 + (Math.random() - 0.5) * 300;
        n.y = this.height / 2 + (Math.random() - 0.5) * 300;
        n.vx = 0;
        n.vy = 0;
      });
      this.wakeUp();
    }

    searchWorkflows(query) {
      this.searchQuery = query || '';
      this.focusedWorkflowId = null;
      this.buildGraph(this.lastWorkflowsData);
    }

    clearSearch() {
      this.searchQuery = '';
      this.focusedWorkflowId = null;
      this.buildGraph(this.lastWorkflowsData);
    }

    async loadData() {
      try {
        const res = await fetch('/api/cognitive/workflows');
        const data = await res.json();
        this.lastWorkflowsData = data.workflows || [];
        this.buildGraph(this.lastWorkflowsData);
      } catch (err) {
        console.error('[WorkflowGraph] Failed to load workflows data:', err);
      }
    }

    buildGraph(workflows) {
      const oldNodesMap = new Map(this.nodes.map(n => [n.id, n]));
      this.nodes = [];
      this.links = [];
      this.sequenceLinks = [];

      let filteredWorkflows = workflows;
      if (this.focusedWorkflowId !== null) {
        filteredWorkflows = workflows.filter(wf => wf.id === this.focusedWorkflowId);
      } else if (this.searchQuery) {
        const query = this.searchQuery.toLowerCase();
        filteredWorkflows = workflows.filter(wf => wf.name.toLowerCase().includes(query));
      }

      filteredWorkflows.forEach((wf, wfIdx) => {
        const pct = wf.confidence_pct || 0;
        const isReady = wf.is_suggestible || (pct >= 82 && wf.times_observed >= 4);
        const isLearning = !isReady && wf.times_observed >= 3;

        let stateLabel = 'observing';
        let color = '#64748b'; // Observing
        let border = '#94a3b8';
        if (isReady) {
          stateLabel = 'ready';
          color = '#10b981'; // Ready
          border = '#34d399';
        } else if (isLearning) {
          stateLabel = 'learning';
          color = '#fbbf24'; // Learning
          border = '#fde047';
        }

        const activePlan = wf.active_plan || wf.plans?.[0] || null;
        const steps = activePlan?.steps || wf.steps || [];
        const isExpanded = this.expandedWorkflows.has(wf.id);
        const countSuffix = steps.length > 0 ? ` (${steps.length})` : '';
        const nodeLabel = wf.name + countSuffix;

        // Parent workflow node
        let wfNode = oldNodesMap.get(wf.id);
        if (!wfNode) {
          wfNode = {
            id: wf.id,
            label: nodeLabel,
            type: 'workflow',
            state: stateLabel,
            color,
            border,
            radius: 18,
            expanded: isExpanded,
            x: this.width / 2 + (Math.random() - 0.5) * 200,
            y: this.height / 2 + (Math.random() - 0.5) * 200,
            vx: 0,
            vy: 0
          };
        } else {
          wfNode.label = nodeLabel;
          wfNode.state = stateLabel;
          wfNode.color = color;
          wfNode.border = border;
          wfNode.expanded = isExpanded;
        }
        this.nodes.push(wfNode);

        // Child Step nodes
        if (isExpanded) {
          const stepNodesList = [];

          steps.forEach((step, sIdx) => {
            const stepId = `${wf.id}_step_${sIdx}`;
            let stepLabel = '';
            if (step.command) {
              stepLabel = `CMD: ${step.command.split(' ')[0]}`;
            } else if (step.app) {
              stepLabel = `App: ${step.app}`;
            } else {
              stepLabel = step.event_type || 'event';
            }

            let stepNode = oldNodesMap.get(stepId);
            if (!stepNode) {
              stepNode = {
                id: stepId,
                label: stepLabel,
                fullText: step.command || step.app || step.event_type || '',
                type: 'step',
                radius: 9,
                color: '#818cf8',
                border: '#c7d2fe',
                x: wfNode.x + (Math.random() - 0.5) * 100,
                y: wfNode.y + (Math.random() - 0.5) * 100,
                vx: 0,
                vy: 0
              };
            }
            this.nodes.push(stepNode);
            stepNodesList.push(stepNode);

            // Link parent to child step
            this.links.push({
              source: wfNode,
              target: stepNode,
              type: 'structural'
            });

            // Link step sequentially
            if (sIdx > 0) {
              this.sequenceLinks.push({
                source: stepNodesList[sIdx - 1],
                target: stepNode,
                type: 'sequence'
              });
            }
          });
        }
      });

      this.resize();
      this.wakeUp();
    }

    start() {
      this.loadData();
      this.wakeUp();
    }

    stop() {
      if (this.animationFrameId) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    }

    wakeUp() {
      if (!this.animationFrameId) {
        this.animate();
      }
    }

    animate() {
      this.tick();
      this.draw();

      // Check kinetic energy for physics sleep mode
      let totalEnergy = 0;
      this.nodes.forEach(n => {
        totalEnergy += (n.vx * n.vx) + (n.vy * n.vy);
      });

      const needsRepaint = this.draggedNode || this.isPanning || this.sequenceLinks.length > 0;

      if (totalEnergy > 0.05 || needsRepaint) {
        this.animationFrameId = requestAnimationFrame(() => this.animate());
      } else {
        this.animationFrameId = null;
        console.log('[WorkflowGraph] Performance sleep mode active');
      }
    }

    tick() {
      this.dashOffset = (this.dashOffset + 0.3) % 1000;
      this.flowProgress = (this.flowProgress + 0.015) % 1.0;

      // 1. Repulsion between all nodes
      for (let i = 0; i < this.nodes.length; i++) {
        const nodeA = this.nodes[i];
        for (let j = i + 1; j < this.nodes.length; j++) {
          const nodeB = this.nodes[j];

          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const distSqr = dx * dx + dy * dy + 100;
          const dist = Math.sqrt(distSqr);

          if (dist < 280) {
            const force = this.kRepulsion / distSqr;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (!nodeA.fixed && nodeA !== this.draggedNode) {
              nodeA.vx -= fx;
              nodeA.vy -= fy;
            }
            if (!nodeB.fixed && nodeB !== this.draggedNode) {
              nodeB.vx += fx;
              nodeB.vy += fy;
            }
          }
        }
      }

      // 2. Attraction along structural & sequence links
      const allLinks = [...this.links, ...this.sequenceLinks];
      allLinks.forEach(link => {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const restLength = link.type === 'structural' ? 65 : 45;
        const force = (dist - restLength) * this.kAttraction;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (!link.source.fixed && link.source !== this.draggedNode) {
          link.source.vx += fx;
          link.source.vy += fy;
        }
        if (!link.target.fixed && link.target !== this.draggedNode) {
          link.target.vx -= fx;
          link.target.vy -= fy;
        }
      });

      // 3. Center gravity and update position
      const cx = this.width / 2;
      const cy = this.height / 2;
      this.nodes.forEach(node => {
        if (node === this.draggedNode) return;

        // Gravity pull to center
        node.vx += (cx - node.x) * this.gravity;
        node.vy += (cy - node.y) * this.gravity;

        // Clamp speed to prevent explosive oscillations
        const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
        const maxSpeed = 7;
        if (speed > maxSpeed) {
          node.vx = (node.vx / speed) * maxSpeed;
          node.vy = (node.vy / speed) * maxSpeed;
        }

        node.x += node.vx;
        node.y += node.vy;

        node.vx *= this.damping;
        node.vy *= this.damping;
      });
    }

    draw() {
      this.ctx.clearRect(0, 0, this.width, this.height);

      this.ctx.save();
      this.ctx.translate(this.offsetX, this.offsetY);
      this.ctx.scale(this.scale, this.scale);

      // Draw structural links
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      this.links.forEach(link => {
        this.ctx.beginPath();
        this.ctx.moveTo(link.source.x, link.source.y);
        this.ctx.lineTo(link.target.x, link.target.y);
        this.ctx.stroke();
      });

      // Draw sequential links
      this.ctx.strokeStyle = 'rgba(167, 139, 250, 0.45)'; // Purple flow lines
      this.ctx.setLineDash([4, 4]);
      this.ctx.lineDashOffset = -this.dashOffset;
      this.sequenceLinks.forEach(link => {
        this.ctx.lineWidth = 1.6;
        this.ctx.beginPath();
        this.ctx.moveTo(link.source.x, link.source.y);
        this.ctx.lineTo(link.target.x, link.target.y);
        this.ctx.stroke();
      });
      this.ctx.setLineDash([]); // Reset

      // Draw flowing dot animations along sequence links
      this.sequenceLinks.forEach(link => {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Dot position
        const dotX = link.source.x + dx * this.flowProgress;
        const dotY = link.source.y + dy * this.flowProgress;

        this.ctx.fillStyle = '#c084fc';
        this.ctx.shadowColor = '#c084fc';
        this.ctx.shadowBlur = 6;
        this.ctx.beginPath();
        this.ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 0; // Reset
      });

      // Draw arrowheads on sequence links
      this.sequenceLinks.forEach(link => {
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const angle = Math.atan2(dy, dx);
        const arrowLength = 7;
        const targetRadius = link.target.radius;

        // Position arrow at target node boundary
        const ax = link.target.x - targetRadius * Math.cos(angle);
        const ay = link.target.y - targetRadius * Math.sin(angle);

        this.ctx.fillStyle = 'rgba(167, 139, 250, 0.8)';
        this.ctx.beginPath();
        this.ctx.moveTo(ax, ay);
        this.ctx.lineTo(ax - arrowLength * Math.cos(angle - Math.PI / 6), ay - arrowLength * Math.sin(angle - Math.PI / 6));
        this.ctx.lineTo(ax - arrowLength * Math.cos(angle + Math.PI / 6), ay - arrowLength * Math.sin(angle + Math.PI / 6));
        this.ctx.closePath();
        this.ctx.fill();
      });

      // Draw nodes
      this.nodes.forEach(node => {
        this.ctx.beginPath();
        this.ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);

        // Fill glow details
        this.ctx.fillStyle = node.color;
        if (node.type === 'workflow') {
          this.ctx.shadowColor = node.color;
          this.ctx.shadowBlur = 8;
        }

        this.ctx.fill();
        this.ctx.shadowBlur = 0; // Reset

        // Border outline
        this.ctx.lineWidth = node.expanded ? 4 : 2;
        this.ctx.strokeStyle = node.border;
        this.ctx.stroke();

        // Label text below node
        this.ctx.fillStyle = '#e2e8f0';
        this.ctx.font = node.type === 'workflow' ? 'bold 11px sans-serif' : '9px monospace';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(node.label, node.x, node.y + node.radius + 13);
      });

      this.ctx.restore();

      // Draw hover tooltips in screen space
      if (this.hoveredNode) {
        const screenX = this.hoveredNode.x * this.scale + this.offsetX;
        const screenY = this.hoveredNode.y * this.scale + this.offsetY;

        this.ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
        this.ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        this.ctx.lineWidth = 1;

        const tipText = this.hoveredNode.fullText || this.hoveredNode.label;
        const textWidth = this.ctx.measureText(tipText).width;
        const rectWidth = textWidth + 16;
        const rectHeight = 22;

        this.ctx.beginPath();
        this.ctx.roundRect(screenX - rectWidth / 2, screenY - this.hoveredNode.radius * this.scale - 32, rectWidth, rectHeight, 6);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.fillStyle = '#f8fafc';
        this.ctx.font = '10px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(tipText, screenX, screenY - this.hoveredNode.radius * this.scale - 18);
      }
    }

    // ── MOUSE INTERACT HANDLERS ───────────────────────

    handleMouseDown(e) {
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      this.clickStartPos = { x: clickX, y: clickY };

      // Convert click coordinates to graph space
      const graphX = (clickX - this.offsetX) / this.scale;
      const graphY = (clickY - this.offsetY) / this.scale;

      // Find if clicked a node
      let foundNode = null;
      for (const node of this.nodes) {
        const dx = node.x - graphX;
        const dy = node.y - graphY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= node.radius) {
          foundNode = node;
          break;
        }
      }

      if (foundNode) {
        this.draggedNode = foundNode;
        this.draggedNode.fixed = true;
      } else {
        this.isPanning = true;
        this.panStartX = clickX - this.offsetX;
        this.panStartY = clickY - this.offsetY;
      }
      this.wakeUp();
    }

    handleMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const graphX = (mouseX - this.offsetX) / this.scale;
      const graphY = (mouseY - this.offsetY) / this.scale;

      if (this.draggedNode) {
        this.draggedNode.x = graphX;
        this.draggedNode.y = graphY;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
      } else if (this.isPanning) {
        this.offsetX = mouseX - this.panStartX;
        this.offsetY = mouseY - this.panStartY;
      } else {
        // Handle hovering checks
        let hover = null;
        for (const node of this.nodes) {
          const dx = node.x - graphX;
          const dy = node.y - graphY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= node.radius) {
            hover = node;
            break;
          }
        }
        if (this.hoveredNode !== hover) {
          this.hoveredNode = hover;
        }
      }
      this.wakeUp();
    }

    handleMouseUp(e) {
      let moved = false;
      if (e && this.clickStartPos) {
        const rect = this.canvas.getBoundingClientRect();
        const curX = e.clientX - rect.left;
        const curY = e.clientY - rect.top;
        const dist = Math.sqrt(Math.pow(curX - this.clickStartPos.x, 2) + Math.pow(curY - this.clickStartPos.y, 2));
        if (dist > 5) moved = true;
      }

      if (this.draggedNode) {
        if (!moved) {
          const node = this.draggedNode;
          let workflowId = null;
          if (node.type === 'workflow') {
            workflowId = node.id;
            if (this.focusedWorkflowId === workflowId) {
              this.focusedWorkflowId = null;
              this.expandedWorkflows.delete(workflowId);
            } else {
              this.focusedWorkflowId = workflowId;
              this.expandedWorkflows.add(workflowId);
            }
            this.buildGraph(this.lastWorkflowsData);
          } else if (node.type === 'step') {
            const parts = node.id.split('_step_');
            if (parts.length > 0) {
              workflowId = parts[0];
            }
          }
          if (workflowId && window.showWorkflowDetails) {
            window.showWorkflowDetails(workflowId);
          }
        }

        this.draggedNode.fixed = false;
        this.draggedNode = null;
      } else if (this.isPanning) {
        if (!moved) {
          // Clicked background: clear focus
          this.focusedWorkflowId = null;
          this.buildGraph(this.lastWorkflowsData);
        }
      }
      this.isPanning = false;
      this.wakeUp();
    }

    handleWheel(e) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Mouse position in graph coordinates before zoom
      const graphX = (mouseX - this.offsetX) / this.scale;
      const graphY = (mouseY - this.offsetY) / this.scale;

      const zoomFactor = 1.1;
      let newScale = this.scale;
      if (e.deltaY < 0) {
        newScale = Math.min(this.scale * zoomFactor, 5.0);
      } else {
        newScale = Math.max(this.scale / zoomFactor, 0.15);
      }

      this.scale = newScale;
      this.offsetX = mouseX - graphX * this.scale;
      this.offsetY = mouseY - graphY * this.scale;

      this.wakeUp();
    }
  }

  // Register in global scope
  window.WorkflowGraph = WorkflowGraph;
})();
