/**
 * Monitor page — real-time per-request monitoring of model activity.
 * Replaces the old "Instances" page.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ModelActivity } from '../api/client'
import { EmptyState } from '../components/EmptyState'
import { RequestBeam } from '../components/RequestBeam'
import { IdleWaveform } from '../components/IdleWaveform'
import ModelConfigDrawer from '../components/ModelConfigDrawer'
import { useWebSocket } from '../hooks/useWebSocket'
import { useMonitor, monitorActions, type TrackedRequest } from '../store/monitorStore'
import { useEffect, useState } from 'react'

function RequestPipeline({
  modelId,
  activity,
}: {
  modelId: string
  activity: ModelActivity | undefined
}) {
  const monitor = useMonitor()
  const requests = monitor.requests[modelId] || []
  // Prefer polling data for slots (WebSocket slot_update not broadcast by server yet)
  const wsSlots = monitor.slots[modelId]
  const slots = (wsSlots && wsSlots.length > 0) ? wsSlots : (activity?.slots || [])
  const metrics = monitor.metrics[modelId] || {
    slots_processing: activity?.slots_processing ?? null,
    slots_deferred: activity?.slots_deferred ?? null,
    tokens_per_sec: activity?.tokens_per_sec ?? null,
    kv_cache_usage: activity?.kv_cache_usage ?? null,
  }

  // Merge: if no WS data yet, use polling data
  const activeRequests = requests.length > 0
    ? requests
    : (activity?.requests || []).map(r => r as TrackedRequest)

  const queuedCount = metrics.slots_deferred ?? 0
  const hasActiveRequests = activeRequests.some(r =>
    r.stage !== 'completed' && r.stage !== 'error'
  )
  const isIdle = activeRequests.length === 0 || !hasActiveRequests

  return (
    <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
      {/* Active request beams */}
      {activeRequests.map((req) => {
        // Find matching slot for prefill progress
        // Match slot to request: prefill slot goes with the first non-generating request,
        // or if the request is already in prefilling stage
        const matchingSlot = slots.find(s =>
          s.state === 'prefill' && (req.stage === 'prefilling' || req.stage === 'queued')
        )
        // If we have a prefill slot for a queued request, show it as prefilling
        const effectiveStage = (matchingSlot && req.stage === 'queued') ? 'prefilling' as const : req.stage
        // Queue position: 1-based index among queued requests (without prefill slot)
        const queuedIndex = req.stage === 'queued' && !matchingSlot
          ? activeRequests.filter(r => r.stage === 'queued').indexOf(req) + 1
          : undefined
        return (
          <RequestBeam
            key={req.request_id}
            request={{ ...req, stage: effectiveStage }}
            prefillProgress={matchingSlot?.progress}
            queuePosition={queuedIndex}
          />
        )
      })}

      {/* Queue indicator (when there are deferred requests not yet in the tracker) */}
      {queuedCount > 0 && !activeRequests.some(r => r.stage === 'queued') && (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
          <span>{queuedCount} request{queuedCount > 1 ? 's' : ''} queued</span>
        </div>
      )}

      {/* Idle waveform when no active requests */}
      {isIdle && <IdleWaveform kvCacheUsage={metrics.kv_cache_usage} />}

      {/* KV cache bar (when active or significant) */}
      {metrics.kv_cache_usage != null && metrics.kv_cache_usage > 0.02 && !isIdle && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-gray-600 w-12 shrink-0">KV cache</span>
          <div className="w-24 bg-gray-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${metrics.kv_cache_usage > 0.85 ? 'bg-fuchsia-500' : 'bg-gray-600'}`}
              style={{ width: `${metrics.kv_cache_usage * 100}%` }}
            />
          </div>
          <span className="text-gray-600">{Math.round(metrics.kv_cache_usage * 100)}%</span>
        </div>
      )}
    </div>
  )
}

export default function MonitorPage() {
  const queryClient = useQueryClient()
  const [drawerModel, setDrawerModel] = useState<{ id: string; name: string } | null>(null)
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

  // Merge polling data into monitor store
  useEffect(() => {
    if (activityData?.activity) {
      monitorActions.mergePollData(activityData.activity as any)
    }
  }, [activityData])

  // WebSocket for real-time updates
  useWebSocket('/ws', (msg) => {
    switch (msg.type) {
      case 'init':
        monitorActions.handleInit(msg.data)
        monitorActions.setConnected(true)
        break
      case 'request_update':
        monitorActions.handleRequestUpdate(msg.data)
        break
      case 'request_removed':
        monitorActions.handleRequestRemoved(msg.data)
        break
      case 'slot_update':
        monitorActions.handleSlotUpdate(msg.data)
        break
      case 'metrics_update':
        monitorActions.handleMetricsUpdate(msg.data)
        break
    }
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
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold">Monitor</h2>
          {/* Live indicator */}
          {models.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-teal-400">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={() => { refetch(); monitorActions.clear(); }}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
        >
          Refresh
        </button>
      </div>

      {/* Hardware info — compact */}
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
          description="Load a model to start monitoring activity."
          illustration="monitor"
          action={{ label: 'Go to Models', linkTo: '/models' }}
        />
      ) : (
        <div className="space-y-3">
          {models.map((m) => {
            const warming = !m.backend_ready
            return (
            <div key={m.model_id} className={`bg-gray-900 border rounded-lg p-4 ${warming ? 'border-amber-700/50' : 'border-teal-800/50'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {warming
                      ? <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                      : <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                    }
                    <p className="font-medium">{m.name}</p>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      m.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{m.backend}</span>
                    {warming && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-amber-900/40 text-amber-300 animate-pulse">
                        {m.load_progress != null ? `loading ${m.load_progress}%` : 'warming up…'}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-1">
                    Port {m.port} · PID {m.pid} · {m.base_url}
                  </p>
                  {warming && (
                    <div className="mt-2">
                      {m.load_progress != null ? (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-gray-800 rounded-full h-1.5 max-w-xs">
                            <div
                              className="bg-amber-400 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${m.load_progress}%` }}
                            />
                          </div>
                          <span className="text-xs text-amber-500/70">{m.load_progress}% — requests queued until ready</span>
                        </div>
                      ) : (
                        <p className="text-xs text-amber-500/70">
                          Loading model weights into memory — requests will queue until ready
                        </p>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setDrawerModel({ id: m.model_id, name: m.name })}
                    className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
                    disabled={warming}
                  >
                    Configure
                  </button>
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
              {!warming && (
                <RequestPipeline
                  modelId={m.model_id}
                  activity={activityData?.activity[m.model_id]}
                />
              )}
            </div>
            )
          })}
        </div>
      )}

      {drawerModel && (
        <ModelConfigDrawer
          modelId={drawerModel.id}
          modelName={drawerModel.name}
          onClose={() => setDrawerModel(null)}
        />
      )}
    </div>
  )
}