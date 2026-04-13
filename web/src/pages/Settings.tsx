import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ComponentVersion } from '../api/client'
import { formatError } from '../utils/errors'

function VersionRow({ label, v, onUpdate }: { label: string; v: ComponentVersion; onUpdate: () => void }) {
  const statusColor = v.error && v.install_method === 'not_found'
    ? 'text-gray-500'
    : v.update_available
      ? 'text-amber-400'
      : 'text-green-400'

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-gray-800 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200">{label}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {v.install_method === 'not_found' ? (
            <span className="text-xs text-gray-500">not installed</span>
          ) : (
            <>
              <span className="text-xs font-mono text-gray-400">
                {v.current ?? 'unknown'} installed
              </span>
              {v.latest && (
                <span className={`text-xs font-mono ${statusColor}`}>
                  {v.update_available ? `→ ${v.latest} available` : '(up to date)'}
                </span>
              )}
              {v.install_method === 'brew' && (
                <span className="text-xs px-1.5 py-0.5 bg-orange-900/40 text-orange-300 rounded">brew</span>
              )}
              {v.install_method === 'pip' && (
                <span className="text-xs px-1.5 py-0.5 bg-blue-900/40 text-blue-300 rounded">pip</span>
              )}
            </>
          )}
          {v.error && v.install_method !== 'not_found' && (
            <span className="text-xs text-red-400">{v.error}</span>
          )}
        </div>
        {v.updating && (
          <p className="text-xs text-teal-400 mt-1 animate-pulse">Updating...</p>
        )}
        {v.update_log.length > 0 && !v.updating && (
          <details className="mt-1">
            <summary className="text-xs text-gray-500 cursor-pointer">Update log</summary>
            <pre className="text-xs text-gray-500 mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap break-all">
              {v.update_log.join('\n')}
            </pre>
          </details>
        )}
      </div>
      {v.update_available && !v.updating && v.install_method !== 'not_found' && (
        <button
          onClick={onUpdate}
          className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-medium whitespace-nowrap"
        >
          Update now
        </button>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const queryClient = useQueryClient()
  const { data: hw } = useQuery({ queryKey: ['hardware'], queryFn: () => api.getHardware() })
  const { data: health } = useQuery({ queryKey: ['health'], queryFn: () => api.getHealth() })

  const { data: savedSettings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })

  const { data: versions, refetch: refetchVersions } = useQuery({
    queryKey: ['backend-versions'],
    queryFn: () => api.getBackendVersions(),
    refetchInterval: 10000,  // re-poll while updates are running
  })

  const [ctxSize, setCtxSize] = useState(100000)
  const [flashAttn, setFlashAttn] = useState('on')
  const [cacheTypeK, setCacheTypeK] = useState('q4_0')
  const [cacheTypeV, setCacheTypeV] = useState('q4_0')
  const [gpuLayers, setGpuLayers] = useState(-1)
  const [nParallel, setNParallel] = useState(2)
  const [modelsDir, setModelsDir] = useState('')
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (savedSettings) {
      setCtxSize(savedSettings.default_ctx_size)
      setFlashAttn(savedSettings.default_flash_attn)
      setCacheTypeK(savedSettings.default_cache_type_k)
      setCacheTypeV(savedSettings.default_cache_type_v)
      setGpuLayers(savedSettings.default_gpu_layers)
      setNParallel(savedSettings.default_n_parallel)
      setModelsDir(savedSettings.models_dir)
      setAutoUpdate(savedSettings.auto_update_backends ?? true)
    }
  }, [savedSettings])

  const saveMut = useMutation({
    mutationFn: () => api.updateSettings({
      models_dir: modelsDir,
      default_ctx_size: ctxSize,
      default_flash_attn: flashAttn,
      default_cache_type_k: cacheTypeK,
      default_cache_type_v: cacheTypeV,
      default_gpu_layers: gpuLayers,
      default_n_parallel: nParallel,
      auto_update_backends: autoUpdate,
    }),
    onSuccess: () => {
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const checkUpdatesMut = useMutation({
    mutationFn: () => api.checkUpdates(),
    onSuccess: () => setTimeout(() => refetchVersions(), 3000),
  })

  const updateBackendMut = useMutation({
    mutationFn: (backend: 'llamacpp' | 'mlx') => api.updateBackend(backend),
    onSuccess: () => setTimeout(() => refetchVersions(), 5000),
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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Models Directory
            </label>
            <input
              type="text"
              value={modelsDir}
              onChange={e => setModelsDir(e.target.value)}
              placeholder="/Volumes/YourDrive/llms"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <p className="text-xs text-gray-400 mt-1">
              Flow downloads to this folder, and “Scan Local Files” only scans this path for GGUF and MLX models.
            </p>
          </div>

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

          {/* Auto-update toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800">
            <div>
              <p className="text-sm font-medium text-gray-300">Auto-update backends on startup</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Automatically update llama.cpp and mlx-openai-server when newer versions are available.
              </p>
            </div>
            <button
              onClick={() => setAutoUpdate(v => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autoUpdate ? 'bg-teal-600' : 'bg-gray-700'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoUpdate ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
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
            {saveMut.isError && <span className="text-red-400 text-sm">Error: {formatError(saveMut.error)}</span>}
          </div>
        </div>
      </section>

      {/* Backend Versions */}
      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-300">Backend Versions</h3>
          <button
            onClick={() => checkUpdatesMut.mutate()}
            disabled={checkUpdatesMut.isPending}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-md text-sm"
          >
            {checkUpdatesMut.isPending ? 'Checking...' : 'Check for Updates'}
          </button>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg px-4 py-1">
          {versions ? (
            <>
              {versions.llamacpp && (
                <VersionRow
                  label="llama.cpp (llama-server)"
                  v={versions.llamacpp}
                  onUpdate={() => updateBackendMut.mutate('llamacpp')}
                />
              )}
              {versions.mlx && (
                <VersionRow
                  label="mlx-openai-server"
                  v={versions.mlx}
                  onUpdate={() => updateBackendMut.mutate('mlx')}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 py-3">Checking versions...</p>
          )}
        </div>
        {!autoUpdate && (
          <p className="text-xs text-gray-500 mt-2">
            Auto-update is off. Updates will not be applied automatically on startup.
          </p>
        )}
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
