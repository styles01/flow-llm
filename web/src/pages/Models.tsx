import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type HFSearchResult, type GGUFFile, type ModelInfo } from '../api/client'
import { LoadDialog } from '../components/LoadDialog'

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<HFSearchResult[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [loadDialogModel, setLoadDialogModel] = useState<ModelInfo | null>(null)
  const [registerPath, setRegisterPath] = useState('')
  const [registerName, setRegisterName] = useState('')

  // Local models
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['models'],
    queryFn: () => api.listModels(),
  })

  // Search HuggingFace
  const searchHF = useMutation({
    mutationFn: (q: string) => api.searchHF(q),
    onSuccess: (data) => setSearchResults(data.results),
  })

  // HF model details
  const { data: hfDetails } = useQuery({
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
  })

  // Connect external model
  const [externalUrl, setExternalUrl] = useState('')
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

      {/* Register local model */}
      <section className="mb-6 bg-gray-900 border border-gray-800 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Register Existing Model</h3>
        <p className="text-xs text-gray-500 mb-3">
          Already have a GGUF file on disk? Register it here (e.g. your external SSD models).
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={registerPath}
            onChange={e => setRegisterPath(e.target.value)}
            placeholder="/Volumes/James4TBSSD/llms/model-name/model-Q4_K_M.gguf"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="text"
            value={registerName}
            onChange={e => setRegisterName(e.target.value)}
            placeholder="Display name (optional)"
            className="w-48 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => registerMut.mutate()}
            disabled={!registerPath.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
          >
            Register
          </button>
        </div>
      </section>

      {/* Connect running model */}
      <section className="mb-6 bg-gray-900 border border-green-900/40 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-green-300 mb-3">Connect Running Model</h3>
        <p className="text-xs text-gray-500 mb-3">
          Already have a llama-server or MLX backend running? Connect JAMES to it without restarting.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={externalUrl}
            onChange={e => setExternalUrl(e.target.value)}
            placeholder="http://127.0.0.1:8081"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          <button
            onClick={() => connectMut.mutate()}
            disabled={!externalUrl.trim() || connectMut.isPending}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
          >
            {connectMut.isPending ? 'Connecting...' : 'Connect'}
          </button>
        </div>
        {connectMut.isError && (
          <p className="text-red-400 text-xs mt-2">{(connectMut.error as Error).message}</p>
        )}
        {connectMut.data && (
          <p className="text-green-400 text-xs mt-2">
            Connected! Model <span className="font-mono">{connectMut.data.model_id}</span> on port {connectMut.data.port}
          </p>
        )}
      </section>

      {/* Local models */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Local Models</h3>
        {modelsLoading ? (
          <p className="text-gray-500">Loading...</p>
        ) : models.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 text-center">
            <p className="text-gray-400 mb-2">No models yet.</p>
            <p className="text-gray-500 text-sm">Download from HuggingFace below or register a local GGUF file above.</p>
          </div>
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
                  ) : m.status === 'available' ? (
                    <button
                      onClick={() => setLoadDialogModel(m)}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-md text-sm"
                    >
                      Load
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 bg-gray-800 text-gray-400 rounded-md text-sm">{m.status}</span>
                  )}
                  {m.status !== 'running' && (
                    <button
                      onClick={() => { if (confirm(`Delete ${m.name}?`)) deleteMut.mutate(m.id) }}
                      className="px-3 py-1.5 bg-red-900/50 hover:bg-red-800 text-red-300 rounded-md text-sm"
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
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Search HuggingFace</h3>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchHF.mutate(searchQuery)}
            placeholder="Search models (e.g. gemma-4, qwen3, llama-4)..."
            className="flex-1 px-4 py-2 bg-gray-900 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={() => searchHF.mutate(searchQuery)}
            disabled={!searchQuery.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-md text-sm font-medium"
          >
            Search
          </button>
        </div>

        {searchHF.isPending && <p className="text-gray-500">Searching...</p>}

        {searchResults.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {searchResults.map((r) => (
              <div
                key={r.id}
                onClick={() => setSelectedModel(r.id)}
                className={`cursor-pointer flex items-center justify-between p-3 rounded-lg border transition-colors ${
                  selectedModel === r.id
                    ? 'bg-gray-800 border-indigo-500'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-600'
                }`}
              >
                <div>
                  <p className="font-medium text-sm">{r.id}</p>
                  <div className="flex gap-2 text-xs text-gray-500 mt-0.5">
                    {r.downloads && <span>{(r.downloads / 1000).toFixed(0)}K downloads</span>}
                    {r.pipeline_tag && <span>{r.pipeline_tag}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Model detail / download */}
        {hfDetails && (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-lg p-4">
            <h4 className="font-semibold mb-2">{selectedModel}</h4>
            <div className="flex gap-4 text-sm text-gray-400 mb-4">
              {hfDetails.has_gguf && <span className="text-blue-400">GGUF available</span>}
              {hfDetails.has_mlx && <span className="text-purple-400">MLX available</span>}
              {hfDetails.has_chat_template && <span className="text-green-400">Chat template</span>}
            </div>

            {hfDetails.gguf_files.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-300 mb-2">GGUF Files:</p>
                <div className="max-h-48 overflow-y-auto">
                  {hfDetails.gguf_files.map((f: GGUFFile) => (
                    <div key={f.filename} className="flex items-center justify-between py-1.5 px-3 bg-gray-800 rounded mb-1">
                      <div className="text-sm min-w-0">
                        <span className="font-mono text-xs truncate block">{f.filename}</span>
                        {f.size_gb && <span className="text-gray-500 text-xs">{f.size_gb} GB</span>}
                      </div>
                      <button
                        onClick={() => {
                          setDownloading(f.filename)
                          downloadMut.mutate({ hfId: selectedModel!, filename: f.filename })
                        }}
                        disabled={downloading === f.filename}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 rounded text-xs font-medium ml-3 whitespace-nowrap"
                      >
                        {downloading === f.filename ? 'Downloading...' : 'Download'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hfDetails.mlx_versions.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium text-gray-300 mb-2">MLX Version:</p>
                {hfDetails.mlx_versions.map((v: { mlx_id: string; available: boolean }) => (
                  <button
                    key={v.mlx_id}
                    onClick={() => {
                      setDownloading(v.mlx_id)
                      downloadMut.mutate({ hfId: v.mlx_id })
                    }}
                    disabled={downloading === v.mlx_id}
                    className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 rounded text-sm font-medium"
                  >
                    {downloading === v.mlx_id ? 'Downloading...' : `Download ${v.mlx_id}`}
                  </button>
                ))}
              </div>
            )}
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
    </div>
  )
}