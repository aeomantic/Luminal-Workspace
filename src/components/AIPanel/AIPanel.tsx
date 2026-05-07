import { useState, useRef, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Send, Trash2, Code2, Loader2, Settings, ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { EditorTab } from '../Editor/useEditorTabs'

// ── Provider catalogue ────────────────────────────────────────────────────────

const PROVIDERS = {
  openai: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o',       label: 'GPT-4o'       },
      { id: 'gpt-4o-mini',  label: 'GPT-4o mini'  },
      { id: 'gpt-4-turbo',  label: 'GPT-4 Turbo'  },
      { id: 'o1-mini',      label: 'o1 mini'       },
    ],
    placeholder: 'sk-…',
    hint: 'platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5'  },
      { id: 'claude-opus-4-7',            label: 'Claude Opus 4.7'   },
    ],
    placeholder: 'sk-ant-api03-…',
    hint: 'console.anthropic.com/settings/keys',
  },
  groq: {
    label: 'Groq',
    models: [
      { id: 'llama-3.3-70b-versatile',  label: 'Llama 3.3 70B'   },
      { id: 'llama-3.1-8b-instant',     label: 'Llama 3.1 8B'    },
      { id: 'mixtral-8x7b-32768',       label: 'Mixtral 8×7B'    },
      { id: 'gemma2-9b-it',             label: 'Gemma 2 9B'      },
    ],
    placeholder: 'gsk_…',
    hint: 'console.groq.com/keys',
  },
  github: {
    label: 'GitHub Models',
    models: [
      { id: 'gpt-4o',                           label: 'GPT-4o'             },
      { id: 'gpt-4o-mini',                      label: 'GPT-4o mini'        },
      { id: 'Meta-Llama-3.1-70B-Instruct',      label: 'Llama 3.1 70B'     },
      { id: 'Phi-3-medium-128k-instruct',        label: 'Phi-3 Medium 128k' },
    ],
    placeholder: 'github_pat_…',
    hint: 'github.com/settings/tokens',
  },
} as const

type ProviderId = keyof typeof PROVIDERS

// ── Types ─────────────────────────────────────────────────────────────────────

interface Message { role: 'user' | 'assistant'; content: string }
interface AiConfigPublic { provider: string; model: string }

interface AIPanelProps {
  activeTab: EditorTab | null
  getEditorSelection: () => string
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AIPanel({ activeTab, getEditorSelection }: AIPanelProps) {
  const [config,      setConfig]      = useState<AiConfigPublic | null | 'loading'>('loading')
  const [showSetup,   setShowSetup]   = useState(false)
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const bottomRef       = useRef<HTMLDivElement>(null)
  const unlistenRef     = useRef<(() => void) | null>(null)
  const streamingMsgRef = useRef('')

  useEffect(() => {
    invoke<AiConfigPublic | null>('ai_get_config')
      .then((c) => { setConfig(c); if (!c) setShowSetup(true) })
      .catch(() => { setConfig(null); setShowSetup(true) })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: Message  = { role: 'user', content: text }
    const allMessages = [...messages, userMsg]
    setMessages(allMessages)
    setInput('')
    setStreaming(true)
    streamingMsgRef.current = ''

    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    unlistenRef.current?.()
    const unlisten = await listen<string>('ai-stream', (ev) => {
      streamingMsgRef.current += ev.payload
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: streamingMsgRef.current }
        return next
      })
    })
    unlistenRef.current = unlisten

    const unlistenDone = await listen('ai-stream-done', () => {
      setStreaming(false)
      unlistenDone()
    })

    const selection   = getEditorSelection()
    const fileContext = selection || (activeTab?.savedContent ?? null)

