interface StatusBadgeProps {
  status: 'running' | 'available' | 'loading' | 'error'
  detail?: string
}

export function StatusBadge({ status, detail }: StatusBadgeProps) {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-green-900/50 text-green-300">
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          Running{detail ? ` :${detail}` : ''}
        </span>
      )
    case 'available':
      return (
        <span className="px-1.5 py-0.5 rounded text-xs font-mono border border-teal-400/50 text-teal-300">
          Available
        </span>
      )
    case 'loading':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm bg-amber-900/30 text-amber-300">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          Loading...
        </span>
      )
    case 'error':
      return (
        <span className="text-xs text-fuchsia-300">
          {detail || 'Error'}
        </span>
      )
  }
}