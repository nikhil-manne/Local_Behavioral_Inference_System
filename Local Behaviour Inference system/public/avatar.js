// public/avatar.js
// Injected into index.html — add <script src="avatar.js"></script> before </body>

(function () {
  'use strict';

  // ── AVATAR STATE ────────────────────────────────────
  const state = {
    emotion: 'idle',
    isVisible: true,
    currentWarning: null,
    currentSuggestion: null,
    name: localStorage.getItem('avatar_name') || 'Freddy',
    sleepState: 'active', // 'active', 'sleepy', 'sleeping', 'sleeping-back', 'waking-up'
    sleepTimer: null
  };

  // ── INJECT AVATAR HTML ───────────────────────────────
  const avatarHTML = `
    <!-- Speech Bubble -->
    <div id="avatarBubble" style="
      display: none;
      position: fixed;
      width: max-content;
      max-width: 340px;
      background: #ffffff;
      border: 2px solid #16a34a;
      padding: 16px 20px;
      box-shadow: 0 10px 30px -5px rgba(22,163,74,0.2), 0 4px 10px -2px rgba(0,0,0,0.08);
      pointer-events: all;
      z-index: 100000;
      border-radius: 16px;
      font-family: system-ui, sans-serif;
    ">
      <div id="avatarMessage" style="
        color: #14532d;
        font-size: 14px;
        line-height: 1.5;
        margin-bottom: 12px;
        font-weight: 600;
      "></div>
      <div id="avatarChain" style="
        display: none;
        font-family: monospace;
        font-size: 11px;
        color: #15803d;
        background: #f0fdf4;
        border-radius: 8px;
        padding: 8px;
        margin-bottom: 12px;
        white-space: pre;
        border: 1px solid #bbf7d0;
      "></div>
      <div id="avatarActions" style="
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      "></div>
    </div>

    <div id="cognitiveAvatar" style="
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 120px;
      height: 160px;
      z-index: 99999;
      font-family: system-ui, sans-serif;
      pointer-events: none;
    ">
      <!-- Avatar Character -->
      <div id="avatarCharacter" style="
        width: 240px;
        height: 360px;
        cursor: pointer;
        transition: transform 0.2s ease;
        pointer-events: all;
        position: absolute;
        top: 0;
        left: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        animation: cogFloat 3s ease-in-out infinite;
      ">
        <img id="avatarImage" src="avatar_character.png" style="
          width: 240px;
          height: auto;
          max-height: 360px;
          object-fit: contain;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
          transition: filter 0.3s ease;
        " />
        
        <!-- Emotion Status Badge -->
        <div id="avatarBadge" style="
          position: absolute;
          top: 180px;
          right: 45px;
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #1e293b;
          border: 1.5px solid #475569;
          display: none;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05);
          z-index: 2;
        "></div>
        
        <!-- Aura Glow Effect -->
        <div id="avatarAura" style="
          position: absolute;
          inset: 0;
          border-radius: 12px;
          box-shadow: 0 0 20px transparent;
          transition: box-shadow 0.3s ease;
          pointer-events: none;
          z-index: -1;
        "></div>
      </div>
    </div>

    <style>
      @keyframes cogFloat {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      @keyframes cogShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-4px); }
        40%, 80% { transform: translateX(4px); }
      }
      @keyframes cogBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-12px); }
      }
      .cogBtn {
        padding: 8px 16px;
        border-radius: 8px;
        border: none;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background-color 0.2s, transform 0.1s, box-shadow 0.2s;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .cogBtn:active {
        transform: scale(0.97);
      }
      .cogBtnPrimary {
        background: #16a34a;
        color: white;
        box-shadow: 0 2px 8px rgba(22,163,74,0.3);
      }
      .cogBtnPrimary:hover {
        background: #15803d;
      }
      .cogBtnSecondary {
        background: #f9fafb;
        color: #374151;
        border: 1px solid #d1d5db;
      }
      .cogBtnSecondary:hover {
        background: #f0fdf4;
        border-color: #16a34a;
        color: #15803d;
      }
      .cogBtnDanger {
        background: #dc2626;
        color: white;
        box-shadow: 0 1px 2px rgba(0,0,0,0.05);
      }
      .cogBtnDanger:hover {
        background: #b91c1c;
      }
      .cogBtnInfo {
        background: #f0fdf4;
        color: #15803d;
        border: 1px solid #86efac;
      }
      .cogBtnInfo:hover {
        background: #dcfce7;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
  `;

  document.body.insertAdjacentHTML('beforeend', avatarHTML);

  const el = {
    avatar: document.getElementById('cognitiveAvatar'),
    character: document.getElementById('avatarCharacter'),
    image: document.getElementById('avatarImage'),
    badge: document.getElementById('avatarBadge'),
    aura: document.getElementById('avatarAura'),
    bubble: document.getElementById('avatarBubble'),
    message: document.getElementById('avatarMessage'),
    chain: document.getElementById('avatarChain'),
    actions: document.getElementById('avatarActions')
  };

  // Restore saved coordinates from localStorage
  const savedX = localStorage.getItem('avatar_x');
  const savedY = localStorage.getItem('avatar_y');
  if (savedX !== null && savedY !== null) {
    el.avatar.style.left = savedX + 'px';
    el.avatar.style.top = savedY + 'px';
    el.avatar.style.bottom = 'auto';
    el.avatar.style.right = 'auto';
  }

  // Get real position and update alignment after initial DOM rendering/paint
  setTimeout(() => {
    const rect = el.character.getBoundingClientRect();
    updateAvatarAlignment(rect.left, rect.top);
  }, 50);

  // Keep alignment correct on screen resize
  window.addEventListener('resize', () => {
    const rect = el.character.getBoundingClientRect();
    updateAvatarAlignment(rect.left, rect.top);
  });

  function updateAvatarAlignment(x, y) {
    const rect = el.character.getBoundingClientRect();
    const isLeftHalf = rect.left < window.innerWidth / 2;
    const isTopHalf = rect.top < window.innerHeight / 2;

    // Center bubble horizontally relative to character container center
    const charCenter = rect.left + rect.width / 2;

    // Temporarily show bubble to measure its layout dimensions
    const originalDisplay = el.bubble.style.display;
    el.bubble.style.display = 'block';
    const bubbleWidth = el.bubble.offsetWidth;
    const bubbleHeight = el.bubble.offsetHeight;
    el.bubble.style.display = originalDisplay;

    // Position horizontally, bounding within screen margins (12px)
    let leftPos = charCenter - bubbleWidth / 2;
    leftPos = Math.max(12, Math.min(window.innerWidth - bubbleWidth - 12, leftPos));
    el.bubble.style.left = leftPos + 'px';
    el.bubble.style.right = 'auto';

    // Position vertically just above or below the boy's visible figure
    const imgRect = el.image.getBoundingClientRect();

    if (isTopHalf) {
      // Position below the boy's feet
      el.bubble.style.top = (imgRect.bottom + 8) + 'px';
      el.bubble.style.bottom = 'auto';
    } else {
      // Position just above the boy's head
      el.bubble.style.top = (imgRect.top - bubbleHeight - 8) + 'px';
      el.bubble.style.bottom = 'auto';
    }
  }

  // ── EMOTIONS ─────────────────────────────────────────
  const EMOTIONS = {
    idle: {
      image: 'avatar_character.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    thinking: {
      image: 'images/thinking.png',
      badge: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#3b82f6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" style="animation: spin 1s linear infinite;"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>`,
      animation: 'cogFloat',
      showBadge: true
    },
    warning: {
      image: 'images/confused.png',
      badge: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
      animation: 'cogShake',
      showBadge: true
    },
    happy: {
      image: 'images/happy.png',
      badge: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#22c55e" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
      animation: 'cogBounce',
      showBadge: true
    },
    urgent: {
      image: 'images/angry.png',
      badge: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#ef4444" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
      animation: 'cogShake',
      showBadge: true
    },
    suggest: {
      image: 'images/celebrate.png',
      badge: `<svg viewBox="0 0 24 24" width="18" height="18" stroke="#f59e0b" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21h6"></path><path d="M9 17h6"></path><path d="M12 2v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M19.07 4.93l-1.41 1.41"></path><path d="M10 8.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2.5-1.5 2.5H10.5S9 10 9 8.5z"></path></svg>`,
      animation: 'cogBounce',
      showBadge: true
    },
    confused: {
      image: 'images/confused.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    angry: {
      image: 'images/angry.png',
      badge: '',
      animation: 'cogShake',
      showBadge: false
    },
    learning: {
      image: 'images/learning.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    sad: {
      image: 'images/sad.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    sleepy: {
      image: 'images/sleepy.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    sleeping: {
      image: 'images/sleeping.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    'sleeping-back': {
      image: 'images/sleeping-back.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    'waking-up': {
      image: 'images/waking-up.png',
      badge: '',
      animation: 'cogFloat',
      showBadge: false
    },
    surprised: {
      image: 'images/suprised.png',
      badge: '',
      animation: 'cogBounce',
      showBadge: false
    },
    celebrate: {
      image: 'images/celebrate.png',
      badge: '',
      animation: 'cogBounce',
      showBadge: false
    }
  };

  let idleTimeout = null;
  let clickTimeout = null;

  function clearSleepTimers() {
    if (state.sleepTimer) {
      clearTimeout(state.sleepTimer);
      state.sleepTimer = null;
    }
  }

  function resetIdleTimer() {
    if (state.sleepState !== 'active') return;
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(() => {
      if (state.emotion === 'idle' && el.bubble.style.display === 'none') {
        transitionToSleepy();
      }
    }, 60000); // 10s of inactivity to become sleepy
  }

  function hideBubbleOnly() {
    el.bubble.style.display = 'none';
    el.chain.style.display = 'none';
  }

  function transitionToSleepy() {
    clearSleepTimers();
    state.sleepState = 'sleepy';
    setEmotion('sleepy');
    showBubble("Yawn... I'm getting sleepy... 🥱", []);
    setTimeout(() => {
      if (state.sleepState === 'sleepy') {
        hideBubbleOnly();
      }
    }, 4000);

    state.sleepTimer = setTimeout(() => {
      transitionToSleeping();
    }, 30000); // sleepy -> sleeping
  }

  function transitionToSleeping() {
    clearSleepTimers();
    state.sleepState = 'sleeping';
    setEmotion('sleeping');
    if (state.isHovered) {
      showBubble("Zzz... 💤", []);
    } else {
      hideBubbleOnly();
    }
  }

  function transitionToSleepingBack() {
    clearSleepTimers();
    state.sleepState = 'sleeping-back';
    setEmotion('sleeping-back');
    showBubble("Mm... just 5 more minutes... 💤 (Double tap to wake me!)", []);
  }

  function transitionToWakingUp() {
    clearSleepTimers();
    state.sleepState = 'waking-up';
    setEmotion('waking-up');
    showBubble("Okay, okay! I'm waking up... 🥱", []);
    setTimeout(() => {
      if (state.sleepState === 'waking-up') {
        hideBubbleOnly();
      }
    }, 4000);

    state.sleepTimer = setTimeout(() => {
      transitionToActive();
    }, 15000); // waking-up -> active
  }

  function transitionToActive() {
    clearSleepTimers();
    state.sleepState = 'active';
    setEmotion('idle');
    showBubble("I'm fully awake and ready!", []);
    setTimeout(() => {
      if (state.sleepState === 'active') {
        hideBubble();
      }
    }, 4000);
  }

  function wakeUpFromSleepy() {
    if (state.sleepState === 'sleepy') {
      transitionToActive();
    }
  }

  function vibrateAvatar() {
    el.character.style.animation = 'none';
    void el.character.offsetWidth; // trigger reflow
    el.character.style.animation = 'cogShake 0.5s ease-in-out';

    const messages = [
      "Hey! Stop shaking me! 🫨",
      "Whoa! That tickles! 😂",
      "Let me sleep! 😴",
      "Don't disturb my dream! 💤"
    ];
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    showBubble(randomMsg, []);

    setTimeout(() => {
      if (state.sleepState === 'sleeping-back') {
        el.character.style.animation = 'cogFloat 3s ease-in-out infinite';
      }
    }, 500);
  }

  // ── FILTER UPDATER ───────────────────────────────────
  function updateImageFilter(isHovered) {
    let shadows = [];

    // Add base shadow (deeper on hover)
    if (isHovered) {
      shadows.push('drop-shadow(0 6px 12px rgba(0, 0, 0, 0.25))');
    } else {
      shadows.push('drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15))');
    }

    el.image.style.filter = shadows.join(' ');
  }

  function setEmotion(emotionKey) {
    const sleepStates = ['sleepy', 'sleeping', 'sleeping-back', 'waking-up'];
    const sleepEmotions = ['sleepy', 'sleeping', 'sleeping-back', 'waking-up', 'idle'];

    if (sleepStates.includes(state.sleepState) && !sleepEmotions.includes(emotionKey)) {
      return;
    }

    const emotion = EMOTIONS[emotionKey] || EMOTIONS.idle;
    state.emotion = emotionKey;

    // Set Status Badge
    if (emotion.showBadge && emotion.badge) {
      el.badge.innerHTML = emotion.badge;
      el.badge.style.display = 'flex';
    } else {
      el.badge.style.display = 'none';
    }

    // Set Image Source
    if (emotion.image) {
      el.image.src = emotion.image;
    }

    // Update Image Filters with current emotion glow
    updateImageFilter(state.isHovered || false);

    // Set Animation
    if (emotion.animation === 'cogFloat') {
      el.character.style.animation = 'cogFloat 3s ease-in-out infinite';
    } else if (emotion.animation) {
      el.character.style.animation = `${emotion.animation} 0.5s ease-in-out`;
      // Return to floating animation after dynamic animation ends
      setTimeout(() => {
        if (state.emotion === emotionKey) {
          el.character.style.animation = 'cogFloat 3s ease-in-out infinite';
        }
      }, 500);
    } else {
      el.character.style.animation = 'none';
    }

    // If we are active and returned to idle, reset the idle timer
    if (emotionKey === 'idle') {
      resetIdleTimer();
    } else {
      if (idleTimeout) {
        clearTimeout(idleTimeout);
        idleTimeout = null;
      }
    }
  }

  // ── SHOW / HIDE BUBBLE ───────────────────────────────
  function showBubble(message, actions = [], chainText = null) {
    // Dynamically update alignment based on current character position before display
    const rect = el.character.getBoundingClientRect();
    updateAvatarAlignment(rect.left, rect.top);

    el.message.textContent = message;
    el.actions.innerHTML = '';

    if (chainText) {
      el.chain.style.display = 'block';
      el.chain.textContent = chainText;
    } else {
      el.chain.style.display = 'none';
    }

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = `cogBtn ${action.style || 'cogBtnSecondary'}`;
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      el.actions.appendChild(btn);
    }

    el.bubble.style.display = 'block';
  }

  function hideBubble() {
    el.bubble.style.display = 'none';
    el.chain.style.display = 'none';
    setEmotion('idle');
  }

  // ── SHOW WARNING (called when delete is intercepted) ──
  window.cognitiveShowSuggestion = function (suggestion) {
    state.currentSuggestion = suggestion;
    if (suggestion.is_ghost) {
      setEmotion('confused');
    } else {
      setEmotion('thinking');
    }

    showBubble(
      suggestion.message || `Want me to run "${suggestion.workflow_name}"?`,
      [
        {
          label: 'Yes, do it',
          style: 'cogBtnPrimary',
          onClick: async () => {
            await fetch('/api/cognitive/workflow-response', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflow_id: suggestion.workflow_id,
                response: 'yes',
                matched_steps: suggestion.matched_steps
              })
            });
            setEmotion('happy');
            showBubble('On it! 🚀', []);
            setTimeout(hideBubble, 2000);
          }
        },
        {
          label: "No, I'll do it",
          style: 'cogBtnSecondary',
          onClick: async () => {
            await fetch('/api/cognitive/workflow-response', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflow_id: suggestion.workflow_id,
                response: 'no',
                actual_sequence: [],
                matched_steps: suggestion.matched_steps
              })
            });
            hideBubble();
          }
        }
      ]
    );

    // Also highlight in panel if open
    if (window.cognitiveHighlightWorkflow) {
      window.cognitiveHighlightWorkflow(suggestion.workflow_id);
    }
  };

  window.cognitiveShowSuccess = function (message) {
    setEmotion('celebrate');
    showBubble(message, [{ label: 'OK', style: 'cogBtnSecondary', onClick: hideBubble }]);
    setTimeout(hideBubble, 2500);
  };

  window.cognitiveShowWarning = function (data) {
    state.currentWarning = data;
    setEmotion(data.risk_level === 'HIGH' ? 'urgent' : 'warning');

    const actions = data.external
      ? [
        {
          label: 'Show Dependencies',
          style: 'cogBtnInfo',
          onClick: () => {
            el.chain.style.display = el.chain.style.display === 'none' ? 'block' : 'none';
          }
        },
        {
          label: 'Acknowledge',
          style: 'cogBtnPrimary',
          onClick: hideBubble
        }
      ]
      : [
        {
          label: 'Delete Anyway',
          style: 'cogBtnDanger',
          onClick: () => cognitiveConfirmDelete(data.path)
        },
        {
          label: 'Show Dependencies',
          style: 'cogBtnInfo',
          onClick: () => {
            el.chain.style.display = el.chain.style.display === 'none' ? 'block' : 'none';
          }
        },
        {
          label: 'Cancel',
          style: 'cogBtnSecondary',
          onClick: hideBubble
        }
      ];

    showBubble(
      data.warning_message,
      actions,
      data.dependency_chain
    );
  };

  async function cognitiveConfirmDelete(filePath) {
    setEmotion('thinking');
    el.message.textContent = 'Deleting...';
    el.actions.innerHTML = '';

    try {
      const res = await fetch('/api/control/confirm-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath })
      });
      const result = await res.json();

      if (result.code === 0 || result.success) {
        setEmotion('happy');
        showBubble('Done — file deleted.', [
          { label: 'Close', style: 'cogBtnSecondary', onClick: hideBubble }
        ]);
        setTimeout(hideBubble, 2000);
      } else {
        setEmotion('urgent');
        showBubble(`Delete failed: ${result.stderr || result.error}`, [
          { label: 'OK', style: 'cogBtnSecondary', onClick: hideBubble }
        ]);
      }
    } catch (err) {
      setEmotion('urgent');
      showBubble('Error communicating with server.', [
        { label: 'OK', style: 'cogBtnSecondary', onClick: hideBubble }
      ]);
    }
  }



  // ── DRAGGING LOGIC FOR AVATAR ────────────────────────
  let isDraggingAvatar = false;
  let hasMoved = false;
  let avatarOffsetX = 0;
  let avatarOffsetY = 0;
  let startX = 0;
  let startY = 0;

  el.character.addEventListener('mousedown', (e) => {
    isDraggingAvatar = true;
    hasMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.character.getBoundingClientRect();
    avatarOffsetX = e.clientX - rect.left;
    avatarOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingAvatar) return;

    // Filter out micro-movements to separate click from drag
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
    }

    if (!hasMoved) return;

    let x = e.clientX - avatarOffsetX;
    let y = e.clientY - avatarOffsetY;

    // Bounds check
    const maxX = window.innerWidth - 80;
    const maxY = window.innerHeight - 80;
    x = Math.max(-80, Math.min(x, maxX));
    y = Math.max(-80, Math.min(y, maxY));

    el.avatar.style.left = `${x}px`;
    el.avatar.style.top = `${y}px`;
    el.avatar.style.bottom = 'auto';
    el.avatar.style.right = 'auto';

    updateAvatarAlignment(x, y);
  });

  document.addEventListener('mouseup', (e) => {
    if (isDraggingAvatar) {
      isDraggingAvatar = false;
      if (hasMoved) {
        const rect = el.character.getBoundingClientRect();
        localStorage.setItem('avatar_x', rect.left);
        localStorage.setItem('avatar_y', rect.top);
      }
      hasMoved = false;
    }
  });

  // ── AVATAR CLICK — TOGGLE BUBBLE ─────────────────────
  el.character.addEventListener('click', (e) => {
    // Prevent triggering click if user dragged the avatar
    if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
      return;
    }

    wakeUpFromSleepy();

    if (state.sleepState === 'sleeping') {
      transitionToSleepingBack();
      return;
    }

    if (state.sleepState === 'sleeping-back') {
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
        transitionToWakingUp();
      } else {
        clickTimeout = setTimeout(() => {
          clickTimeout = null;
          vibrateAvatar();
        }, 250);
      }
      return;
    }

    if (state.sleepState === 'waking-up') {
      return;
    }

    if (el.bubble.style.display === 'block') {
      hideBubble();
    } else {
      showBubble(`Hi! I'm ${state.name}. How can I help you today?`, [
        {
          label: 'Dashboard',
          style: 'cogBtnPrimary',
          onClick: () => {
            if (window.electronAPI && window.electronAPI.openExternal) {
              window.electronAPI.openExternal('http://localhost:5050');
            } else {
              window.open('/index.html', '_blank');
            }
            hideBubble();
          }
        },
        {
          label: 'Hide Me',
          style: 'cogBtnDanger',
          onClick: async () => {
            if (confirm('Are you sure you want to hide the Freddy bot?')) {
              await fetch('/api/cognitive/avatar/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disabled: true })
              });
              hideBubble();
            }
          }
        },
        {
          label: 'Kill Me',
          style: 'cogBtnDanger',
          onClick: async () => {
            if (confirm('Are you sure you want to completely terminate both Freddy overlay and backend?')) {
              fetch('/api/cognitive/terminate', { method: 'POST' }).catch(() => {});
              if (window.electronAPI && window.electronAPI.terminate) {
                window.electronAPI.terminate();
              } else {
                window.close();
              }
            }
          }
        }
      ]);
      setEmotion('happy');
    }
  });

  // ── HOVER EFFECT ─────────────────────────────────────
  el.character.addEventListener('mouseenter', () => {
    wakeUpFromSleepy();
    state.isHovered = true;
    el.character.style.transform = 'scale(1.08)';
    updateImageFilter(true);
    if (state.sleepState === 'sleeping') {
      showBubble("Zzz... 😴💤", []);
    }
  });
  el.character.addEventListener('mouseleave', () => {
    state.isHovered = false;
    el.character.style.transform = 'scale(1)';
    updateImageFilter(false);
    if (state.sleepState === 'sleeping') {
      hideBubbleOnly();
    }
  });

  // ── INTERCEPT DELETE RESPONSES FROM EXISTING UI ───────
  // Monkey-patch fetch to intercept cognitive warnings from /api/control
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    // Only intercept /api/control POST calls
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (url.includes('/api/control') && !url.includes('confirm-delete')) {
      const clone = response.clone();
      clone.json().then(data => {
        if (data && data.cognitive_warning === true) {
          window.cognitiveShowWarning(data);
        }
      }).catch(() => { });
    }

    return response;
  };

  // Expose setEmotion globally to allow other scripts to set Freddy's emotion
  window.setAvatarEmotion = setEmotion;

  // Connect to SSE events to dynamically change emotions based on system state
  const avatarEventSource = new EventSource('/api/events');
  avatarEventSource.addEventListener('workflow-started', () => {
    if (state.sleepState !== 'active') return;
    setEmotion('thinking');
    hideBubble();
  });
  avatarEventSource.addEventListener('workflow-stopped', (e) => {
    if (state.sleepState !== 'active') return;
    try {
      const data = JSON.parse(e.data);
      if (data.status === 'aborted') {
        setEmotion('sad');
      } else {
        setEmotion('celebrate');
        showBubble("I have done the work.", []);
      }
    } catch (err) {
      setEmotion('celebrate');
      showBubble("I have done the work.", []);
    }
    setTimeout(() => {
      if (state.emotion === 'sad' || state.emotion === 'celebrate') {
        setEmotion('idle');
        hideBubble();
      }
    }, 4000);
  });
  avatarEventSource.addEventListener('directory-added', () => {
    if (state.sleepState !== 'active') return;
    setEmotion('surprised');
    setTimeout(() => {
      if (state.emotion === 'surprised') setEmotion('idle');
    }, 3000);
  });
  avatarEventSource.addEventListener('scan-complete', () => {
    if (state.sleepState !== 'active') return;
    setEmotion('celebrate');
    setTimeout(() => {
      if (state.emotion === 'celebrate') setEmotion('idle');
    }, 4000);
  });
  avatarEventSource.addEventListener('recording-started', () => {
    if (state.sleepState !== 'active') return;
    setEmotion('learning');
  });
  avatarEventSource.addEventListener('recording-stopped', (e) => {
    if (state.sleepState !== 'active') return;
    try {
      const data = JSON.parse(e.data);
      if (data.success) {
        setEmotion('celebrate');
      } else {
        setEmotion('idle');
      }
    } catch {
      setEmotion('idle');
    }
    setTimeout(() => {
      if (state.emotion === 'celebrate') {
        setEmotion('idle');
      }
    }, 4000);
  });
  avatarEventSource.addEventListener('scheduled-trigger', (e) => {
    try {
      const data = JSON.parse(e.data);
      const { schedule_id, workflow_name } = data;

      // Wake up Freddy if asleep!
      if (state.sleepState !== 'active') {
        transitionToActive();
      }
      setEmotion('thinking');

      let remainingSecs = 15;
      let countdownTimer = null;

      const updateBubble = () => {
        showBubble(
          `Do u want me to run scheduled workflow "${workflow_name}"? (Auto-starting in ${remainingSecs}s...)`,
          [
            {
              label: '▶ Run Now',
              style: 'cogBtnPrimary',
              onClick: async () => {
                if (countdownTimer) clearInterval(countdownTimer);
                await fetch('/api/cognitive/schedule/response', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ schedule_id, response: 'yes' })
                });
                setEmotion('happy');
                showBubble(`Running "${workflow_name}"... 🚀`, []);
                setTimeout(hideBubble, 2500);
              }
            },
            {
              label: 'Cancel',
              style: 'cogBtnSecondary',
              onClick: async () => {
                if (countdownTimer) clearInterval(countdownTimer);
                await fetch('/api/cognitive/schedule/response', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ schedule_id, response: 'no' })
                });
                hideBubble();
              }
            }
          ]
        );
      };

      updateBubble();

      countdownTimer = setInterval(() => {
        remainingSecs--;
        if (remainingSecs <= 0) {
          clearInterval(countdownTimer);
          setEmotion('happy');
          showBubble(`Running scheduled workflow "${workflow_name}"... 🚀`, []);
          setTimeout(hideBubble, 3000);
        } else {
          updateBubble();
        }
      }, 1000);

    } catch (err) {
      console.error('[Avatar] Scheduled trigger parse error:', err);
    }
  });

  avatarEventSource.addEventListener('avatar-toggle', (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.disabled) {
        el.avatar.style.display = 'none';
        hideBubble();
      } else {
        el.avatar.style.display = 'block';
      }
    } catch (err) { }
  });

  async function checkInitialAvatarStatus() {
    try {
      const res = await fetch('/api/cognitive/avatar/status');
      const data = await res.json();
      if (data.disabled) {
        el.avatar.style.display = 'none';
        hideBubble();
      } else {
        el.avatar.style.display = 'block';
      }
    } catch (err) { }
  }
  checkInitialAvatarStatus();

  console.log(`[CognitiveOS] Avatar "${state.name}" initialized`);
  resetIdleTimer();
})();
