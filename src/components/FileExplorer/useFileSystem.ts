import { useState, useCallback, useEffect } from 'react'
import { readDir, writeTextFile, mkdir, remove, rename } from '@tauri-apps/plugin-fs'
import { open } from '@tauri-apps/plugin-dialog'
import type { FileNode } from './types'

// ─── Path helpers ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function joinPath(base: string, name: string): string {
  return name ? `${normalizePath(base)}/${name}` : normalizePath(base)
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

async function readDirectoryChildren(absPath: string, relativePath: string): Promise<FileNode[]> {
  const entries = await readDir(absPath)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (!entry.name) continue
    const childRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name
    nodes.push({
      id: childRelative,
      name: entry.name,
      kind: entry.isDirectory ? 'directory' : 'file',
      absPath: joinPath(absPath, entry.name),
      children: null,
      isExpanded: false,
      path: childRelative,
    })
  }

  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function updateNode(
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) return updater(node)
    if (node.children && targetPath.startsWith(node.path + '/')) {
      return { ...node, children: updateNode(node.children, targetPath, updater) }
    }
    return node
  })
}

function removeNode(nodes: FileNode[], targetPath: string): FileNode[] {
  return nodes
    .filter((n) => n.path !== targetPath)
    .map((n) => {
      if (n.children && targetPath.startsWith(n.path + '/')) {
        return { ...n, children: removeNode(n.children, targetPath) }
      }
      return n
    })
}

function findNode(nodes: FileNode[], targetPath: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    if (node.children) {
      const found = findNode(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

function collapseAllNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'directory') return node
    return { ...node, isExpanded: false, children: node.children ? collapseAllNodes(node.children) : null }
  })
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface FileSystemState {
  rootName: string | null
  rootAbsPath: string | null
  tree: FileNode[]
  loading: boolean
  error: string | null
}

