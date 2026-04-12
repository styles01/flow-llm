import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ModelActivity } from '../api/client'
import { EmptyState } from '../components/EmptyState'

function ActivityStrip({ activity }: { activity: ModelActivity | undefined }) {
  const activeSlots = activity?.slots ?? []
  const { slots_deferred, tokens_per_sec, kv_cache_usage } = activity ?? {}

  const generatingSlots = activeSlots.filter(s => s.state === 'generating')
  const prefillSlots = activeSlots.filter(s => s.state === 'prefill')
  const isIdle = activeSlots.length === 0 && !slots_deferred

  return (
    <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">

      {/* Per-slot prefill progress bars */}
      {prefillSlots.map(slot => (
        <div key={slot.slot_id} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-12 shrink-0">
            slot {slot.slot_id}
          </span>
          <div className="flex-1 bg-gray-800 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 bg-amber-400 rounded-full transition-all duration-300"
              style={{ width: `${slot.progress * 100}%` }}
            />
          </div>
          <span className="text-xs text-amber-400 w-10 text-right shrink-0">
            {Math.round(slot.progress * 100)}%
          </span>
          <span className="text-xs text-gray-500 shrink-0">prefill</span>
        </div>
      ))}

      {/* Generating slots */}
      {generatingSlots.map(slot => (
        <div key={slot.slot_id} className="flex items-center gap-2 text-xs">
          <span className="text-gray-500 w-12 shrink-0">slot {slot.slot_id}</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping shrink-0" />
          <span className="text-teal-400">Generating</span>
          {tokens_per_sec != null && tokens_per_sec > 0 && (
            <span className="text-gray-400">{tokens_per_sec.toFixed(1)} tok/s</span>
          )}
        </div>
      ))}

      {/* Queued turns */}
      {slots_deferred != null && slots_deferred > 0 && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-12 shrink-0" />
          <span>{slots_deferred} turn{slots_deferred > 1 ? 's' : ''} queued</span>
        </div>
      )}

      {/* Idle */}
      {isIdle && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600">Idle</span>
          {kv_cache_usage != null && kv_cache_usage > 0.02 && (
            <span className="text-gray-600 ml-2">
              KV {Math.round(kv_cache_usage * 100)}% used
            </span>
          )}
        </div>
      )}

      {/* KV cache bar (when active) */}
      {!isIdle && kv_cache_usage != null && kv_cache_usage > 0.02 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600 w-12 shrink-0">KV cache</span>
          <div className="w-24 bg-gray-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${kv_cache_usage > 0.85 ? 'bg-fuchsia-500' : 'bg-gray-600'}`}
              style={{ width: `${kv_cache_usage * 100}%` }}
            />
          </div>
          <span className="text-gray-600">{Math.round(kv_cache_usage * 100)}%</span>
        </div>
      )}
    </div>
  )
}

export default function RunningPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['running'],
    queryFn: () => api.listRunning(),
    refetchInterval: 5000,
  })

  const { data: activityData } = useQuery({
    queryKey: ['model-activity'],
    queryFn: () => api.getModelActivity(),
    refetchInterval: 1000,
  })

  const unloadMut = useMutation({
    mutationFn: (id: string) => api.unloadModel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['running'] })
      queryClient.invalidateQueries({ queryKey: ['models'] })
    },
  })

  const models = data?.models ?? []
  const hw = data?.hardware

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Instances</h2>
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
              <p className="text-xs text-gray-400">Chip</p>
              <p className="font-medium">{hw.chip}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Total RAM</p>
              <p className="font-medium">{hw.memory_total_gb} GB</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Available</p>
              <p className="font-medium">{hw.memory_available_gb.toFixed(1)} GB</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Used</p>
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
            <p className="text-xs text-gray-400 mt-1">
              {(hw.memory_used_gb / hw.memory_total_gb * 100).toFixed(0)}% used — {hw.memory_available_gb.toFixed(1)} GB available
            </p>
          </div>
        </div>
      )}

      {/* Running models */}
      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : models.length === 0 ? (
        <EmptyState
          title="No models running"
          description="Load a model to get started."
          illustration="instances"
          action={{ label: 'Go to Models', linkTo: '/models' }}
        />
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
                  <p className="text-sm text-gray-400 mt-1">
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
                    onClick={() => unloadMut.mutate(m.model_id)}
                    disabled={unloadMut.isPending}
                    className="px-3 py-1.5 bg-fuchsia-900/40 hover:bg-fuchsia-800 text-fuchsia-300 rounded-md text-sm disabled:opacity-50"
                  >
                    {unloadMut.isPending ? 'Unloading...' : 'Unload'}
                  </button>
                </div>
              </div>
              <ActivityStrip activity={activityData?.activity[m.model_id]} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}