<p align="center">
  <img src="Local Behaviour Inference system/public/avatar_character.png" alt="Freddy — Local Behavioral Inference System AI Assistant" width="180" />
</p>

<h1 align="center">Local Behavioral Inference System (LBIS)</h1>

<p align="center">
  <strong>An intelligent, self-learning desktop automation system for Windows</strong><br>
  <em>Observe · Learn · Automate · Protect</em>
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows" />
  <img alt="Node.js" src="https://img.shields.io/badge/runtime-Node.js_22+-339933?style=flat-square&logo=node.js&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/overlay-Electron-47848F?style=flat-square&logo=electron&logoColor=white" />
</p>

---

## 🧠 What is Local Behavioral Inference System?

**Local Behavioral Inference System (LBIS)** is a **cognitive desktop operating layer** that runs on top of Windows. It watches how you use your computer — which apps you open, which commands you run, which files you access — and gradually **learns repeating patterns as automatable workflows**.

Think of it as a personal assistant that silently observes your habits, then says _"Hey, you do this sequence every morning — want me to handle it for you?"_

At its core, LBIS ships with:

- **Freddy** — a draggable on-screen AI avatar (Electron overlay) that suggests, confirms, and executes workflows
- **A full-featured web dashboard** — glassmorphic UI for file management, dependency visualization, workflow control, and real-time system monitoring
- **A behavioral learning engine** — pattern detection, ghost workflows, confidence scoring, and progressive automation

---

## ✨ Key Features

### 🔄 Workflow Recording & Playback
Record any sequence of mouse clicks, keyboard input, app launches, and terminal commands with a single button. LBIS captures every action via a custom C# input hook ([`input_tool.cs`](input_tool.cs)), then replays them precisely — including window focus management, coordinate mapping, and inter-step timing.

### 🧬 Behavioral Pattern Learning
LBIS's **Sequence Engine** observes OS-level events in real time and identifies repeating multi-step patterns. When a pattern reaches a confidence threshold, Freddy proactively suggests automating it. Patterns that go stale are "ghosted" to save storage and can be reactivated if they resurface.

### 📅 Scheduled Workflows
Schedule any learned or recorded workflow to run at a specific time — once, daily, or on selected days of the week. Freddy wakes up at the scheduled time, shows a 15-second countdown, and auto-executes if the user doesn't cancel.

### 🗺️ Multi-Language Dependency Graph
The built-in **Dependency Engine 2.0** scans your project directories and builds a full import/export graph across **20+ languages** — JavaScript/TypeScript, Python, Java/Kotlin, C/C++, C#, Go, Rust, PHP, Ruby, Dart, Swift, and more. The interactive canvas visualization lets you click any node to see what it imports and what depends on it.

### 🛡️ Blast Radius Analysis
Before you delete a file, LBIS checks the dependency graph and warns you if other files depend on it. It calculates a risk score, shows the full dependency chain, and optionally narrates the warning in plain English via a local LLM (Ollama).

### 📂 System Inventory & File Explorer
Automatically scans Start Menu shortcuts, Desktop links, Windows Registry, and UWP packages to build a searchable index of every application and file on your system. Browse as a card grid, file tree, or interactive force-directed graph.

### 💻 Integrated PowerShell Executor
Run PowerShell commands directly from the dashboard against any selected file or folder. Includes quick-action macros (Head 20, ACL, SHA256, Test Path) and full streaming output.

### 🗣️ Natural Language Commands
Type plain English commands like `open Chrome`, `list Downloads`, `read config.json`, or `create folder Projects` into the command bar and the system translates them into executable operations.

### 📡 Real-Time System Observer
A background WMI watcher captures every process launch, terminal command, file access, and window title change system-wide. Events feed into the behavioral engine and are logged as semantic events in the SQLite database.

### 💾 Storage Monitor
A dedicated storage analysis page shows disk usage breakdowns, largest files, and capacity trends — accessible from the sidebar.

---

## ⚡ Memory & Performance Optimizations

LBIS is engineered to run silently 24/7 in the background with near-zero overhead. Through adaptive schema pruning, virtual token addressing, and automated eviction, **LBIS can store 10K workflows in less than 150MB** while keeping background CPU below 1% and heap memory flat.

### Key Optimization Techniques at a Glance:
- **👻 Ghost Workflows:** Inactive workflows (>60 days) have verbose step/plan graphs stripped down to 8-character SHA-1 structural fingerprints (`step_hash`), shrinking pattern footprint by ~90% while retaining instant zero-loss reactivation.
- **🎯 Tokenized Memory & Prefix Indexing:** Replaces heavy string scanning with compact virtual hexadecimal pointers (`0x0001`...) and character-sliced SQLite B-trees, reducing candidate matching from `O(N * L)` to `O(1)`.
- **🗄️ Bounded Storage Budget (`enforceStorageLimit`):** Real-time SQLite page monitoring (`PRAGMA page_count * PRAGMA page_size`) enforces a strict 500 MB ceiling, purging the oldest 1,000 events in a sliding FIFO window followed by physical `VACUUM` space reclamation.
- **🛑 Multi-Tier Noise Throttling:** 1-hour same-file access cooldown, longest-overlap history streaming for terminal polls, 500ms WMI windows, and internal PID suppression filter out >95% of redundant OS events.
- **⚡ Iterative Dependency Engine:** Replaces recursion with heap-based array traversal, 500-item batch transactions, and `mtimeMs` AST caching, capping peak scanner RAM to <80 MB on massive repos.
- **🪶 Native Runtime Footprint:** Powered directly by Node 22's built-in `node:sqlite` (`DatabaseSync`) and a frameless, transparent Electron overlay.

