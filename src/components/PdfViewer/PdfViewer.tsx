/**
 * PdfViewer.tsx
 * ─────────────
 * Dual-mode viewer for .pdf files.
 *
 * Rendered mode : react-pdf renders pages via pdfjs-dist canvas.
 * Raw mode      : Monaco editor shows the PDF byte stream as latin-1 text,
 *                 letting you inspect the PDF syntax structure.
 *
 * The chosen mode is persisted per-file in localStorage so it survives
 * tab switches and app restarts.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import MonacoEditor from '@monaco-editor/react'
import { readFile } from '@tauri-apps/plugin-fs'
import { ChevronLeft, ChevronRight, Code2, FileText, Loader2 } from 'lucide-react'
import { cn, isTauri } from '../../lib/utils'

import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Configure pdf.js worker once at module load
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// ── Types ─────────────────────────────────────────────────────────────────────

interface PdfViewerProps {
  /** Absolute OS path to the PDF file. */
  absPath: string
  /** Tab path used as the localStorage key. */
  tabPath: string
}

type ViewMode = 'rendered' | 'raw'

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = (tabPath: string) => `luminal:pdfView:${tabPath}`

// ── Component ─────────────────────────────────────────────────────────────────

export function PdfViewer({ absPath, tabPath }: PdfViewerProps) {
  // Restore persisted mode, defaulting to rendered
  const [mode, setMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY(tabPath))
    return (saved === 'raw' || saved === 'rendered') ? saved : 'rendered'
  })

  const [pdfBytes, setPdfBytes]   = useState<Uint8Array | null>(null)
  const [rawText,  setRawText]    = useState<string | null>(null)
  const [numPages, setNumPages]   = useState(0)
  const [page,     setPage]       = useState(1)
  const [loading,  setLoading]    = useState(true)
  const [error,    setError]      = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(600)

  // Measure container width for PDF page scaling
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setContainerWidth(el.clientWidth - 32) // 16px padding each side
    })
    ro.observe(el)
    setContainerWidth(el.clientWidth - 32)
    return () => ro.disconnect()
  }, [])

  // Load the file whenever absPath changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    setPdfBytes(null)
    setRawText(null)
    setPage(1)

    if (!isTauri()) {
      setError('PDF files can only be opened in the desktop app.')
      setLoading(false)
      return
    }

    readFile(absPath)
      .then((bytes) => {
        setPdfBytes(bytes)
        // Build raw text from the binary — latin-1 preserves every byte
        const raw = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
        setRawText(raw)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to read PDF')
        setLoading(false)
      })
  }, [absPath])

  // Persist mode preference
  const switchMode = useCallback((next: ViewMode) => {
    setMode(next)
    localStorage.setItem(STORAGE_KEY(tabPath), next)
  }, [tabPath])

  // ── Loading / error states ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-3 bg-surface-container-lowest text-on-surface/30">
        <Loader2 size={24} className="animate-spin" />
        <span className="text-sm font-mono">Loading PDF…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-2 bg-surface-container-lowest px-8 text-center">
        <FileText size={36} className="text-on-surface/10" />
        <p className="text-sm text-red-400/80">{error}</p>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface-container-lowest">

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-9 bg-surface-container shrink-0 border-b border-white/[0.05]">

        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-surface-container-low rounded p-0.5">
          <ModeButton
            active={mode === 'rendered'}
            icon={<FileText size={12} />}
            label="Rendered"
            onClick={() => switchMode('rendered')}
          />
          <ModeButton
            active={mode === 'raw'}
            icon={<Code2 size={12} />}
            label="Raw"
            onClick={() => switchMode('raw')}
          />
        </div>

        {/* Page navigation — only in rendered mode */}
        {mode === 'rendered' && numPages > 0 && (
          <div className="flex items-center gap-2 text-[12px] text-on-surface/50">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span>
              {page} / {numPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(numPages, p + 1))}
              disabled={page >= numPages}
              className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/[0.06] disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      {mode === 'rendered' ? (
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto flex justify-center py-4 px-4"
        >
          {pdfBytes && (
            <Document
              file={{ data: pdfBytes.buffer as ArrayBuffer }}
              onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPage(1) }}
              onLoadError={(e) => setError(e.message)}
              loading={
                <div className="flex items-center gap-2 text-on-surface/30 text-sm mt-8">
                  <Loader2 size={16} className="animate-spin" /> Rendering…
                </div>
              }
            >
              <Page
                pageNumber={page}
                width={Math.min(containerWidth, 900)}
                renderTextLayer
                renderAnnotationLayer
                className="shadow-2xl shadow-black/60"
              />
            </Document>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <MonacoEditor
            language="plaintext"
            value={rawText ?? ''}
            theme="kinetic-void"
            options={{
              readOnly: true,
              fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
              padding: { top: 16 },
            }}
            loading={
              <div className="flex items-center justify-center h-full bg-surface-container-lowest text-on-surface/20 text-sm font-mono">
                Loading…
              </div>
            }
          />
        </div>
      )}
    </div>
  )
}

// ── ModeButton ────────────────────────────────────────────────────────────────

function ModeButton({
  active, icon, label, onClick,
}: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-ui transition-colors',
        active
          ? 'bg-primary/20 text-primary'
          : 'text-on-surface/40 hover:text-on-surface hover:bg-white/[0.04]',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
