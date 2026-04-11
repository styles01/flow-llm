import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

interface DownloadProgressProps {
  downloadKey: string
  onComplete?: () => void
}

export function DownloadProgress({ downloadKey, onComplete }: DownloadProgressProps) {
  const { data } = useQuery({
    queryKey: ['downloads'],
    queryFn: () => api.getDownloads(),
    refetchInterval: 2000,
  })

  const download = data?.[downloadKey]
  const progress = download?.progress ?? 0
  const status = download?.status

  // Trigger onComplete when download completes
  if (status === 'complete' && onComplete) {
    onComplete()
  }

  if (status === 'error') {
    return (
      <div className="mt-2">
        <div className="flex items-center gap-2 text-sm text-danger">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Download failed
        </div>
      </div>
    )
  }

  if (status === 'complete') {
    return (
      <div className="mt-2">
        <div className="w-full bg-bg-elevated rounded-full h-2">
          <div className="bg-gradient-to-r from-teal-400 to-fuchsia-400 h-2 rounded-full osc-glow" style={{ width: '100%' }} />
        </div>
        <p className="text-xs text-success mt-1">Download complete</p>
      </div>
    )
  }

  // Active download — show indeterminate or progress bar
  return (
    <div className="mt-2">
      <div className="w-full bg-bg-elevated rounded-full h-2 overflow-hidden">
        {progress > 0 && progress < 100 ? (
          // Determinate progress
          <div
            className="bg-gradient-to-r from-teal-400 to-fuchsia-400 h-2 rounded-full transition-all duration-500 ease-out osc-glow"
            style={{ width: `${progress}%` }}
          />
        ) : (
          // Indeterminate — sliding bar
          <div className="relative w-full h-2">
            <div
              className="absolute h-2 bg-gradient-to-r from-teal-400 to-fuchsia-400 rounded-full osc-glow"
              style={{
                width: '40%',
                animation: 'pulse-bar 2s ease-in-out infinite',
              }}
            />
          </div>
        )}
      </div>
      <p className="text-xs text-text-muted mt-1">
        {progress > 0 && progress < 100 ? `${progress.toFixed(0)}%` : 'Downloading...'}
      </p>
    </div>
  )
}