/**
 * EditorArea.tsx
 * ──────────────
 * Tab bar + Monaco Editor panel.
 *
 * Design:
 *  - Active tab background = editor background (#0e0e0e) — seamless join.
 *  - Inactive tabs = surface-container-low (#1c1b1b).
 *  - Dirty indicator: Electric Blue dot before the filename.
 *  - No borders anywhere — depth via background shifts only.
 *  - Ctrl+S / Cmd+S saves to disk via the File System Access API.
 *  - Monaco is initialised with the custom "kinetic-void" theme once on mount.
 */

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import MonacoEditor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditorNS } from 'monaco-editor'
import { X, FileText } from 'lucide-react'
import type { EditorTab } from './useEditorTabs'
import { cn } from '../../lib/utils'

// ── Kinetic Void Monaco theme ─────────────────────────────────────────────────

// Defined once and registered on first editor mount via `beforeMount`.
const KV_THEME = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment',                     foreground: '4a5568', fontStyle: 'italic' },
    { token: 'comment.doc',                 foreground: '4a5568', fontStyle: 'italic' },
    { token: 'keyword',                     foreground: '00b4d8' },  // Electric Blue
    { token: 'keyword.control',             foreground: '00b4d8' },
    { token: 'keyword.operator',            foreground: '00b4d8' },
    { token: 'storage.type',               foreground: '00b4d8' },
    { token: 'string',                      foreground: '39d98a' },  // Mint Green
    { token: 'string.escape',              foreground: '2db87a' },
    { token: 'number',                      foreground: '9d8df1' },  // Soft Purple
    { token: 'constant.numeric',           foreground: '9d8df1' },
    { token: 'constant.language',         foreground: '9d8df1' },
    { token: 'variable',                    foreground: 'e8e8e8' },
    { token: 'variable.parameter',         foreground: 'c5b8f5' },
    { token: 'entity.name.function',       foreground: 'e2c97e' },
    { token: 'entity.name.type',           foreground: '00b4d8' },
    { token: 'entity.name.class',          foreground: '00b4d8' },
    { token: 'entity.name.tag',            foreground: '00b4d8' },
    { token: 'support.function',           foreground: 'e2c97e' },
    { token: 'support.type',               foreground: '00b4d8' },
    { token: 'support.class',              foreground: '00b4d8' },
    { token: 'meta.tag',                    foreground: '00b4d8' },
    { token: 'punctuation',                 foreground: '606878' },
    { token: 'operator',                    foreground: '7ec8d8' },
    { token: 'delimiter',                   foreground: '606878' },
    { token: 'type',                        foreground: '00b4d8' },
    { token: 'regexp',                      foreground: '39d98a' },
    { token: 'invalid',                     foreground: 'ff6b6b', fontStyle: 'underline' },
  ],
  colors: {
    'editor.background':                    '#0e0e0e',
    'editor.foreground':                    '#e8e8e8',
    'editor.lineHighlightBackground':       '#1c1b1b',
    'editor.selectionBackground':           '#00b4d822',
    'editor.inactiveSelectionBackground':   '#00b4d812',
    'editor.selectionHighlightBackground':  '#00b4d815',
    'editorLineNumber.foreground':          '#353534',
    'editorLineNumber.activeForeground':    '#5a5a5a',
    'editorCursor.foreground':              '#00b4d8',
    'editorCursor.background':              '#0e0e0e',
    'editorIndentGuide.background1':        '#1e1e1e',
    'editorIndentGuide.activeBackground1':  '#2e2e2e',
    'editorBracketMatch.background':        '#00b4d820',
    'editorBracketMatch.border':            '#00000000',
    'editorWhitespace.foreground':          '#2a2a2a',
    'editorGutter.background':              '#0e0e0e',
    'editorWidget.background':              '#1c1b1b',
    'editorWidget.border':                  '#00000000',
    'editorSuggestWidget.background':       '#1c1b1b',
    'editorSuggestWidget.selectedBackground':'#252525',
    'editorSuggestWidget.border':           '#00000000',
    'editorHoverWidget.background':         '#1c1b1b',
    'editorHoverWidget.border':             '#00000000',
    'scrollbar.shadow':                     '#00000000',
    'scrollbarSlider.background':           '#ffffff0d',
    'scrollbarSlider.hoverBackground':      '#ffffff18',
    'scrollbarSlider.activeBackground':     '#ffffff25',
    'stickyScroll.background':              '#0e0e0e',
    'minimap.background':                   '#0e0e0e',
    'tab.activeBackground':                 '#0e0e0e',
    'tab.inactiveBackground':               '#1c1b1b',
    'tab.border':                           '#00000000',
    'editorGroupHeader.tabsBackground':     '#131313',
  },
}

