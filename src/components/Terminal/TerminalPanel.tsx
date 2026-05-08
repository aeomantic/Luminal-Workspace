import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { X, Plus, ChevronDown, ChevronUp, MonitorX } from 'lucide-react'
import { cn, isTauri } from '../../lib/utils'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function TerminalPanel({ isOpen, onClose }: TerminalPanelProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const termRef       = useRef<Terminal | null>(null)
  const fitRef        = useRef<FitAddon | null>(null)
  const unlistenRef   = useRef<(() => void) | null>(null)
  const roRef         = useRef<ResizeObserver | null>(null)

  const [panelHeight, setPanelHeight] = useState(220)
  const [isDragging,  setIsDragging]  = useState(false)
  const [isMinimized, setIsMinimized] = useState(false)
  const dragStartY  = useRef(0)
  const dragStartH  = useRef(0)

  // ── Initialise / destroy xterm when panel opens / closes ─────────────────
  useEffect(() => {
    if (!isOpen) return

    // Give the DOM a frame to paint the container before measuring it
    const timer = setTimeout(() => {
      if (!containerRef.current) return

      const term = new Terminal({
        theme: {
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
        },
        fontFamily:        '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
        fontSize:          13,
        lineHeight:        1.5,
        cursorBlink:       true,
        cursorStyle:       'bar',
        scrollback:        5000,
        tabStopWidth:      4,
        allowTransparency: true,
      })

      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(containerRef.current)
      fit.fit()
      term.focus()

      termRef.current = term
      fitRef.current  = fit

      invoke('pty_create', { cols: term.cols, rows: term.rows }).catch(console.error)

      let active = true
      listen<string>('pty-output', (ev) => {
        if (active) term.write(ev.payload)
      }).then((fn) => {
        if (!active) fn()
        else unlistenRef.current = fn
      })

      term.onData((data) => {
        invoke('pty_write', { data }).catch(console.error)
      })

      const ro = new ResizeObserver(() => {
        try {
          fit.fit()
          invoke('pty_resize', { cols: term.cols, rows: term.rows }).catch(() => {})
        } catch { /* xterm not yet ready */ }
      })
      ro.observe(containerRef.current)
      roRef.current = ro

      return () => { active = false }
    }, 50)

    return () => {
      clearTimeout(timer)
      unlistenRef.current?.()
      unlistenRef.current = null
      roRef.current?.disconnect()
      roRef.current = null
      termRef.current?.dispose()
      termRef.current = null
      fitRef.current  = null
      invoke('pty_close').catch(() => {})
    }
  }, [isOpen])

  // Reset minimized state whenever the panel is fully closed so the next
  // open always starts expanded.
  useEffect(() => {
    if (!isOpen) setIsMinimized(false)
  }, [isOpen])

  // Re-fit the terminal after restoring from minimized so xterm fills the
  // now-visible container correctly.
  useEffect(() => {
    if (isMinimized) return
    const t = setTimeout(() => {
      if (fitRef.current && termRef.current) {
        fitRef.current.fit()
        invoke('pty_resize', { cols: termRef.current.cols, rows: termRef.current.rows }).catch(() => {})
        termRef.current.focus()
      }
    }, 50)
    return () => clearTimeout(t)
  }, [isMinimized])

  // ── Drag-to-resize handle ─────────────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragStartY.current = e.clientY
    dragStartH.current = panelHeight
    setIsDragging(true)
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return

    function onMove(e: MouseEvent) {
      const delta   = dragStartY.current - e.clientY
      const clamped = Math.max(80, Math.min(600, dragStartH.current + delta))
      setPanelHeight(clamped)
    }

    function onUp() {
      setIsDragging(false)
      setTimeout(() => {
        if (fitRef.current && termRef.current) {
          fitRef.current.fit()
          invoke('pty_resize', { cols: termRef.current.cols, rows: termRef.current.rows }).catch(() => {})
        }
      }, 50)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [isDragging])

  if (!isOpen) return null

  // In the browser the PTY backend isn't available — show a friendly message
  if (!isTauri()) {
    return (
      <div className="flex items-center justify-between px-4 h-10 bg-surface-container-low shrink-0 border-t border-white/[0.04]">
        <div className="flex items-center gap-2 text-on-surface/35 text-[12px]">
          <MonitorX size={13} />
          <span>Terminal requires the desktop app</span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
        >
          <X size={11} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col shrink-0 bg-[#0e0e0e]"
      // Use the stored height when expanded; collapse to just the header row
      // when minimized (the xterm canvas is hidden, not unmounted).
      style={{ height: isMinimized ? 'auto' : panelHeight }}
    >
      {/* Resize handle — only interactive when the panel is expanded */}
      {!isMinimized && (
        <div
          onMouseDown={handleResizeStart}
          className={cn(
            'h-[3px] w-full shrink-0 cursor-ns-resize transition-colors',
            isDragging ? 'bg-primary/50' : 'hover:bg-primary/25',
          )}
          aria-label="Drag to resize terminal"
        />
      )}

      {/* Panel header */}
      <div className="flex items-center justify-between px-3 h-8 bg-surface-container-low shrink-0 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-display tracking-widest uppercase text-primary/70">
            Terminal
          </span>
          <button
            title="New Terminal (Ctrl+`)"
            className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            <Plus size={11} />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          {/* Minimize / restore */}
          <button
            onClick={() => setIsMinimized((p) => !p)}
            title={isMinimized ? 'Restore Terminal' : 'Minimize Terminal'}
            className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            {isMinimized ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>

          {/* Close (destroys PTY) */}
          <button
            onClick={onClose}
            title="Close Terminal"
            className="flex items-center justify-center w-5 h-5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {/* xterm.js mount point — kept mounted when minimized so the PTY session
          survives, but hidden via display:none to take up no layout space. */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden px-1 pt-1"
        style={{ display: isMinimized ? 'none' : undefined }}
      />
    </div>
  )
}
