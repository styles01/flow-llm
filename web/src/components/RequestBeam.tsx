/**
 * RequestBeam — visualization of a single tracked request.
 * Shows stage-appropriate visuals: queued (gray pulse), prefilling (amber progress),
 * generating (teal beam with token counter), sending (magenta flash), completed (green checkmark).
 */

import { TokenCounter } from './TokenCounter'
import type { TrackedRequest } from '../store/monitorStore'

interface RequestBeamProps {
  request: TrackedRequest
  queuePosition?: number
  prefillProgress?: number  // 0-1 from slot state (if available)
}

export function RequestBeam({ request, queuePosition, prefillProgress }: RequestBeamProps) {
  const elapsed = ((performance.now() / 1000) - request.started_at) * 1000

  switch (request.stage) {
    case 'queued':
      return (
        <div className="flex items-center gap-2 h-8 px-2 rounded bg-gray-800/50 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0" />
          <span className="text-xs text-gray-500">Queued</span>
          {queuePosition != null && queuePosition > 0 && (
            <span className="text-xs text-gray-600">#{queuePosition}</span>
          )}
          <span className="ml-auto text-[10px] text-gray-600 font-mono">
            {Math.round(elapsed / 1000)}s
          </span>
        </div>
      )

    case 'prefilling':
      const progress = prefillProgress ?? 0
      return (
        <div className="flex items-center gap-2 h-8 px-2 rounded bg-amber-950/20 border border-amber-800/30">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          <span className="text-xs text-amber-400 shrink-0">Analyzing</span>
          <div className="flex-1 bg-gray-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-1.5 bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <span className="text-xs text-amber-400/80 font-mono w-8 text-right shrink-0">
            {Math.round(progress * 100)}%
          </span>
        </div>
      )

    case 'generating':
      return (
        <div className="flex items-center gap-2 h-10 px-2 rounded bg-teal-950/20 border border-teal-800/30 osc-glow-active relative overflow-hidden">
          {/* Scanning highlight sweep */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(45,212,191,0.06) 50%, transparent 100%)',
              animation: 'beam-sweep 2s ease-in-out infinite',
            }}
          />
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping shrink-0" />
          <TokenCounter count={request.output_tokens} rate={request.tokens_per_sec} />
          {request.ttft_ms != null && (
            <span className="text-[10px] text-teal-500/50 font-mono ml-1">
              {(request.ttft_ms / 1000).toFixed(1)}s TTFT
            </span>
          )}
        </div>
      )

    case 'sending':
      return (
        <div className="flex items-center gap-2 h-8 px-2 rounded bg-fuchsia-950/20 border border-fuchsia-800/30 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full bg-fuchsia-400 shrink-0" />
          <span className="text-xs text-fuchsia-400">Sending</span>
          <span className="ml-auto text-[10px] text-fuchsia-400/60 font-mono">
            {request.output_tokens} tokens
          </span>
        </div>
      )

    case 'completed':
      return (
        <div className="flex items-center gap-2 h-8 px-2 rounded bg-green-950/20 border border-green-800/20">
          <svg className="w-3.5 h-3.5 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs text-green-400">Complete</span>
          {request.tokens_per_sec != null && (
            <span className="text-[10px] text-green-400/60 font-mono ml-auto">
              {request.tokens_per_sec.toFixed(1)} tok/s · {request.output_tokens} tokens
            </span>
          )}
        </div>
      )

    case 'error':
      return (
        <div className="flex items-center gap-2 h-8 px-2 rounded bg-red-950/20 border border-red-800/30" title={request.error_message || undefined}>
          <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-xs text-red-400">Error</span>
          {request.error_message && (
            <span className="text-[10px] text-red-400/60 truncate ml-1">
              {request.error_message.slice(0, 60)}
            </span>
          )}
        </div>
      )

    default:
      return null
  }
}