const INITIAL_STATE: FileSystemState = {
  rootName: null,
  rootAbsPath: null,
  tree: [],
  loading: false,
  error: null,
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface UseFileSystemReturn {
  state: FileSystemState
  openFolder: () => Promise<void>
  collapseAll: () => void
  toggleExpand: (path: string) => Promise<void>
  createFile: (parentPath: string | null, name: string) => Promise<void>
  createFolder: (parentPath: string | null, name: string) => Promise<void>
  renameNode: (path: string, newName: string) => Promise<void>
  deleteNode: (path: string) => Promise<void>
  copyPath: (path: string) => void
  copyRelativePath: (path: string) => void
  refreshDirectory: (path: string | null) => Promise<void>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const LAST_FOLDER_KEY = 'luminal:lastFolder'

async function loadFolder(absPath: string): Promise<FileSystemState> {
  const tree = await readDirectoryChildren(absPath, '')
  return {
    rootName: absPath.split('/').pop() ?? absPath,
    rootAbsPath: absPath,
    tree,
    loading: false,
    error: null,
  }
}

export function useFileSystem(): UseFileSystemReturn {
  const [state, setState] = useState<FileSystemState>(INITIAL_STATE)

  // ── Restore last folder on mount ───────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem(LAST_FOLDER_KEY)
    if (!saved) return
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    loadFolder(saved)
      .then((next) => { if (!cancelled) setState(next) })
      .catch(() => {
        // Folder no longer accessible (deleted / moved / permissions changed)
        if (!cancelled) {
          localStorage.removeItem(LAST_FOLDER_KEY)
          setState((s) => ({ ...s, loading: false }))
        }
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open folder ────────────────────────────────────────────────────────────

  const openFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Open Folder' }) as string | null
      if (!selected) return
      const absPath = normalizePath(selected)
      setState((s) => ({ ...s, loading: true, error: null }))
      const next = await loadFolder(absPath)
      localStorage.setItem(LAST_FOLDER_KEY, absPath)
      setState(next)
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to open folder',
      }))
    }
  }, [])

  // ── Toggle expand ──────────────────────────────────────────────────────────

  const toggleExpand = useCallback(async (path: string) => {
    setState((s) => {
      const node = findNode(s.tree, path)
      if (!node || node.kind !== 'directory') return s
      if (node.children !== null) {
        return {
          ...s,
          tree: updateNode(s.tree, path, (n) => ({ ...n, isExpanded: !n.isExpanded })),
        }
      }
      return s
    })

    setState((s) => {
      const node = findNode(s.tree, path)
      if (!node || node.kind !== 'directory' || node.children !== null) return s
      return { ...s, loading: true }
    })

    try {
      const node = findNode(state.tree, path)
      if (!node || node.kind !== 'directory' || node.children !== null) return

      const children = await readDirectoryChildren(node.absPath, path)
      setState((s) => ({
        ...s,
        loading: false,
        tree: updateNode(s.tree, path, (n) => ({ ...n, children, isExpanded: true })),
      }))
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [state])

  // ── Refresh directory ──────────────────────────────────────────────────────

  const refreshDirectory = useCallback(async (path: string | null) => {
    const { rootAbsPath, tree } = state
    if (!rootAbsPath) return

    setState((s) => ({ ...s, loading: true }))
    try {
      if (!path) {
        const freshTree = await readDirectoryChildren(rootAbsPath, '')
        setState((s) => ({ ...s, tree: freshTree, loading: false }))
        return
      }

      const node = findNode(tree, path)
      if (!node || node.kind !== 'directory') {
        setState((s) => ({ ...s, loading: false }))
        return
      }

      const children = await readDirectoryChildren(node.absPath, path)
      setState((s) => ({
        ...s,
        loading: false,
        tree: updateNode(s.tree, path, (n) => ({ ...n, children, isExpanded: true })),
      }))
    } catch (err) {
      console.error('[FS] refresh failed:', err)
      setState((s) => ({ ...s, loading: false }))
    }
  }, [state])

  // ── Create file ────────────────────────────────────────────────────────────

  const createFile = useCallback(async (parentPath: string | null, name: string) => {
    const { rootAbsPath, tree } = state
    if (!rootAbsPath) return

    try {
      const parentAbs = parentPath
        ? (findNode(tree, parentPath)?.absPath ?? rootAbsPath)
        : rootAbsPath
      await writeTextFile(joinPath(parentAbs, name), '')
      await refreshDirectory(parentPath)
    } catch (err) {
      console.error('[FS] create file failed:', err)
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to create file',
      }))
    }
  }, [state, refreshDirectory])

  // ── Create folder ──────────────────────────────────────────────────────────

  const createFolder = useCallback(async (parentPath: string | null, name: string) => {
    const { rootAbsPath, tree } = state
    if (!rootAbsPath) return

    try {
      const parentAbs = parentPath
        ? (findNode(tree, parentPath)?.absPath ?? rootAbsPath)
        : rootAbsPath
      await mkdir(joinPath(parentAbs, name))
      await refreshDirectory(parentPath)
    } catch (err) {
      console.error('[FS] create folder failed:', err)
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to create folder',
      }))
    }
  }, [state, refreshDirectory])

  // ── Rename node ────────────────────────────────────────────────────────────
  // Uses std::fs::rename under the hood — atomic, works for both files and dirs.

  const renameNode = useCallback(async (path: string, newName: string) => {
    const { tree } = state
    const node = findNode(tree, path)
    if (!node) return

    try {
      const parentAbs = node.absPath.split('/').slice(0, -1).join('/')
      await rename(node.absPath, joinPath(parentAbs, newName))

      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : null
      await refreshDirectory(parentPath)
    } catch (err) {
      console.error('[FS] rename failed:', err)
    }
  }, [state, refreshDirectory])

  // ── Delete node ────────────────────────────────────────────────────────────

  const deleteNode = useCallback(async (path: string) => {
    const { tree } = state
    const node = findNode(tree, path)
    if (!node) return

    try {
      await remove(node.absPath, { recursive: node.kind === 'directory' })
      setState((s) => ({ ...s, tree: removeNode(s.tree, path) }))
    } catch (err) {
      console.error('[FS] delete failed:', err)
    }
  }, [state])

  // ── Clipboard helpers ──────────────────────────────────────────────────────

  const copyPath = useCallback((path: string) => {
    const { rootAbsPath } = state
    const full = rootAbsPath ? joinPath(rootAbsPath, path) : path
    navigator.clipboard.writeText(full).catch(console.error)
  }, [state.rootAbsPath])

  const copyRelativePath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(console.error)
  }, [])

  const collapseAll = useCallback(() => {
    setState((s) => ({ ...s, tree: collapseAllNodes(s.tree) }))
  }, [])

  return {
    state,
    openFolder,
    collapseAll,
    toggleExpand,
    createFile,
    createFolder,
    renameNode,
    deleteNode,
    copyPath,
    copyRelativePath,
    refreshDirectory,
  }
}
