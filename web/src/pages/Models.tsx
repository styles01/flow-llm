import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type HFSearchResult, type GGUFFile, type ModelInfo } from '../api/client'
import { LoadDialog } from '../components/LoadDialog'
import { ConfirmationDialog } from '../components/ConfirmationDialog'
import { EmptyState } from '../components/EmptyState'
import { useToast } from '../components/Toast'
import { formatError } from '../utils/errors'

function formatSize(bytes: number | null, gb: number | null): string {
  if (gb && gb >= 1) return `${gb} GB`
  if (bytes) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return '—'
}

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<HFSearchResult[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [loadDialogModel, setLoadDialogModel] = useState<ModelInfo | null>(null)
  const [registerPath, setRegisterPath] = useState('')
  const [registerName, setRegisterName] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [activeTab, setActiveTab] = useState<'gguf' | 'mlx' | 'files'>('gguf')
  const [deleteTarget, setDeleteTarget] = useState<ModelInfo | null>(null)

  // Local models
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
  })

  // Search HuggingFace
  const searchHF = useMutation({
    mutationFn: (q: string) => api.searchHF(q),
    onSuccess: (data) => {
      setSearchResults(data.results)
      setSelectedModel(null)
    },
  })

  // HF model details
  const { data: hfDetails, isLoading: hfLoading } = useQuery({
    queryKey: ['hfModel', selectedModel],
    queryFn: () => api.getHFModel(selectedModel!),
    enabled: !!selectedModel,
  })

  // Download model
  const downloadMut = useMutation({
    mutationFn: ({ hfId, filename }: { hfId: string; filename?: string }) =>
      api.downloadModel(hfId, filename),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setDownloading(null)
    },
    onError: () => {
      setDownloading(null)
    },
  })

  // Unload model
  const unloadMut = useMutation({
    mutationFn: (id: string) => api.unloadModel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })

  // Delete model
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteModel(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })

  // Scan local models
  const scanMut = useMutation({
    mutationFn: () => fetch('/api/models/scan', { method: 'POST' }).then(r => r.json()),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      const found = data?.found?.length ?? 0
      if (found > 0) {
        toast.success(`Found ${found} new model${found > 1 ? 's' : ''}`)
      } else {
        toast.info('No new models found')
      }
    },
  })

  // Connect external model
  const connectMut = useMutation({
    mutationFn: () => api.connectExternal(externalUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      queryClient.invalidateQueries({ queryKey: ['running'] })
      setExternalUrl('')
    },
  })

  // Register local model
  const registerMut = useMutation({
    mutationFn: () => fetch('/api/register-local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gguf_path: registerPath, name: registerName || undefined }),
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['models'] })
      setRegisterPath('')
      setRegisterName('')
    },
  })

  // Determine which GGUF files to show (from this repo or the GGUF variant repo)
  const ggufFiles = hfDetails?.gguf_files?.length
    ? hfDetails.gguf_files
    : hfDetails?.gguf_repo_files?.length
      ? hfDetails.gguf_repo_files
      : []

  const hasMlx = hfDetails?.has_mlx || !!hfDetails?.mlx_repo_id
  const mlxDetails = hfDetails?.mlx_details

  const handleDownloadGGUF = (hfId: string, filename: string) => {
    setDownloading(filename)
    downloadMut.mutate({ hfId, filename })
  }

  const handleDownloadMLX = (hfId: string) => {
    const name = hfId.split('/').pop() || hfId
    setDownloading(name)
    downloadMut.mutate({ hfId })
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Models</h2>
        <div className="flex gap-2">
          <button
            onClick={() => scanMut.mutate()}
            disabled={scanMut.isPending}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-md text-sm"
          >
            {scanMut.isPending ? 'Scanning...' : 'Scan Local Files'}
          </button>
        </div>
      </div>

      {/* Advanced: Register & Connect */}
      <details className="mb-6">
        <summary className="text-sm font-semibold text-gray-400 cursor-pointer hover:text-white transition-colors select-none flex items-center gap-2">
          <svg className="w-4 h-4 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          Advanced: Register & Connect
        </summary>
        <div className="mt-3 space-y-4">
          {/* Register local model */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Register Existing Model</h3>
            <p className="text-xs text-gray-400 mb-3">
              Already have a GGUF file on disk? Register it here.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={registerPath}
                onChange={e => setRegisterPath(e.target.value)}
                placeholder="/Volumes/James4TBSSD/llms/model-Q4_K_M.gguf"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <input
                type="text"
                value={registerName}
                onChange={e => setRegisterName(e.target.value)}
                placeholder="Display name (optional)"
                className="w-48 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={() => registerMut.mutate()}
                disabled={!registerPath.trim()}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
              >
                Register
              </button>
            </div>
          </section>

          {/* Connect running model */}
          <section className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-300 mb-3">Connect Running Model</h3>
            <p className="text-xs text-gray-400 mb-3">
              Already have a llama-server or MLX backend running? Connect Flow to it without restarting.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={externalUrl}
                onChange={e => setExternalUrl(e.target.value)}
                placeholder="http://127.0.0.1:8081"
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button
                onClick={() => connectMut.mutate()}
                disabled={!externalUrl.trim() || connectMut.isPending}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
              >
                {connectMut.isPending ? 'Connecting...' : 'Connect'}
              </button>
            </div>
            {connectMut.isError && (
              <p className="text-red-400 text-xs mt-2">{formatError(connectMut.error)}</p>
            )}
            {connectMut.data && (
              <p className="text-green-400 text-xs mt-2">
                Connected! Model <span className="font-mono">{connectMut.data.model_id}</span> on port {connectMut.data.port}
              </p>
            )}
          </section>
        </div>
      </details>

      {/* Local models */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Local Models</h3>
        {modelsLoading ? (
          <p className="text-gray-400">Loading...</p>
        ) : models.length === 0 ? (
          <EmptyState
            title="No models yet"
            description="Download your first model from HuggingFace or register a local GGUF file."
            illustration="models"
          />
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{m.name}</p>
                  <div className="flex gap-3 text-sm text-gray-400 mt-1">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      m.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{m.backend?.toUpperCase()}</span>
                    {m.quantization && <span>{m.quantization}</span>}
                    {m.size_gb && <span>{m.size_gb} GB</span>}
                    {m.template_valid === false && <span className="text-red-400">template error</span>}
                    {m.template_valid === true && <span className="text-green-400">template ok</span>}
                    {m.supports_tools && <span className="text-green-400">tools</span>}
                  </div>
                  {(m.gguf_file || m.mlx_path) && (
                    <p className="text-xs text-gray-600 mt-0.5 truncate font-mono">{m.gguf_file || m.mlx_path}</p>
                  )}
                </div>
                <div className="flex gap-2 ml-4">
                  {m.status === 'running' ? (
                    <>
                      <span className="px-3 py-1.5 bg-green-900/50 text-green-300 rounded-md text-sm whitespace-nowrap">
                        Running :{m.port}
                      </span>
                      <button
                        onClick={() => unloadMut.mutate(m.id)}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-md text-sm"
                      >
                        Unload
                      </button>
                    </>
                  ) : m.status === 'error' ? (
                    <>
                      <button
                        onClick={() => setLoadDialogModel(m)}
                        className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-md text-sm"
                      >
                        Retry
                      </button>
                      <span className="px-2 py-1.5 text-fuchsia-400 rounded-md text-xs">load failed</span>
                    </>
                  ) : m.status === 'available' || m.status === 'loading' ? (
                    <button
                      onClick={() => setLoadDialogModel(m)}
                      className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 rounded-md text-sm"
                    >
                      Load
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 bg-gray-800 text-gray-400 rounded-md text-sm">{m.status}</span>
                  )}
                  {m.status !== 'running' && (
                    <button
                      onClick={() => setDeleteTarget(m)}
                      className="px-3 py-1.5 bg-fuchsia-900/40 hover:bg-fuchsia-800 text-fuchsia-300 rounded-md text-sm"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* HuggingFace search */}
      <section>
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Download from HuggingFace</h3>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchHF.mutate(searchQuery)}
            placeholder="Search models (e.g. Qwen3.5, gemma-4, llama-4)..."
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <button
            onClick={() => searchHF.mutate(searchQuery)}
            disabled={!searchQuery.trim()}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
          >
            Search
          </button>
        </div>

        {searchHF.isPending && <p className="text-gray-400">Searching...</p>}

        {searchResults.length > 0 && (
          <div className="space-y-1 max-h-64 overflow-y-auto mb-4">
            {searchResults.map((r) => {
              const tags = r.tags || []
              const isInstruct = tags.some(t => t === 'instruct' || t.includes('instruct'))
              const isVision = tags.some(t => t === 'vision' || t.includes('vision'))
              const isMlx = tags.some(t => t === 'mlx' || t.includes('mlx'))
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedModel(r.id)}
                  className={`cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    selectedModel === r.id
                      ? 'bg-gray-800 border-teal-500'
                      : 'bg-gray-900 border-gray-800 hover:border-gray-600'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{r.id}</p>
                    <div className="flex gap-1.5 items-center mt-0.5">
                      {r.downloads && <span className="text-xs text-gray-500">{(r.downloads / 1000).toFixed(0)}K</span>}
                      {r.pipeline_tag && <span className="text-xs text-gray-500">{r.pipeline_tag}</span>}
                      {isInstruct && <span className="px-1 py-0.5 bg-teal-900/50 text-teal-300 rounded text-[10px] font-mono">instruct</span>}
                      {isVision && <span className="px-1 py-0.5 bg-fuchsia-900/50 text-fuchsia-300 rounded text-[10px] font-mono">vision</span>}
                      {isMlx && <span className="px-1 py-0.5 bg-purple-900/50 text-purple-300 rounded text-[10px] font-mono">mlx</span>}
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
              )
            })}
          </div>
        )}

        {/* Model detail card */}
        {selectedModel && hfLoading && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
            <p className="text-gray-400">Loading model details...</p>
          </div>
        )}

        {hfDetails && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-800">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-lg font-semibold">{hfDetails.id}</h4>
                  {hfDetails.author && <p className="text-sm text-gray-400">by {hfDetails.author}</p>}
                  <a
                    href={`https://huggingface.co/${hfDetails.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-teal-400 hover:text-teal-300 mt-1"
                  >
                    View on HuggingFace
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                  </a>
                </div>
                <div className="flex gap-2">
                  {hfDetails.has_gguf && <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded text-xs font-mono">GGUF</span>}
                  {hfDetails.has_mlx && <span className="px-2 py-1 bg-purple-900/50 text-purple-300 rounded text-xs font-mono">MLX</span>}
                  {hfDetails.has_chat_template && <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded text-xs font-mono">Chat Template</span>}
                </div>
              </div>

              {/* Stats row */}
              <div className="flex gap-4 mt-2 text-sm text-gray-400">
                {hfDetails.downloads && <span>{(hfDetails.downloads / 1000).toFixed(0)}K downloads</span>}
                {hfDetails.total_size_gb && <span>{hfDetails.total_size_gb} GB total</span>}
                <span>{hfDetails.file_count} files</span>
                {hfDetails.pipeline_tag && <span>{hfDetails.pipeline_tag}</span>}
              </div>

              {/* Description */}
              {hfDetails.description && (
                <p className="mt-3 text-sm text-gray-300 line-clamp-4">{hfDetails.description}</p>
              )}

              {/* Tags */}
              {hfDetails.tags && hfDetails.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {hfDetails.tags.filter(t => !t.startsWith('base_model:') && !t.startsWith('license:') && !t.startsWith('language:')).slice(0, 12).map((tag) => (
                    <span key={tag} className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-xs">{tag}</span>
                  ))}
                </div>
              )}

              {/* Download destination */}
              {hfDetails.models_dir && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <span>Saves to: <span className="font-mono text-gray-400">{hfDetails.models_dir}/</span></span>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-800">
              {ggufFiles.length > 0 && (
                <button
                  onClick={() => setActiveTab('gguf')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'gguf' ? 'border-blue-400 text-blue-300' : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  GGUF Files ({ggufFiles.length})
                </button>
              )}
              {hasMlx && (
                <button
                  onClick={() => setActiveTab('mlx')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === 'mlx' ? 'border-purple-400 text-purple-300' : 'border-transparent text-gray-400 hover:text-gray-300'
                  }`}
                >
                  MLX
                </button>
              )}
              <button
                onClick={() => setActiveTab('files')}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === 'files' ? 'border-gray-400 text-gray-200' : 'border-transparent text-gray-400 hover:text-gray-300'
                }`}
              >
                All Files ({hfDetails.file_count})
              </button>
            </div>

            {/* Tab content */}
            <div className="p-4">
              {/* GGUF tab */}
              {activeTab === 'gguf' && ggufFiles.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm text-gray-400 mb-2">
                    Choose a quantization level. Higher = better quality, larger file.
                  </p>
                  {ggufFiles.map((f: GGUFFile) => (
                    <div key={f.filename} className="flex items-center justify-between py-2 px-3 bg-gray-800 rounded">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm truncate">{f.filename}</p>
                        <div className="flex gap-3 text-xs text-gray-400 mt-0.5">
                          {f.quantization && <span className="text-blue-300">{f.quantization}</span>}
                          {f.size_gb && <span>{f.size_gb} GB</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDownloadGGUF(
                          hfDetails.gguf_repo_id || hfDetails.id,
                          f.filename
                        )}
                        disabled={downloading === f.filename}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 rounded text-sm font-medium ml-3 whitespace-nowrap"
                      >
                        {downloading === f.filename ? 'Downloading...' : 'Download'}
                      </button>
                    </div>
                  ))}
                  {hfDetails.gguf_repo_id && (
                    <p className="text-xs text-gray-400 mt-2">
                      GGUF files from <span className="font-mono">{hfDetails.gguf_repo_id}</span>
                    </p>
                  )}
                </div>
              )}

              {/* MLX tab */}
              {activeTab === 'mlx' && hasMlx && (
                <div>
                  {mlxDetails ? (
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-semibold text-purple-300">{mlxDetails.id}</p>
                          <div className="flex gap-3 text-sm text-gray-400 mt-1">
                            <span>{mlxDetails.file_count} files</span>
                            {mlxDetails.total_size_gb && <span>{mlxDetails.total_size_gb} GB</span>}
                            {mlxDetails.has_chat_template && <span className="text-green-400">chat template</span>}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDownloadMLX(mlxDetails.id)}
                          disabled={downloading !== null}
                          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 rounded-md text-sm font-medium"
                        >
                          {downloading === mlxDetails.id.split('/').pop() ? 'Downloading...' : 'Download MLX Model'}
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 mb-3">
                        Downloads the entire model directory (weights, tokenizer, config) for Apple Silicon MLX inference.
                      </p>
                      {/* Show file breakdown */}
                      {mlxDetails.model_weights.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs text-gray-400 font-medium">Model Weights</p>
                          {mlxDetails.model_weights.slice(0, 5).map((f) => (
                            <div key={f.filename} className="flex justify-between text-xs text-gray-400 py-0.5">
                              <span className="font-mono truncate">{f.filename}</span>
                              {f.size_gb && <span className="ml-2 shrink-0">{f.size_gb} GB</span>}
                            </div>
                          ))}
                          {mlxDetails.model_weights.length > 5 && (
                            <p className="text-xs text-gray-400">+ {mlxDetails.model_weights.length - 5} more weight files</p>
                          )}
                          {mlxDetails.tokenizer_files.length > 0 && (
                            <p className="text-xs text-gray-400 mt-1">
                              + {mlxDetails.tokenizer_files.length} tokenizer file{mlxDetails.tokenizer_files.length > 1 ? 's' : ''}
                              {mlxDetails.config_files.length > 0 && `, ${mlxDetails.config_files.length} config file${mlxDetails.config_files.length > 1 ? 's' : ''}`}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-400 mb-2">
                        MLX version available at <span className="font-mono text-purple-300">{hfDetails.mlx_repo_id}</span>
                      </p>
                      <button
                        onClick={() => handleDownloadMLX(hfDetails.mlx_repo_id!)}
                        disabled={downloading !== null}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 rounded-md text-sm font-medium"
                      >
                        {downloading ? 'Downloading...' : 'Download MLX Model'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Files tab */}
              {activeTab === 'files' && (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {hfDetails.model_weights.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 font-medium mb-1">Model Weights ({hfDetails.model_weights.length})</p>
                      {hfDetails.model_weights.map((f) => (
                        <div key={f.filename} className="flex justify-between text-xs text-gray-300 py-0.5">
                          <span className="font-mono truncate">{f.filename}</span>
                          <span className="ml-2 shrink-0 text-gray-500">{formatSize(f.size_bytes, f.size_gb)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hfDetails.tokenizer_files.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 font-medium mb-1">Tokenizer ({hfDetails.tokenizer_files.length})</p>
                      {hfDetails.tokenizer_files.map((f) => (
                        <div key={f.filename} className="flex justify-between text-xs text-gray-300 py-0.5">
                          <span className="font-mono truncate">{f.filename}</span>
                          <span className="ml-2 shrink-0 text-gray-500">{formatSize(f.size_bytes, f.size_gb)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hfDetails.config_files.length > 0 && (
                    <div className="mb-3">
                      <p className="text-xs text-gray-400 font-medium mb-1">Config ({hfDetails.config_files.length})</p>
                      {hfDetails.config_files.map((f) => (
                        <div key={f.filename} className="flex justify-between text-xs text-gray-300 py-0.5">
                          <span className="font-mono truncate">{f.filename}</span>
                          <span className="ml-2 shrink-0 text-gray-500">{formatSize(f.size_bytes, f.size_gb)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {hfDetails.other_files.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 font-medium mb-1">Other ({hfDetails.other_files.length})</p>
                      {hfDetails.other_files.slice(0, 20).map((f) => (
                        <div key={f.filename} className="flex justify-between text-xs text-gray-300 py-0.5">
                          <span className="font-mono truncate">{f.filename}</span>
                          <span className="ml-2 shrink-0 text-gray-500">{formatSize(f.size_bytes, f.size_gb)}</span>
                        </div>
                      ))}
                      {hfDetails.other_files.length > 20 && (
                        <p className="text-xs text-gray-400">+ {hfDetails.other_files.length - 20} more files</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Load dialog */}
      {loadDialogModel && (
        <LoadDialog
          model={loadDialogModel}
          onClose={() => {
            setLoadDialogModel(null)
            queryClient.invalidateQueries({ queryKey: ['models'] })
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmationDialog
          title="Delete Model"
          message={`This will permanently delete ${deleteTarget.name} and remove it from disk. This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={() => { deleteMut.mutate(deleteTarget.id); setDeleteTarget(null) }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}