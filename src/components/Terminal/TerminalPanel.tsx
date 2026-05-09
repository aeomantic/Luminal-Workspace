/**
 * TerminalPanel.tsx
 * ─────────────────
 * Pro terminal with:
 *  - Multiple independent PTY instances, each with its own tab
 *  - Rename tabs via double-click (inline input)
 *  - Clipboard: Ctrl/Cmd+C copies selection (no interrupt); Ctrl/Cmd+V pastes
 *  - Fullscreen toggle (covers the entire editor area)
 *  - Drag-to-resize handle
 *
 * Each XtermPane stays mounted (display:none when inactive) so the PTY
 * session and scrollback survive tab switches.
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  MonitorX,
} from 'lucide-react'
import { cn, isTauri } from '../../lib/utils'
import '@xterm/xterm/css/xterm.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TerminalInstance {
  id: string
  name: string
}

let _termCounter = 0
function nextId() { return `term-${++_termCounter}` }

// ── xterm theme (matches Kinetic Void) ───────────────────────────────────────

const KV_TERM_THEME = {
  background:          '#0e0e0e',
  foreground:          '#e8e8e8',
  cursor:              '#00b4d8',
  cursorAccent:        '#0e0e0e',
  selectionBackground: 'rgba(0,180,216,0.20)',
  black:   '#131313', brightBlack:   '#4a5568',
  red:     '#ff6b6b', brightRed:     '#ff8787',
  green:   '#39d98a', brightGreen:   '#52f0a0',
  yellow:  '#e2c97e', brightYellow:  '#f0d98a',
  blue:    '#00b4d8', brightBlue:    '#38d4f0',
  magenta: '#9d8df1', brightMagenta: '#b5a5ff',
  cyan:    '#38d4f0', brightCyan:    '#56e4ff',
  white:   '#e8e8e8', brightWhite:   '#ffffff',
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TerminalPanelProps {
  isOpen: boolean
  onClose: () => void
}

// ── Panel component ───────────────────────────────────────────────────────────

export function TerminalPanel({ isOpen, onClose }: TerminalPanelProps) {
  const [terminals,       setTerminals]       = useState<TerminalInstance[]>([])
  const [activeId,        setActiveId]        = useState<string | null>(null)
  const [panelHeight,     setPanelHeight]     = useState(220)
  const [isMinimized,     setIsMinimized]     = useState(false)
  const [isFullscreen,    setIsFullscreen]    = useState(false)
  const [isDragging,      setIsDragging]      = useState(false)
  const [renamingId,      setRenamingId]      = useState<string | null>(null)
  const [renameValue,     setRenameValue]     = useState('')
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)

  // Spawn first terminal when panel opens
  useEffect(() => {
    if (!isOpen) return
    if (terminals.length === 0) {
      const id = nextId()
      setTerminals([{ id, name: 'bash' }])
      setActiveId(id)
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset minimized when closed
  useEffect(() => { if (!isOpen) { setIsMinimized(false); setIsFullscreen(false) } }, [isOpen])

  // ── New terminal ───────────────────────────────────────────────────────────
  function addTerminal() {
    const id = nextId()
    setTerminals((prev) => [...prev, { id, name: 'bash' }])
    setActiveId(id)
  }

  // ── Close terminal ─────────────────────────────────────────────────────────
  function closeTerminal(id: string) {
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id)
      if (activeId === id) {
        const idx = prev.findIndex((t) => t.id === id)
        setActiveId(next[idx]?.id ?? next[next.length - 1]?.id ?? null)
      }
      if (next.length === 0) { onClose() }
      return next
    })
  }

  // ── Rename ─────────────────────────────────────────────────────────────────
  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  function commitRename() {
    if (!renamingId) return
    const name = renameValue.trim() || 'bash'
    setTerminals((prev) => prev.map((t) => t.id === renamingId ? { ...t, name } : t))
    setRenamingId(null)
  }

  function handleRenameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')  { e.preventDefault(); commitRename() }
    if (e.key === 'Escape') { setRenamingId(null) }
  }

  // ── Resize drag ────────────────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartY.current = e.clientY
    dragStartH.current = panelHeight
    setIsDragging(true)
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return
    function onMove(e: MouseEvent) {
      setPanelHeight(Math.max(80, Math.min(600, dragStartH.current + dragStartY.current - e.clientY)))
    }
    function onUp() { setIsDragging(false) }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [isDragging])

  if (!isOpen) return null

  // ── Browser guard ──────────────────────────────────────────────────────────
  if (!isTauri()) {
    return (
      <div className="flex items-center justify-between px-4 h-10 bg-surface-container-low shrink-0 border-t border-white/[0.04]">
        <div className="flex items-center gap-2 text-on-surface/35 text-[12px]">
          <MonitorX size={13} />
          <span>Terminal requires the desktop app</span>
        </div>
        <button onClick={onClose} className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors">
          <X size={11} />
        </button>
      </div>
    )
  }

  const panelStyle = isFullscreen
    ? { position: 'fixed' as const, inset: 0, top: 36, zIndex: 50 }
    : isMinimized
      ? {}
      : { height: panelHeight }

  return (
    <div
      className={cn(
        'flex flex-col bg-[#0e0e0e] shrink-0',
        isFullscreen && 'fixed inset-0 z-50',
      )}
      style={panelStyle}
    >
      {/* Resize handle — not in fullscreen or minimized */}
      {!isMinimized && !isFullscreen && (
        <div
          onMouseDown={handleResizeStart}
          className={cn(
            'h-[3px] w-full shrink-0 cursor-ns-resize transition-colors',
            isDragging ? 'bg-primary/50' : 'hover:bg-primary/25',
          )}
        />
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center bg-surface-container-low shrink-0 border-b border-white/[0.04]">

        {/* Terminal tabs */}
        <div className="flex items-center flex-1 overflow-x-auto scrollbar-none min-w-0">
          {terminals.map((t) => (
            <div
              key={t.id}
              className={cn(
                'group flex items-center gap-1.5 h-8 px-3 shrink-0 cursor-pointer transition-colors',
                t.id === activeId
                  ? 'bg-[#0e0e0e] text-primary/80 border-t border-t-primary/50'
                  : 'text-on-surface/35 hover:text-on-surface hover:bg-white/[0.04]',
              )}
              onClick={() => setActiveId(t.id)}
              onDoubleClick={() => startRename(t.id, t.name)}
            >
              {renamingId === t.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  className="w-20 bg-surface-container text-on-surface text-[11px] font-mono px-1 rounded outline outline-1 outline-primary/50"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="text-[11px] font-display tracking-wide">{t.name}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); closeTerminal(t.id) }}
                className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-4 h-4 rounded text-on-surface/40 hover:text-on-surface hover:bg-white/[0.1] transition-all"
              >
                <X size={9} />
              </button>
            </div>
          ))}
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-0.5 px-2 shrink-0">
          <IconBtn title="New Terminal (Ctrl+`)" onClick={addTerminal}><Plus size={11} /></IconBtn>
          <IconBtn
            title={isFullscreen ? 'Exit Fullscreen (F11)' : 'Fullscreen (F11)'}
            onClick={() => setIsFullscreen((p) => !p)}
          >
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </IconBtn>
          <IconBtn
            title={isMinimized ? 'Restore' : 'Minimize'}
            onClick={() => setIsMinimized((p) => !p)}
          >
            {isMinimized ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </IconBtn>
          <IconBtn title="Close Panel" onClick={onClose}><X size={11} /></IconBtn>
        </div>
      </div>

      {/* ── Xterm panes — all kept mounted, only active is visible ────────── */}
      {!isMinimized && (
        <div className="flex-1 min-h-0 relative">
          {terminals.map((t) => (
            <XtermPane
              key={t.id}
              id={t.id}
              isActive={t.id === activeId}
              isFullscreen={isFullscreen}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── XtermPane ─────────────────────────────────────────────────────────────────
// One PTY-backed xterm instance. Stays mounted; hidden via visibility when
// not active so the PTY session and scrollback survive tab switches.

interface XtermPaneProps {
  id: string
  isActive: boolean
  isFullscreen: boolean
}

function XtermPane({ id, isActive, isFullscreen }: XtermPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef      = useRef<Terminal | null>(null)
  const fitRef       = useRef<FitAddon | null>(null)
  const unlistenOut  = useRef<(() => void) | null>(null)
  const unlistenExit = useRef<(() => void) | null>(null)
  const roRef        = useRef<ResizeObserver | null>(null)

  // Initialise xterm + PTY once on mount
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const timer = setTimeout(() => {
      const term = new Terminal({
        theme: KV_TERM_THEME,
        fontFamily: '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        cursorBlink: true,
        cursorStyle: 'bar',
        scrollback: 5000,
        tabStopWidth: 4,
        allowTransparency: true,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(container)
      fit.fit()
      if (isActive) term.focus()

      termRef.current = term
      fitRef.current  = fit

      // ── Clipboard ──────────────────────────────────────────────────────
      term.attachCustomKeyEventHandler((e) => {
        const ctrl = e.ctrlKey || e.metaKey
        if (ctrl && e.key === 'c' && e.type === 'keydown' && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection()).catch(() => {})
          return false // consumed — don't send ^C to shell
        }
        if (ctrl && e.key === 'v' && e.type === 'keydown') {
          navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => {})
          return false
        }
        return true // let xterm handle everything else
      })

      // ── PTY wiring ─────────────────────────────────────────────────────
      invoke('pty_create', { id, cols: term.cols, rows: term.rows }).catch(console.error)

      let active = true

      listen<string>(`pty-output-${id}`, (ev) => {
        if (active) term.write(ev.payload)
      }).then((fn) => {
        if (!active) fn()
        else unlistenOut.current = fn
      })

      listen(`pty-exit-${id}`, () => {
        if (active) term.write('\r\n[Process exited]\r\n')
      }).then((fn) => {
        if (!active) fn()
        else unlistenExit.current = fn
      })

      term.onData((data) => invoke('pty_write', { id, data }).catch(() => {}))

      const ro = new ResizeObserver(() => {
        try {
          fit.fit()
          invoke('pty_resize', { id, cols: term.cols, rows: term.rows }).catch(() => {})
        } catch { /* not ready yet */ }
      })
      ro.observe(container)
      roRef.current = ro

      return () => { active = false }
    }, 50)

    return () => {
      clearTimeout(timer)
      unlistenOut.current?.()
      unlistenExit.current?.()
      unlistenOut.current = null
      unlistenExit.current = null
      roRef.current?.disconnect()
      roRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current  = null
      invoke('pty_close', { id }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Re-fit and focus when switching to this pane or entering fullscreen
  useEffect(() => {
    if (!isActive) return
    const t = setTimeout(() => {
      fitRef.current?.fit()
      invoke('pty_resize', { id, cols: termRef.current?.cols ?? 80, rows: termRef.current?.rows ?? 24 }).catch(() => {})
      termRef.current?.focus()
    }, 30)
    return () => clearTimeout(t)
  }, [isActive, isFullscreen, id])

  return (
    <div
      ref={containerRef}
      style={{
        position:     'absolute',
        inset:        0,
        visibility:   isActive ? 'visible' : 'hidden',
        pointerEvents:isActive ? 'auto'    : 'none',
        paddingLeft:  4,
        paddingTop:   4,
      }}
    />
  )
}

// ── IconBtn ───────────────────────────────────────────────────────────────────

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
    >
      {children}
    </button>
  )
}