// ── Monaco editor options ─────────────────────────────────────────────────────

const EDITOR_OPTIONS: MonacoEditorNS.IStandaloneEditorConstructionOptions = {
  fontFamily:                '"JetBrains Mono", "Cascadia Code", "Fira Code", monospace',
  fontLigatures:             true,
  fontSize:                  14,
  lineHeight:                22,
  letterSpacing:             0.3,
  minimap:                   { enabled: false },
  scrollBeyondLastLine:      false,
  renderLineHighlight:       'gutter',
  smoothScrolling:           true,
  cursorBlinking:            'phase',
  cursorSmoothCaretAnimation:'on',
  padding:                   { top: 16, bottom: 32 },
  renderWhitespace:          'selection',
  bracketPairColorization:   { enabled: true },
  overviewRulerLanes:        0,
  hideCursorInOverviewRuler: true,
  occurrencesHighlight:      'off',
  scrollbar: {
    verticalScrollbarSize:   6,
    horizontalScrollbarSize: 6,
    useShadows:              false,
  },
  suggest: {
    showIcons: true,
  },
  wordWrap:                  'off',
  automaticLayout:           true,  // resizes with container
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface EditorAreaProps {
  tabs: EditorTab[]
  activeTabPath: string | null
  onTabClick:   (path: string) => void
  onTabClose:   (path: string) => void
  onDirtyChange:(path: string, isDirty: boolean) => void
  onSave:       (path: string, content: string) => Promise<void>
  /** App writes a getter fn here; call it to get the current editor selection. */
  selectionGetterRef?: React.MutableRefObject<() => string>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function EditorArea({
  tabs,
  activeTabPath,
  onTabClick,
  onTabClose,
  onDirtyChange,
  onSave,
  selectionGetterRef,
}: EditorAreaProps) {
  const editorRef = useRef<MonacoEditorNS.IStandaloneCodeEditor | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ── Ctrl+S / Cmd+S ────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const path = activeTabPath
    if (!path || !editorRef.current) return
    const content = editorRef.current.getValue()
    try {
      await onSave(path, content)
      setSaveError(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    }
  }, [activeTabPath, onSave])

  // Keep a ref so handleMount's closed-over callback always calls the latest version
  const handleSaveRef = useRef(handleSave)
  useEffect(() => { handleSaveRef.current = handleSave }, [handleSave])

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  // Clear auto-save timer on tab switch to avoid saving stale content
  useEffect(() => {
    clearTimeout(autoSaveTimerRef.current)
  }, [activeTabPath])

  // ── Monaco callbacks ───────────────────────────────────────────────────────
  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monaco.editor.defineTheme('kinetic-void', KV_THEME)
    monaco.editor.setTheme('kinetic-void')
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleSaveRef.current()
    })
    if (selectionGetterRef) {
      selectionGetterRef.current = () => {
        const sel = editor.getSelection()
        if (!sel || sel.isEmpty()) return ''
        return editor.getModel()?.getValueInRange(sel) ?? ''
      }
    }
  }, [selectionGetterRef])

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null

  // ── Tab keyboard nav ───────────────────────────────────────────────────────
  function handleTabKeyDown(
    e: ReactKeyboardEvent<HTMLButtonElement>,
    path: string,
  ) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTabClick(path) }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); onTabClose(path) }
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-surface-container-lowest">
        <FileText size={36} className="text-on-surface/10" />
        <p className="text-on-surface/15 text-sm font-mono">
          Open a file from the explorer
        </p>
        <p className="text-on-surface/10 text-xs">
          Click a file in the sidebar, or press{' '}
          <kbd className="font-mono bg-surface-container px-1.5 py-0.5 rounded text-on-surface/25">
            Ctrl+K
          </kbd>{' '}
          to use the command palette
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="Open files"
        className="flex items-end bg-surface shrink-0 overflow-x-auto scrollbar-none"
      >
        {tabs.map((tab) => {
          const isActive = tab.path === activeTabPath
          return (
            <div
              key={tab.path}
              className={cn(
                'group relative flex items-center gap-2 px-3 h-9',
                'max-w-[180px] min-w-[100px] shrink-0',
                // Active tab: merge with editor background — no visible seam
                isActive
                  ? 'bg-surface-container-lowest text-on-surface'
                  : 'bg-surface-container-low text-on-surface/45 hover:text-on-surface/75 hover:bg-surface-container cursor-pointer',
                'transition-colors duration-100',
                // Top accent line on active tab
                isActive && 'border-t border-t-primary/60',
              )}
              onClick={() => onTabClick(tab.path)}
            >
              {/* Dirty indicator dot */}
              {tab.isDirty && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                  aria-label="Unsaved changes"
                />
              )}

              {/* Filename */}
              <button
                role="tab"
                aria-selected={isActive}
                aria-label={tab.name}
                tabIndex={isActive ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, tab.path)}
                className="flex-1 min-w-0 text-left text-[12px] font-ui truncate focus:outline-none"
              >
                {tab.name}
              </button>

              {/* Close button */}
              <button
                onClick={(e) => { e.stopPropagation(); onTabClose(tab.path) }}
                aria-label={`Close ${tab.name}`}
                className={cn(
                  'shrink-0 flex items-center justify-center w-4 h-4 rounded-sm',
                  'text-on-surface/0 group-hover:text-on-surface/40',
                  isActive && 'text-on-surface/30',
                  'hover:!text-on-surface hover:bg-white/10 transition-colors',
                )}
              >
                <X size={11} />
              </button>
            </div>
          )
        })}
      </div>

      {/* ── Save error strip ──────────────────────────────────────────────── */}
      {saveError && (
        <div className="flex items-center justify-between px-4 py-1 bg-red-950/60 text-red-400 text-[11px] shrink-0">
          <span>Save failed: {saveError}</span>
          <button
            onClick={() => setSaveError(null)}
            aria-label="Dismiss"
            className="ml-4 text-red-400/60 hover:text-red-400"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Monaco Editor ─────────────────────────────────────────────────── */}
      {/* We always render one Editor and change its path/language.
          `path` tells @monaco-editor/react to use a separate model per file,
          preserving each file's undo/redo history when you switch tabs. */}
      {activeTab && (
        <div className="flex-1 min-h-0">
          <MonacoEditor
            path={activeTab.path}
            language={activeTab.language}
            defaultValue={activeTab.savedContent}
            theme="kinetic-void"
            options={EDITOR_OPTIONS}
            onMount={handleMount}
            onChange={(val) => {
              if (val === undefined || !activeTab) return
              const dirty = val !== activeTab.savedContent
              onDirtyChange(activeTab.path, dirty)
              if (dirty && activeTab.absPath) {
                clearTimeout(autoSaveTimerRef.current)
                const path = activeTab.path
                autoSaveTimerRef.current = setTimeout(() => void onSave(path, val), 1500)
              }
            }}
            loading={
              <div className="flex items-center justify-center h-full bg-surface-container-lowest text-on-surface/20 text-sm font-mono">
                Loading editor…
              </div>
            }
          />
        </div>
      )}
    </div>
  )
}
