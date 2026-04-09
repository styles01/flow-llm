import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  toolCalls?: any[]
}

export default function ChatPage() {
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [userMessage, setUserMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState(false)
  const [includeTools, setIncludeTools] = useState(false)
  const [selectedModel, setSelectedModel] = useState<string>('')

  // Get running models
  const { data: runningData } = useQuery({
    queryKey: ['running'],
    queryFn: () => api.listRunning(),
  })

  const runningModels = runningData?.models ?? []
  const baseUrl = selectedModel
    ? runningModels.find(m => m.model_id === selectedModel)?.base_url
    : null

  async function sendMessage() {
    if (!userMessage.trim() || !baseUrl) return

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
      const res = await fetch(`${baseUrl}/chat/completions`, {
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

      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value)
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '))

        for (const line of lines) {
          const data = line.slice(6)
          if (data === '[DONE]') break

          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content || ''
            assistantContent += delta

            setMessages(prev => {
              const updated = [...prev]
              updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
              return updated
            })
          } catch {}
        }
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
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
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white"
          >
            <option value="">Select running model...</option>
            {runningModels.map(m => (
              <option key={m.model_id} value={m.model_id}>{m.name} (:{m.port})</option>
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

      {/* System prompt */}
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-md text-white font-mono text-sm h-24 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500"
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
          disabled={!baseUrl || streaming}
          placeholder={baseUrl ? "Type a message..." : "Load a model first"}
          className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-md text-white disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={sendMessage}
          disabled={!baseUrl || streaming}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 rounded-md font-medium"
        >
          {streaming ? 'Streaming...' : 'Send'}
        </button>
      </div>
    </div>
  )
}