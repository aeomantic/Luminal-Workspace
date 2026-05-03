/**
 * ContextMenu.tsx
 * ───────────────
 * A portal-based right-click context menu that follows the Kinetic Void
 * design rules:
 *   - Background shift only — no border tokens.
 *   - Separators are a subtle bg-white/5 band, not a line.
 *   - Glassmorphism surface: surface-container-highest + backdrop-blur.
 *   - Keyboard navigable: ↑↓ navigate, Enter/Space activate, Escape close.
 *
 * Positioning logic auto-flips the menu to stay inside the viewport.
 */

import {
  useEffect,
  useRef,
  useCallback,
  createPortal,
  type KeyboardEvent,
} from 'react'
import type { ContextEntry, ContextMenuPosition } from './types'
import { cn } from '../../lib/utils'

interface ContextMenuProps {
  position: ContextMenuPosition
  entries: ContextEntry[]
  onClose: () => void
}

export function ContextMenu({ position, entries, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // ── Close on outside click or Escape ──────────────────────────────────────
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('mousedown', onMouseDown, { capture: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, { capture: true })
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // ── Auto-focus first item when mounted ────────────────────────────────────
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')
    first?.focus()
  }, [])

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    )
    const focused = document.activeElement
    const idx = buttons.indexOf(focused as HTMLButtonElement)

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      buttons[(idx + 1) % buttons.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }, [onClose])

  // ── Viewport-aware positioning ────────────────────────────────────────────
  // We measure after mount; CSS vars drive the final position.
  const vw = window.innerWidth
  const vh = window.innerHeight
  // Estimate: ~240px wide, ~24px per entry
  const actionCount = entries.filter((e) => e.type === 'action').length
  const sepCount    = entries.filter((e) => e.type === 'separator').length
  const estHeight   = actionCount * 30 + sepCount * 9 + 16
  const estWidth    = 248

  const left = position.x + estWidth  > vw ? position.x - estWidth  : position.x
  const top  = position.y + estHeight > vh ? position.y - estHeight  : position.y

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      onKeyDown={handleKeyDown}
      style={{ left, top }}
      className={cn(
        'fixed z-[60] min-w-[240px] py-1.5',
        // Glassmorphism — same recipe as command palette but tighter blur
        'bg-[#1e1e1e]/95 backdrop-blur-glass',
        // Depth via shadow only — no border
        'shadow-[0_4px_24px_0_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.04)]',
        'rounded-lg overflow-hidden',
        // Appear animation
        'animate-in fade-in-0 zoom-in-95 duration-100 origin-top-left',
      )}
    >
      {entries.map((entry, i) => {
        if (entry.type === 'separator') {
          return (
            <div
              key={i}
              role="separator"
              className="mx-2 my-1 h-px bg-white/[0.06]"
              aria-hidden="true"
            />
          )
        }

        return (
          <button
            key={entry.id}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => { entry.action(); onClose() }}
            className={cn(
              'w-full flex items-center justify-between gap-4',
              'px-3 py-[5px] text-left text-[13px] font-ui',
              'text-on-surface/85 leading-snug',
              // Hover/focus = background shift, no border
              'hover:bg-white/[0.07] focus:bg-white/[0.07]',
              'disabled:opacity-35 disabled:cursor-default disabled:hover:bg-transparent',
              'transition-colors duration-75 outline-none',
            )}
          >
            <span className="truncate">{entry.label}</span>
            {entry.shortcut && (
              <span className="shrink-0 text-[11px] text-on-surface/30 font-mono">
                {entry.shortcut}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
