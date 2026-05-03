/**
 * useEditorTabs
 * ─────────────
 * Manages the open-file tab list. Uses the Web File System Access API to
 * read/write file content. Monaco manages its own in-memory buffer; we
 * track only the on-disk snapshot (`savedContent`) and a dirty flag.
 */

import { useState, useCallback } from 'react'
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
  /** Content that was last written to disk (at open time or after save). */
  savedContent: string
  handle: FileSystemFileHandle
  language: string
  isDirty: boolean
}

export interface UseEditorTabsReturn {
  tabs: EditorTab[]
  activeTabPath: string | null
  activeTab: EditorTab | null
  openTab: (node: FileNode) => Promise<void>
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

  const activeTab = tabs.find((t) => t.path === activeTabPath) ?? null

  // ── Open a file ────────────────────────────────────────────────────────────
  const openTab = useCallback(async (node: FileNode) => {
    if (node.kind !== 'file') return

    // Already open → just focus
    if (tabs.some((t) => t.path === node.path)) {
      setActiveTabPath(node.path)
      return
    }

    try {
      const handle = node.handle as FileSystemFileHandle
      const file   = await handle.getFile()
      const text   = await file.text()

      const newTab: EditorTab = {
        path:         node.path,
        name:         node.name,
        savedContent: text,
        handle,
        language:     detectLanguage(node.name),
        isDirty:      false,
      }

      setTabs((prev) => {
        // Guard against concurrent double-open
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
    // Determine next active before mutating
    const idx      = tabs.findIndex((t) => t.path === path)
    const remaining = tabs.filter((t) => t.path !== path)
    const nextPath  =
      activeTabPath === path
        ? (remaining[idx]?.path ?? remaining[Math.max(0, idx - 1)]?.path ?? null)
        : activeTabPath

    setTabs(remaining)
    setActiveTabPath(nextPath)
  }, [tabs, activeTabPath])

  // ── Close all tabs (workspace switch) ─────────────────────────────────────
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

  // ── Mark dirty state (called by Monaco onChange) ───────────────────────────
  const setDirty = useCallback((path: string, isDirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.path === path ? { ...t, isDirty } : t)),
    )
  }, [])

  // ── Save (called with fresh content from editor.getValue()) ───────────────
  const saveTab = useCallback(async (path: string, freshContent: string) => {
    const tab = tabs.find((t) => t.path === path)
    if (!tab) return

    try {
      const writable = await tab.handle.createWritable()
      await writable.write(freshContent)
      await writable.close()

      setTabs((prev) =>
        prev.map((t) =>
          t.path === path
            ? { ...t, savedContent: freshContent, isDirty: false }
            : t,
        ),
      )
    } catch (err) {
      console.error('[tabs] save failed:', err)
      throw err  // propagate so EditorArea can display the error to the user
    }
  }, [tabs])

  return {
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
  }
}
