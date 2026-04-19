import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type ModelConfig, type Preset } from '../api/client'

interface Props {
  modelId: string
  modelName: string
  onClose: () => void
}

interface FormState {
  temperature: string
  top_p: string
  top_k: string
  presence_penalty: string
  repetition_penalty: string
  preserve_thinking: '' | 'true' | 'false'
  enable_thinking: '' | 'true' | 'false'
}

function emptyForm(): FormState {
  return {
    temperature: '',
    top_p: '',
    top_k: '',
    presence_penalty: '',
    repetition_penalty: '',
    preserve_thinking: '',
    enable_thinking: '',
  }
}

function configToForm(config: ModelConfig): FormState {
  const ctk = config.chat_template_kwargs || {}
  return {
    temperature: config.temperature != null ? String(config.temperature) : '',
    top_p: config.top_p != null ? String(config.top_p) : '',
    top_k: config.top_k != null ? String(config.top_k) : '',
    presence_penalty: config.presence_penalty != null ? String(config.presence_penalty) : '',
    repetition_penalty: config.repetition_penalty != null ? String(config.repetition_penalty) : '',
    preserve_thinking: ctk.preserve_thinking != null ? (ctk.preserve_thinking ? 'true' : 'false') : '',
    enable_thinking: ctk.enable_thinking != null ? (ctk.enable_thinking ? 'true' : 'false') : '',
  }
}

function formToConfig(form: FormState): ModelConfig {
  const config: ModelConfig = {}
  if (form.temperature !== '') config.temperature = parseFloat(form.temperature)
  if (form.top_p !== '') config.top_p = parseFloat(form.top_p)
  if (form.top_k !== '') config.top_k = parseInt(form.top_k)
  if (form.presence_penalty !== '') config.presence_penalty = parseFloat(form.presence_penalty)
  if (form.repetition_penalty !== '') config.repetition_penalty = parseFloat(form.repetition_penalty)
  const ctk: Record<string, unknown> = {}
  if (form.preserve_thinking !== '') ctk.preserve_thinking = form.preserve_thinking === 'true'
  if (form.enable_thinking !== '') ctk.enable_thinking = form.enable_thinking === 'true'
  if (Object.keys(ctk).length > 0) config.chat_template_kwargs = ctk
  return config
}

function presetMatchesForm(preset: Preset, form: FormState): boolean {
  return JSON.stringify(configToForm(preset.config)) === JSON.stringify(form)
}

