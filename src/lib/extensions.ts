/**
 * Luminal Extension API
 * ─────────────────────
 * Extensions are plain objects that call `registry.register*()` methods
 * during their `activate(api)` call. The registry is provided via React
 * context so any part of the UI can read the contributed commands and
 * context-menu items without coupling to a specific component.
 *
 * Phase 4 will add: language providers, themes, web-worker sandboxing.
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface ExtensionCommand {
  id:           string
  label:        string
  description?: string
  group?:       string
  shortcut?:    string
  action:       () => void
}

export interface ExtensionContextItem {
  id:     string
  label:  string
  /** Which node types this item should appear on. */
  when:   'file' | 'directory' | 'always'
  action: (target: { path: string; kind: 'file' | 'directory' }) => void
}

export interface ExtensionAPI {
  registerCommand(cmd: ExtensionCommand): void
  registerContextMenuItem(item: ExtensionContextItem): void
  /** Read-only – extensions may inspect other registrations. */
  readonly commands: ReadonlyArray<ExtensionCommand>
  readonly contextItems: ReadonlyArray<ExtensionContextItem>
}

// ── Registry (singleton, created once per app lifetime) ───────────────────────

class ExtensionRegistry implements ExtensionAPI {
  private _commands:     ExtensionCommand[]     = []
  private _contextItems: ExtensionContextItem[] = []
  private _listeners:    Array<() => void>      = []

  get commands():      ReadonlyArray<ExtensionCommand>     { return this._commands }
  get contextItems():  ReadonlyArray<ExtensionContextItem> { return this._contextItems }

  registerCommand(cmd: ExtensionCommand): void {
    if (this._commands.some((c) => c.id === cmd.id)) return
    this._commands = [...this._commands, cmd]
    this._notify()
  }

  registerContextMenuItem(item: ExtensionContextItem): void {
    if (this._contextItems.some((c) => c.id === item.id)) return
    this._contextItems = [...this._contextItems, item]
    this._notify()
  }

  /** Subscribe to any registration change — returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void {
    this._listeners.push(listener)
    return () => { this._listeners = this._listeners.filter((l) => l !== listener) }
  }

  private _notify() { this._listeners.forEach((l) => l()) }
}

export const extensionRegistry = new ExtensionRegistry()

// ── Built-in "extensions" (always registered) ─────────────────────────────────
// Add your own plugins here or load them dynamically from ~/.luminal/extensions/.

// Example: a formatter extension stub
extensionRegistry.registerCommand({
  id:          'ext.format',
  label:       'Format Document',
  description: 'Auto-format the current file',
  group:       'Editor',
  shortcut:    'Shift+Alt+F',
  action:      () => console.log('[ext] format document'),
})
