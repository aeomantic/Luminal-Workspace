import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Files,
  Search,
  GitBranch,
  Puzzle,
  Bug,
  Settings,
  Bot,
} from 'lucide-react'
import {
  CommandPalette,
  useCommandPaletteShortcut,
  DEFAULT_COMMANDS,
  type EditorCommand,
} from './components/CommandPalette'
import { FileExplorer, type FileExplorerHandle } from './components/FileExplorer'
import { EditorArea } from './components/Editor/EditorArea'
import { useEditorTabs } from './components/Editor/useEditorTabs'
import type { FileNode } from './components/FileExplorer/types'
import { TitleBar, type MenuItemDef } from './components/TitleBar'
import { TerminalPanel } from './components/Terminal'
import { SourceControlPanel } from './components/SourceControl'
import { AIPanel } from './components/AIPanel'
import { cn } from './lib/utils'

// ── Activity bar ──────────────────────────────────────────────────────────────

type PanelId = 'files' | 'search' | 'git' | 'ai' | 'extensions' | 'debug'

interface ActivityItem { id: PanelId; icon: React.ReactNode; label: string }

const ACTIVITY_ITEMS: ActivityItem[] = [
  { id: 'files',      icon: <Files     size={20} />, label: 'Explorer (Ctrl+Shift+E)'  },
  { id: 'search',     icon: <Search    size={20} />, label: 'Search (Ctrl+Shift+F)'    },
  { id: 'git',        icon: <GitBranch size={20} />, label: 'Source Control'            },
  { id: 'ai',         icon: <Bot       size={20} />, label: 'AI Assistant'              },
  { id: 'extensions', icon: <Puzzle    size={20} />, label: 'Extensions'                },
  { id: 'debug',      icon: <Bug       size={20} />, label: 'Run and Debug'             },
]

const MENU_NAMES = ['File', 'Edit', 'View', 'Terminal'] as const

// ── Command registry ──────────────────────────────────────────────────────────

