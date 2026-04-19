const API_BASE = '/api';

async function fetchAPI<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

export interface HardwareInfo {
  chip: string;
  memory_total_gb: number;
  memory_available_gb: number;
  memory_used_gb: number;
  cpu_count: number;
  is_apple_silicon: boolean;
  metal_supported: boolean;
  recommended_max_model_gb: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  hf_id: string | null;
  backend: string;
  gguf_file: string | null;
  mlx_path: string | null;
  quantization: string | null;
  size_gb: number | null;
  memory_gb: number | null;
  template_valid: boolean | null;
  supports_tools: boolean | null;
  status: string;
  port: number | null;
  pid: number | null;
}

export interface RunningModel {
  model_id: string;
  name: string;
  backend: string;
  port: number;
  base_url: string;
  pid: number | null;
  is_running: boolean;
}

export interface HFSearchResult {
  id: string;
  author: string | null;
  downloads: number;
  tags: string[];
  pipeline_tag: string | null;
}

export interface GGUFFile {
  filename: string;
  quantization: string;
  size_bytes: number | null;
  size_gb: number | null;
}

export interface RepoFile {
  filename: string;
  size_bytes: number;
  size_gb: number | null;
}

export interface HFModelDetails {
  id: string;
  author: string | null;
  downloads: number;
  description: string | null;
  tags: string[];
  pipeline_tag: string | null;
  library_name: string | null;
  license: string | null;
  languages: string[];
  total_size_bytes: number;
  total_size_gb: number | null;
  file_count: number;
  has_gguf: boolean;
  has_mlx: boolean;
  has_chat_template: boolean;
  gguf_files: GGUFFile[];
  model_weights: RepoFile[];
  tokenizer_files: RepoFile[];
  config_files: RepoFile[];
  other_files: RepoFile[];
  gguf_repo_id: string | null;
  mlx_repo_id: string | null;
  gguf_repo_files: GGUFFile[];
  mlx_details: HFModelDetails | null;
  models_dir: string;
  // Legacy fields kept for compatibility
  siblings: string[];
  mlx_versions: { mlx_id: string; available: boolean }[];
}

export interface TelemetryRecord {
  id: number;
  model_id: string;
  timestamp: string | null;
  ttft_ms: number | null;
  tokens_per_sec: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  backend: string;
  error: string | null;
}

export interface AppSettings {
  port: number
  default_ctx_size: number
  default_flash_attn: string
  default_cache_type_k: string
  default_cache_type_v: string
  default_gpu_layers: number
  default_n_parallel: number
  models_dir: string
  auto_update_backends: boolean
}

export interface ComponentVersion {
  name: string
  current: string | null
  latest: string | null
  update_available: boolean
  install_method: string  // "brew" | "pip" | "not_found" | "unknown"
  updating: boolean
  update_log: string[]
  error: string | null
}

export interface SlotActivity {
  slot_id: number
  state: 'prefill' | 'generating' | 'idle'
  progress: number   // 0-1 during prefill, 1.0 when generating
}

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

export interface ModelActivity {
  slots: SlotActivity[]          // one entry per active slot
  slots_processing: number | null
  slots_deferred: number | null
  tokens_per_sec: number | null
  kv_cache_usage: number | null
  requests: TrackedRequest[]     // active requests from request tracker
}

