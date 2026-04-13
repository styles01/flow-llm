import type { ReactNode } from 'react'

type Illustration = 'models' | 'monitor' | 'chat' | 'telemetry'

interface EmptyStateProps {
  title: string
  description: string
  illustration: Illustration
  action?: { label: string; onClick: () => void } | { label: string; linkTo: string }
}

const illustrations: Record<Illustration, ReactNode> = {
  models: (
    <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Download arrow above a flatline */}
      <path d="M32 8v20M24 16l8-8 8 8" />
      <path d="M16 40h32" strokeWidth="1" opacity="0.4" />
      <rect x="12" y="44" width="40" height="3" rx="1" opacity="0.3" />
      <rect x="20" y="50" width="24" height="3" rx="1" opacity="0.2" />
    </svg>
  ),
  monitor: (
    <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Oscilloscope screen with flatline */}
      <rect x="4" y="8" width="56" height="40" rx="3" strokeWidth="1" opacity="0.3" />
      <path d="M8 28h10l4-8 6 16 6-12h6l4 4h8" opacity="0.5" />
      <line x1="4" y1="52" x2="60" y2="52" strokeWidth="1" opacity="0.2" />
    </svg>
  ),
  chat: (
    <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Speech bubble with flatline inside */}
      <path d="M12 16h40a4 4 0 014 4v20a4 4 0 01-4 4H28l-12 8v-8H12a4 4 0 01-4-4V20a4 4 0 014-4z" />
      <path d="M22 28h20" strokeWidth="1" opacity="0.4" />
    </svg>
  ),
  telemetry: (
    <svg className="w-16 h-16" viewBox="0 0 64 64" fill="none" stroke="#2dd4bf" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {/* Empty chart trace */}
      <line x1="12" y1="52" x2="52" y2="52" opacity="0.3" />
      <line x1="12" y1="12" x2="12" y2="52" opacity="0.3" />
      <path d="M16 44h8l4-16 6 24 4-12h8" opacity="0.5" />
    </svg>
  ),
}

export function EmptyState({ title, description, illustration, action }: EmptyStateProps) {
  return (
    <div className="bg-bg-surface border border-border rounded-lg p-8 text-center">
      <div className="flex justify-center mb-4">
        {illustrations[illustration]}
      </div>
      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary mb-4">{description}</p>
      {action && (
        'linkTo' in action ? (
          <a
            href={action.linkTo}
            className="inline-block px-4 py-2 bg-primary-dim hover:bg-teal-500 rounded-md text-sm font-medium text-white transition-colors"
          >
            {action.label}
          </a>
        ) : (
          <button
            onClick={action.onClick}
            className="px-4 py-2 bg-primary-dim hover:bg-teal-500 rounded-md text-sm font-medium text-white transition-colors"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  )
}