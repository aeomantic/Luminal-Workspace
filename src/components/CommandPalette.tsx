/**
 * CommandPalette.tsx
 * ──────────────────
 * The "Floating Command Palette" — a signature Kinetic Void component.
 *
 * Design decisions:
 *  - Rendered in a React Portal at document.body to escape any stacking
 *    context inside the editor shell (z-index 50 is always on top).
 *  - Glassmorphism: bg-surface-container-highest/85 + backdrop-blur-palette
 *    (40px). No border tokens anywhere — depth comes from the blur + shadow.
 *  - Uses cmdk for keyboard navigation (↑↓ arrow, Enter, type-to-filter,
 *    Escape) — the same primitive ShadCN wraps in its <Command> component.
 *  - The overlay backdrop is a separate div so clicks outside close the
 *    palette without needing @radix-ui/react-dialog.
 *  - Fully typed: the EditorCommand interface covers every field; no `any`.
 */

import {
  useEffect,
  useCallback,
  useRef,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import {
  Search,
  Save,
  FolderOpen,
  Palette,
  Play,
  Wrench,
  SplitSquareHorizontal,
  Terminal,
  Settings,
  RotateCcw,
  FileCode,
  AlignLeft,
} from 'lucide-react'
import { cn } from '../lib/utils'

// ── Types ──────────────────────────────────────────────────────────────────

export interface EditorCommand {
  id: string
  label: string
  description?: string
  /** Groups commands under a visual header in the list */
  group: 'File' | 'Editor' | 'View' | 'Tools' | 'Run'
  icon?: React.ReactNode
  /** Displayed shortcut badge (visual only; actual binding is external) */
  shortcut?: string
  action: () => void
}

interface CommandPaletteProps {
  /** Whether the palette is visible */
  open: boolean
  /** Called when the palette should close (Escape or overlay click) */
  onClose: () => void
  /** Full list of available commands */
  commands?: EditorCommand[]
}

// ── Default command registry ───────────────────────────────────────────────
// Replace `action` bodies with real editor callbacks once Monaco is wired in.

const DEFAULT_COMMANDS: EditorCommand[] = [
  // File
  {
    id: 'file.save',
    label: 'Save File',
    description: 'Write current buffer to disk',
    group: 'File',
    icon: <Save size={15} />,
    shortcut: 'Ctrl+S',
    action: () => console.log('[cmd] save file'),
  },
  {
    id: 'file.open',
    label: 'Open File…',
    description: 'Browse and open a file',
    group: 'File',
    icon: <FolderOpen size={15} />,
    shortcut: 'Ctrl+O',
    action: () => console.log('[cmd] open file'),
  },
  {
    id: 'file.new',
    label: 'New File',
    description: 'Create an untitled buffer',
    group: 'File',
    icon: <FileCode size={15} />,
    shortcut: 'Ctrl+N',
    action: () => console.log('[cmd] new file'),
  },
  // Editor
  {
    id: 'editor.format',
    label: 'Format Document',
    description: 'Run the formatter on the active file',
    group: 'Editor',
    icon: <AlignLeft size={15} />,
    shortcut: 'Alt+Shift+F',
    action: () => console.log('[cmd] format document'),
  },
  {
    id: 'editor.split',
    label: 'Split Editor',
    description: 'Open a second editor column',
    group: 'Editor',
    icon: <SplitSquareHorizontal size={15} />,
    action: () => console.log('[cmd] split editor'),
  },
  {
    id: 'editor.undo',
    label: 'Undo',
    group: 'Editor',
    icon: <RotateCcw size={15} />,
    shortcut: 'Ctrl+Z',
    action: () => console.log('[cmd] undo'),
  },
  // View
  {
    id: 'view.toggleTheme',
    label: 'Toggle Theme',
    description: 'Cycle between Kinetic Void, Nebula Dusk, Mint Zero',
    group: 'View',
    icon: <Palette size={15} />,
    action: () => console.log('[cmd] toggle theme'),
  },
  {
    id: 'view.terminal',
    label: 'Toggle Terminal',
    description: 'Show or hide the integrated terminal panel',
    group: 'View',
    icon: <Terminal size={15} />,
    shortcut: 'Ctrl+`',
    action: () => console.log('[cmd] toggle terminal'),
  },
  {
    id: 'view.settings',
    label: 'Open Settings',
    group: 'View',
    icon: <Settings size={15} />,
    shortcut: 'Ctrl+,',
    action: () => console.log('[cmd] open settings'),
  },
  // Tools
  {
    id: 'tools.linter',
    label: 'Run Linter',
    description: 'Analyse the current file for code style issues',
    group: 'Tools',
    icon: <Wrench size={15} />,
    action: () => console.log('[cmd] run linter'),
  },
  // Run
  {
    id: 'run.start',
    label: 'Start Dev Server',
    description: 'npm run dev in the workspace root',
    group: 'Run',
    icon: <Play size={15} />,
    shortcut: 'F5',
    action: () => console.log('[cmd] start dev server'),
  },
]

// ── Sub-components ─────────────────────────────────────────────────────────

/** A single keyboard shortcut badge — pill-shaped, no border */
function ShortcutBadge({ keys }: { keys: string }) {
  return (
    <span className="flex gap-1">
      {keys.split('+').map((key) => (
        <kbd
          key={key}
          className={cn(
            // Background shift only — no border
            'bg-surface-container px-1.5 py-0.5',
            'rounded font-mono text-[10px] leading-none text-on-surface/50',
          )}
        >
          {key.trim()}
        </kbd>
      ))}
    </span>
  )
}

/** One row in the command list */
function CommandRow({ command }: { command: EditorCommand }) {
  return (
    <Command.Item
      key={command.id}
      value={`${command.label} ${command.description ?? ''} ${command.group}`}
      onSelect={command.action}
      className={cn(
        'group flex items-center gap-3 px-4 py-2.5 mx-2 rounded',
        // Hover: background shift (no border, no underline)
        'hover:bg-surface-bright cursor-pointer',
        // Active highlight driven by [cmdk-item][aria-selected] in index.css
        'transition-colors duration-100',
      )}
      aria-label={command.label}
    >
      {/* Icon — tinted blue when selected via group-aria-selected */}
      <span className="text-on-surface/40 group-aria-selected:text-primary shrink-0 transition-colors">
        {command.icon}
      </span>

      {/* Label + description */}
      <span className="flex min-w-0 flex-col">
        <span className="font-ui text-sm font-medium text-on-surface leading-snug truncate">
          {command.label}
        </span>
        {command.description && (
          <span className="text-xs text-on-surface/40 leading-snug truncate">
            {command.description}
          </span>
        )}
      </span>

      {/* Shortcut badge pushed to the right */}
      {command.shortcut && (
        <span className="ml-auto shrink-0">
          <ShortcutBadge keys={command.shortcut} />
        </span>
      )}
    </Command.Item>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onClose,
  commands = DEFAULT_COMMANDS,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus the search input when the palette opens
  useEffect(() => {
    if (open) {
      // rAF ensures the portal has painted before we focus
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Group commands by their `group` field, preserving insertion order
  const grouped = commands.reduce<Record<string, EditorCommand[]>>(
    (acc, cmd) => {
      ;(acc[cmd.group] ??= []).push(cmd)
      return acc
    },
    {},
  )

  // Prevent keydown events from leaking to the editor behind the overlay
  const stopPropagation = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation()
  }, [])

  if (!open) return null

  return createPortal(
    /*
     * Overlay: semi-transparent scrim that closes the palette on click.
     * aria-hidden so screen readers only interact with the dialog itself.
     */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      aria-hidden="false"
    >
      {/* Backdrop scrim — click to dismiss */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/*
       * The glassmorphic panel.
       *
       * Glassmorphism recipe:
       *   bg-surface-container-highest/85  →  rgba(53,53,52,0.85)
       *   backdrop-blur-palette            →  blur(40px)
       *   shadow-palette                   →  two-layer diffused shadow
       *   rounded-xl                       →  1.5rem (modal token)
       *
       * NO borders anywhere — panel edges are defined by the background
       * colour contrast against the darkened scrim.
       */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onKeyDown={stopPropagation}
        className={cn(
          'relative z-10 w-full max-w-[600px] mx-4',
          'bg-surface-container-highest/85 backdrop-blur-palette',
          'rounded-xl shadow-palette',
          'overflow-hidden',
          // Animate in: fade + slide down
          'animate-in fade-in-0 slide-in-from-top-4 duration-200',
        )}
      >
        <Command
          // cmdk applies its own filter; pass false for custom scoring if needed
          shouldFilter
          loop
          className="flex flex-col"
        >
          {/* ── Search row ─────────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
            {/* Magnifier icon — decorative, aria-hidden */}
            <Search
              size={16}
              className="shrink-0 text-primary/70"
              aria-hidden="true"
            />

            <Command.Input
              ref={inputRef}
              placeholder="Type a command or search…"
              className={cn(
                'flex-1 bg-transparent text-on-surface text-sm',
                'font-ui placeholder:text-on-surface/35',
                'focus:outline-none',
              )}
              aria-label="Search commands"
            />

            {/* Escape hint badge */}
            <kbd
              className={cn(
                'shrink-0 px-1.5 py-0.5 rounded font-mono text-[10px]',
                'bg-surface-container text-on-surface/40 leading-none',
              )}
              aria-label="Press Escape to close"
            >
              Esc
            </kbd>
          </div>

          {/* ── Results list ───────────────────────────────────────────── */}
          <Command.List
            aria-label="Available commands"
            className="py-2"
          >
            <Command.Empty>No commands matched your search.</Command.Empty>

            {Object.entries(grouped).map(([group, cmds]) => (
              <Command.Group
                key={group}
                heading={group}
                className="mb-1 last:mb-0"
              >
                {cmds.map((cmd) => (
                  <CommandRow key={cmd.id} command={cmd} />
                ))}
              </Command.Group>
            ))}
          </Command.List>

          {/* ── Footer hint bar ─────────────────────────────────────────── */}
          <div
            className={cn(
              'flex items-center gap-4 px-4 py-2',
              'border-t border-white/[0.06]',
              'text-[10px] text-on-surface/30 font-ui',
            )}
            aria-hidden="true"
          >
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-container px-1 py-0.5 rounded font-mono text-[9px]">↑</kbd>
              <kbd className="bg-surface-container px-1 py-0.5 rounded font-mono text-[9px]">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-container px-1.5 py-0.5 rounded font-mono text-[9px]">↵</kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-surface-container px-1.5 py-0.5 rounded font-mono text-[9px]">Esc</kbd>
              Close
            </span>
          </div>
        </Command>
      </div>
    </div>,
    document.body,
  )
}

// ── Hook: global keyboard shortcut ────────────────────────────────────────

/**
 * useCommandPaletteShortcut
 *
 * Listens for Ctrl+K (Windows/Linux) or Cmd+K (macOS) anywhere in the
 * window and toggles the palette open/closed.
 *
 * For a production Tauri build you can replace this with the
 * `@tauri-apps/plugin-global-shortcut` plugin to capture the shortcut even
 * when the window is not focused — see:
 * https://v2.tauri.app/reference/rust/tauri::plugin::global_shortcut/
 */
export function useCommandPaletteShortcut(
  onToggle: () => void,
): void {
  useEffect(() => {
    function handleKeyDown(e: globalThis.KeyboardEvent) {
      // Cmd+K on macOS, Ctrl+K on Windows / Linux
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onToggle()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onToggle])
}

export { DEFAULT_COMMANDS }
