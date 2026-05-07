/**
 * FileExplorer.tsx
 * ────────────────
 * The sidebar panel rendered when the Files activity-bar icon is active.
 *
 * Features:
 *  - "Open Folder" button triggers the native directory picker.
 *  - Lazy-loaded, expandable file tree.
 *  - Right-click context menu with context-aware actions (file vs. dir vs. pane).
 *  - Inline rename (click the rename action or press F2).
 *  - Inline new-file / new-folder input at the top of the target directory.
 *  - Delete with a browser confirm() guard.
 *
 * All surfaces follow the Kinetic Void "no-line" rule — separators are
 * background-shift bands, not <hr> elements with visible colour.
 */

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  type MouseEvent,
  type KeyboardEvent,
} from 'react'
import {
  FolderOpen,
  RefreshCw,
  FilePlus,
  FolderPlus,
  ChevronsUpDown,
} from 'lucide-react'
import { useFileSystem } from './useFileSystem'
import { FileTreeNode } from './FileTreeNode'
import { ContextMenu } from './ContextMenu'
import type {
  FileNode,
  ContextMenuPosition,
  ContextEntry,
  InlineInputMode,
} from './types'

/** Walk the in-memory tree to find a node by path (non-exported mirror of useFileSystem's findNode). */
function findNodeInTree(nodes: FileNode[], path: string): FileNode | null {
  for (const node of nodes) {
    if (node.path === path) return node
    if (node.children) {
      const found = findNodeInTree(node.children, path)
      if (found) return found
    }
  }
  return null
}
import { cn } from '../../lib/utils'

export interface FileExplorerHandle {
  requestOpenFolder: () => void
  rootAbsPath: string | null
}

interface FileExplorerProps {
  /** Called when the user single-clicks a file — opens it in the editor. */
  onFileOpen: (node: FileNode) => void
  /** Called after a file/folder is deleted — closes any matching editor tabs. */
  onFileDelete?: (path: string) => void
  /** Called just before the folder picker opens — use it to close stale editor tabs. */
  onWillOpenFolder?: () => void
  /** Called whenever the root folder path changes (including on close). */
  onRootChange?: (path: string | null) => void
}

