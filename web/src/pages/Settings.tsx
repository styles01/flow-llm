import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: hw } = useQuery({ queryKey: ['hardware'], queryFn: () => api.getHardware() })
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth() })

  const { data: savedSettings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })

  const [ctxSize, setCtxSize] = useState(100000)
  const [flashAttn, setFlashAttn] = useState('on')
  const [cacheTypeK, setCacheTypeK] = useState('q4_0')
  const [cacheTypeV, setCacheTypeV] = useState('q4_0')
  const [gpuLayers, setGpuLayers] = useState(-1)
  const [nParallel, setNParallel] = useState(2)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (savedSettings) {
      setCtxSize(savedSettings.default_ctx_size)
      setFlashAttn(savedSettings.default_flash_attn)
      setCacheTypeK(savedSettings.default_cache_type_k)
      setCacheTypeV(savedSettings.default_cache_type_v)
      setGpuLayers(savedSettings.default_gpu_layers)
      setNParallel(savedSettings.default_n_parallel)
    }
  }, [savedSettings])

  const saveMut = useMutation({
    mutationFn: () => api.updateSettings({
      default_ctx_size: ctxSize,
      default_flash_attn: flashAttn,
      default_cache_type_k: cacheTypeK,
      default_cache_type_v: cacheTypeV,
      default_gpu_layers: gpuLayers,
      default_n_parallel: nParallel,
    }),
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const effectiveCtx = ctxSize * nParallel

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {/* Server status */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Server Status</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-400">Status</p>
              <p className="font-medium">{health?.status ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Running Models</p>
              <p className="font-medium">{health?.running_models ?? 0}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Model Loading Defaults */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Model Loading Defaults</h3>
        <p className="text-sm text-gray-400 mb-4">
          These values are used when loading a model. Changes here apply to the Load dialog and Chat page.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-4">
          {/* Context Window */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Context Window (tokens per slot)
            </label>
            <input
              type="number"
              value={ctxSize}
              onChange={e => setCtxSize(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">
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
              max={8}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Concurrent request slots — needed for multi-turn agent conversations. More slots = more memory.
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
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="on">On (recommended)</option>
              <option value="off">Off</option>
              <option value="auto">Auto</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Critical for long context windows. Keep On.
            </p>
          </div>

          {/* KV Cache Quantization */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              KV Cache Quantization
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Keys</p>
                <select
                  value={cacheTypeK}
                  onChange={e => setCacheTypeK(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="q4_0">q4_0 (75% savings)</option>
                  <option value="q8_0">q8_0 (50% savings)</option>
                  <option value="f16">f16 (full precision)</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Values</p>
                <select
                  value={cacheTypeV}
                  onChange={e => setCacheTypeV(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="q4_0">q4_0 (75% savings)</option>
                  <option value="q8_0">q8_0 (50% savings)</option>
                  <option value="f16">f16 (full precision)</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              q4_0 recommended for 100K+ context. f16 for maximum quality.
            </p>
          </div>

          {/* GPU Layers */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              GPU Layers
            </label>
            <input
              type="number"
              value={gpuLayers}
              onChange={e => setGpuLayers(Number(e.target.value))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              -1 = all layers on Metal GPU (recommended for Apple Silicon)
            </p>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 rounded-md font-medium"
            >
              {saveMut.isPending ? 'Saving...' : 'Save Defaults'}
            </button>
            {saved && <span className="text-green-400 text-sm">Saved!</span>}
            {saveMut.isError && <span className="text-red-400 text-sm">Error: {(saveMut.error as Error).message}</span>}
          </div>
        </div>
      </section>

      {/* Hardware */}
      {hw && (
        <section className="mb-8">
          <h3 className="text-lg font-semibold mb-3 text-gray-300">Hardware</h3>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-400">Chip</p>
                <p className="font-medium">{hw.chip}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Total Memory</p>
                <p className="font-medium">{hw.memory_total_gb} GB</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Available</p>
                <p className="font-medium">{hw.memory_available_gb.toFixed(1)} GB</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Apple Silicon</p>
                <p className="font-medium">{hw.is_apple_silicon ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Metal GPU</p>
                <p className="font-medium">{hw.metal_supported ? 'Supported' : 'Not supported'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">CPU Cores</p>
                <p className="font-medium">{hw.cpu_count}</p>
              </div>
            </div>
            {/* Memory bar */}
            <div className="mt-4">
              <div className="w-full bg-gray-800 rounded-full h-3">
                <div
                  className="bg-teal-600 h-3 rounded-full transition-all"
                  style={{ width: `${(hw.memory_used_gb / hw.memory_total_gb) * 100}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {hw.memory_used_gb.toFixed(1)} GB used — {hw.memory_available_gb.toFixed(1)} GB available — max model ~{hw.recommended_max_model_gb.toFixed(1)} GB
              </p>
            </div>
          </div>
        </section>
      )}

      {/* OpenClaw config */}
      <section>
        <h3 className="text-lg font-semibold mb-3 text-gray-300">OpenClaw Configuration</h3>
        <p className="text-sm text-gray-400 mb-3">
          Copy this into your OpenClaw config to connect to Flow.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 overflow-x-auto">
          <pre>{`{
  "models": {
    "providers": {
      "flow": {
        "baseUrl": "http://127.0.0.1:3377/v1",
        "apiKey": "flow-local",
        "api": "openai-completions"
      }
    }
  }
}`}</pre>
        </div>
      </section>
    </div>
  )
}