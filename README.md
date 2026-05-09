# Luminal Workspace

A modern, VS Code-style desktop IDE built with **Tauri v2** (Rust) + **React 19** + **TypeScript** + **Tailwind CSS**. Features split-screen editing, a hybrid PDF viewer, a multi-instance terminal, an AI coding assistant, Git integration, and a lazy-loading file explorer — all styled with the *Kinetic Void* dark design system.

---

## Features

| Feature | Status |
|---|---|
| Monaco code editor (50+ languages) | ✅ |
| Split-screen editing (horizontal & vertical) | ✅ |
| Hybrid PDF viewer (Rendered + Raw) | ✅ |
| Multi-instance terminal with tabs | ✅ |
| Terminal clipboard, rename, fullscreen | ✅ |
| AI assistant (Anthropic, OpenAI, Groq, GitHub Models) | ✅ |
| Git source control panel | ✅ |
| File explorer with tree, rename, create, delete | ✅ |
| Auto-save (1.5 s debounce) | ✅ |
| Resizable sidebar (drag handle, localStorage) | ✅ |
| Command palette (Ctrl+K) | ✅ |
| Mobile / browser responsive layout | ✅ |

---

## Quick Start

### Browser (Vercel)
Visit the deployed app — file-system features (folder open, terminal, PDF) require the desktop app.

### Desktop (Tauri)

```bash
# Install dependencies
npm install

# Development
npm run tauri dev

# Production installer (outputs MSI + NSIS in src-tauri/target/release/bundle/)
npm run tauri build
```

