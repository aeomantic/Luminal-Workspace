import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  GitBranch, GitCommit, RefreshCw, Plus, Minus,
  ArrowUp, ArrowDown, Loader2,
} from 'lucide-react'
import { cn } from '../../lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface GitFile {
  path:   string
  status: string   // M, A, D, R, U, ?
}

interface GitStatus {
  branch:    string
  staged:    GitFile[]
  unstaged:  GitFile[]
  untracked: GitFile[]
}

interface SourceControlPanelProps {
  rootAbsPath: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  M: 'text-yellow-400/80',
  A: 'text-green-400/80',
  D: 'text-red-400/80',
  R: 'text-blue-400/80',
  U: 'text-orange-400/80',
  '?': 'text-on-surface/40',
}

const STATUS_LABELS: Record<string, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', U: 'Unmerged', '?': 'Untracked',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SourceControlPanel({ rootAbsPath }: SourceControlPanelProps) {
  const [status,        setStatus]        = useState<GitStatus | null>(null)
  const [loading,       setLoading]       = useState(false)
  const [commitMsg,     setCommitMsg]     = useState('')
  const [committing,    setCommitting]    = useState(false)
  const [pushing,       setPushing]       = useState(false)
  const [pulling,       setPulling]       = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [successMsg,    setSuccessMsg]    = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!rootAbsPath) return
    setLoading(true)
    setError(null)
    try {
      const s = await invoke<GitStatus>('git_status', { repoPath: rootAbsPath })
      setStatus(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [rootAbsPath])

  useEffect(() => { void refresh() }, [refresh])

  function showSuccess(msg: string) {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 3000)
  }

  async function handleStage(paths: string[]) {
    if (!rootAbsPath) return
    try {
      await invoke('git_stage', { repoPath: rootAbsPath, paths })
      await refresh()
    } catch (err) { setError(String(err)) }
  }

  async function handleUnstage(paths: string[]) {
    if (!rootAbsPath) return
    try {
      await invoke('git_unstage', { repoPath: rootAbsPath, paths })
      await refresh()
    } catch (err) { setError(String(err)) }
  }

  async function handleStageAll() {
    if (!rootAbsPath || !status) return
    const paths = [
      ...status.unstaged.map((f) => f.path),
      ...status.untracked.map((f) => f.path),
    ]
    await handleStage(paths)
  }

  async function handleCommit() {
    if (!rootAbsPath || !commitMsg.trim()) return
    setCommitting(true)
    try {
      await invoke('git_commit', { repoPath: rootAbsPath, message: commitMsg.trim() })
      setCommitMsg('')
      showSuccess('Committed successfully')
      await refresh()
    } catch (err) { setError(String(err)) }
    finally { setCommitting(false) }
  }

  async function handlePush() {
    if (!rootAbsPath) return
    setPushing(true)
    try {
      await invoke('git_push', { repoPath: rootAbsPath })
      showSuccess('Pushed to remote')
    } catch (err) { setError(String(err)) }
    finally { setPushing(false) }
  }

  async function handlePull() {
    if (!rootAbsPath) return
    setPulling(true)
    try {
      await invoke('git_pull', { repoPath: rootAbsPath })
      showSuccess('Pulled from remote')
      await refresh()
    } catch (err) { setError(String(err)) }
    finally { setPulling(false) }
  }

  // ── No workspace open ────────────────────────────────────────────────────
  if (!rootAbsPath) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Source Control" />
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-[12px] text-on-surface/20 text-center leading-relaxed">
            Open a folder to see Git status.
          </p>
        </div>
      </div>
    )
  }

  // ── Not a git repo ───────────────────────────────────────────────────────
  if (error?.includes('not a git') || error?.includes('could not find')) {
    return (
      <div className="flex flex-col h-full">
        <PanelHeader title="Source Control" onRefresh={refresh} />
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-[12px] text-on-surface/20 text-center leading-relaxed">
            No Git repository found in the current folder.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Source Control" loading={loading} onRefresh={refresh}>
        {/* Branch badge */}
        {status && (
          <span className="flex items-center gap-1 text-[10px] text-on-surface/35 font-mono ml-1">
            <GitBranch size={10} />
            {status.branch}
          </span>
        )}
      </PanelHeader>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {error && !error.includes('not a git') && (
          <p className="px-4 py-2 text-[11px] text-red-400/80">{error}</p>
        )}
        {successMsg && (
          <p className="px-4 py-2 text-[11px] text-green-400/80">{successMsg}</p>
        )}

        {status && (
          <>
            {/* Staged changes */}
            <FileGroup
              label="Staged Changes"
              files={status.staged}
              action={{ icon: <Minus size={11} />, title: 'Unstage', onClick: (f) => handleUnstage([f.path]) }}
              onGroupAction={() => handleUnstage(status.staged.map((f) => f.path))}
              groupActionTitle="Unstage All"
            />

            {/* Unstaged + untracked */}
            <FileGroup
              label="Changes"
              files={[...status.unstaged, ...status.untracked]}
              action={{ icon: <Plus size={11} />, title: 'Stage', onClick: (f) => handleStage([f.path]) }}
              onGroupAction={handleStageAll}
              groupActionTitle="Stage All"
            />
          </>
        )}
      </div>

      {/* Commit section */}
      <div className="shrink-0 border-t border-white/[0.04] p-3 flex flex-col gap-2">
        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Commit message (required)"
          rows={3}
          className={cn(
            'w-full resize-none bg-surface-container rounded text-[12px]',
            'text-on-surface placeholder:text-on-surface/25 px-2 py-1.5',
            'outline outline-1 outline-white/[0.08] focus:outline-primary/40',
            'scrollbar-thin font-ui',
          )}
        />

        <button
          onClick={() => void handleCommit()}
          disabled={!commitMsg.trim() || committing || !status?.staged.length}
          className={cn(
            'flex items-center justify-center gap-2 px-3 py-1.5 rounded text-[12px] transition-colors',
            commitMsg.trim() && status?.staged.length
              ? 'bg-primary/20 text-primary hover:bg-primary/30'
              : 'bg-white/[0.04] text-on-surface/20 cursor-not-allowed',
          )}
        >
          {committing
            ? <Loader2 size={12} className="animate-spin" />
            : <GitCommit size={12} />}
          Commit {status?.staged.length ? `(${status.staged.length})` : ''}
        </button>

        <div className="flex gap-2">
          <button
            onClick={() => void handlePull()}
            disabled={pulling}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            {pulling ? <Loader2 size={11} className="animate-spin" /> : <ArrowDown size={11} />}
            Pull
          </button>
          <button
            onClick={() => void handlePush()}
            disabled={pushing}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[11px] text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            {pushing ? <Loader2 size={11} className="animate-spin" /> : <ArrowUp size={11} />}
            Push
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PanelHeader({
  title, loading, onRefresh, children,
}: {
  title: string
  loading?: boolean
  onRefresh?: () => void
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between px-4 h-9 shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-display text-[11px] font-medium tracking-widest uppercase text-on-surface/40">
          {title}
        </span>
        {children}
      </div>
      {onRefresh && (
        <button
          onClick={onRefresh}
          title="Refresh"
          className="p-1 rounded text-on-surface/25 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
        >
          <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
        </button>
      )}
    </div>
  )
}

function FileGroup({
  label, files, action, onGroupAction, groupActionTitle,
}: {
  label: string
  files: GitFile[]
  action: { icon: React.ReactNode; title: string; onClick: (f: GitFile) => void }
  onGroupAction?: () => void
  groupActionTitle?: string
}) {
  if (!files.length) return null

  return (
    <div className="mb-1">
      {/* Group header */}
      <div className="flex items-center justify-between px-4 py-1">
        <span className="text-[10px] font-display tracking-widest uppercase text-on-surface/30">
          {label} ({files.length})
        </span>
        {onGroupAction && (
          <button
            onClick={onGroupAction}
            title={groupActionTitle}
            className="p-0.5 rounded text-on-surface/20 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            {action.icon}
          </button>
        )}
      </div>

      {/* File rows */}
      {files.map((file) => {
        const filename = file.path.split('/').pop() ?? file.path
        const dir      = file.path.includes('/') ? file.path.split('/').slice(0, -1).join('/') : ''
        return (
          <div
            key={file.path}
            className="group flex items-center gap-2 px-4 py-[3px] hover:bg-white/[0.03] transition-colors"
          >
            <span
              className={cn('text-[11px] font-mono shrink-0 w-3 text-center', STATUS_COLORS[file.status] ?? 'text-on-surface/40')}
              title={STATUS_LABELS[file.status]}
            >
              {file.status}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[12px] text-on-surface/80 truncate block">{filename}</span>
              {dir && <span className="text-[10px] text-on-surface/30 truncate block">{dir}</span>}
            </div>
            <button
              onClick={() => action.onClick(file)}
              title={action.title}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-on-surface/30 hover:text-on-surface hover:bg-white/[0.06] transition-all"
            >
              {action.icon}
            </button>
          </div>
        )
      })}
    </div>
  )
}