export const api = {
  // Hardware
  getHardware: () => fetchAPI<HardwareInfo>('/hardware'),

  // Models
  listModels: () => fetchAPI<ModelInfo[]>('/models'),
  getModel: (id: string) => fetchAPI<ModelInfo>(`/models/${encodeURIComponent(id)}`),
  deleteModel: (id: string) => fetchAPI<{ status: string }>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  downloadModel: (hfId: string, filename?: string, localDir?: string, expectedSizeBytes?: number) =>
    fetchAPI<{ download_key: string; status: string }>('/models/download', {
      method: 'POST',
      body: JSON.stringify({ hf_id: hfId, filename, local_dir: localDir, expected_size_bytes: expectedSizeBytes }),
    }),
  loadModel: (id: string, opts?: {
    ctx_size?: number; flash_attn?: string; cache_type_k?: string; cache_type_v?: string; gpu_layers?: number; n_parallel?: number;
    mlx_context_length?: number; mlx_prompt_cache_size?: number; mlx_enable_auto_tool_choice?: boolean;
    mlx_reasoning_parser?: string; mlx_chat_template_file?: string; mlx_trust_remote_code?: boolean;
    mlx_model_type?: string;
  }) =>
    fetchAPI<{ model_id: string; status: string; port: number; base_url: string }>(`/models/${encodeURIComponent(id)}/load`, {
      method: 'POST',
      body: JSON.stringify(opts || {}),
    }),
  unloadModel: (id: string) =>
    fetchAPI<{ model_id: string; status: string }>(`/models/${encodeURIComponent(id)}/unload`, { method: 'POST' }),
  listRunning: () => fetchAPI<{ models: RunningModel[]; hardware: HardwareInfo }>('/models/running'),

  // HuggingFace
  searchHF: (query: string) => fetchAPI<{ results: HFSearchResult[] }>(`/hf/search?q=${encodeURIComponent(query)}`),
  getHFModel: (id: string) => fetchAPI<HFModelDetails>(`/hf/model/${encodeURIComponent(id)}`),

  // Telemetry
  getTelemetry: (modelId?: string) =>
    fetchAPI<{ records: TelemetryRecord[] }>(modelId ? `/telemetry?model_id=${encodeURIComponent(modelId)}` : '/telemetry'),

  // Health
  getHealth: () => fetchAPI<{ status: string; running_models: number }>('/health'),

  // Settings
  getSettings: () => fetchAPI<AppSettings>('/settings'),
  updateSettings: (s: Partial<AppSettings>) =>
    fetchAPI<{ status: string }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(s),
    }),

  // Scan local models
  scanLocal: () => fetchAPI<{ found: any[]; total: number }>('/models/scan', { method: 'POST' }),

  // Register local GGUF
  registerLocal: (ggufPath: string, name?: string) =>
    fetchAPI<{ model_id: string; name: string; size_gb: number }>('/register-local', {
      method: 'POST',
      body: JSON.stringify({ gguf_path: ggufPath, name }),
    }),

  // Connect external backend
  connectExternal: (baseUrl: string, modelId?: string) =>
    fetchAPI<{ model_id: string; status: string; port: number; base_url: string; external: boolean }>('/connect-external', {
      method: 'POST',
      body: JSON.stringify({ base_url: baseUrl, model_id: modelId }),
    }),

  // Download progress
  getDownloads: () => fetchAPI<Record<string, any>>('/downloads'),

  // Processing progress
  getProcessingProgress: () => fetchAPI<{ progress: Record<string, number> }>('/processing-progress'),

  // Backend logs
  getLogs: (lines?: number, modelId?: string) => {
    const params = new URLSearchParams()
    if (lines) params.set('lines', String(lines))
    if (modelId) params.set('model_id', modelId)
    const qs = params.toString()
    return fetchAPI<{ logs: string[] }>(`/logs${qs ? `?${qs}` : ''}`)
  },

  // Backend versions and updates
  getBackendVersions: () =>
    fetchAPI<Record<string, ComponentVersion>>('/backend-versions'),
  checkUpdates: () =>
    fetchAPI<{ status: string }>('/check-updates', { method: 'POST' }),
  updateBackend: (backend: 'llamacpp' | 'mlx') =>
    fetchAPI<{ status: string }>(`/update-backend/${backend}`, { method: 'POST' }),

  // Live model activity (slots, token rate, KV cache, requests)
  getModelActivity: () =>
    fetchAPI<{ activity: Record<string, ModelActivity> }>('/model-activity'),

  // Active request tracker (polling fallback for WebSocket)
  getRequests: () =>
    fetchAPI<{ requests: Record<string, TrackedRequest[]> }>('/requests'),
};