> 📖 **Deep Dive:** For detailed description see [`docs/optimizations.md`](docs/optimizations.md) file.

---

## Performance & Memory Impact Summary

| Metric | Without Optimizations | With LBIS Optimizations | Improvement |
|---|---|---|---|
| **Storage per 10,000 Workflows** | ~1.2 GB – 1.8 GB | **< 150 MB** | **~88%–91% reduction** |
| **Search / Lookup Latency** | `O(N * L)` linear scan (~40–80 ms) | `O(1)` B-tree lookup (**< 0.5 ms**) | **~100x faster** |
| **Continuous Disk Write Churn** | Continuous (~5–10 MB/hr) | Throttled / Deduplicated (**< 0.2 MB/hr**) | **> 95% I/O reduction** |
| **Max Database Disk Allocation** | Unbounded (grows indefinitely) | **Capped at 500 MB** (configurable) | **Zero runaway bloat** |
| **Full Repo Dependency Scan RAM** | Spikes to 600 MB – 1.2 GB | **Capped at < 80 MB** | **~85% memory saved** |
| **Background CPU Utilization** | 3% – 8% continuous | **< 0.8% average** | **Near-zero idle footprint** |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Electron Desktop Overlay                  │
│              (transparent, always-on-top window)             │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐   │
│   │  Freddy Avatar (avatar.js)                           │   │
│   │  • Draggable character with emotion states           │   │
│   │  • Sleep/wake cycle with idle detection              │   │
│   │  • Workflow suggestion bubbles                       │   │
│   │  • Scheduled trigger countdown UI                    │   │
│   └──────────────────────────────────────────────────────┘   │
└────────────────────────────┬─────────────────────────────────┘
                             │ SSE (Server-Sent Events)
                             ▼
┌──────────────────────────────────────────────────────────────┐
│                   Express Server (server.js)                 │
│                    http://localhost:5050                      │
│                                                              │
│   ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│   │ System Observer │  │ Sequence       │  │ Behavioral   │  │
│   │ (WMI Watcher,  │  │ Engine         │  │ Memory       │  │
│   │  PS History,   │──▶ (Pattern       │──▶ (Discover,   │  │
│   │  Window Titles)│  │  Detection)    │  │  Reinforce,  │  │
│   └────────────────┘  └────────────────┘  │  Ghost)      │  │
│                                           └──────────────┘  │
│   ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│   │ Workflow       │  │ Dependency     │  │ File System  │  │
│   │ Executor       │  │ Engine 2.0     │  │ Watcher      │  │
│   │ (Record/Play)  │  │ (20+ langs)    │  │ (Live FS)    │  │
│   └────────────────┘  └────────────────┘  └──────────────┘  │
│                                                              │
│   ┌────────────────┐  ┌────────────────┐  ┌──────────────┐  │
│   │ Scanner        │  │ Command        │  │ Cognitive    │  │
│   │ (Apps, UWP,    │  │ Parser (NLP)   │  │ Narrator     │  │
│   │  Registry)     │  │                │  │ (LLM / tmpl) │  │
│   └────────────────┘  └────────────────┘  └──────────────┘  │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│               SQLite Database (system_portal_v3.db)          │
│                                                              │
│  Tables: semantic_events · indexed_items · workflow_patterns │
│          scanned_directories · file_dependencies             │
│          scheduled_workflows · failure_history               │
│          checkup_logs · token_index · prefix_index           │
└──────────────────────────────────────────────────────────────┘
```

---

## 📁 Project Structure

```
local-behavioral-inference-system/
├── bootstrap.js              # Entry point — installs deps, inits DB, starts server
├── server.js                 # Express server — all API routes, workflow executor, scheduler
├── database.js               # SQLite schema, migrations, CRUD operations
├── powershell.js             # PowerShell execution helpers (run, spawn, script)
├── scanner.js                # Application scanner (shortcuts, registry, UWP)
├── watcher.js                # Real-time filesystem watcher with blast radius hooks
├── system_observer.js        # Background WMI process watcher, terminal history polling
├── sequence_engine.js        # Behavioral pattern detection and workflow learning
├── behavioral_memory.js      # Workflow lifecycle: discover, reinforce, ghost, suggest
├── cognitive_narrator.js     # LLM-powered plain-English narration (Ollama integration)
├── command_parser.js         # Natural language → system command translator
├── dependency_graph.js       # Multi-language dependency scanner and blast radius
├── electron_app.js           # Electron overlay window (Freddy's desktop host)
├── input_tool.cs             # C# source — low-level mouse/keyboard recorder & simulator
├── log_cmd.js                # CMD wrapper helper — forwards terminal events to server
├── cmd_autorun.bat           # Doskey macros for CMD command interception
├── cmd_wrapper.bat           # CMD command logger wrapper
├── package.json              # Project manifest (express, electron)
│
├── dependency_engine/        # Pluggable multi-language dependency analysis
│   ├── engine.js             # Core file processor with caching and timeout
│   ├── registry.js           # File extension → parser/resolver mapping
│   ├── parserRegistry.js     # Parser module registry (25 parsers)
│   ├── resolverRegistry.js   # Resolver module registry (9 resolvers)
│   ├── parsers/              # Language-specific import/export parsers
│   │   ├── languages/        # ecmascript, python, jvm, c_family, csharp, go, rust, ...
│   │   └── containers/       # docker
│   ├── resolvers/            # Path resolution logic per ecosystem
│   └── cache/                # In-memory dependency cache
│
└── public/                   # Web dashboard (served as static files)
    ├── index.html            # Main dashboard — search, graphs, control center
    ├── index.css             # Glassmorphic design system (~2000 lines)
    ├── index.js              # Dashboard logic — SSE, search, graphs, file ops
    ├── avatar.js             # Freddy avatar — emotions, sleep, drag, workflow prompts
    ├── workflows_panel.js    # Slide-out workflow panel — record, play, schedule, edit
    ├── workflows_graph.js    # Canvas-based workflow relationship visualization
    ├── storage.html          # Storage monitor — disk usage analysis
    └── avatar_character.png  # Freddy's character sprite