const APP_COMMANDS: EditorCommand[] = [
  ...DEFAULT_COMMANDS,
  {
    id: 'app.quit',
    label: 'Quit Luminal Workspace',
    description: 'Close the application',
    group: 'File',
    shortcut: 'Ctrl+Q',
    action: () => { console.log('[cmd] quit') },
  },
]

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [paletteOpen,  setPaletteOpen]  = useState(false)
  const [activePanel,  setActivePanel]  = useState<PanelId | null>('files')
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rootAbsPath,  setRootAbsPath]  = useState<string | null>(null)

  // Responsive: track whether we're in mobile layout (< 768px)
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false,
  )
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  // Sidebar width with localStorage persistence
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('luminal:sidebarWidth')
    return saved ? Number(saved) : 256
  })
  const isDraggingRef      = useRef(false)
  const dragStartXRef      = useRef(0)
  const dragStartWidthRef  = useRef(0)

  const fileExplorerRef  = useRef<FileExplorerHandle>(null)
  const selectionGetterRef = useRef<() => string>(() => '')

  const editorTabs = useEditorTabs()
  const {
    tabs,
    activeTabPath,
    activeTab,
    openTab,
    openFileByPath,
    newUntitledTab,
    closeTab,
    closeAllTabs,
    forceCloseByPrefix,
    focusTab,
    setDirty,
    saveTab,
  } = editorTabs

  // ── Palette ───────────────────────────────────────────────────────────────
  const togglePalette = useCallback(() => setPaletteOpen((p) => !p), [])
  const closePalette  = useCallback(() => setPaletteOpen(false),     [])
  useCommandPaletteShortcut(togglePalette)

  // ── Ctrl+` — toggle terminal panel ───────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        setTerminalOpen((p) => !p)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Sidebar resize drag ───────────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingRef.current) return
      const delta    = e.clientX - dragStartXRef.current
      const newWidth = Math.max(160, Math.min(480, dragStartWidthRef.current + delta))
      setSidebarWidth(newWidth)
      localStorage.setItem('luminal:sidebarWidth', String(newWidth))
    }
    function onMouseUp() { isDraggingRef.current = false }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup',   onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup',   onMouseUp)
    }
  }, [])

  function handleSidebarDragStart(e: React.MouseEvent) {
    isDraggingRef.current     = true
    dragStartXRef.current     = e.clientX
    dragStartWidthRef.current = sidebarWidth
    e.preventDefault()
  }

  // ── Activity bar ──────────────────────────────────────────────────────────
  function handleActivityClick(id: PanelId) {
    setActivePanel((prev) => (prev === id ? null : id))
  }

  // Mobile: toggle sidebar drawer
  function handleSidebarToggle() {
    setActivePanel((prev) => (prev ? null : 'files'))
  }

  // ── File explorer callbacks ───────────────────────────────────────────────
  const handleFileOpen = useCallback((node: FileNode) => {
    void openTab(node)
  }, [openTab])

  const handleFileDelete = useCallback((path: string) => {
    forceCloseByPrefix(path)
  }, [forceCloseByPrefix])

  // ── Editor selection getter ───────────────────────────────────────────────
  const getEditorSelection = useCallback(() => selectionGetterRef.current(), [])

  // ── Menu item definitions ─────────────────────────────────────────────────
  function getMenuItems(menu: string): MenuItemDef[] {
    switch (menu) {
      case 'File': return [
        {
          label: 'New File',
          shortcut: 'Ctrl+N',
          action: () => newUntitledTab(),
        },
        {
          label: 'Open File…',
          shortcut: 'Ctrl+O',
          action: () => void openFileByPath(),
        },
        {
          label: 'Open Folder…',
          action: () => {
            closeAllTabs()
            fileExplorerRef.current?.requestOpenFolder()
          },
        },
        { type: 'sep' },
        {
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
            )
          },
        },
      ]
      case 'Edit': return [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
            )
          },
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
            )
          },
        },
        { type: 'sep' },
        {
          label: 'Find in File',
          shortcut: 'Ctrl+F',
          action: () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }),
            )
          },
        },
      ]
      case 'View': return [
        {
          label: 'Toggle Explorer',
          shortcut: 'Ctrl+Shift+E',
          action: () => handleActivityClick('files'),
        },
        { type: 'sep' },
        {
          label: 'Command Palette',
          shortcut: 'Ctrl+K',
          action: () => togglePalette(),
        },
      ]
      case 'Terminal': return [
        {
          label: 'New Terminal',
          shortcut: 'Ctrl+`',
          action: () => setTerminalOpen(true),
        },
        {
          label: 'Close Terminal',
          action: () => setTerminalOpen(false),
          disabled: !terminalOpen,
        },
      ]
      default: return []
    }
  }

  // ── Language label for status bar ─────────────────────────────────────────
  const langLabel = activeTab
    ? activeTab.language.charAt(0).toUpperCase() + activeTab.language.slice(1)
    : '—'

  const sidebarOpen = activePanel !== null
  const menus = MENU_NAMES.map((name) => ({ name, items: getMenuItems(name) }))

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface font-ui text-on-surface">

      {/* ── Unified title bar (full width, single row) ────────────────────── */}
      <TitleBar
        menus={menus}
        onPaletteOpen={togglePalette}
        onSidebarToggle={handleSidebarToggle}
      />

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Activity bar — hidden on mobile ───────────────────────────── */}
        <nav
          className="hidden md:flex flex-col items-center py-2 bg-surface-container-low w-12 shrink-0 z-10"
          aria-label="Activity bar"
        >
          <div className="flex flex-col gap-0.5 flex-1">
            {ACTIVITY_ITEMS.map(({ id, icon, label }) => (
              <button
                key={id}
                title={label}
                aria-label={label}
                aria-pressed={activePanel === id}
                onClick={() => handleActivityClick(id)}
                className={cn(
                  'relative flex items-center justify-center w-10 h-10 rounded',
                  'transition-colors duration-100',
                  activePanel === id
                    ? 'text-on-surface bg-white/[0.06]'
                    : 'text-on-surface/40 hover:text-on-surface hover:bg-white/[0.04]',
                )}
              >
                {icon}
                {activePanel === id && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-primary"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}
          </div>
          <button
            title="Settings"
            aria-label="Settings"
            className="flex items-center justify-center w-10 h-10 rounded text-on-surface/40 hover:text-on-surface hover:bg-white/[0.04] transition-colors mb-1"
          >
            <Settings size={20} />
          </button>
        </nav>

        {/* ── Mobile backdrop ────────────────────────────────────────────── */}
        {isMobile && sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50"
            onClick={() => setActivePanel(null)}
            aria-hidden="true"
          />
        )}

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <aside
            style={isMobile ? undefined : { width: sidebarWidth }}
            className={cn(
              'flex flex-col bg-surface-container-low',
              isMobile
                // Mobile: fixed overlay drawer
                ? 'fixed top-9 bottom-0 left-0 z-40 w-[85vw] max-w-xs shadow-2xl shadow-black/60'
                // Desktop: normal in-flow sidebar
                : 'shrink-0 shadow-[1px_0_0_0_rgba(255,255,255,0.04)]',
            )}
            aria-label="Sidebar"
          >
            {/* Mobile: activity tabs inside the drawer */}
            {isMobile && (
              <div className="flex items-center gap-1 px-2 py-2 border-b border-white/[0.06] shrink-0 overflow-x-auto scrollbar-none">
                {ACTIVITY_ITEMS.map(({ id, icon, label }) => (
                  <button
                    key={id}
                    title={label}
                    onClick={() => handleActivityClick(id)}
                    className={cn(
                      'flex items-center justify-center w-9 h-9 rounded shrink-0 transition-colors',
                      activePanel === id
                        ? 'text-on-surface bg-white/[0.08]'
                        : 'text-on-surface/35 hover:text-on-surface hover:bg-white/[0.04]',
                    )}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            )}

            <div className={activePanel === 'files' ? 'flex flex-col flex-1 min-h-0' : 'hidden'}>
              <FileExplorer
                ref={fileExplorerRef}
                onFileOpen={(node) => { handleFileOpen(node); if (isMobile) setActivePanel(null) }}
                onFileDelete={handleFileDelete}
                onWillOpenFolder={closeAllTabs}
                onRootChange={setRootAbsPath}
              />
            </div>

            {activePanel === 'search' && (
              <PlaceholderPanel label="Search" description="Full-text search — coming soon" />
            )}
            {activePanel === 'git' && (
              <SourceControlPanel rootAbsPath={rootAbsPath} />
            )}
            {activePanel === 'ai' && (
              <AIPanel activeTab={activeTab} getEditorSelection={getEditorSelection} />
            )}
            {activePanel === 'extensions' && (
              <PlaceholderPanel label="Extensions" description="Extension marketplace — Phase 4" />
            )}
            {activePanel === 'debug' && (
              <PlaceholderPanel label="Run & Debug" description="Debugger integration — Phase 4" />
            )}
          </aside>
        )}

        {/* ── Sidebar resize handle — desktop only ──────────────────────── */}
        {sidebarOpen && !isMobile && (
          <div
            className="w-[3px] shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={handleSidebarDragStart}
          />
        )}

        {/* ── Editor shell ──────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">

          {/* Editor area — takes all remaining vertical space */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <EditorArea
              tabs={tabs}
              activeTabPath={activeTabPath}
              onTabClick={focusTab}
              onTabClose={closeTab}
              onDirtyChange={setDirty}
              onSave={saveTab}
              selectionGetterRef={selectionGetterRef}
            />
          </div>

          {/* Collapsible terminal panel */}
          <TerminalPanel
            isOpen={terminalOpen}
            onClose={() => setTerminalOpen(false)}
          />

          {/* Status bar */}
          <footer
            className="flex items-center justify-between px-4 h-6 bg-surface-container-low shrink-0 text-[11px] text-on-surface/30 font-ui"
            aria-label="Status bar"
          >
            <span className="flex items-center gap-4">
              <span className="flex items-center gap-1.5">
                <GitBranch size={11} />
                main
              </span>
              <span className="text-tertiary/70">● 0 Errors</span>
              <span className="text-yellow-500/60">▲ 2 Warnings</span>
            </span>
            <span className="flex items-center gap-4">
              {activeTab && (
                <>
                  <span>{activeTab.isDirty ? '● ' : ''}{activeTab.name}</span>
                  <span className="text-on-surface/20">|</span>
                </>
              )}
              <span>Spaces: 2</span>
              <span>UTF-8</span>
              <span className="text-on-surface/45">{langLabel}</span>
            </span>
          </footer>
        </div>
      </div>

      {/* ── Command Palette ───────────────────────────────────────────────── */}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={APP_COMMANDS}
      />
    </div>
  )
}

// ─── Placeholder panels ───────────────────────────────────────────────────────

function PlaceholderPanel({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 h-9 shrink-0">
        <span className="font-display text-[11px] font-medium tracking-widest uppercase text-on-surface/40">
          {label}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-[12px] text-on-surface/20 text-center leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  )
}
