import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ModelInfo, type Preset } from '../api/client'

interface LoadDialogProps {
  model: ModelInfo
  onClose: () => void
}

export function LoadDialog({ model, onClose }: LoadDialogProps) {
  const queryClient = useQueryClient()
  const dialogRef = useRef<HTMLDivElement>(null)
  const isGGUF = model.backend === 'gguf'
  const isMLX = model.backend === 'mlx'

  // Fetch saved defaults
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() })

  // Fetch presets (for load_params presets)
  const { data: presetsData } = useQuery({ queryKey: ['presets'], queryFn: () => api.listPresets() })
  const loadPresets: Preset[] = (presetsData?.presets ?? []).filter(p => p.load_params)

  // --- GGUF params ---
  const [ctxSize, setCtxSize] = useState(settings?.default_ctx_size ?? 100000)
  const [flashAttn, setFlashAttn] = useState(settings?.default_flash_attn ?? 'on')
  const [cacheTypeK, setCacheTypeK] = useState(settings?.default_cache_type_k ?? 'q4_0')
  const [cacheTypeV, setCacheTypeV] = useState(settings?.default_cache_type_v ?? 'q4_0')
  const [gpuLayers, setGpuLayers] = useState(settings?.default_gpu_layers ?? -1)
  const [nParallel, setNParallel] = useState(settings?.default_n_parallel ?? 2)
  const [threads, setThreads] = useState(-1)
  const [batchSize, setBatchSize] = useState(2048)
  const [mlock, setMlock] = useState(false)
  const [mmap, setMmap] = useState(true)
  const [ropeScaling, setRopeScaling] = useState('none')
  const [ropeScale, setRopeScale] = useState(1.0)

  // --- MLX params ---
  const [mlxContextLength, setMlxContextLength] = useState(0) // 0 = model default
  const [promptCacheSize, setPromptCacheSize] = useState(10)
  const [enableAutoToolChoice, setEnableAutoToolChoice] = useState(false)
  const [reasoningParser, setReasoningParser] = useState('')
  const [toolCallParser, setToolCallParser] = useState('')
  const [chatTemplateFile, setChatTemplateFile] = useState('')
  const [trustRemoteCode, setTrustRemoteCode] = useState(false)
  const [mlxModelType, setMlxModelType] = useState('lm')

  function applyLoadPreset(preset: Preset) {
    const lp = preset.load_params
    if (!lp) return
    if (lp.mlx_context_length != null) setMlxContextLength(lp.mlx_context_length)
    if (lp.mlx_prompt_cache_size != null) setPromptCacheSize(lp.mlx_prompt_cache_size)
    if (lp.mlx_enable_auto_tool_choice != null) setEnableAutoToolChoice(lp.mlx_enable_auto_tool_choice)
    if (lp.mlx_reasoning_parser != null) setReasoningParser(lp.mlx_reasoning_parser)
    if (lp.mlx_tool_call_parser != null) setToolCallParser(lp.mlx_tool_call_parser)
    if (lp.mlx_model_type != null) setMlxModelType(lp.mlx_model_type)
    if (lp.mlx_chat_template_file != null) setChatTemplateFile(lp.mlx_chat_template_file)
    if (lp.mlx_trust_remote_code != null) setTrustRemoteCode(lp.mlx_trust_remote_code)
    if (lp.ctx_size != null) setCtxSize(lp.ctx_size)
    if (lp.n_parallel != null) setNParallel(lp.n_parallel)
  }

  // --- Common ---

  // Focus trap and Escape handling
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        if (focusables.length === 0) return
        const first = focusables[0] as HTMLElement
        const last = focusables[focusables.length - 1] as HTMLElement
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus() }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus() }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus?.focus() }
  }, [onClose])

  const loadMut = useMutation({
    mutationFn: () => api.loadModel(model.id, {
      // GGUF params
      ctx_size: isGGUF ? ctxSize : undefined,
      flash_attn: isGGUF ? flashAttn : undefined,
      cache_type_k: isGGUF ? cacheTypeK : undefined,
      cache_type_v: isGGUF ? cacheTypeV : undefined,
      gpu_layers: isGGUF ? gpuLayers : undefined,
      n_parallel: isGGUF ? nParallel : undefined,
      // MLX params
      mlx_context_length: isMLX ? mlxContextLength : undefined,
      mlx_prompt_cache_size: isMLX ? promptCacheSize : undefined,
      mlx_enable_auto_tool_choice: isMLX ? enableAutoToolChoice : undefined,
      mlx_reasoning_parser: isMLX ? (reasoningParser || undefined) : undefined,
      mlx_tool_call_parser: isMLX ? (toolCallParser || undefined) : undefined,
      mlx_chat_template_file: isMLX ? (chatTemplateFile || undefined) : undefined,
      mlx_trust_remote_code: isMLX ? trustRemoteCode : undefined,
      mlx_model_type: isMLX ? mlxModelType : undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['running'] })
      onClose()
    },
  })

  const effectiveCtx = ctxSize * nParallel

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Load model" className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-[min(520px,calc(100vw-2rem))] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-bold mb-1">Load Model</h3>
        <div className="flex items-center gap-2 mb-4">
          <p className="text-sm text-gray-400 font-mono">{model.name}</p>
          <span className={`px-1.5 py-0.5 rounded text-xs ${isGGUF ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'}`}>
            {model.backend.toUpperCase()}
          </span>
        </div>

        <div className="space-y-4">
          {isGGUF && (
            <>
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
                    <option value="q4_0">q4_0 (75% savings)</option>
                    <option value="q4_1">q4_1 (73% savings)</option>
                    <option value="q5_0">q5_0 (69% savings)</option>
                    <option value="q5_1">q5_1 (66% savings)</option>
                    <option value="q8_0">q8_0 (50% savings)</option>
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
                    <option value="q4_0">q4_0 (75% savings)</option>
                    <option value="q4_1">q4_1 (73% savings)</option>
                    <option value="q5_0">q5_0 (69% savings)</option>
                    <option value="q5_1">q5_1 (66% savings)</option>
                    <option value="q8_0">q8_0 (50% savings)</option>
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

              {/* Advanced GGUF params */}
              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300 transition-colors select-none flex items-center gap-1">
                  <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  Advanced
                </summary>
                <div className="mt-3 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">CPU Threads</label>
                      <input
                        type="number"
                        value={threads}
                        onChange={e => setThreads(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">-1 = auto</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Batch Size</label>
                      <input
                        type="number"
                        value={batchSize}
                        onChange={e => setBatchSize(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">Default: 2048</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">RoPE Scaling</label>
                      <select
                        value={ropeScaling}
                        onChange={e => setRopeScaling(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      >
                        <option value="none">None</option>
                        <option value="linear">Linear</option>
                        <option value="yarn">YaRN</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">RoPE Scale</label>
                      <input
                        type="number"
                        value={ropeScale}
                        onChange={e => setRopeScale(Number(e.target.value))}
                        step={0.1}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                      />
                      <p className="text-xs text-gray-500 mt-1">Context extension factor</p>
                    </div>
                  </div>

                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={mlock}
                        onChange={e => setMlock(e.target.checked)}
                        className="rounded"
                      />
                      mlock (pin to RAM)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={mmap}
                        onChange={e => setMmap(e.target.checked)}
                        className="rounded"
                      />
                      mmap
                    </label>
                  </div>
                </div>
              </details>
            </>
          )}

          {isMLX && (
            <>
              {/* Load Preset */}
              {loadPresets.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Load Preset
                  </label>
                  <select
                    onChange={e => {
                      const p = loadPresets.find(p => p.id === e.target.value)
                      if (p) applyLoadPreset(p)
                    }}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    defaultValue=""
                  >
                    <option value="">— select a preset —</option>
                    {loadPresets.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Fills in all load parameters from a saved preset
                  </p>
                </div>
              )}

              {/* Context Length */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Context Length
                </label>
                <input
                  type="number"
                  value={mlxContextLength}
                  onChange={e => setMlxContextLength(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  0 = use model default
                </p>
              </div>

              {/* Prompt Cache */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Prompt Cache Entries
                </label>
                <input
                  type="number"
                  value={promptCacheSize}
                  onChange={e => setPromptCacheSize(Number(e.target.value))}
                  min={0}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Max KV cache entries to keep for prompt reuse. Default: 10
                </p>
              </div>

              {/* Tool calling */}
              <div>
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={enableAutoToolChoice}
                    onChange={e => setEnableAutoToolChoice(e.target.checked)}
                    className="rounded"
                  />
                  Enable Auto Tool Choice
                </label>
                <p className="text-xs text-gray-500 mt-1">
                  Allow the model to automatically decide when to call tools
                </p>
              </div>

              {/* Advanced MLX params */}
              <details className="group">
                <summary className="cursor-pointer text-sm text-gray-400 hover:text-gray-300 transition-colors select-none flex items-center gap-1">
                  <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  Advanced
                </summary>
                <div className="mt-3 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Reasoning Parser
                    </label>
                    <select
                      value={reasoningParser}
                      onChange={e => setReasoningParser(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Auto-detect</option>
                      <option value="gemma4">Gemma 4</option>
                      <option value="qwen3">Qwen 3</option>
                      <option value="qwen3_5">Qwen 3.5</option>
                      <option value="qwen3_moe">Qwen 3 MoE</option>
                      <option value="qwen3_vl">Qwen 3 VL / Qwen 3.6</option>
                      <option value="hermes">Hermes</option>
                      <option value="harmony">Harmony</option>
                      <option value="nemotron3_nano">Nemotron 3 Nano</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Parser for &lt;thinking&gt; blocks. Must pair with a Tool Call Parser below for structured tool calls.
                    </p>
                  </div>

                  {/* Tool Call Parser */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Tool Call Parser
                    </label>
                    <select
                      value={toolCallParser}
                      onChange={e => setToolCallParser(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="">Disabled (no tool parser)</option>
                      <option value="qwen3">Qwen 3</option>
                      <option value="qwen3_coder">Qwen 3.5 / Qwen 3 Coder</option>
                      <option value="hermes">Hermes</option>
                      <option value="mistral">Mistral</option>
                      <option value="llama">Llama</option>
                      <option value="chatglm">ChatGLM</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      REQUIRED for structured tool calls. Without this, raw {'<tool_call>'} XML leaks into reasoning content.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Chat Template Override
                    </label>
                    <input
                      type="text"
                      value={chatTemplateFile}
                      onChange={e => setChatTemplateFile(e.target.value)}
                      placeholder="Path to custom chat template file"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Override the model's chat template. Leave empty for default.
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      checked={trustRemoteCode}
                      onChange={e => setTrustRemoteCode(e.target.checked)}
                      className="rounded"
                    />
                    Trust Remote Code
                  </label>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Model Type
                    </label>
                    <select
                      value={mlxModelType}
                      onChange={e => setMlxModelType(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <option value="lm">lm — text only (default)</option>
                      <option value="multimodal">multimodal — vision + text</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Use multimodal for vision-language models (VLMs)
                    </p>
                  </div>
                </div>
              </details>
            </>
          )}

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