**Prerequisites:** Node 20+, Rust (stable), [Tauri prerequisites](https://tauri.app/start/prerequisites/).

---

## Architecture

```
src/
├── App.tsx                        # Root layout, split-editor state, menus
├── components/
│   ├── Editor/
│   │   ├── SplitEditor.tsx        # react-resizable-panels split-pane wrapper
│   │   ├── EditorArea.tsx         # Monaco + PDF viewer per group
│   │   └── useEditorTabs.ts       # Shared tab state (open, close, save, dirty)
│   ├── PdfViewer/
│   │   └── PdfViewer.tsx          # pdfjs-dist rendered view + raw text toggle
│   ├── Terminal/
│   │   └── TerminalPanel.tsx      # Multi-instance xterm.js + PTY management
│   ├── FileExplorer/              # Lazy tree, rename, create, delete
│   ├── AIPanel/                   # Multi-provider streaming chat
│   ├── SourceControl/             # Git status, stage, commit, push/pull
│   ├── TitleBar/                  # Custom drag region + menu bar
│   └── CommandPalette/            # Ctrl+K palette
└── lib/
    └── utils.ts                   # cn() + isTauri()

src-tauri/src/lib.rs               # Rust: multi-PTY, AI streaming, Git commands
```

---

## Split-Pane Editor

### State shape

```typescript
// Each group represents one editor pane
interface EditorGroup {
  id: string            // stable key ("main", "group-1234567890")
  activeTabPath: string | null  // which tab this pane is showing
}

// App-level state
groups:         EditorGroup[]   // length 1 = single pane, 2 = split
splitDirection: 'none' | 'horizontal' | 'vertical'
focusedGroupId: string          // which pane receives keyboard focus / AI context
```

All groups share the same `tabs: EditorTab[]` list from `useEditorTabs`. Monaco uses per-URI models internally, so **if two panes open the same file, edits in one are reflected in the other instantly** — no synchronisation code needed.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+\` | Split editor right (horizontal) |
| `Ctrl+Shift+\` | Split editor down (vertical) |
| Via **Layout** menu | Close Editor Group |

Use the **Layout** menu in the title bar to access all split commands. The `×` button in the tab bar closes the active group when in split mode.

---

## Hybrid PDF Viewer

When you open a `.pdf` file from the explorer, `EditorArea` renders `PdfViewer` instead of Monaco.

### Toggle logic

```typescript
// PdfViewer.tsx — persisted per file
const STORAGE_KEY = (tabPath: string) => `luminal:pdfView:${tabPath}`

// On mount: read localStorage to restore last-used mode
const [mode, setMode] = useState<'rendered' | 'raw'>(() => {
  const saved = localStorage.getItem(STORAGE_KEY(tabPath))
  return saved === 'raw' ? 'raw' : 'rendered'
})

// On switch: write back immediately
function switchMode(next: 'rendered' | 'raw') {
  setMode(next)
  localStorage.setItem(STORAGE_KEY(tabPath), next)
}
```

**Rendered mode** — `pdfjs-dist` renders each page to a canvas via `react-pdf`. Navigate with the `‹ ›` arrows in the toolbar.

**Raw mode** — The file is read as binary (`readFile` → `Uint8Array`) and decoded as latin-1 so every byte is preserved. The resulting string is shown in a read-only Monaco editor, letting you inspect the PDF stream structure, object headers, and cross-reference tables.

> **Note:** PDF files are only readable in the desktop app (Tauri). The browser version shows an explanatory message.

---

## Terminal

### Multi-instance management

Each terminal instance gets its own PTY session in Rust, keyed by a unique string ID:

```
Rust: HashMap<String, PtyHandles>
Events: "pty-output-{id}", "pty-exit-{id}"
```

The frontend keeps all `XtermPane` components mounted simultaneously — switching tabs uses `visibility: hidden` rather than unmounting, so the PTY process and full scrollback history survive.

### Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+\`` | Toggle terminal panel open/close |
| `+` button | New terminal instance |
| Double-click tab | Rename terminal |
| `Enter` / `Esc` during rename | Confirm / cancel |
| `⤢` button (or `F11` title) | Fullscreen (covers entire editor area) |
| `⌄` button | Minimize panel (PTY stays alive) |
| `×` on tab | Close that terminal instance |

### Clipboard behaviour

The terminal uses a **custom key handler** that intercepts clipboard shortcuts before they reach the shell:

```typescript
term.attachCustomKeyEventHandler((e) => {
  const ctrl = e.ctrlKey || e.metaKey
  // Copy — only when text is selected (no interrupt sent)
  if (ctrl && e.key === 'c' && term.hasSelection()) {
    navigator.clipboard.writeText(term.getSelection())
    return false   // consumed
  }
  // Paste
  if (ctrl && e.key === 'v') {
    navigator.clipboard.readText().then(text => term.paste(text))
    return false
  }
  return true  // pass everything else to xterm
})
```

`Ctrl+C` **with a selection** → copies. `Ctrl+C` **without a selection** → sends the interrupt signal to the shell as normal.

### Renaming terminals

Double-click any terminal tab label. An inline text input appears pre-filled with the current name. Press `Enter` to confirm or `Esc` to cancel. The new name is stored in React state and persists for the session.

---

## AI Assistant

Configure via the **Bot** icon in the activity bar. Supported providers:

| Provider | Env key format | Models |
|---|---|---|
| Anthropic | `sk-ant-api03-…` | claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5 |
| OpenAI | `sk-…` | gpt-4o, gpt-4o-mini, o1-mini |
| Groq | `gsk_…` | llama-3.3-70b-versatile, mixtral-8x7b |
| GitHub Models | `github_pat_…` | gpt-4o, phi-4, meta-llama-3.1 |

Config is stored at `~/.luminal/config.json` (never committed). Select text in the editor before sending to include it as code context.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS (Kinetic Void theme) |
| Code editor | Monaco Editor (`@monaco-editor/react`) |
| Split panes | `react-resizable-panels` |
| PDF rendering | `react-pdf` + `pdfjs-dist` |
| Terminal | xterm.js v5 (`@xterm/xterm`, `@xterm/addon-fit`) |
| File system | `@tauri-apps/plugin-fs` |
| Dialog | `@tauri-apps/plugin-dialog` |
| AI streaming | `reqwest` SSE (Rust) + Tauri events |
