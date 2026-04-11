interface MemoryBarProps {
  used: number
  total: number
  label?: string
  variant?: 'gradient' | 'solid'
}

export function MemoryBar({ used, total, label, variant = 'gradient' }: MemoryBarProps) {
  const pct = total > 0 ? (used / total) * 100 : 0
  const available = (total - used).toFixed(1)

  return (
    <div>
      <div className="w-full bg-bg-elevated rounded-full h-3">
        <div
          className={`h-3 rounded-full transition-all duration-500 ease-out ${
            variant === 'gradient'
              ? 'bg-gradient-to-r from-teal-400 to-fuchsia-400'
              : 'bg-primary-dim'
          } osc-glow`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {label !== undefined ? (
        <p className="text-xs text-text-muted mt-1">{label}</p>
      ) : (
        <p className="text-xs text-text-muted mt-1">
          {pct.toFixed(0)}% used — {available} GB available
        </p>
      )}
    </div>
  )
}