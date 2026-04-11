import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const queryClient = useQueryClient()
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [userMessage, setUserMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [includeTools, setIncludeTools] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
  })

  const selectedModelInfo = models.find(m => m.id === selectedModel)
  const canSend = selectedModel && selectedModelInfo?.status === 'running' && !streaming

  // Load model mutation
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

  async function sendMessage() {
    if (!userMessage.trim() || !canSend) return
    setError(null)

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
        // Split on double newlines (SSE event boundary)
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''  // keep incomplete event in buffer

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
    } catch (err: any) {
      const errMsg = err.message || 'Unknown error'
      setError(errMsg)
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errMsg}` }])
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="p-6 max-w-6xl h-full flex flex-col">
      <h2 className="text-2xl font-bold mb-4">Chat Test</h2>

      {/* Config row */}
      <div className="flex gap-4 mb-4">
        <div className="flex-1">
          <label className="block text-sm text-gray-400 mb-1">Model</label>
          <select
            value={selectedModel}
            onChange={(e) => { setSelectedModel(e.target.value); setError(null) }}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white"
          >
            <option value="">Select a model...</option>
            {models.map(m => (
              <option key={m.id} value={m.id}>
                {m.name} {m.status === 'running' ? '● running' : m.status === 'loading' ? '◌ loading' : '○ available'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={includeTools}
              onChange={(e) => setIncludeTools(e.target.checked)}
              className="rounded"
            />
            Include tool calling
          </label>
        </div>
      </div>

      {/* Load model if selected but not running */}
      {selectedModel && selectedModelInfo?.status !== 'running' && (
        <div className="mb-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 flex items-center justify-between">
          <span className="text-yellow-300 text-sm">
            {selectedModelInfo?.status === 'loading' ? 'Model is loading...' : 'This model needs to be loaded first.'}
          </span>
          {selectedModelInfo?.status === 'available' && (
            <button
              onClick={() => loadMut.mutate(selectedModel)}
              disabled={loadMut.isPending}
              className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 rounded-md text-sm font-medium"
            >
              {loadMut.isPending ? 'Loading...' : 'Load Model'}
            </button>
          )}
        </div>
      )}
      {loadMut.error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm">
          Failed to load: {(loadMut.error as Error).message}
        </div>
      )}
      {error && (
        <div className="mb-4 bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* System prompt */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white font-mono text-sm h-24 resize-y focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
      </div>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto bg-gray-900 border border-gray-800 rounded-lg p-4 mb-4">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-center">Send a message to test the model.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`${
                m.role === 'system' ? 'text-yellow-400' :
                m.role === 'user' ? 'text-blue-300' :
                'text-gray-100'
              }`}>
                <span className="text-xs font-bold uppercase mr-2">{m.role}</span>
                <span className="whitespace-pre-wrap">{m.content}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={userMessage}
          onChange={(e) => setUserMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          disabled={!canSend}
          placeholder={canSend ? "Type a message..." : selectedModel ? `Model status: ${selectedModelInfo?.status || 'unknown'}` : "Select a model"}
          className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-md text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
        />
        <button
          onClick={sendMessage}
          disabled={!canSend}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 rounded-md font-medium"
        >
          {streaming ? 'Streaming...' : 'Send'}
        </button>
      </div>
    </div>
  )
}