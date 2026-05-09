import { useState, useCallback, useRef } from 'react'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog'
import type { FileNode } from '../FileExplorer/types'

// ── Language detection ────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',   tsx: 'typescript',
  js: 'javascript',   jsx: 'javascript',  mjs: 'javascript',  cjs: 'javascript',
  json: 'json',       jsonc: 'json',
  md: 'markdown',     mdx: 'markdown',
  html: 'html',       htm: 'html',
  css: 'css',
  scss: 'scss',       sass: 'scss',
  less: 'less',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  cpp: 'cpp',         cc: 'cpp',          h: 'cpp',           hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  rb: 'ruby',
  sh: 'shell',        bash: 'shell',      zsh: 'shell',       fish: 'shell',
  ps1: 'powershell',
  sql: 'sql',
  yaml: 'yaml',       yml: 'yaml',
  xml: 'xml',         svg: 'xml',
  toml: 'ini',
  dockerfile: 'dockerfile',
  graphql: 'graphql', gql: 'graphql',
  txt: 'plaintext',   log: 'plaintext',   env: 'plaintext',
  pdf: 'pdf',
}

export function detectLanguage(name: string): string {
  const lower = name.toLowerCase()
  if (lower === 'dockerfile') return 'dockerfile'
  const ext = lower.split('.').pop() ?? ''
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditorTab {
  path: string
  name: string
  /** Content last written to disk (at open time or after save). */
  savedContent: string
  /** Absolute OS path used for all file I/O. null = untitled, not saved yet. */
  absPath: string | null
  language: string
  isDirty: boolean
}

export interface UseEditorTabsReturn {
  tabs: EditorTab[]
  activeTabPath: string | null
  activeTab: EditorTab | null
  openTab: (node: FileNode) => Promise<void>
  /** Open a file picker dialog and open the chosen file as a new tab. */
  openFileByPath: () => Promise<void>
  /** Create a new blank untitled tab. */
  newUntitledTab: () => void
  closeTab: (path: string) => void
  closeAllTabs: () => void
  /** Close any tab whose path equals or starts with `pathPrefix` (for folder deletes). */
  forceCloseByPrefix: (pathPrefix: string) => void
  focusTab: (path: string) => void
  setDirty: (path: string, isDirty: boolean) => void
  saveTab: (path: string, freshContent: string) => Promise<void>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useEditorTabs(): UseEditorTabsReturn {
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null)
  const untitledCounter = useRef(0)

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null

  // ── New untitled tab ───────────────────────────────────────────────────────
  const newUntitledTab = useCallback(() => {
    untitledCounter.current += 1
    const path = `untitled://${untitledCounter.current}`
    const name = `Untitled-${untitledCounter.current}`
    setTabs((prev) => [
      ...prev,
      { path, name, savedContent: '', absPath: null, language: 'plaintext', isDirty: false },
    ])
    setActiveTabPath(path)
  }, [])

  // ── Open via file dialog ───────────────────────────────────────────────────
  const openFileByPath = useCallback(async () => {
    const selected = await openFileDialog({ multiple: false, directory: false })
    if (!selected || typeof selected !== 'string') return

    const absPath = selected
    // If already open, just focus it
    const existing = tabs.find((t) => t.absPath === absPath)
    if (existing) { setActiveTabPath(existing.path); return }

    try {
      const text = await readTextFile(absPath)
      const name = absPath.replace(/\\/g, '/').split('/').pop() ?? absPath
      const path = `file://${absPath}`
      setTabs((prev) => {
        if (prev.some((t) => t.path === path)) return prev
        return [...prev, { path, name, savedContent: text, absPath, language: detectLanguage(name), isDirty: false }]
      })
      setActiveTabPath(path)
    } catch (err) {
      console.error('[tabs] open file failed:', err)
    }
  }, [tabs])

  // ── Open a file node ───────────────────────────────────────────────────────
  const openTab = useCallback(async (node: FileNode) => {
    if (node.kind !== 'file') return

    if (tabs.some((t) => t.path === node.path)) {
      setActiveTabPath(node.path)
      return
    }

    const lang = detectLanguage(node.name)
    try {
      // PDFs are binary — PdfViewer reads the file itself; skip text read
      const text = lang === 'pdf' ? '' : await readTextFile(node.absPath)
      const newTab: EditorTab = {
        path:         node.path,
        name:         node.name,
        savedContent: text,
        absPath:      node.absPath,
        language:     lang,
        isDirty:      false,
      }

      setTabs((prev) => {
        if (prev.some((t) => t.path === node.path)) return prev
        return [...prev, newTab]
      })
      setActiveTabPath(node.path)
    } catch (err) {
      console.error('[tabs] open failed:', err)
    }
  }, [tabs])

  // ── Close a tab ────────────────────────────────────────────────────────────
  const closeTab = useCallback((path: string) => {
    const idx       = tabs.findIndex((t) => t.path === path)
    const remaining = tabs.filter((t) => t.path !== path)
    const nextPath  =
      activeTabPath === path
        ? (remaining[idx]?.path ?? remaining[Math.max(0, idx - 1)]?.path ?? null)
        : activeTabPath

    setTabs(remaining)
    setActiveTabPath(nextPath)
  }, [tabs, activeTabPath])

  // ── Close all tabs ─────────────────────────────────────────────────────────
  const closeAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabPath(null)
  }, [])

  // ── Force-close by path prefix (folder deleted) ────────────────────────────
  const forceCloseByPrefix = useCallback((prefix: string) => {
    setTabs((prev) => {
      const next = prev.filter(
        (t) => t.path !== prefix && !t.path.startsWith(prefix + '/'),
      )
      setActiveTabPath((cur) => {
        if (!cur) return null
        const stillOpen = next.some((t) => t.path === cur)
        return stillOpen ? cur : (next[next.length - 1]?.path ?? null)
      })
      return next
    })
  }, [])

  // ── Focus an existing tab ──────────────────────────────────────────────────
  const focusTab = useCallback((path: string) => {
    setActiveTabPath(path)
  }, [])

  // ── Mark dirty state ───────────────────────────────────────────────────────
  const setDirty = useCallback((path: string, isDirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, isDirty } : t)),
    )
  }, [])

  // ── Save (with Save As for untitled tabs) ──────────────────────────────────
  const saveTab = useCallback(async (path: string, freshContent: string) => {
    const tab = tabs.find((t) => t.path === path)
    if (!tab) return

    let targetPath = tab.absPath

    if (!targetPath) {
      const chosen = await saveFileDialog({ title: 'Save File', defaultPath: tab.name })
      if (!chosen) return
      targetPath = chosen
    }

    try {
      await writeTextFile(targetPath, freshContent)
      const savedName = targetPath.replace(/\\/g, '/').split('/').pop() ?? tab.name

      setTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? { ...t, absPath: targetPath!, name: savedName, savedContent: freshContent, isDirty: false }
            : t,
        ),
      )
    } catch (err) {
      console.error('[tabs] save failed:', err)
      throw err
    }
  }, [tabs])

  return {
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
  }
}
