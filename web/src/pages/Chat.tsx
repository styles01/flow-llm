import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type TelemetryRecord } from '../api/client'
import { formatError } from '../utils/errors'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  isError?: boolean
}

type ContentSegment =
  | { type: 'thinking'; content: string }
  | { type: 'text'; content: string }

// Strip model control tokens that shouldn't be displayed
function stripControlTokens(text: string): string {
  // Remove pipe-delimited control tokens: <|end|>, <|channel|>, <|eot_id|>, </|think|>, etc.
  // But keep <|think|> and </|think|> (handled by thinking block parser)
  let cleaned = text.replace(/<\|\/?([a-z_0-9]+)\|>/g, (full, tag) => {
    if (tag === 'think' || tag === '/think') return full
    return ''
  })
  // Remove known non-pipe control tokens: <start_of_turn>, <end_of_turn>, <im_end>, <im_sep>
  cleaned = cleaned.replace(/<\/?(?:start_of_turn|end_of_turn|im_end|im_sep)>/g, '')
  // Remove [INST] and [/INST] markers
  cleaned = cleaned.replace(/\[\/?INST\]/g, '')
  return cleaned.trim()
}

function parseThinkingBlocks(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  type Region = { start: number; end: number; content: string }
  const regions: Region[] = []
  let match: RegExpExecArray | null

  // Gemma 4: <|think|>...<|/think|>
  const re1 = /<\|think\|>([\s\S]*?)<\|\/think\|>/g
  while ((match = re1.exec(content)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length, content: match[1].trim() })
  }

  // Handle UNCLOSED <|think|> (Gemma may not close the tag if streaming stopped)
  // Only check if no closed thinking blocks were found for Gemma style
  if (regions.length === 0 || regions.every(r => {
    // Check if there's an unclosed <|think|> after the last closed region
    const afterLast = content.slice(r.end)
    return !/<\|think\|>/.test(afterLast)
  })) {
    const unclosedRe = /<\|think\|>([\s\S]+)$/g
    let unclosedMatch: RegExpExecArray | null
    while ((unclosedMatch = unclosedRe.exec(content)) !== null) {
      // Make sure this isn't already covered by a closed region
      const isAlreadyCovered = regions.some(r => unclosedMatch!.index >= r.start && unclosedMatch!.index < r.end)
      if (!isAlreadyCovered && unclosedMatch![1].trim()) {
        regions.push({ start: unclosedMatch!.index, end: content.length, content: unclosedMatch![1].trim() })
      }
    }
  }

  // Claude-style: <thinking>...</thinking>
  const re2 = /<thinking>([\s\S]*?)<\/thinking>/g
  while ((match = re2.exec(content)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length, content: match[1].trim() })
  }

  // Qwen 3 / DeepSeek R1: think_start...<\/think>
  const re3 = /<think>([\s\S]*?)<\/think>/g
  while ((match = re3.exec(content)) !== null) {
    regions.push({ start: match.index, end: match.index + match[0].length, content: match[1].trim() })
  }

  // Sort regions by start position
  regions.sort((a, b) => a.start - b.start)

  // Build segments from non-overlapping regions
  let pos = 0
  for (const region of regions) {
    if (region.start < pos) continue // Skip overlapping
    if (region.start > pos) {
      const textContent = content.slice(pos, region.start).trim()
      if (textContent) segments.push({ type: 'text', content: textContent })
    }
    segments.push({ type: 'thinking', content: region.content })
    pos = region.end
  }
  if (pos < content.length) {
    const textContent = content.slice(pos).trim()
    if (textContent) segments.push({ type: 'text', content: textContent })
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content })
  }

  return segments
}


