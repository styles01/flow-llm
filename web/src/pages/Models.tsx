import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type HFSearchResult, type GGUFFile } from '../api/client'

export default function ModelsPage() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<HFSearchResult[]>([])
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)

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

  // Load model
  const loadMut = useMutation({
    mutationFn: ({ id, ctxSize }: { id: string; ctxSize: number }) =>
      api.loadModel(id, { ctx_size: ctxSize }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['models'] }),
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

  return (
    <div className="p-6 max-w-6xl">
      <h2 className="text-2xl font-bold mb-6">Models</h2>

      {/* Local models */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Local Models</h3>
        {modelsLoading ? (
          <p className="text-gray-500">Loading...</p>
        ) : models.length === 0 ? (
          <p className="text-gray-500">No models downloaded yet. Search HuggingFace to add models.</p>
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg p-4"
              >
                <div className="flex-1">
                  <p className="font-medium">{m.name}</p>
                  <div className="flex gap-3 text-sm text-gray-400 mt-1">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                      m.backend === 'gguf' ? 'bg-blue-900/50 text-blue-300' : 'bg-purple-900/50 text-purple-300'
                    }`}>{m.backend.toUpperCase()}</span>
                    {m.quantization && <span>{m.quantization}</span>}
                    {m.size_gb && <span>{m.size_gb} GB</span>}
                    {m.template_valid === false && <span className="text-red-400">template error</span>}
                    {m.supports_tools && <span className="text-green-400">tools</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  {m.status === 'running' ? (
                    <>
                      <span className="px-3 py-1.5 bg-green-900/50 text-green-300 rounded-md text-sm">
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
                      onClick={() => loadMut.mutate({ id: m.id, ctxSize: 100000 })}
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
          <div className="space-y-2">
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
                {hfDetails.gguf_files.map((f: GGUFFile) => (
                  <div key={f.filename} className="flex items-center justify-between py-1.5 px-3 bg-gray-800 rounded">
                    <div className="text-sm">
                      <span className="font-mono">{f.filename}</span>
                      {f.size_gb && <span className="ml-2 text-gray-500">{f.size_gb} GB</span>}
                    </div>
                    <button
                      onClick={() => {
                        setDownloading(f.filename)
                        downloadMut.mutate({ hfId: selectedModel!, filename: f.filename })
                      }}
                      disabled={downloading === f.filename}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 rounded text-xs font-medium"
                    >
                      {downloading === f.filename ? 'Downloading...' : 'Download'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}