/**
 * IdleWaveform — subtle CRT-style flatline animation shown when a model has no active requests.
 */

interface IdleWaveformProps {
  kvCacheUsage: number | null
}

export function IdleWaveform({ kvCacheUsage }: IdleWaveformProps) {
  return (
    <div className="flex items-center gap-3 h-8">
      <svg className="w-24 h-6" viewBox="0 0 96 24" fill="none">
        {/* Grid line */}
        <line x1="0" y1="12" x2="96" y2="12" stroke="#2dd4bf" strokeWidth="0.5" opacity="0.15" />
        {/* Slowly oscillating waveform */}
        <path
          d="M0 12 Q12 10, 24 12 Q36 14, 48 12 Q60 10, 72 12 Q84 14, 96 12"
          stroke="#2dd4bf"
          strokeWidth="1"
          opacity="0.2"
          fill="none"
        >
          <animate attributeName="d"
            values="M0 12 Q12 10, 24 12 Q36 14, 48 12 Q60 10, 72 12 Q84 14, 96 12;
                    M0 12 Q12 14, 24 12 Q36 10, 48 12 Q60 14, 72 12 Q84 10, 96 12;
                    M0 12 Q12 10, 24 12 Q36 14, 48 12 Q60 10, 72 12 Q84 14, 96 12"
            dur="4s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
      <span className="text-xs text-gray-600">Idle</span>
      {kvCacheUsage != null && kvCacheUsage > 0.02 && (
        <span className="text-xs text-gray-600 ml-1">
          KV {Math.round(kvCacheUsage * 100)}%
        </span>
      )}
    </div>
  )
}