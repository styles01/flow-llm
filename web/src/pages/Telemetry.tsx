import { useQuery } from '@tanstack/react-query'
import { api, type TelemetryRecord } from '../api/client'

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
        <p className="text-gray-500">Loading...</p>
      ) : records.length === 0 ? (
        <p className="text-gray-500">No telemetry data yet. Send some requests through the proxy to see stats.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-gray-400 text-left">
                <th className="pb-2 pr-4">Time</th>
                <th className="pb-2 pr-4">Model</th>
                <th className="pb-2 pr-4">Backend</th>
                <th className="pb-2 pr-4 text-right">TTFT</th>
                <th className="pb-2 pr-4 text-right">tok/s</th>
                <th className="pb-2 pr-4 text-right">In</th>
                <th className="pb-2 pr-4 text-right">Out</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b border-gray-800/50">
                  <td className="py-2 pr-4 text-gray-400">{r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : '-'}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.model_id.slice(0, 30)}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      r.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{r.backend}</span>
                  </td>
                  <td className="py-2 pr-4 text-right">{r.ttft_ms ? `${r.ttft_ms.toFixed(0)}ms` : '-'}</td>
                  <td className="py-2 pr-4 text-right">{r.tokens_per_sec ? `${r.tokens_per_sec.toFixed(1)}` : '-'}</td>
                  <td className="py-2 pr-4 text-right">{r.input_tokens ?? '-'}</td>
                  <td className="py-2 pr-4 text-right">{r.output_tokens ?? '-'}</td>
                  <td className="py-2 text-right">{r.total_tokens ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}