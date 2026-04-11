import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ModelInfo } from '../api/client'

interface LoadDialogProps {
  model: ModelInfo
  onClose: () => void
}

export function LoadDialog({ model, onClose }: LoadDialogProps) {
  const queryClient = useQueryClient()

  // Fetch saved defaults
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })

  const [ctxSize, setCtxSize] = useState(settings?.default_ctx_size ?? 100000)
  const [flashAttn, setFlashAttn] = useState(settings?.default_flash_attn ?? 'on')
  const [cacheTypeK, setCacheTypeK] = useState(settings?.default_cache_type_k ?? 'q4_0')
  const [cacheTypeV, setCacheTypeV] = useState(settings?.default_cache_type_v ?? 'q4_0')
  const [gpuLayers, setGpuLayers] = useState(settings?.default_gpu_layers ?? -1)
  const [nParallel, setNParallel] = useState(settings?.default_n_parallel ?? 2)

  const loadMut = useMutation({
    mutationFn: () => api.loadModel(model.id, {
      ctx_size: ctxSize,
      flash_attn: flashAttn,
      cache_type_k: cacheTypeK,
      cache_type_v: cacheTypeV,
      gpu_layers: gpuLayers,
      n_parallel: nParallel,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['running'] })
      onClose()
    },
  })

  // Calculate effective context
  const effectiveCtx = ctxSize * nParallel

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-[480px] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-4">Load Model</h3>
        <p className="text-sm text-gray-400 mb-4 font-mono">{model.name}</p>

        <div className="space-y-4">
          {/* Context Window */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Context Window (tokens per slot)
            </label>
            <input
              type="number"
              value={ctxSize}
              onChange={e => setCtxSize(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Effective total: {effectiveCtx.toLocaleString()} tokens ({ctxSize.toLocaleString()} × {nParallel} slots)
            </p>
          </div>

          {/* Parallel Slots */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Parallel Slots
            </label>
            <input
              type="number"
              value={nParallel}
              onChange={e => setNParallel(Number(e.target.value))}
              min={1}
              max={4}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Concurrent request slots for multi-turn agent loops
            </p>
          </div>

          {/* Flash Attention */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Flash Attention
            </label>
            <select
              value={flashAttn}
              onChange={e => setFlashAttn(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="on">On (recommended)</option>
              <option value="off">Off</option>
              <option value="auto">Auto</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Critical for long context windows. Keep On.
            </p>
          </div>

          {/* KV Cache Quantization */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                KV Cache Keys
              </label>
              <select
                value={cacheTypeK}
                onChange={e => setCacheTypeK(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="q4_0">q4_0 (75% memory savings)</option>
                <option value="q8_0">q8_0 (50% savings, more precision)</option>
                <option value="f16">f16 (no savings, full precision)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                KV Cache Values
              </label>
              <select
                value={cacheTypeV}
                onChange={e => setCacheTypeV(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="q4_0">q4_0 (75% memory savings)</option>
                <option value="q8_0">q8_0 (50% savings, more precision)</option>
                <option value="f16">f16 (no savings, full precision)</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-gray-500 -mt-2">
            q4_0 recommended for 100K+ context. f16 for maximum quality.
          </p>

          {/* GPU Layers */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              GPU Layers
            </label>
            <input
              type="number"
              value={gpuLayers}
              onChange={e => setGpuLayers(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              -1 = all layers on Metal GPU (recommended for Apple Silicon)
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => loadMut.mutate()}
              disabled={loadMut.isPending}
              className="flex-1 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md font-medium"
            >
              {loadMut.isPending ? 'Loading...' : 'Load Model'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-md font-medium"
            >
              Cancel
            </button>
          </div>

          {loadMut.isError && (
            <p className="text-red-400 text-sm">{loadMut.error?.message || 'Failed to load model'}</p>
          )}
        </div>
      </div>
    </div>
  )
}