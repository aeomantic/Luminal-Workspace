# Luminal Workspace

A modern, VS Code-style desktop IDE built with Tauri v2 (Rust) + React 19. Features a unified custom title bar, an embedded interactive terminal, a Monaco code editor, and a lazy-loading file explorer — all styled with the *Kinetic Void* dark design system.

---

## Features

| Feature | Status |
|---|---|
| Unified custom title bar (menu + window controls on one row) | ✅ Phase 2 |
| Embedded terminal (xterm.js + real PTY via portable-pty) | ✅ Phase 2 |
| Monaco editor with syntax highlighting and tab management | ✅ Phase 1 |
| File explorer with context menus and inline renaming | ✅ Phase 1 |
| Command palette (Ctrl+K) | ✅ Phase 1 |
| Full-text search | 🔜 Phase 3 |
| Git integration | 🔜 Phase 3 |
| Extension marketplace | 🔜 Phase 4 |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Tauri v2 (Rust backend + WebView frontend) |
| UI | React 19, TypeScript, Tailwind CSS v3 |
| Editor | Monaco Editor (`@monaco-editor/react`) |
| Terminal | xterm.js (`@xterm/xterm`, `@xterm/addon-fit`) |
| PTY backend | `portable-pty` (Rust crate) |
| Icons | Lucide React |
| Command palette | cmdk |
| File system | `@tauri-apps/plugin-fs` |

---

## Project Structure

```
luminal-workspace/
├── src/                              # React frontend
│   ├── App.tsx                       # Root layout: title bar, panels, editor shell
│   ├── main.tsx                      # React entry point
│   ├── index.css                     # Global styles, Tailwind, drag-region classes
│   ├── global.d.ts                   # Ambient TypeScript declarations
│   ├── lib/
│   │   └── utils.ts                  # cn() Tailwind merge helper
│   └── components/
│       ├── TitleBar/
│       │   ├── TitleBar.tsx          # Unified title bar with drag regions
│       │   └── index.ts
│       ├── Terminal/
│       │   ├── TerminalPanel.tsx     # xterm.js panel + drag-to-resize handle
│       │   └── index.ts
│       ├── Editor/
│       │   ├── EditorArea.tsx        # Monaco editor + tab bar
│       │   └── useEditorTabs.ts      # Tab state hook (open, close, save, dirty)
│       ├── FileExplorer/
│       │   ├── FileExplorer.tsx      # Sidebar file browser
│       │   ├── FileTreeNode.tsx      # Single tree row with icons
│       │   ├── ContextMenu.tsx       # Right-click portal menu
│       │   ├── useFileSystem.ts      # Tauri FS operations hook
│       │   ├── types.ts              # FileNode interface
│       │   └── index.ts
│       └── CommandPalette.tsx        # Fuzzy command launcher (cmdk)
└── src-tauri/                        # Rust / Tauri backend
    ├── src/
    │   ├── main.rs                   # Binary entry (calls lib::run)
    │   └── lib.rs                    # App setup + PTY commands
    ├── Cargo.toml                    # Rust dependencies
    ├── tauri.conf.json               # Window config (decorations: false, dimensions)
    └── capabilities/
        └── default.json              # Tauri v2 security permissions
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js** 18+ | `node --version` |
| **Rust** (via rustup) | `rustup update stable` |
| **Tauri system deps** | See [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |
| **Windows**: VS C++ Build Tools | Required for the Rust compiler |
| **Linux**: `libwebkit2gtk`, `libappindicator` | Distro packages |

---

## Setup & Installation

```bash
# 1. Install JS dependencies
npm install

# 2. Launch in development mode (starts Vite dev server + Tauri window)
npm run tauri dev

# 3. Build a production bundle
npm run tauri build
```

The first `tauri dev` run will compile the Rust backend (including `portable-pty`) which may take a few minutes. Subsequent runs are incremental.

---

## The Unified Title Bar

### Why a custom title bar?

`tauri.conf.json` sets `"decorations": false`, which removes the native OS window chrome (title bar + border). This gives the app full control over the top area and allows merging the menu bar and window controls onto a single row — saving vertical space the same way VS Code does.

### Layout (left → right)

```
[ L icon ] [ File ] [ Edit ] [ View ] [ Terminal ]  ←drag zone / title→  [ Command Palette ]  [ ─ ] [ ☐ ] [ ✕ ]
```

### Drag regions (CSS)

Two utility classes are defined in `src/index.css`:

```css
/* Applied to the outer <header> — the whole bar is a drag target by default */
.titlebar-drag {
  -webkit-app-region: drag;
  app-region: drag;
}

