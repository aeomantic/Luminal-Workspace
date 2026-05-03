/**
 * FileTreeNode.tsx
 * ────────────────
 * Renders a single row in the file tree — either a file or a directory.
 * Directories show a chevron and can be expanded/collapsed.
 * Supports inline rename when `inlineRename` matches this node's path.
 *
 * Design: selection state = background shift only (no border/underline).
 */

import {
  useRef,
  useEffect,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileImage,
  File,
} from 'lucide-react'
import type { FileNode, ContextMenuPosition, InlineInputMode } from './types'
import { cn } from '../../lib/utils'

// ─── File icon helper ─────────────────────────────────────────────────────────

const CODE_EXTS = new Set([
  'ts','tsx','js','jsx','mjs','cjs','vue','svelte',
  'py','rb','rs','go','java','kt','swift','c','cpp','cc','h','hpp',
  'cs','php','lua','r','dart','zig','nim','ex','exs',
  'html','css','scss','sass','less',
  'json','yaml','yml','toml','xml','graphql','gql',
  'sh','bash','zsh','fish','ps1','bat',
  'sql','prisma','dockerfile',
  'md','mdx',
])

const IMG_EXTS = new Set(['png','jpg','jpeg','gif','svg','webp','ico','bmp','tiff'])
const TEXT_EXTS = new Set(['txt','log','env','gitignore','gitattributes','editorconfig'])

function FileIcon({ name, className }: { name: string; className?: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMG_EXTS.has(ext))  return <FileImage  size={14} className={className} />
  if (TEXT_EXTS.has(ext)) return <FileText   size={14} className={className} />
  if (CODE_EXTS.has(ext)) return <FileCode   size={14} className={className} />
  return                         <File       size={14} className={className} />
}

// ─── Component ────────────────────────────────────────────────────────────────

interface FileTreeNodeProps {
  node: FileNode
  depth: number
  selectedPath: string | null
  /** Called when the user clicks a file node — opens it in the editor. */
  onFileOpen: (node: FileNode) => void
  renamingPath: string | null
  onSelect: (path: string) => void
  onToggleExpand: (path: string) => void
  onContextMenu: (e: MouseEvent, pos: ContextMenuPosition) => void
  onRenameCommit: (path: string, newName: string) => void
  onRenameCancel: () => void
  /** Inline create-file / create-folder input state — passed through the whole tree */
  inlineInput: InlineInputMode | null
  inlineValue: string
  onInlineChange: (v: string) => void
  onInlineKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  onInlineBlur: () => void
}

