import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Minus, Square, Copy, X, Search, Menu } from 'lucide-react'
import { cn, isTauri } from '../../lib/utils'

// ── Shared menu types (also used by App.tsx) ──────────────────────────────────

export type MenuItemDef =
  | { type?: undefined; label: string; shortcut?: string; action?: () => void; disabled?: boolean }
  | { type: 'sep' }

export interface TitleBarMenu {
  name: string
  items: MenuItemDef[]
}

interface TitleBarProps {
  menus: TitleBarMenu[]
  onPaletteOpen: () => void
  onSidebarToggle?: () => void
  title?: string
}

// ─────────────────────────────────────────────────────────────────────────────

export function TitleBar({ menus, onPaletteOpen, onSidebarToggle, title = 'Luminal Workspace' }: TitleBarProps) {
  const [openMenu,     setOpenMenu]     = useState<string | null>(null)
  const [isMaximized,  setIsMaximized]  = useState(false)
  const [isDesktopApp, setIsDesktopApp] = useState(false)
  const menuBarRef = useRef<HTMLDivElement>(null)
  const win = useMemo(() => isTauri() ? getCurrentWindow() : null, [])

  useEffect(() => { setIsDesktopApp(isTauri()) }, [])

  // Track maximized state — only relevant in the desktop app
  useEffect(() => {
    if (!win) return
    let unlisten: (() => void) | null = null
    let mounted = true

    win.isMaximized().then((v) => { if (mounted) setIsMaximized(v) }).catch(() => {})
    win.onResized(async () => {
      if (mounted) setIsMaximized(await win.isMaximized().catch(() => false))
    }).then((fn) => {
      if (!mounted) fn()
      else unlisten = fn
    }).catch(() => {})

    return () => {
      mounted = false
      unlisten?.()
    }
  }, [win])

  // Close the open menu when the user clicks outside the menu bar
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

  const closeMenu = useCallback(() => setOpenMenu(null), [])

  return (
    // .titlebar-drag makes the entire bar a drag region; interactive children
    // use .titlebar-no-drag to opt back out (see index.css).
    <header
      className="titlebar-drag flex items-center h-9 bg-surface-container-low shrink-0 select-none z-20"
      aria-label="Title bar"
    >
      {/* Hamburger — mobile only */}
      {onSidebarToggle && (
        <button
          onClick={onSidebarToggle}
          className="titlebar-no-drag md:hidden flex items-center justify-center w-9 h-9 text-on-surface/40 hover:text-on-surface transition-colors shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu size={16} />
        </button>
      )}

      {/* App icon */}
      <div className="titlebar-no-drag flex items-center pl-3 pr-1">
        <span className="text-primary font-bold text-sm leading-none">L</span>
      </div>

      {/* Menu items — hidden on mobile */}
      <div ref={menuBarRef} className="titlebar-no-drag hidden md:flex items-center gap-0.5">
        {menus.map(({ name, items }) => (
          <div key={name} className="relative">
            <button
              onClick={() => setOpenMenu((p) => (p === name ? null : name))}
              // Hover-to-switch when another menu is already open (VS Code feel)
              onMouseEnter={() => openMenu && openMenu !== name && setOpenMenu(name)}
              className={cn(
                'text-[13px] px-2 py-1 rounded transition-colors duration-75',
                openMenu === name
                  ? 'text-on-surface bg-white/[0.08]'
                  : 'text-on-surface/55 hover:text-on-surface hover:bg-white/[0.04]',
              )}
            >
              {name}
            </button>

            {openMenu === name && (
              <MenuDropdown items={items} onClose={closeMenu} />
            )}
          </div>
        ))}
      </div>

      {/* Center drag zone — title text is non-interactive so the region drags */}
      <div className="flex-1 flex items-center justify-center min-w-0 px-4">
        <span className="text-[12px] text-on-surface/20 truncate pointer-events-none">
          {title}
        </span>
      </div>

      {/* Command Palette button */}
      <button
        onClick={onPaletteOpen}
        className={cn(
          'titlebar-no-drag flex items-center gap-2 px-2 md:px-3 py-1 rounded mr-2',
          'bg-surface-container text-on-surface/40 text-[12px]',
          'hover:bg-surface-container-high hover:text-on-surface transition-colors',
        )}
        aria-label="Open command palette (Ctrl+K)"
      >
        <Search size={12} />
        <span className="hidden md:inline">Command Palette</span>
        <kbd className="hidden md:inline font-mono text-[10px] text-on-surface/20">Ctrl+K</kbd>
      </button>

      {/* Window controls — desktop app only */}
      {isDesktopApp && (
        <div className="titlebar-no-drag flex items-center">
          <button
            onClick={() => win?.minimize().catch(() => {})}
            className="flex items-center justify-center w-11 h-9 text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>

          <button
            onClick={() => win?.toggleMaximize().catch(() => {})}
            className="flex items-center justify-center w-11 h-9 text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Copy size={12} /> : <Square size={12} />}
          </button>

          <button
            onClick={() => win?.close().catch(() => {})}
            className="flex items-center justify-center w-11 h-9 text-on-surface/40 hover:text-red-400 hover:bg-red-500/[0.12] transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </header>
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
            // Always close the menu after the action fires — callers don't need to
            onClick={() => { item.action?.(); onClose() }}
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
              <span className="ml-8 text-on-surface/25 text-[10px] font-mono">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
    </div>
  )
}
