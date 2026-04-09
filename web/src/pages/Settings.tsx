import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export default function SettingsPage() {
  const { data: hw } = useQuery({
    queryKey: ['hardware'],
    queryFn: () => api.getHardware(),
  })

  const { data: health } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
  })

  return (
    <div className="p-6 max-w-4xl">
      <h2 className="text-2xl font-bold mb-6">Settings</h2>

      {/* Server status */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-gray-300">Server Status</h3>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500">Status</p>
              <p className="font-medium">{health?.status ?? 'Unknown'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Running Models</p>
              <p className="font-medium">{health?.running_models ?? 0}</p>
            </div>
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
                <p className="text-xs text-gray-500">Chip</p>
                <p className="font-medium">{hw.chip}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Total Memory</p>
                <p className="font-medium">{hw.memory_total_gb} GB</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Apple Silicon</p>
                <p className="font-medium">{hw.is_apple_silicon ? 'Yes' : 'No'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Metal GPU</p>
                <p className="font-medium">{hw.metal_supported ? 'Supported' : 'Not supported'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">CPU Cores</p>
                <p className="font-medium">{hw.cpu_count}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Recommended Max Model</p>
                <p className="font-medium">{hw.recommended_max_model_gb.toFixed(1)} GB</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* OpenClaw config */}
      <section>
        <h3 className="text-lg font-semibold mb-3 text-gray-300">OpenClaw Configuration</h3>
        <p className="text-sm text-gray-400 mb-3">
          Copy this into your OpenClaw config to connect to JAMES.
        </p>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 overflow-x-auto">
          <pre>{`{
  "models": {
    "providers": {
      "james": {
        "baseUrl": "http://127.0.0.1:3377/v1",
        "apiKey": "james-local",
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