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

export interface HFModelDetails {
  id: string;
  has_gguf: boolean;
  has_mlx: boolean;
  has_chat_template: boolean;
  gguf_files: GGUFFile[];
  mlx_versions: { mlx_id: string; available: boolean }[];
  siblings: string[];
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

export const api = {
  // Hardware
  getHardware: () => fetchAPI<HardwareInfo>('/hardware'),

  // Models
  listModels: () => fetchAPI<ModelInfo[]>('/models'),
  getModel: (id: string) => fetchAPI<ModelInfo>(`/models/${encodeURIComponent(id)}`),
  deleteModel: (id: string) => fetchAPI<{ status: string }>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  downloadModel: (hfId: string, filename?: string, localDir?: string) =>
    fetchAPI<{ model_id: string; path: string }>('/models/download', {
      method: 'POST',
      body: JSON.stringify({ hf_id: hfId, filename, local_dir: localDir }),
    }),
  loadModel: (id: string, opts?: { ctx_size?: number; flash_attn?: string; cache_type_k?: string; cache_type_v?: string }) =>
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

  // Scan local models
  scanLocal: () => fetchAPI<{ found: any[]; total: number }>('/models/scan', { method: 'POST' }),

  // Register local GGUF
  registerLocal: (ggufPath: string, name?: string) =>
    fetchAPI<{ model_id: string; name: string; size_gb: number }>('/register-local', {
      method: 'POST',
      body: JSON.stringify({ gguf_path: ggufPath, name }),
    }),

  // Download progress
  getDownloads: () => fetchAPI<Record<string, any>>('/downloads'),
};