    try {
      await invoke('ai_chat', {
        messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
        context:  fileContext,
      })
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev]
        next[next.length - 1] = { role: 'assistant', content: `⚠ ${err instanceof Error ? err.message : String(err)}` }
        return next
      })
      setStreaming(false)
    }
  }, [input, messages, streaming, activeTab, getEditorSelection])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend() }
  }

  function handleInjectContext() {
    const sel = getEditorSelection()
    if (sel) {
      setInput((p) => p + (p ? '\n\n' : '') + '```\n' + sel + '\n```')
    } else if (activeTab) {
      setInput((p) =>
        p + (p ? '\n\n' : '') +
        `Context from \`${activeTab.name}\`:\n\`\`\`\n${activeTab.savedContent.slice(0, 2000)}\n\`\`\``,
      )
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (config === 'loading') {
    return (
      <div className="flex items-center justify-center h-32 text-on-surface/25 text-xs">
        <Loader2 size={14} className="animate-spin mr-2" /> Loading…
      </div>
    )
  }

  // ── Setup screen ──────────────────────────────────────────────────────────
  if (!config || showSetup) {
    return (
      <SetupScreen
        current={config}
        onSaved={(c) => { setConfig(c); setShowSetup(false) }}
        onCancel={config ? () => setShowSetup(false) : undefined}
      />
    )
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  const providerLabel = PROVIDERS[config.provider as ProviderId]?.label ?? config.provider
  const modelLabel    = PROVIDERS[config.provider as ProviderId]?.models
    .find((m) => m.id === config.model)?.label ?? config.model

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 shrink-0 border-b border-white/[0.04]">
        <span className="font-display text-[11px] font-medium tracking-widest uppercase text-on-surface/40">
          AI Assistant
        </span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-on-surface/25 font-mono truncate max-w-[90px]" title={modelLabel}>
            {modelLabel}
          </span>
          <button
            onClick={() => { setMessages([]); streamingMsgRef.current = '' }}
            title="Clear conversation"
            className="p-1 rounded text-on-surface/25 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={() => setShowSetup(true)}
            title={`${providerLabel} — change provider`}
            className="p-1 rounded text-on-surface/25 hover:text-on-surface hover:bg-white/[0.06] transition-colors"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-3 py-2 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-[11px] text-on-surface/20 text-center mt-8 leading-relaxed">
            Ask anything about your code.<br />
            Use the <span className="text-primary/50">{'</>'}</span> button to inject context.
          </p>
        )}
        {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex items-center gap-1.5 text-on-surface/30 text-[11px]">
            <Loader2 size={11} className="animate-spin" /> Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-white/[0.04] p-2 flex flex-col gap-2">
        <button
          onClick={handleInjectContext}
          disabled={!activeTab}
          title="Inject current selection or file context"
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-colors self-start',
            activeTab ? 'text-on-surface/40 hover:text-on-surface hover:bg-white/[0.06]' : 'text-on-surface/15 cursor-not-allowed',
          )}
        >
          <Code2 size={11} /> Inject context
        </button>
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={3}
            placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
            className={cn(
              'flex-1 min-w-0 resize-none bg-surface-container rounded text-[12px]',
              'text-on-surface placeholder:text-on-surface/25 px-2 py-1.5',
              'outline outline-1 outline-white/[0.08] focus:outline-primary/40',
              'scrollbar-thin font-ui',
            )}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || streaming}
            className={cn(
              'shrink-0 flex items-center justify-center w-8 h-8 rounded transition-colors',
              input.trim() && !streaming
                ? 'bg-primary/20 text-primary hover:bg-primary/30'
                : 'bg-white/[0.04] text-on-surface/20 cursor-not-allowed',
            )}
            aria-label="Send"
          >
            {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Setup screen ──────────────────────────────────────────────────────────────

function SetupScreen({
  current,
  onSaved,
  onCancel,
}: {
  current: AiConfigPublic | null
  onSaved: (c: AiConfigPublic) => void
  onCancel?: () => void
}) {
  const [provider, setProvider] = useState<ProviderId>((current?.provider as ProviderId) ?? 'openai')
  const [model,    setModel]    = useState(current?.model ?? PROVIDERS.openai.models[0].id)
  const [apiKey,   setApiKey]   = useState('')
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState('')

  const info = PROVIDERS[provider]

  // Reset model when provider changes (keep if still valid)
  function handleProviderChange(p: ProviderId) {
    setProvider(p)
    const models = PROVIDERS[p].models
    if (!models.some((m) => m.id === model)) setModel(models[0].id)
  }

  async function handleSave() {
    if (!apiKey.trim()) { setError('API key cannot be empty'); return }
    setSaving(true); setError('')
    try {
      await invoke('ai_set_config', { provider, apiKey: apiKey.trim(), model })
      onSaved({ provider, model })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 h-9 shrink-0 border-b border-white/[0.04]">
        <span className="font-display text-[11px] font-medium tracking-widest uppercase text-on-surface/40">
          AI Setup
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            className="text-[10px] text-on-surface/30 hover:text-on-surface transition-colors px-1"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 p-4 flex-1 overflow-y-auto scrollbar-thin">
        {/* Provider */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] text-on-surface/40 font-display tracking-widest uppercase">
            Provider
          </label>
          <div className="relative">
            <select
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
              className={cn(
                'w-full appearance-none bg-surface-container text-on-surface text-[12px]',
                'px-3 py-2 rounded outline outline-1 outline-white/[0.08] focus:outline-primary/40',
                'cursor-pointer pr-8',
              )}
            >
              {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                <option key={id} value={id}>{PROVIDERS[id].label}</option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface/30 pointer-events-none" />
          </div>
        </div>

        {/* Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] text-on-surface/40 font-display tracking-widest uppercase">
            Model
          </label>
          <div className="relative">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={cn(
                'w-full appearance-none bg-surface-container text-on-surface text-[12px]',
                'px-3 py-2 rounded outline outline-1 outline-white/[0.08] focus:outline-primary/40',
                'cursor-pointer pr-8',
              )}
            >
              {info.models.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface/30 pointer-events-none" />
          </div>
        </div>

        {/* API Key */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] text-on-surface/40 font-display tracking-widest uppercase">
            API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleSave() }}
            placeholder={info.placeholder}
            autoComplete="off"
            className={cn(
              'w-full bg-surface-container text-on-surface text-[12px] font-mono',
              'px-3 py-2 rounded outline outline-1',
              error ? 'outline-red-500/60' : 'outline-white/[0.08] focus:outline-primary/40',
            )}
          />
          <p className="text-[10px] text-on-surface/25 leading-relaxed">
            Get your key from{' '}
            <span className="text-primary/50 font-mono">{info.hint}</span>
            {'. '}Stored locally in <span className="font-mono">~/.luminal/config.json</span>.
          </p>
        </div>

        {error && <p className="text-[11px] text-red-400">{error}</p>}

        <button
          onClick={() => void handleSave()}
          disabled={saving}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded bg-primary/20 text-primary text-[12px] hover:bg-primary/30 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : null}
          {current ? 'Update' : 'Save & Start Chatting'}
        </button>
      </div>
    </div>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('flex flex-col gap-1', isUser && 'items-end')}>
      <span className={cn(
        'text-[10px] font-display tracking-wider uppercase',
        isUser ? 'text-primary/50' : 'text-on-surface/25',
      )}>
        {isUser ? 'You' : 'AI'}
      </span>
      <div className={cn(
        'rounded px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap break-words max-w-full',
        isUser ? 'bg-primary/10 text-on-surface' : 'bg-surface-container text-on-surface/85',
      )}>
        {message.content || <span className="text-on-surface/30 italic">…</span>}
      </div>
    </div>
  )
}
