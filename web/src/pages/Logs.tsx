import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useSession, logActions } from '../store/sessionStore'

export default function LogsPage() {
  const session = useSession()
  const { logLines, logModelFilter, logAutoScroll } = session
  const logContainerRef = useRef<HTMLDivElement>(null)

  const { data: models = [] } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
  })

  const runningModels = models.filter(m => m.status === 'running')

  // Poll logs
  const { data: logsData } = useQuery({
    queryKey: ['logs', logModelFilter],
    queryFn: () => api.getLogs(200, logModelFilter || undefined),
    refetchInterval: 1000,
  })

  useEffect(() => {
    if (logsData?.logs) {
      logActions.appendLogLines(logsData.logs)
    }
  }, [logsData])

  // Auto-scroll to bottom
  useEffect(() => {
    if (logAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [logLines, logAutoScroll])

  function getLogLevelColor(line: string): string {
    const lower = line.toLowerCase()
    if (lower.includes('error') || lower.includes('fail') || lower.includes('fatal')) return 'text-red-400'
    if (lower.includes('warn')) return 'text-amber-400'
    if (lower.includes('info') || lower.includes('loaded') || lower.includes('started')) return 'text-teal-400'
    if (lower.includes('debug') || lower.includes('trace')) return 'text-gray-500'
    return 'text-gray-300'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 bg-gray-950 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white">Logs</h1>
          <div className="flex items-center gap-3">
            <select
              value={logModelFilter}
              onChange={(e) => logActions.setLogModelFilter(e.target.value)}
              className="px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-white text-sm"
            >
              <option value="">All Models</option>
              {runningModels.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 shrink-0">
              <input
                type="checkbox"
                checked={logAutoScroll}
                onChange={(e) => logActions.setLogAutoScroll(e.target.checked)}
                className="rounded"
              />
              Auto-scroll
            </label>
          </div>
        </div>
      </div>

      {/* Log viewer */}
      <div
        ref={logContainerRef}
        className="flex-1 overflow-y-auto bg-gray-950 font-mono text-xs leading-relaxed"
      >
        {logLines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 py-20">
            <svg className="w-10 h-10 mb-3 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No logs yet. Start a model to see its output.</p>
          </div>
        ) : (
          <div className="p-4">
            {logLines.map((line, i) => (
              <div key={i} className={`py-0.5 hover:bg-gray-900/50 ${getLogLevelColor(line)}`}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 border-t border-gray-800 bg-gray-950 px-4 py-1.5">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>{logLines.length} lines</span>
          <span>Polling every 1s</span>
        </div>
      </div>
    </div>
  )
}