export function FileTreeNode({
  node,
  depth,
  selectedPath,
  renamingPath,
  onSelect,
  onFileOpen,
  onToggleExpand,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  inlineInput,
  inlineValue,
  onInlineChange,
  onInlineKeyDown,
  onInlineBlur,
}: FileTreeNodeProps) {
  const isSelected = selectedPath === node.path
  const isRenaming = renamingPath === node.path
  const [renameValue, setRenameValue] = useState(node.name)
  const renameRef = useRef<HTMLInputElement>(null)

  // Focus the rename input when editing starts
  useEffect(() => {
    if (isRenaming) {
      setRenameValue(node.name)
      requestAnimationFrame(() => {
        renameRef.current?.focus()
        // Select the name without the extension
        const dotIdx = node.name.lastIndexOf('.')
        renameRef.current?.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length)
      })
    }
  }, [isRenaming, node.name])

  function handleRowClick() {
    onSelect(node.path)
    if (node.kind === 'directory') onToggleExpand(node.path)
    else onFileOpen(node)
  }

  function handleRowKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleRowClick()
    }
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, {
      x: e.clientX,
      y: e.clientY,
      target: node.kind === 'file'
        ? { kind: 'file', node }
        : { kind: 'directory', node },
    })
  }

  function handleRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    e.stopPropagation()
    if (e.key === 'Enter') {
      const trimmed = renameValue.trim()
      if (trimmed && trimmed !== node.name) onRenameCommit(node.path, trimmed)
      else onRenameCancel()
    } else if (e.key === 'Escape') {
      onRenameCancel()
    }
  }

  // Indent: 12px per depth level, plus 8px base padding
  const indentPx = depth * 12 + 8

  return (
    <>
      {/* ── Row ─────────────────────────────────────────────────────────── */}
      <div
        role={node.kind === 'directory' ? 'treeitem' : 'treeitem'}
        aria-expanded={node.kind === 'directory' ? node.isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleContextMenu}
        style={{ paddingLeft: indentPx }}
        className={cn(
          'group flex items-center gap-1.5 h-[22px] pr-2 cursor-pointer',
          'text-[13px] font-ui leading-none select-none',
          'outline-none transition-colors duration-75',
          // Hover / selected state — background shift only
          isSelected
            ? 'bg-primary/15 text-on-surface'
            : 'text-on-surface/70 hover:bg-white/[0.05] hover:text-on-surface',
          'focus-visible:ring-0',
        )}
      >
        {/* Chevron for directories */}
        {node.kind === 'directory' ? (
          <span className="shrink-0 text-on-surface/40">
            {node.isExpanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />}
          </span>
        ) : (
          // Spacer so files align with folder names
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}

        {/* Icon */}
        {node.kind === 'directory' ? (
          node.isExpanded
            ? <FolderOpen size={14} className="shrink-0 text-primary/70" />
            : <Folder     size={14} className="shrink-0 text-primary/50" />
        ) : (
          <FileIcon
            name={node.name}
            className="shrink-0 text-on-surface/40 group-hover:text-on-surface/60"
          />
        )}

        {/* Name / inline rename input */}
        {isRenaming ? (
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex-1 min-w-0 bg-surface-container-highest',
              'text-on-surface text-[13px] font-ui',
              'px-1 rounded-sm outline outline-1 outline-primary/60',
              'caret-primary',
            )}
            aria-label="Rename file"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">{node.name}</span>
        )}
      </div>

      {/* ── Children (lazy) ─────────────────────────────────────────────── */}
      {node.kind === 'directory' && node.isExpanded && node.children && (
        <div role="group" aria-label={node.name}>
          {/* Inline create-file / create-folder input for this directory */}
          {inlineInput && inlineInput.parentPath === node.path && (
            <div
              className="flex items-center gap-1.5 h-[22px] pr-2"
              style={{ paddingLeft: (depth + 1) * 12 + 8 + 16 }}
            >
              <input
                autoFocus
                value={inlineValue}
                placeholder={inlineInput.mode === 'create-file' ? 'file.txt' : 'folder'}
                onChange={(e) => onInlineChange(e.target.value)}
                onKeyDown={onInlineKeyDown}
                onBlur={onInlineBlur}
                className={cn(
                  'flex-1 min-w-0 bg-surface-container-highest',
                  'text-on-surface text-[13px] font-ui',
                  'px-1 rounded-sm outline outline-1 outline-primary/60',
                  'caret-primary placeholder:text-on-surface/25',
                )}
                aria-label={`Enter ${inlineInput.mode === 'create-file' ? 'file name' : 'folder name'}`}
              />
            </div>
          )}
          {/* Empty-state label — hide when an inline input is active here */}
          {node.children.length === 0 && inlineInput?.parentPath !== node.path && (
            <div
              className="text-[12px] text-on-surface/20 font-ui italic"
              style={{ paddingLeft: indentPx + 20 }}
            >
              empty
            </div>
          )}
          {node.children.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              renamingPath={renamingPath}
              onSelect={onSelect}
              onFileOpen={onFileOpen}
              onToggleExpand={onToggleExpand}
              onContextMenu={onContextMenu}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              inlineInput={inlineInput}
              inlineValue={inlineValue}
              onInlineChange={onInlineChange}
              onInlineKeyDown={onInlineKeyDown}
              onInlineBlur={onInlineBlur}
            />
          ))}
        </div>
      )}
    </>
  )
}
