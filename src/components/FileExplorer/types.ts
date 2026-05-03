// ─────────────────────────────────────────────────────────────────────────────
// FileExplorer — shared types
// ─────────────────────────────────────────────────────────────────────────────

/** A node in the virtual file tree. Both files and directories share this
 *  shape; distinguish by `kind`. `children: null` means the directory has
 *  not been loaded yet (lazy). `children: []` means it was loaded and is empty. */
export interface FileNode {
  /** Unique identifier — equals `path` */
  id: string
  name: string
  kind: 'file' | 'directory'
  /** Underlying Web File System Access API handle */
  handle: FileSystemFileHandle | FileSystemDirectoryHandle
  /** `null` for files, and for unloaded directories */
  children: FileNode[] | null
  isExpanded: boolean
  /** Relative path from the workspace root, e.g. "src/components/App.tsx" */
  path: string
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export type ContextTarget =
  | { kind: 'file';      node: FileNode }
  | { kind: 'directory'; node: FileNode }
  | { kind: 'explorer' }          // right-click on the empty explorer pane

export interface ContextMenuPosition {
  x: number
  y: number
  target: ContextTarget
}

/** A clickable item in the context menu */
export interface ContextAction {
  type: 'action'
  id: string
  label: string
  shortcut?: string
  disabled?: boolean
  action: () => void
}

/** A visual separator — no line, just spacing + a subtle background shift */
export interface ContextSeparator {
  type: 'separator'
}

export type ContextEntry = ContextAction | ContextSeparator

// ─── Inline creation / rename state ───────────────────────────────────────────

export type InlineInputMode =
  | { mode: 'create-file';   parentPath: string }
  | { mode: 'create-folder'; parentPath: string }
  | { mode: 'rename';        nodePath: string; currentName: string }