export default function ModelConfigDrawer({ modelId, modelName, onClose }: Props) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(emptyForm())
  const [selectedPresetId, setSelectedPresetId] = useState<string>('')
  const [saveAsName, setSaveAsName] = useState('')
  const [showSaveAs, setShowSaveAs] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const { data: configData } = useQuery({
    queryKey: ['model-config', modelId],
    queryFn: () => api.getModelConfig(modelId),
  })

  const { data: presetsData } = useQuery({
    queryKey: ['presets'],
    queryFn: () => api.listPresets(),
  })

  // Hydrate form from server config on first load
  useEffect(() => {
    if (configData) {
      setForm(configToForm(configData.config))
    }
  }, [configData])

  const setMut = useMutation({
    mutationFn: (config: ModelConfig) => api.setModelConfig(modelId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-config', modelId] })
      showToast('Config applied')
    },
  })

  const resetMut = useMutation({
    mutationFn: () => api.resetModelConfig(modelId),
    onSuccess: () => {
      setForm(emptyForm())
      setSelectedPresetId('')
      queryClient.invalidateQueries({ queryKey: ['model-config', modelId] })
      showToast('Config cleared')
    },
  })

  const createPresetMut = useMutation({
    mutationFn: ({ name, config }: { name: string; config: ModelConfig }) =>
      api.createPreset(name, config),
    onSuccess: (preset) => {
      queryClient.invalidateQueries({ queryKey: ['presets'] })
      setSelectedPresetId(preset.id)
      setShowSaveAs(false)
      setSaveAsName('')
      showToast(`Preset "${preset.name}" saved`)
    },
  })

  const updatePresetMut = useMutation({
    mutationFn: ({ id, config }: { id: string; config: ModelConfig }) =>
      api.updatePreset(id, { config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets'] })
      showToast('Preset updated')
    },
  })

  const deletePresetMut = useMutation({
    mutationFn: (id: string) => api.deletePreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets'] })
      setSelectedPresetId('')
      showToast('Preset deleted')
    },
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  function handlePresetSelect(presetId: string) {
    setSelectedPresetId(presetId)
    const preset = presetsData?.presets.find(p => p.id === presetId)
    if (preset) setForm(configToForm(preset.config))
  }

  function handleApply() {
    setMut.mutate(formToConfig(form))
  }

  function handleReset() {
    resetMut.mutate()
  }

  function handleSavePreset() {
    const selectedPreset = presetsData?.presets.find(p => p.id === selectedPresetId)
    if (selectedPreset && !selectedPreset.builtin) {
      updatePresetMut.mutate({ id: selectedPresetId, config: formToConfig(form) })
    } else {
      setShowSaveAs(true)
    }
  }

  function handleSaveAs() {
    if (!saveAsName.trim()) return
    createPresetMut.mutate({ name: saveAsName.trim(), config: formToConfig(form) })
  }

  const presets = presetsData?.presets ?? []
  const loadParams = configData?.load_params
  const selectedPreset = presets.find(p => p.id === selectedPresetId)
  const isModified = selectedPreset ? !presetMatchesForm(selectedPreset, form) : false
  const canSave = selectedPreset && !selectedPreset.builtin

  function field(
    label: string,
    key: keyof FormState,
    type: 'number' | 'select',
    opts?: { min?: number; max?: number; step?: number; selectOpts?: { value: string; label: string }[] }
  ) {
    const value = form[key] as string
    return (
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-400 w-40 shrink-0">{label}</label>
        {type === 'number' ? (
          <input
            type="number"
            value={value}
            placeholder="— (default)"
            min={opts?.min}
            max={opts?.max}
            step={opts?.step ?? 0.05}
            onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))}
            className="w-28 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm font-mono focus:outline-none focus:border-teal-600"
          />
        ) : (
          <select
            value={value}
            onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value as any }))}
            className="w-28 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-teal-600"
          >
            <option value="">— (unset)</option>
            {opts?.selectOpts?.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        )}
      </div>
    )
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-[480px] bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div>
            <h3 className="font-semibold">{modelName}</h3>
            {loadParams && (
              <p className="text-xs text-gray-500 mt-0.5">
                {loadParams.backend?.toUpperCase()}
                {loadParams.ctx_size ? ` · ${loadParams.ctx_size.toLocaleString()} ctx` : ''}
                {loadParams.n_parallel ? ` · ${loadParams.n_parallel} slots` : ''}
                {loadParams.mlx_reasoning_parser ? ` · parser: ${loadParams.mlx_reasoning_parser}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Preset picker */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Preset</p>
            <div className="flex gap-2">
              <select
                value={selectedPresetId}
                onChange={(e) => handlePresetSelect(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-teal-600"
              >
                <option value="">— choose a preset —</option>
                {presets.filter(p => p.builtin).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {presets.some(p => !p.builtin) && (
                  <optgroup label="My presets">
                    {presets.filter(p => !p.builtin).map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {selectedPreset && !selectedPreset.builtin && (
                <button
                  onClick={() => deletePresetMut.mutate(selectedPresetId)}
                  disabled={deletePresetMut.isPending}
                  className="px-2 py-1 bg-gray-800 hover:bg-red-900/60 text-gray-400 hover:text-red-300 rounded text-xs"
                >
                  Delete
                </button>
              )}
            </div>
            {isModified && (
              <p className="text-xs text-amber-400 mt-1">Modified — save to keep changes</p>
            )}
          </div>

          {/* Runtime config fields */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Runtime Config</p>
            <p className="text-xs text-gray-600 mb-3">Applied to every request for this model. Blank = backend default.</p>
            <div className="space-y-3">
              {field('preserve_thinking', 'preserve_thinking', 'select', {
                selectOpts: [{ value: 'true', label: 'on' }, { value: 'false', label: 'off' }],
              })}
              {field('enable_thinking', 'enable_thinking', 'select', {
                selectOpts: [{ value: 'true', label: 'on' }, { value: 'false', label: 'off' }],
              })}
              <div className="border-t border-gray-800 pt-3 mt-1 space-y-3">
                {field('temperature', 'temperature', 'number', { min: 0, max: 2, step: 0.05 })}
                {field('top_p', 'top_p', 'number', { min: 0, max: 1, step: 0.05 })}
                {field('top_k', 'top_k', 'number', { min: 1, max: 500, step: 1 })}
                {field('presence_penalty', 'presence_penalty', 'number', { min: -2, max: 2, step: 0.1 })}
                {field('repetition_penalty', 'repetition_penalty', 'number', { min: 1, max: 2, step: 0.05 })}
              </div>
            </div>
          </div>
        </div>

        {/* Save As dialog */}
        {showSaveAs && (
          <div className="px-5 py-3 bg-gray-900 border-t border-gray-800">
            <p className="text-sm text-gray-300 mb-2">Save as new preset</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAs() }}
                placeholder="Preset name…"
                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm focus:outline-none focus:border-teal-600"
                autoFocus
              />
              <button
                onClick={handleSaveAs}
                disabled={!saveAsName.trim() || createPresetMut.isPending}
                className="px-3 py-1 bg-teal-700 hover:bg-teal-600 rounded text-sm disabled:opacity-50"
              >
                Save
              </button>
              <button
                onClick={() => { setShowSaveAs(false); setSaveAsName('') }}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-gray-800 flex gap-2">
          <button
            onClick={handleApply}
            disabled={setMut.isPending}
            className="flex-1 px-3 py-2 bg-teal-700 hover:bg-teal-600 rounded-md text-sm font-medium disabled:opacity-50"
          >
            Apply
          </button>
          {canSave && isModified ? (
            <button
              onClick={handleSavePreset}
              disabled={updatePresetMut.isPending}
              className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-sm disabled:opacity-50"
            >
              Save
            </button>
          ) : null}
          <button
            onClick={() => setShowSaveAs(true)}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-md text-sm"
          >
            Save As…
          </button>
          <button
            onClick={handleReset}
            disabled={resetMut.isPending}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 rounded-md text-sm disabled:opacity-50"
          >
            Reset
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-700 rounded-full text-sm text-white shadow-lg pointer-events-none">
            {toast}
          </div>
        )}
      </div>
    </>
  )
}