```

---

## 🚀 Getting Started

### Prerequisites

| Requirement | Details |
|---|---|
| **OS** | Windows 10 / 11 |
| **Node.js** | v22.0 or higher (uses native `node:sqlite`) |
| **npm** | Bundled with Node.js |
| **.NET Framework** | v4.0+ (for auto-compiling `input_tool.cs` via `csc.exe`) |

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-username/local-behavioral-inference-system.git
cd local-behavioral-inference-system

# 2. Start the server (auto-installs dependencies on first run)
npm start
```

On first launch, `bootstrap.js` will:
1. Run `npm install` to fetch Express and Electron
2. Initialize the SQLite database (`system_portal_v3.db`)
3. Compile `input_tool.cs` → `input_tool.exe` using the system's .NET `csc.exe`
4. Start the Express server on **http://localhost:5050**
5. Launch the Electron overlay (Freddy appears on your desktop)

### Accessing the Dashboard

Open **http://localhost:5050** in any browser to access the full system dashboard.

---

## 🎮 Usage Guide

### Recording a Workflow
1. Click Freddy or open the Workflows panel from the dashboard
2. Click **🔴 Start Recording** and give it a name
3. Perform your actions (open apps, click, type, run commands)
4. Click **⏹ Stop Recording** — the workflow is saved instantly

### Playing a Workflow
- From the **Workflows panel**: click the ▶ Play button on any workflow card
- From **Freddy**: when he suggests a recognized pattern, click "Yes"
- Workflows replay all recorded actions including mouse movement, keyboard input, and window focus

### Scheduling a Workflow
1. Open the workflow card and click **📅 Schedule**
2. Choose frequency: **Once**, **Daily**, or **Specific Days**
3. Set the time and click **Save Plan**
4. Freddy will wake up at the scheduled time with a 15-second auto-run countdown

### Natural Language Commands
Type into the command bar:
- `open Chrome` — launches Chrome
- `list Downloads` — shows folder contents
- `read package.json` — displays file content
- `delete old_backup` — removes a file (with blast radius check)
- `create folder MyProject` — creates a new directory

---

## ⚙️ Configuration

### LLM Integration (Optional)
The system can use a local LLM for natural-language warnings and narration. Configure via environment variables:

```bash
set LLM_ENDPOINT=http://localhost:11434/api/generate
set LLM_MODEL=qwen3:1.7b
npm start
```

If no LLM is available, it falls back to template-based messages automatically.

### Storage Limit
The default database storage limit is **500 MB**. When exceeded, the oldest semantic events are automatically evicted. This can be adjusted in the `storage_meta` table.

---

## 🔐 Privacy & Security

- **100% local** — no data leaves your machine. All processing happens on localhost.
- **No cloud dependencies** — works fully offline after `npm install`.
- **No telemetry** — zero analytics, tracking, or phone-home behavior.
- **SQLite storage** — all data lives in a single local database file.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js 22+, Express 5 |
| **Frontend** | Vanilla HTML/CSS/JS, Canvas API |
| **Desktop Overlay** | Electron |
| **Database** | SQLite (via `node:sqlite`) |
| **Input Automation** | Custom C# tool (Win32 API, UI Automation) |
| **Process Monitoring** | PowerShell WMI Events |
| **LLM (optional)** | Ollama / any OpenAI-compatible endpoint |

---


<p align="center">
  <strong>Built with ❤️ for power users who believe their computer should learn from them.</strong>
</p>
