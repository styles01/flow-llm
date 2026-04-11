import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export function ConnectionBanner() {
  const { isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.getHealth(),
    retry: 2,
    refetchInterval: 5000,
  })

  if (!isError) return null

  return (
    <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-2 text-sm flex items-center gap-2">
      <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
      <span className="text-red-300">Flow server disconnected.</span>
      <span className="text-red-400 animate-pulse">Reconnecting...</span>
    </div>
  )
}