/* Applied to every interactive child (menus, buttons) to opt out of dragging */
.titlebar-no-drag {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
```

The center title text uses `pointer-events: none` so it doesn't interfere with dragging while still being visually present.

### Window controls

`TitleBar.tsx` uses `@tauri-apps/api/window` to drive the native window:

```typescript
import { getCurrentWindow } from '@tauri-apps/api/window'
const win = getCurrentWindow()

win.minimize()        // ─ button
win.toggleMaximize()  // ☐ / ❐ button (icon changes based on isMaximized state)
win.close()           // ✕ button
```

The maximize/restore icon updates in real time via `win.onResized()`:

```typescript
win.onResized(async () => {
  setIsMaximized(await win.isMaximized())
})
```

### Menu auto-close behaviour

`TitleBar`'s internal `MenuDropdown` always calls `onClose()` after firing any menu item's action. This means `App.tsx` menu item definitions don't need to manually close the menu — it is handled automatically.

---

## Integrated Terminal

### Architecture overview

```
┌─────────────────────────────────────────────────────┐
│  TerminalPanel.tsx (React)                          │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  xterm.js    │     │  Tauri IPC (invoke/emit)  │  │
│  │  Terminal    │────▶│  pty_write(data)          │  │
│  │  instance    │◀────│  listen('pty-output')     │  │
│  └──────────────┘     └──────────────────────────┘  │
└───────────────────────────────┬─────────────────────┘
                                │ Tauri command bridge
┌───────────────────────────────▼─────────────────────┐
│  lib.rs (Rust)                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  portable-pty                                │   │
│  │  MasterPty ◀──── reader thread ────▶ emit()  │   │
│  │  MasterPty.take_writer() ◀── pty_write cmd   │   │
│  └───────────────────┬──────────────────────────┘   │
│                      │ PTY pair                      │
│  ┌───────────────────▼──────────────────────────┐   │
│  │  System shell (PowerShell / zsh / bash)      │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### Tauri commands (`lib.rs`)

| Command | Parameters | Description |
|---|---|---|
| `pty_create` | `cols: u16, rows: u16` | Open PTY, spawn shell, start reader thread |
| `pty_write` | `data: String` | Write raw bytes from xterm.js to PTY master |
| `pty_resize` | `cols: u16, rows: u16` | Notify PTY of viewport dimension change |
| `pty_close` | — | Drop all PTY handles; shell receives SIGHUP |

### Data flow (detailed)

```
User types in xterm.js
  ──▶ term.onData(data)
      ──▶ invoke('pty_write', { data })
          ──▶ Rust: writer.write_all(data.as_bytes())
              ──▶ Shell stdin receives input

Shell produces output
  ──▶ Rust reader thread: reader.read(&mut buf)
      ──▶ app_handle.emit("pty-output", data)
          ──▶ Frontend: listen('pty-output', ev => term.write(ev.payload))
```

### Resize flow

When the user drags the terminal panel's resize handle, or the window resizes:

```
ResizeObserver fires on container div
  ──▶ fitAddon.fit()        (recalculates cols/rows from pixel size)
      ──▶ invoke('pty_resize', { cols, rows })
          ──▶ Rust: master.resize(PtySize { rows, cols, .. })
              ──▶ Shell receives SIGWINCH (terminal size changed)
```

### Shell selection (Rust)

```rust
let shell = if cfg!(target_os = "windows") {
    "powershell.exe"
} else if std::path::Path::new("/bin/zsh").exists() {
    "/bin/zsh"
} else {
    "/bin/bash"
};
```

### UI features

- **Drag-to-resize**: Grab the 3 px handle at the top of the panel; height is clamped to 80–600 px.
- **Toggle**: `Terminal → New Terminal` menu item or `Ctrl+`` ` keyboard shortcut.
- **Theme**: Matches the *Kinetic Void* palette — `#0e0e0e` background, Electric Blue cursor, Mint Green output.
- **Scrollback**: 5 000 lines.

---

## Design System — Kinetic Void

| Token | Value | Usage |
|---|---|---|
| `surface` | `#131313` | App background |
| `surface-container-low` | `#1c1b1b` | Activity bar, sidebar, status bar |
| `surface-container` | `#252525` | Dropdowns, modals |
| `primary` (Electric Blue) | `#00b4d8` | Active icons, caret, terminal cursor |
| `accent` (Mint Green) | `#39d98a` | Strings, success states |
| `secondary` (Purple) | `#9d8df1` | Numbers, secondary accents |
| `tertiary` (Gold) | `#e2c97e` | Warnings, tertiary highlights |
| `on-surface` | `#e8e8e8` | Primary text |

**No borders** — depth is created exclusively through background-colour shifts.  
**Glassmorphism** — `backdrop-blur` + semi-transparent backgrounds on floating elements.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Open Command Palette |
| `Ctrl+S` | Save active file |
| `Ctrl+`` ` | Toggle terminal panel |
| `Ctrl+Shift+E` | Toggle Explorer sidebar |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+F` | Find in file |

---

## Security & Permissions

Tauri v2 uses a capability-based permission system (`src-tauri/capabilities/default.json`). Permissions granted:

- **File system**: read directory, read/write text files, mkdir, remove, rename, copy — scoped to the user's home directory.
- **Dialogs**: open file/folder picker.
- **Window**: minimize, toggle-maximize, close, is-maximized, start-dragging — required for the custom title bar.
- **Events**: included via `core:default` — enables `listen()` for `pty-output` events.

Custom PTY commands (`pty_create`, `pty_write`, `pty_resize`, `pty_close`) are registered via `.invoke_handler(tauri::generate_handler![...])` and are automatically accessible from the frontend without additional capability entries.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Run `npm run tauri dev` to start the development environment.
3. Follow the *Kinetic Void* design conventions: no borders, background-shift depth, Electric Blue accents.
4. Submit a pull request with a clear description of the change.
