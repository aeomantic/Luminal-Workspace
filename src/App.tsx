import { useState, useCallback, useRef, useEffect } from 'react'
import {
  Files,
  Search,
  GitBranch,
  Puzzle,
  Bug,
  Settings,
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
import { cn } from './lib/utils'

// ── Activity bar ──────────────────────────────────────────────────────────────

type PanelId = 'files' | 'search' | 'git' | 'extensions' | 'debug'

interface ActivityItem { id: PanelId; icon: React.ReactNode; label: string }

const ACTIVITY_ITEMS: ActivityItem[] = [
  { id: 'files',      icon: <Files     size={20} />, label: 'Explorer (Ctrl+Shift+E)'  },
  { id: 'search',     icon: <Search    size={20} />, label: 'Search (Ctrl+Shift+F)'    },
  { id: 'git',        icon: <GitBranch size={20} />, label: 'Source Control'            },
  { id: 'extensions', icon: <Puzzle    size={20} />, label: 'Extensions'                },
  { id: 'debug',      icon: <Bug       size={20} />, label: 'Run and Debug'             },
]

const MENU_NAMES = ['File', 'Edit', 'View', 'Terminal'] as const

// ── Menu item types ───────────────────────────────────────────────────────────

type MenuItemDef =
  | { type?: undefined; label: string; shortcut?: string; action?: () => void; disabled?: boolean }
  | { type: 'sep' }

// ── Command registry ──────────────────────────────────────────────────────────

const APP_COMMANDS: EditorCommand[] = [
  ...DEFAULT_COMMANDS,
  {
    id: 'app.quit',
    label: 'Quit Luminal Workspace',
    description: 'Close the application',
    group: 'File',
    shortcut: 'Ctrl+Q',
    action: () => {
      // Tauri v2: import { exit } from '@tauri-apps/plugin-process'; exit(0)
      console.log('[cmd] quit')
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<PanelId | null>('files')
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const menuBarRef = useRef<HTMLElement>(null)
  const fileExplorerRef = useRef<FileExplorerHandle>(null)

  const editorTabs = useEditorTabs()
  const {
    tabs,
    activeTabPath,
    activeTab,
    openTab,
    closeTab,
    closeAllTabs,
    forceCloseByPrefix,
    focusTab,
    setDirty,
    saveTab,
  } = editorTabs

  // ── Close menu when clicking outside the menu bar ─────────────────────────
  useEffect(() => {
    if (!openMenu) return
    function handleDocClick(e: MouseEvent) {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handleDocClick)
    return () => document.removeEventListener('mousedown', handleDocClick)
  }, [openMenu])

  // ── Palette ───────────────────────────────────────────────────────────────
  const togglePalette = useCallback(() => setPaletteOpen((p) => !p), [])
  const closePalette  = useCallback(() => setPaletteOpen(false),     [])
  useCommandPaletteShortcut(togglePalette)

  // ── Activity bar ──────────────────────────────────────────────────────────
  function handleActivityClick(id: PanelId) {
    setActivePanel((prev) => (prev === id ? null : id))
  }

  // ── File explorer callbacks ───────────────────────────────────────────────
  const handleFileOpen = useCallback((node: FileNode) => {
    void openTab(node)
  }, [openTab])

  const handleFileDelete = useCallback((path: string) => {
    forceCloseByPrefix(path)
  }, [forceCloseByPrefix])

  // ── Menu item definitions ─────────────────────────────────────────────────
  function closeMenu() { setOpenMenu(null) }

  function getMenuItems(menu: string): MenuItemDef[] {
    switch (menu) {
      case 'File': return [
        {
          label: 'Open Folder…',
          action: () => {
            closeAllTabs()
            fileExplorerRef.current?.requestOpenFolder()
            closeMenu()
          },
        },
        { type: 'sep' },
        {
          label: 'Save',
          shortcut: 'Ctrl+S',
          action: () => {
            // Triggers EditorArea's window keydown listener
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
            )
            closeMenu()
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
            closeMenu()
          },
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Y',
          action: () => {
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
            )
            closeMenu()
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
            closeMenu()
          },
        },
      ]
      case 'View': return [
        {
          label: 'Toggle Explorer',
          shortcut: 'Ctrl+Shift+E',
          action: () => { handleActivityClick('files'); closeMenu() },
        },
        { type: 'sep' },
        {
          label: 'Command Palette',
          shortcut: 'Ctrl+K',
          action: () => { togglePalette(); closeMenu() },
        },
      ]
      case 'Terminal': return [
        { label: 'New Terminal', disabled: true },
      ]
      default: return []
    }
  }

  // ── Language label for status bar ─────────────────────────────────────────
  const langLabel = activeTab
    ? activeTab.language.charAt(0).toUpperCase() + activeTab.language.slice(1)
    : '—'

  const sidebarOpen = activePanel !== null

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface font-ui text-on-surface">

      {/* ── Activity bar ──────────────────────────────────────────────────── */}
      <nav
        className="flex flex-col items-center py-2 bg-surface-container-low w-12 shrink-0 z-10"
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

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'w-64 shrink-0 flex flex-col bg-surface-container-low',
          'shadow-[1px_0_0_0_rgba(255,255,255,0.04)]',
          !sidebarOpen && 'hidden',
        )}
        aria-label="Sidebar"
      >
        <div className={activePanel === 'files' ? 'flex flex-col h-full' : 'hidden'}>
          <FileExplorer
            ref={fileExplorerRef}
            onFileOpen={handleFileOpen}
            onFileDelete={handleFileDelete}
            onWillOpenFolder={closeAllTabs}
          />
        </div>

        {activePanel === 'search' && (
          <PlaceholderPanel label="Search" description="Full-text search — Phase 3" />
        )}
        {activePanel === 'git' && (
          <PlaceholderPanel label="Source Control" description="Git integration — Phase 3" />
        )}
        {activePanel === 'extensions' && (
          <PlaceholderPanel label="Extensions" description="Extension marketplace — Phase 4" />
        )}
        {activePanel === 'debug' && (
          <PlaceholderPanel label="Run & Debug" description="Debugger integration — Phase 4" />
        )}
      </aside>

      {/* ── Editor shell ──────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 overflow-hidden min-w-0">

        {/* ── Menu bar ────────────────────────────────────────────────────── */}
        <header
          ref={menuBarRef}
          className="flex items-center gap-1 px-4 h-10 bg-surface-container-low shrink-0 select-none"
          aria-label="Menu bar"
        >
          <span className="font-display text-sm font-bold text-primary tracking-wide mr-3">
            Luminal Editor
          </span>

          {MENU_NAMES.map((menu) => (
            <div key={menu} className="relative">
              <button
                onClick={() => setOpenMenu((p) => (p === menu ? null : menu))}
                className={cn(
                  'text-[13px] px-2 py-1 rounded transition-colors duration-75',
                  openMenu === menu
                    ? 'text-on-surface bg-white/[0.08]'
                    : 'text-on-surface/55 hover:text-on-surface hover:bg-white/[0.04]',
                )}
              >
                {menu}
              </button>
              {openMenu === menu && (
                <MenuDropdown items={getMenuItems(menu)} onClose={closeMenu} />
              )}
            </div>
          ))}

          <button
            onClick={togglePalette}
            className={cn(
              'ml-auto flex items-center gap-2 px-3 py-1 rounded',
              'bg-surface-container text-on-surface/45 text-[12px]',
              'hover:bg-surface-container-high hover:text-on-surface transition-colors',
            )}
            aria-label="Open command palette (Ctrl+K)"
          >
            <Search size={12} />
            <span>Command Palette</span>
            <kbd className="font-mono text-[10px] text-on-surface/25">Ctrl+K</kbd>
          </button>
        </header>

        {/* ── Editor area ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <EditorArea
            tabs={tabs}
            activeTabPath={activeTabPath}
            onTabClick={focusTab}
            onTabClose={closeTab}
            onDirtyChange={setDirty}
            onSave={saveTab}
          />
        </div>

        {/* ── Status bar ──────────────────────────────────────────────────── */}
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
                <span>{activeTab.isDirty ? '● ' : ''}
                  {activeTab.name}
                </span>
                <span className="text-on-surface/20">|</span>
              </>
            )}
            <span>Spaces: 2</span>
            <span>UTF-8</span>
            <span className="text-on-surface/45">{langLabel}</span>
          </span>
        </footer>
      </div>

      {/* ── Command Palette ──────────────────────────────────────────────── */}
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={APP_COMMANDS}
      />
    </div>
  )
}

// ─── Menu dropdown ────────────────────────────────────────────────────────────

function MenuDropdown({ items, onClose }: { items: MenuItemDef[]; onClose: () => void }) {
  return (
    <div className="absolute top-full left-0 z-50 mt-0.5 min-w-[200px] py-1 bg-surface-container rounded shadow-2xl shadow-black/60 border border-white/[0.06]">
      {items.map((item, i) =>
        item.type === 'sep' ? (
          <div key={i} className="my-1 mx-2 border-t border-white/[0.05]" />
        ) : (
          <button
            key={i}
            onClick={item.action ?? onClose}
            disabled={item.disabled}
            className={cn(
              'flex items-center justify-between w-full px-4 py-1.5',
              'text-[12px] font-ui text-on-surface/75',
              'hover:bg-white/[0.06] hover:text-on-surface',
              'disabled:opacity-30 disabled:cursor-not-allowed',
              'transition-colors duration-75',
            )}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="ml-8 text-on-surface/30 text-[10px] font-mono">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
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