export const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(
  function FileExplorer({ onFileOpen, onFileDelete, onWillOpenFolder, onRootChange }, ref) {
  const fs = useFileSystem()
  const { state, openFolder, toggleExpand, createFile, createFolder,
          renameNode, deleteNode, copyPath, copyRelativePath, refreshDirectory,
          collapseAll } = fs

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputMode | null>(null)
  const [inlineValue, setInlineValue] = useState('')
  const inlineRef = useRef<HTMLInputElement>(null)
  const committingRef = useRef(false)

  useImperativeHandle(ref, () => ({
    requestOpenFolder: () => void openFolder(),
    rootAbsPath: state.rootAbsPath ?? null,
  }), [openFolder, state.rootAbsPath])

  // Notify parent whenever the root path changes
  useEffect(() => {
    onRootChange?.(state.rootAbsPath ?? null)
  }, [state.rootAbsPath, onRootChange])

  // ── Context menu builder ─────────────────────────────────────────────────

  const buildEntries = useCallback((pos: ContextMenuPosition): ContextEntry[] => {
    const target = pos.target

    if (target.kind === 'file') {
      const { node } = target
      return [
        { type: 'action', id: 'open',   label: 'Open',         action: () => console.log('[explorer] open', node.path) },
        { type: 'action', id: 'rename', label: 'Rename',       action: () => setRenamingPath(node.path) },
        { type: 'action', id: 'delete', label: 'Delete',       action: () => {
            if (window.confirm(`Delete "${node.name}"?`)) {
              deleteNode(node.path)
              onFileDelete?.(node.path)
            }
          }
        },
        { type: 'separator' },
        { type: 'action', id: 'reveal', label: 'Reveal in File Explorer', shortcut: 'Shift+Alt+R',
          action: () => console.log('[explorer] reveal', node.path) },
        { type: 'separator' },
        { type: 'action', id: 'copyPath',     label: 'Copy Path',          shortcut: 'Shift+Alt+C',        action: () => copyPath(node.path) },
        { type: 'action', id: 'copyRelPath',  label: 'Copy Relative Path', shortcut: 'Ctrl+K Ctrl+Shift+C', action: () => copyRelativePath(node.path) },
      ]
    }

    if (target.kind === 'directory') {
      const { node } = target
      const parentPath = node.path
      return [
        { type: 'action', id: 'newFile',   label: 'New File…',   action: () => {
            // Only expand if collapsed — toggling an expanded dir would hide the input
            if (!node.isExpanded) void toggleExpand(node.path)
            setInlineInput({ mode: 'create-file', parentPath })
            setInlineValue('')
          }
        },
        { type: 'action', id: 'newFolder', label: 'New Folder…', action: () => {
            if (!node.isExpanded) void toggleExpand(node.path)
            setInlineInput({ mode: 'create-folder', parentPath })
            setInlineValue('')
          }
        },
        { type: 'action', id: 'rename', label: 'Rename',         action: () => setRenamingPath(node.path) },
        { type: 'action', id: 'delete', label: 'Delete',         action: () => {
            if (window.confirm(`Delete folder "${node.name}" and all its contents?`)) {
              deleteNode(node.path)
              onFileDelete?.(node.path)
            }
          }
        },
        { type: 'separator' },
        { type: 'action', id: 'reveal',    label: 'Reveal in File Explorer',    shortcut: 'Shift+Alt+R',
          action: () => console.log('[explorer] reveal', node.path) },
        { type: 'action', id: 'terminal',  label: 'Open in Integrated Terminal',
          action: () => console.log('[explorer] terminal', node.path) },
        { type: 'separator' },
        { type: 'action', id: 'find',      label: 'Find in Folder…',            shortcut: 'Shift+Alt+F',
          action: () => console.log('[explorer] find', node.path) },
        { type: 'separator' },
        { type: 'action', id: 'copyPath',    label: 'Copy Path',          shortcut: 'Shift+Alt+C',         action: () => copyPath(node.path) },
        { type: 'action', id: 'copyRelPath', label: 'Copy Relative Path', shortcut: 'Ctrl+K Ctrl+Shift+C', action: () => copyRelativePath(node.path) },
        { type: 'separator' },
        { type: 'action', id: 'refresh',   label: 'Refresh',
          action: () => refreshDirectory(node.path) },
        { type: 'action', id: 'collapse',  label: 'Collapse All',
          action: () => console.log('[explorer] collapse') },
      ]
    }

    // 'explorer' — right-clicked on empty pane space
    return [
      { type: 'action', id: 'newFile',   label: 'New File…',   action: () => {
          setInlineInput({ mode: 'create-file', parentPath: '' })
          setInlineValue('')
        }
      },
      { type: 'action', id: 'newFolder', label: 'New Folder…', action: () => {
          setInlineInput({ mode: 'create-folder', parentPath: '' })
          setInlineValue('')
        }
      },
      { type: 'separator' },
      { type: 'action', id: 'openFolder',   label: 'Add Folder to Workspace…', action: () => { onWillOpenFolder?.(); void openFolder() } },
      { type: 'action', id: 'openSettings', label: 'Open Folder Settings',
        action: () => console.log('[explorer] folder settings') },
      { type: 'action', id: 'removeFolder', label: 'Remove Folder from Workspace',
        disabled: !state.rootAbsPath,
        action: () => console.log('[explorer] remove folder') },
      { type: 'separator' },
      { type: 'action', id: 'find',         label: 'Find in Folder…',            shortcut: 'Shift+Alt+F',
        action: () => console.log('[explorer] find') },
      { type: 'separator' },
      { type: 'action', id: 'copyPath',    label: 'Copy Path',          shortcut: 'Shift+Alt+C',
        disabled: !selectedPath,
        action: () => { if (selectedPath) copyPath(selectedPath) }
      },
      { type: 'action', id: 'copyRelPath', label: 'Copy Relative Path', shortcut: 'Ctrl+K Ctrl+Shift+C',
        disabled: !selectedPath,
        action: () => { if (selectedPath) copyRelativePath(selectedPath) }
      },
      { type: 'separator' },
      { type: 'action', id: 'reveal',   label: 'Reveal in File Explorer',
        action: () => console.log('[explorer] reveal root') },
      { type: 'action', id: 'terminal', label: 'Open in Integrated Terminal',
        action: () => console.log('[explorer] terminal root') },
    ]
  }, [copyPath, copyRelativePath, deleteNode, onFileDelete, onWillOpenFolder, openFolder,
      refreshDirectory, selectedPath, state.rootAbsPath, toggleExpand])

  // ── Context menu open ────────────────────────────────────────────────────

  const handleContextMenu = useCallback((
    _e: MouseEvent,
    pos: ContextMenuPosition,
  ) => {
    setContextMenu(pos)
  }, [])

  function handlePaneContextMenu(e: MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, target: { kind: 'explorer' } })
  }

  // ── Inline input ─────────────────────────────────────────────────────────

  async function commitInlineInput() {
    // Guard against double-firing (Enter keydown unmounts input → onBlur also fires)
    if (committingRef.current) return
    committingRef.current = true

    const name = inlineValue.trim()
    if (!name || !inlineInput) {
      setInlineInput(null)
      committingRef.current = false
      return
    }

    try {
      if (inlineInput.mode === 'create-file') {
        await createFile(inlineInput.parentPath || null, name)
      } else if (inlineInput.mode === 'create-folder') {
        await createFolder(inlineInput.parentPath || null, name)
      }
    } finally {
      setInlineInput(null)
      setInlineValue('')
      committingRef.current = false
    }
  }

  function handleInlineKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation()
    if (e.key === 'Enter')  { void commitInlineInput() }
    if (e.key === 'Escape') { setInlineInput(null) }
  }

  // ── Rename commit ────────────────────────────────────────────────────────

  function handleRenameCommit(path: string, newName: string) {
    void renameNode(path, newName)
    setRenamingPath(null)
  }

  // ── Toolbar actions ──────────────────────────────────────────────────────

  function handleNewFile() {
    let parentPath = ''
    if (selectedPath) {
      const node = findNodeInTree(state.tree, selectedPath)
      if (node?.kind === 'directory') {
        parentPath = selectedPath
        if (!node.isExpanded) void toggleExpand(selectedPath)
      } else if (node?.kind === 'file') {
        // Create in the file's parent directory
        parentPath = selectedPath.includes('/')
          ? selectedPath.split('/').slice(0, -1).join('/')
          : ''
      }
    }
    setInlineInput({ mode: 'create-file', parentPath })
    setInlineValue('')
  }

  function handleNewFolder() {
    let parentPath = ''
    if (selectedPath) {
      const node = findNodeInTree(state.tree, selectedPath)
      if (node?.kind === 'directory') {
        parentPath = selectedPath
        if (!node.isExpanded) void toggleExpand(selectedPath)
      } else if (node?.kind === 'file') {
        parentPath = selectedPath.includes('/')
          ? selectedPath.split('/').slice(0, -1).join('/')
          : ''
      }
    }
    setInlineInput({ mode: 'create-folder', parentPath })
    setInlineValue('')
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col h-full bg-surface-container-low select-none"
      onContextMenu={handlePaneContextMenu}
    >
      {/* ── Panel header ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 h-9 shrink-0">
        <span className="font-display text-[11px] font-medium tracking-widest uppercase text-on-surface/40">
          Explorer
        </span>

        {/* Toolbar icons — visible on hover of the header */}
        {state.rootAbsPath && (
          <div className="flex items-center gap-0.5">
            <ToolbarButton title="New File (Ctrl+N)"   onClick={handleNewFile}>
              <FilePlus size={14} />
            </ToolbarButton>
            <ToolbarButton title="New Folder"          onClick={handleNewFolder}>
              <FolderPlus size={14} />
            </ToolbarButton>
            <ToolbarButton title="Refresh Explorer"    onClick={() => refreshDirectory(null)}>
              <RefreshCw size={14} />
            </ToolbarButton>
            <ToolbarButton title="Collapse All"        onClick={collapseAll}>
              <ChevronsUpDown size={14} />
            </ToolbarButton>
          </div>
        )}
      </div>

      {/* ── Workspace root label ────────────────────────────────────────── */}
      {state.rootName && (
        <div className="flex items-center justify-between gap-1.5 px-4 py-1 shrink-0">
          <span className="font-display text-[11px] font-semibold tracking-wider uppercase text-on-surface/55 truncate flex-1 min-w-0">
            {state.rootName}
          </span>
          <button
            title="Change Folder"
            onClick={() => { onWillOpenFolder?.(); void openFolder() }}
            className="shrink-0 text-[10px] text-on-surface/25 hover:text-primary transition-colors font-ui ml-2"
          >
            change
          </button>
        </div>
      )}

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin"
        role="tree"
        aria-label="File tree"
      >
        {/* Empty state — no folder opened yet */}
        {!state.rootAbsPath && (
          <div className="flex flex-col items-center justify-center gap-4 h-full px-4 pb-8">
            <FolderOpen size={32} className="text-on-surface/15" aria-hidden="true" />
            <p className="text-[12px] text-on-surface/30 text-center leading-relaxed">
              You have not opened a folder.
            </p>
            <button
              onClick={() => { onWillOpenFolder?.(); void openFolder() }}
              className={cn(
                'px-4 py-2 rounded text-sm font-ui font-medium',
                'bg-primary/20 text-primary hover:bg-primary/30',
                'transition-colors duration-150',
              )}
            >
              Open Folder
            </button>
          </div>
        )}

        {/* Loading indicator */}
        {state.loading && (
          <div className="flex items-center gap-2 px-4 py-2 text-[12px] text-on-surface/30">
            <RefreshCw size={11} className="animate-spin" />
            Loading…
          </div>
        )}

        {/* Error */}
        {state.error && (
          <p className="px-4 py-2 text-[12px] text-red-400/80">{state.error}</p>
        )}

        {/* Inline input at root level (create file/folder at root) */}
        {inlineInput && (inlineInput.parentPath === '' || inlineInput.parentPath === null) && (
          <InlineInput
            ref={inlineRef}
            placeholder={inlineInput.mode === 'create-file' ? 'file.txt' : 'folder'}
            value={inlineValue}
            depth={0}
            onChange={setInlineValue}
            onKeyDown={handleInlineKeyDown}
            onBlur={() => void commitInlineInput()}
          />
        )}

        {/* Tree */}
        {state.tree.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            renamingPath={renamingPath}
            onSelect={setSelectedPath}
            onFileOpen={onFileOpen}
            onToggleExpand={(path) => void toggleExpand(path)}
            onContextMenu={handleContextMenu}
            onRenameCommit={handleRenameCommit}
            onRenameCancel={() => setRenamingPath(null)}
            inlineInput={inlineInput}
            inlineValue={inlineValue}
            onInlineChange={setInlineValue}
            onInlineKeyDown={handleInlineKeyDown}
            onInlineBlur={() => void commitInlineInput()}
          />
        ))}
      </div>

      {/* ── Context menu portal ──────────────────────────────────────────── */}
      {contextMenu && (
        <ContextMenu
          position={contextMenu}
          entries={buildEntries(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
})

// ─── Small helper components ───────────────────────────────────────────────────

function ToolbarButton({
  title, onClick, children,
}: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center w-6 h-6 rounded',
        'text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06]',
        'transition-colors duration-75',
      )}
    >
      {children}
    </button>
  )
}

const InlineInput = forwardRef<HTMLInputElement, {
  placeholder: string
  value: string
  depth: number
  onChange: (v: string) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}>(function InlineInput({ placeholder, value, depth, onChange, onKeyDown, onBlur }, ref) {
  return (
    <div
      className="flex items-center gap-1.5 h-[22px] pr-2"
      style={{ paddingLeft: depth * 12 + 8 + 16 }}
    >
      <input
        ref={ref}
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        className={cn(
          'flex-1 min-w-0 bg-surface-container-highest',
          'text-on-surface text-[13px] font-ui',
          'px-1 rounded-sm outline outline-1 outline-primary/60',
          'caret-primary placeholder:text-on-surface/25',
        )}
        aria-label={`Enter ${placeholder}`}
      />
    </div>
  )
})
