/**
 * useFileSystem
 * ─────────────
 * Manages the workspace root and the lazy-loaded file tree.
 * Backed by the Web File System Access API — works in Tauri's WebView2
 * (Chromium-based) without any Node or Rust dependency.
 *
 * Migration note: when Tauri's `@tauri-apps/plugin-fs` is available, replace
 * `showDirectoryPicker` with `open({ directory: true })` from
 * `@tauri-apps/plugin-dialog` and the FS calls with the plugin equivalents.
 */

import { useState, useCallback } from 'react'
import type { FileNode } from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Load the immediate children of a directory handle. Directories start with
 *  `children: null` (unloaded); calling this populates them. */
async function readDirectoryChildren(
  dirHandle: FileSystemDirectoryHandle,
  parentPath: string,
): Promise<FileNode[]> {
  const nodes: FileNode[] = []

  for await (const handle of dirHandle.values()) {
    const childPath = parentPath ? `${parentPath}/${handle.name}` : handle.name
    nodes.push({
      id: childPath,
      name: handle.name,
      kind: handle.kind,
      handle: handle as FileSystemFileHandle | FileSystemDirectoryHandle,
      children: null,   // lazy — will be loaded on first expand
      isExpanded: false,
      path: childPath,
    })
  }

  // Directories first, then files; both sorted A→Z
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

/** Immutable deep-update: walk the tree and apply `updater` to the node whose
 *  `path` matches `targetPath`. Returns the same array reference if nothing
 *  changed (so React can bail out of re-renders). */
function updateNode(
  nodes: FileNode[],
  targetPath: string,
  updater: (node: FileNode) => FileNode,
): FileNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath) return updater(node)
    // Recurse only into ancestors of the target
    if (node.children && targetPath.startsWith(node.path + '/')) {
      return { ...node, children: updateNode(node.children, targetPath, updater) }
    }
    return node
  })
}

/** Remove a node from the tree by path */
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

/** Find a node by path (returns null if not found) */
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

/** Recursively set isExpanded: false on every directory node */
function collapseAllNodes(nodes: FileNode[]): FileNode[] {
  return nodes.map((node) => {
    if (node.kind !== 'directory') return node
    return { ...node, isExpanded: false, children: node.children ? collapseAllNodes(node.children) : null }
  })
}

/** Get the parent directory handle for a given path within the root tree */
async function resolveParentHandle(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/')
  let current = rootHandle
  for (const part of parts.slice(0, -1)) {
    current = await current.getDirectoryHandle(part)
  }
  return current
}

// ─── State shape ──────────────────────────────────────────────────────────────

interface FileSystemState {
  rootName: string | null
  rootHandle: FileSystemDirectoryHandle | null
  tree: FileNode[]
  loading: boolean
  error: string | null
}

