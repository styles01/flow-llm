import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export default function RunningPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['running'],
    queryFn: () => api.listRunning(),
    refetchInterval: 5000,
  })

  const models = data?.models ?? []
  const hw = data?.hardware

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Running Models</h2>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
        >
          Refresh
        </button>
      </div>

      {/* Hardware info */}
      {hw && (
        <div className="mb-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-gray-400 mb-2">Hardware</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-500">Chip</p>
              <p className="font-medium">{hw.chip}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Total RAM</p>
              <p className="font-medium">{hw.memory_total_gb} GB</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Available</p>
              <p className="font-medium">{hw.memory_available_gb.toFixed(1)} GB</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Used</p>
              <p className="font-medium">{hw.memory_used_gb.toFixed(1)} GB</p>
            </div>
          </div>
          {/* Memory bar */}
          <div className="mt-3">
            <div className="w-full bg-gray-800 rounded-full h-3">
              <div
                className="bg-gradient-to-r from-teal-500 to-fuchsia-500 h-3 rounded-full transition-all"
                style={{ width: `${(hw.memory_used_gb / hw.memory_total_gb) * 100}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {(hw.memory_used_gb / hw.memory_total_gb * 100).toFixed(0)}% used — {hw.memory_available_gb.toFixed(1)} GB available
            </p>
          </div>
        </div>
      )}

      {/* Running models */}
      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : models.length === 0 ? (
        <p className="text-gray-500">No models running. Load a model from the Models page.</p>
      ) : (
        <div className="space-y-3">
          {models.map((m) => (
            <div key={m.model_id} className="bg-gray-900 border border-teal-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    <p className="font-medium">{m.name}</p>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      m.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{m.backend}</span>
                  </div>
                  <p className="text-sm text-gray-500 mt-1">
                    Port {m.port} · PID {m.pid} · {m.base_url}
                  </p>
                </div>
                <div className="flex gap-2">
                  <a
                    href={m.base_url.replace('/v1', '/')}
                    target="_blank"
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
                  >
                    Open UI
                  </a>
                  <button
                    className="px-3 py-1.5 bg-fuchsia-900/40 hover:bg-fuchsia-800 text-fuchsia-300 rounded-md text-sm"
                  >
                    Unload
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}