/**
 * Monitor store — real-time request tracking state.
 * Fed by WebSocket updates and HTTP polling fallback.
 * Uses useSyncExternalStore for React integration.
 */

import { useSyncExternalStore } from 'react'

export interface TrackedRequest {
  request_id: string
  model_id: string
  route: string
  stage: 'queued' | 'prefilling' | 'generating' | 'sending' | 'completed' | 'error'
  started_at: number
  output_tokens: number
  input_tokens: number | null
  tokens_per_sec: number | null
  ttft_ms: number | null
  first_token_time: number | null
  error_message: string | null
  completed_at: number | null
}

export interface SlotState {
  slot_id: number
  state: 'prefill' | 'generating' | 'idle'
  progress: number
}

export interface ModelMetrics {
  slots_processing: number | null
  slots_deferred: number | null
  tokens_per_sec: number | null
  kv_cache_usage: number | null
}

interface MonitorState {
  requests: Record<string, TrackedRequest[]>
  slots: Record<string, SlotState[]>
  metrics: Record<string, ModelMetrics>
  connected: boolean
}

const state: MonitorState = {
  requests: {},
  slots: {},
  metrics: {},
  connected: false,
}

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(l => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Snapshot for useSyncExternalStore
let snapshotVersion = 0
let lastSnapshot: MonitorState = { ...state } as any

function getSnapshot(): MonitorState {
  if ((lastSnapshot as any).__v !== snapshotVersion) {
    lastSnapshot = { ...state, __v: snapshotVersion } as any
  }
  return lastSnapshot
}

function getServerSnapshot(): MonitorState {
  return state
}

function update(partial: Partial<MonitorState>) {
  Object.assign(state, partial)
  snapshotVersion++
  emit()
}

// --- Prune stale completed requests ---

function pruneStale() {
  const now = Date.now() / 1000
  let changed = false
  const newRequests: Record<string, TrackedRequest[]> = {}

  for (const [modelId, reqs] of Object.entries(state.requests)) {
    const filtered = reqs.filter(r => {
      if (r.stage === 'completed' || r.stage === 'error') {
        if (r.completed_at && now - r.completed_at > 6) {
          return false
        }
      }
      return true
    })
    if (filtered.length > 0) {
      newRequests[modelId] = filtered
    }
    if (filtered.length !== reqs.length) changed = true
  }

  if (changed) {
    update({ requests: newRequests })
  }
}

// Prune every 3 seconds
setInterval(pruneStale, 3000)

// --- Actions (called from WebSocket messages or polling) ---

export const monitorActions = {
  setConnected(v: boolean) { update({ connected: v }) },

  handleInit(data: { requests: Record<string, TrackedRequest[]> }) {
    const requests: Record<string, TrackedRequest[]> = {}
    for (const [modelId, reqs] of Object.entries(data.requests || {})) {
      requests[modelId] = reqs.map(r => ({
        ...r,
        // started_at is monotonic — store as-is, display code will compute elapsed
      }))
    }
    update({ requests })
  },

  handleRequestUpdate(data: TrackedRequest) {
    const modelId = data.model_id
    const current = state.requests[modelId] || []
    const idx = current.findIndex(r => r.request_id === data.request_id)

    let newReqs: TrackedRequest[]
    if (idx >= 0) {
      newReqs = [...current]
      newReqs[idx] = data
    } else {
      newReqs = [...current, data]
    }

    update({
      requests: { ...state.requests, [modelId]: newReqs }
    })
  },

  handleRequestRemoved(data: { request_id: string }) {
    const newRequests: Record<string, TrackedRequest[]> = {}
    for (const [modelId, reqs] of Object.entries(state.requests)) {
      const filtered = reqs.filter(r => r.request_id !== data.request_id)
      if (filtered.length > 0) {
        newRequests[modelId] = filtered
      }
    }
    update({ requests: newRequests })
  },

  handleSlotUpdate(data: { model_id: string; slot_id: number; state: string; progress: number }) {
    const modelId = data.model_id
    const current = state.slots[modelId] || []
    const idx = current.findIndex(s => s.slot_id === data.slot_id)

    const slot: SlotState = {
      slot_id: data.slot_id,
      state: data.state as SlotState['state'],
      progress: data.progress,
    }

    let newSlots: SlotState[]
    if (data.state === 'idle') {
      newSlots = current.filter(s => s.slot_id !== data.slot_id)
    } else if (idx >= 0) {
      newSlots = [...current]
      newSlots[idx] = slot
    } else {
      newSlots = [...current, slot]
    }

    update({
      slots: { ...state.slots, [modelId]: newSlots }
    })
  },

  handleMetricsUpdate(data: { model_id: string } & ModelMetrics) {
    const modelId = data.model_id
    update({
      metrics: {
        ...state.metrics,
        [modelId]: {
          slots_processing: data.slots_processing,
          slots_deferred: data.slots_deferred,
          tokens_per_sec: data.tokens_per_sec,
          kv_cache_usage: data.kv_cache_usage,
        }
      }
    })
  },

  /** Merge polling data from /api/model-activity */
  mergePollData(activity: Record<string, {
    slots: SlotState[]
    slots_processing: number | null
    slots_deferred: number | null
    tokens_per_sec: number | null
    kv_cache_usage: number | null
    requests: TrackedRequest[]
  }>) {
    const newRequests: Record<string, TrackedRequest[]> = { ...state.requests }
    const newSlots: Record<string, SlotState[]> = { ...state.slots }
    const newMetrics: Record<string, ModelMetrics> = { ...state.metrics }

    for (const [modelId, data] of Object.entries(activity)) {
      // Only update requests if we don't have WebSocket data
      if (data.requests && data.requests.length > 0) {
        // Merge: update existing, add new, but keep our more-fresh WS data
        const existing = state.requests[modelId] || []
        const merged = [...existing]
        for (const req of data.requests) {
          const idx = merged.findIndex(r => r.request_id === req.request_id)
          if (idx >= 0) {
            // Only overwrite if the polled data is more recent (it shouldn't be if WS is active)
          } else {
            merged.push(req)
          }
        }
        newRequests[modelId] = merged
      }

      newSlots[modelId] = data.slots
      newMetrics[modelId] = {
        slots_processing: data.slots_processing,
        slots_deferred: data.slots_deferred,
        tokens_per_sec: data.tokens_per_sec,
        kv_cache_usage: data.kv_cache_usage,
      }
    }

    update({
      requests: newRequests,
      slots: newSlots,
      metrics: newMetrics,
    })
  },

  clear() {
    update({ requests: {}, slots: {}, metrics: {} })
  },
}

// --- React hook ---

export function useMonitor(): MonitorState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}