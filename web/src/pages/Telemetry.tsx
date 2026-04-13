import { useQuery } from '@tanstack/react-query'
import { api, type TelemetryRecord } from '../api/client'
import { EmptyState } from '../components/EmptyState'

function formatDuration(ms: number | null): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatNumber(n: number | null): string {
  if (n == null) return '-'
  return n.toLocaleString()
}

export default function TelemetryPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['telemetry'],
    queryFn: () => api.getTelemetry(),
    refetchInterval: 10000,
  })

  const records: TelemetryRecord[] = data?.records ?? []

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Telemetry</h2>
        <button onClick={() => refetch()} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-sm">
          Refresh
        </button>
      </div>

      {isLoading ? (
        <p className="text-gray-400">Loading...</p>
      ) : records.length === 0 ? (
        <EmptyState
          title="No telemetry data yet"
          description="Send requests through the proxy to see stats."
          illustration="telemetry"
        />
      ) : (
        <div className="space-y-2">
          {records.map((r) => {
            const hasError = !!r.error
            return (
              <div
                key={r.id}
                className={`bg-gray-900 border rounded-lg px-4 py-3 ${
                  hasError ? 'border-red-800/50' : 'border-gray-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm truncate max-w-[280px]" title={r.model_id}>
                      {r.model_id.slice(0, 35)}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      r.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{r.backend}</span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '-'}
                  </span>
                </div>

                {hasError ? (
                  <div className="mt-2 text-xs text-red-400 truncate" title={r.error || undefined}>
                    Error: {r.error}
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {/* TTFT */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">TTFT</span>
                      <span className={`text-sm font-mono ${
                        r.ttft_ms != null && r.ttft_ms > 5000 ? 'text-amber-400' : 'text-teal-400'
                      }`}>
                        {formatDuration(r.ttft_ms)}
                      </span>
                    </div>

                    {/* Throughput */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Speed</span>
                      <span className="text-sm font-mono text-teal-400">
                        {r.tokens_per_sec != null ? `${r.tokens_per_sec.toFixed(1)} tok/s` : '-'}
                      </span>
                    </div>

                    {/* Token counts */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">In tokens</span>
                      <span className="text-sm font-mono text-gray-300">{formatNumber(r.input_tokens)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-gray-500 uppercase tracking-wider">Out tokens</span>
                      <span className="text-sm font-mono text-gray-300">{formatNumber(r.output_tokens)}</span>
                    </div>
                    {r.total_tokens != null && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-500 uppercase tracking-wider">Total tokens</span>
                        <span className="text-sm font-mono text-gray-400">{formatNumber(r.total_tokens)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}