function ThinkingBlock({ content, defaultExpanded = false }: { content: string; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const preview = content.length > 120 ? content.slice(0, 120) + '...' : content
  return (
    <details className="my-1">
      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400 transition-colors select-none flex items-center gap-1">
        <svg className="w-3 h-3 shrink-0 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        <span className="italic">Thinking...</span>
      </summary>
      <div className="mt-1 pl-3 border-l-2 border-gray-700 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
        {expanded ? content : preview}
        {content.length > 120 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-1 text-gray-400 hover:text-gray-300"
          >
            {expanded ? 'less' : 'more'}
          </button>
        )}
      </div>
    </details>
  )
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'system') return null

  if (message.isError) {
    return (
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-2.5 text-sm text-red-300">
          {message.content}
        </div>
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-teal-700/40 border border-teal-600/30 rounded-lg px-4 py-2.5 text-sm text-teal-100 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  // Assistant message — parse thinking blocks
  const segments = parseThinkingBlocks(message.content)
  const thinkingSegments = segments.filter(s => s.type === 'thinking')
  const textSegments = segments.filter(s => s.type === 'text').map(s => ({
    ...s,
    content: stripControlTokens(s.content),
  })).filter(s => s.content.length > 0)

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {thinkingSegments.length > 0 && (
          <div className={textSegments.length > 0 ? 'mb-1' : ''}>
            {thinkingSegments.map((s, i) => (
              <ThinkingBlock key={i} content={s.content} defaultExpanded={textSegments.length === 0} />
            ))}
          </div>
        )}
        {textSegments.length > 0 ? (
          <div className="bg-gray-800 border border-gray-700/50 rounded-lg px-4 py-2.5 text-sm text-gray-200 whitespace-pre-wrap">
            {textSegments.map((s, i) => (
              <span key={i}>{s.content}{i < textSegments.length - 1 ? '\n\n' : ''}</span>
            ))}
          </div>
        ) : thinkingSegments.length > 0 ? (
          <p className="text-xs text-gray-600 italic pl-3">No visible response text</p>
        ) : null}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const queryClient = useQueryClient()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [userMessage, setUserMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [includeTools, setIncludeTools] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [lastTelemetry, setLastTelemetry] = useState<TelemetryRecord | null>(null)
  const [processingProgress, setProcessingProgress] = useState<number | null>(null)

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
  })

  const selectedModelInfo = models.find(m => m.id === selectedModel)
  const canSend = selectedModel && selectedModelInfo?.status === 'running' && !streaming

  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })
  const loadMut = useMutation({
    mutationFn: (id: string) => api.loadModel(id, {
      ctx_size: settings?.default_ctx_size ?? 100000,
      flash_attn: settings?.default_flash_attn ?? 'on',
      cache_type_k: settings?.default_cache_type_k ?? 'q4_0',
      cache_type_v: settings?.default_cache_type_v ?? 'q4_0',
      gpu_layers: settings?.default_gpu_layers ?? -1,
      n_parallel: settings?.default_n_parallel ?? 2,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['running'] })
    },
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + 'px'
    }
  }, [userMessage])

  // Poll processing progress while streaming
  useEffect(() => {
    if (!streaming || !selectedModel) {
      setProcessingProgress(null)
      return
    }
    const interval = setInterval(async () => {
      try {
        const data = await api.getProcessingProgress()
        const p = data.progress[selectedModel]
        if (p != null && p > 0) {
          setProcessingProgress(p)
        }
      } catch {}
    }, 500)
    return () => clearInterval(interval)
  }, [streaming, selectedModel])

  async function sendMessage() {
    if (!userMessage.trim() || !canSend) return
    setError(null)
    setLastTelemetry(null)

    const newMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
      { role: 'user', content: userMessage },
    ]
    setMessages(newMessages)
    setUserMessage('')
    setStreaming(true)

    const tools = includeTools ? [{
      type: 'function',
      function: {
        name: 'shell_command',
        description: 'Execute a shell command and return output',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'Shell command' } },
          required: ['command'],
        },
      },
    }] : undefined

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel,
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          ...(tools ? { tools, tool_choice: 'auto' } : {}),
          max_tokens: 500,
          stream: true,
        }),
      })

      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`HTTP ${res.status}: ${errText}`)
      }
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''
      let buffer = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6)
            if (data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                assistantContent += delta
                // Clear processing progress once tokens start flowing
                if (processingProgress !== null) setProcessingProgress(null)
                setMessages(prev => {
                  const updated = [...prev]
                  updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
                  return updated
                })
              }
            } catch {}
          }
        }
      }

      // After streaming completes, fetch telemetry (small delay to let backend commit)
      try {
        await new Promise(r => setTimeout(r, 300))
        const telData = await api.getTelemetry(selectedModel)
        if (telData.records && telData.records.length > 0) {
          setLastTelemetry(telData.records[0])
        }
      } catch {}
    } catch (err: any) {
      const errMsg = formatError(err)
      setError(errMsg)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}`, isError: true }])
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Top bar: model selector + controls */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-3">
        <div className="flex items-center gap-3 max-w-4xl mx-auto">
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); setError(null) }}
            className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white text-sm"
          >
            <option value="">Select a model...</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} {m.status === 'running' ? '●' : m.status === 'loading' ? '◌' : '○'}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
            <input
              type="checkbox"
              checked={includeTools}
              onChange={(e) => setIncludeTools(e.target.checked)}
              className="rounded"
            />
            Tools
          </label>

          {messages.length > 0 && (
            <button
              onClick={() => { setMessages([]); setError(null); setLastTelemetry(null) }}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-xs text-gray-400 hover:text-white transition-colors shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        {/* Load model banner */}
        {selectedModel && selectedModelInfo?.status !== 'running' && (
          <div className="mt-2 max-w-4xl mx-auto bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-2.5 flex items-center justify-between">
            <span className="text-yellow-300 text-xs">
              {selectedModelInfo?.status === 'loading' ? 'Model is loading...' :
               selectedModelInfo?.status === 'error' ? 'Model failed to load previously.' :
               'This model needs to be loaded first.'}
            </span>
            {(selectedModelInfo?.status === 'available' || selectedModelInfo?.status === 'error') && (
              <button
                onClick={() => loadMut.mutate(selectedModel)}
                disabled={loadMut.isPending}
                className="px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 rounded-md text-xs font-medium"
              >
                {loadMut.isPending ? 'Loading...' : selectedModelInfo?.status === 'error' ? 'Retry Load' : 'Load Model'}
              </button>
            )}
          </div>
        )}
        {loadMut.error && (
          <div className="mt-2 max-w-4xl mx-auto bg-red-900/30 border border-red-700/50 rounded-lg p-2.5 text-red-300 text-xs">
            Failed to load: {formatError(loadMut.error)}
          </div>
        )}
        {error && (
          <div className="mt-2 max-w-4xl mx-auto bg-red-900/30 border border-red-700/50 rounded-lg p-2.5 text-red-300 text-xs">
            {error}
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 py-20">
              <svg className="w-12 h-12 mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-sm">Select a model and send a message to start chatting.</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <MessageBubble key={i} message={m} />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Telemetry strip */}
      {lastTelemetry && (
        <div className="shrink-0 px-4 py-1.5 bg-gray-900/50 border-t border-gray-800">
          <div className="max-w-3xl mx-auto flex gap-4 text-xs text-gray-500">
            <span>{lastTelemetry.ttft_ms?.toFixed(0)}ms TTFT</span>
            <span className="text-gray-700">·</span>
            <span>{lastTelemetry.tokens_per_sec?.toFixed(1)} tok/s</span>
            <span className="text-gray-700">·</span>
            <span>{lastTelemetry.input_tokens ?? '?'} in / {lastTelemetry.output_tokens ?? '?'} out</span>
            <span className="text-gray-700">·</span>
            <span className={
              lastTelemetry.backend === 'gguf' ? 'text-blue-400' :
              lastTelemetry.backend === 'mlx' ? 'text-purple-400' : 'text-gray-500'
            }>
              {lastTelemetry.backend}
            </span>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-950 px-4 py-3">
        <div className="max-w-3xl mx-auto">
          {/* System prompt (collapsible) */}
          <details className="mb-2">
            <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-400 transition-colors select-none flex items-center gap-1">
              <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              System Prompt
              {systemPrompt && systemPrompt !== 'You are a helpful assistant.' && (
                <span className="text-gray-600 ml-1">— {systemPrompt.slice(0, 50)}{systemPrompt.length > 50 ? '...' : ''}</span>
              )}
            </summary>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full mt-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white font-mono text-xs h-20 resize-y focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </details>

          {/* Message input */}
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={userMessage}
              onChange={(e) => setUserMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              disabled={!canSend}
              placeholder={canSend ? "Type a message... (Enter to send, Shift+Enter for newline)" : selectedModel ? `Model status: ${selectedModelInfo?.status || 'unknown'}` : "Select a model to start"}
              rows={1}
              className="flex-1 px-4 py-2.5 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none overflow-hidden"
            />
            <button
              onClick={sendMessage}
              disabled={!canSend}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium text-sm self-end transition-colors"
            >
              {streaming ? (
                <span className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="60" strokeDashoffset="15" /></svg>
                  Streaming
                </span>
              ) : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