const INITIAL_STATE: FileSystemState = {
  rootName: null,
  rootHandle: null,
  tree: [],
  loading: false,
  error: null,
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseFileSystemReturn {
  state: FileSystemState
  /** Open the native folder-picker and load the workspace root */
  openFolder: () => Promise<void>
  /** Collapse every directory node in the tree */
  collapseAll: () => void
  /** Expand or collapse a directory node (lazy-loads children on first expand) */
  toggleExpand: (path: string) => Promise<void>
  /** Create a new empty file at `parentPath/name` */
  createFile: (parentPath: string | null, name: string) => Promise<void>
  /** Create a new directory at `parentPath/name` */
  createFolder: (parentPath: string | null, name: string) => Promise<void>
  /** Rename a node in place */
  renameNode: (path: string, newName: string) => Promise<void>
  /** Move a file/folder to the system trash (best-effort) */
  deleteNode: (path: string) => Promise<void>
  /** Copy the absolute-ish path to the clipboard (workspace root name + relative path) */
  copyPath: (path: string) => void
  /** Copy just the relative path to the clipboard */
  copyRelativePath: (path: string) => void
  /** Refresh the children of a directory */
  refreshDirectory: (path: string | null) => Promise<void>
}

export function useFileSystem(): UseFileSystemReturn {
  const [state, setState] = useState<FileSystemState>(INITIAL_STATE)

  // ── Open folder ────────────────────────────────────────────────────────────

  const openFolder = useCallback(async () => {
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      setState((s) => ({ ...s, loading: true, error: null }))
      const tree = await readDirectoryChildren(dirHandle, '')
      setState({
        rootName: dirHandle.name,
        rootHandle: dirHandle,
        tree,
        loading: false,
        error: null,
      })
    } catch (err) {
      // User cancelled the picker — not an error worth surfacing
      if (err instanceof DOMException && err.name === 'AbortError') return
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
      // If already loaded — just flip isExpanded synchronously
      if (node.children !== null) {
        return {
          ...s,
          tree: updateNode(s.tree, path, (n) => ({ ...n, isExpanded: !n.isExpanded })),
        }
      }
      // Async load will be done outside setState
      return s
    })

    // Async path: load children if not yet loaded
    setState((s) => {
      const node = findNode(s.tree, path)
      if (!node || node.kind !== 'directory' || node.children !== null) return s
      return { ...s, loading: true }
    })

    try {
      const { tree } = state
      const node = findNode(tree, path)
      if (!node || node.kind !== 'directory' || node.children !== null) return

      const dirHandle = node.handle as FileSystemDirectoryHandle
      const children = await readDirectoryChildren(dirHandle, path)

      setState((s) => ({
        ...s,
        loading: false,
        tree: updateNode(s.tree, path, (n) => ({
          ...n,
          children,
          isExpanded: true,
        })),
      }))
    } catch {
      setState((s) => ({ ...s, loading: false }))
    }
  }, [state])

  // ── Refresh directory ──────────────────────────────────────────────────────
  // Declared before createFile/createFolder/renameNode so it can be listed
  // in their dependency arrays without a temporal dead zone error.

  const refreshDirectory = useCallback(async (path: string | null) => {
    const { rootHandle, tree } = state
    if (!rootHandle) return

    setState((s) => ({ ...s, loading: true }))
    try {
      if (!path) {
        const freshTree = await readDirectoryChildren(rootHandle, '')
        setState((s) => ({ ...s, tree: freshTree, loading: false }))
        return
      }

      const node = findNode(tree, path)
      if (!node || node.kind !== 'directory') {
        setState((s) => ({ ...s, loading: false }))
        return
      }

      const dirHandle = node.handle as FileSystemDirectoryHandle
      const children = await readDirectoryChildren(dirHandle, path)

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
    const { rootHandle, tree } = state
    if (!rootHandle) return

    try {
      let parentHandle: FileSystemDirectoryHandle
      if (!parentPath) {
        parentHandle = rootHandle
      } else {
        const parentNode = findNode(tree, parentPath)
        parentHandle = (parentNode?.handle ?? rootHandle) as FileSystemDirectoryHandle
      }

      await parentHandle.getFileHandle(name, { create: true })
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
    const { rootHandle, tree } = state
    if (!rootHandle) return

    try {
      let parentHandle: FileSystemDirectoryHandle
      if (!parentPath) {
        parentHandle = rootHandle
      } else {
        const parentNode = findNode(tree, parentPath)
        parentHandle = (parentNode?.handle ?? rootHandle) as FileSystemDirectoryHandle
      }

      await parentHandle.getDirectoryHandle(name, { create: true })
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
  // The File System Access API has no rename() — we copy then delete.

  const renameNode = useCallback(async (path: string, newName: string) => {
    const { rootHandle, tree } = state
    if (!rootHandle) return

    try {
      const node = findNode(tree, path)
      if (!node) return

      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : null
      let parentHandle: FileSystemDirectoryHandle
      if (!parentPath) {
        parentHandle = rootHandle
      } else {
        parentHandle = await resolveParentHandle(rootHandle, path)
      }

      if (node.kind === 'file') {
        const oldHandle = node.handle as FileSystemFileHandle
        const oldFile = await oldHandle.getFile()
        const newHandle = await parentHandle.getFileHandle(newName, { create: true })
        const writable = await newHandle.createWritable()
        await writable.write(await oldFile.arrayBuffer())
        await writable.close()
        await parentHandle.removeEntry(node.name)
      } else {
        // Directories: deep-copy then remove (best-effort for MVP)
        await copyDirectory(
          node.handle as FileSystemDirectoryHandle,
          await parentHandle.getDirectoryHandle(newName, { create: true }),
        )
        await parentHandle.removeEntry(node.name, { recursive: true })
      }

      await refreshDirectory(parentPath)
    } catch (err) {
      console.error('[FS] rename failed:', err)
    }
  }, [state, refreshDirectory])

  // ── Delete node ────────────────────────────────────────────────────────────

  const deleteNode = useCallback(async (path: string) => {
    const { rootHandle, tree } = state
    if (!rootHandle) return

    const node = findNode(tree, path)
    if (!node) return

    try {
      const parentPath = path.includes('/') ? path.split('/').slice(0, -1).join('/') : null
      let parentHandle: FileSystemDirectoryHandle
      if (!parentPath) {
        parentHandle = rootHandle
      } else {
        parentHandle = await resolveParentHandle(rootHandle, path)
      }

      await parentHandle.removeEntry(node.name, { recursive: node.kind === 'directory' })

      setState((s) => ({ ...s, tree: removeNode(s.tree, path) }))
    } catch (err) {
      console.error('[FS] delete failed:', err)
    }
  }, [state])

  // ── Clipboard helpers ──────────────────────────────────────────────────────

  const copyPath = useCallback((path: string) => {
    const full = state.rootName ? `${state.rootName}/${path}` : path
    navigator.clipboard.writeText(full).catch(console.error)
  }, [state.rootName])

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

// ─── Internal deep-copy helper ─────────────────────────────────────────────────

async function copyDirectory(
  src: FileSystemDirectoryHandle,
  dest: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const handle of src.values()) {
    if (handle.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      const newHandle = await dest.getFileHandle(handle.name, { create: true })
      const writable = await newHandle.createWritable()
      await writable.write(await file.arrayBuffer())
      await writable.close()
    } else {
      const subDest = await dest.getDirectoryHandle(handle.name, { create: true })
      await copyDirectory(handle as FileSystemDirectoryHandle, subDest)
    }
  }
}
