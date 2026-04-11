import type { ReactNode } from 'react'

interface CardProps {
  variant?: 'default' | 'active' | 'accent' | 'danger'
  children: ReactNode
  className?: string
}

const variantClasses: Record<string, string> = {
  default: 'bg-bg-surface border border-border rounded-lg',
  active: 'bg-bg-surface border-l-2 border-l-primary rounded-lg osc-glow-active',
  accent: 'bg-bg-surface border border-accent/30 rounded-lg osc-glow-accent',
  danger: 'bg-bg-surface border border-danger/30 rounded-lg',
}

export function Card({ variant = 'default', children, className = '' }: CardProps) {
  return (
    <div className={`p-4 ${variantClasses[variant]} ${className}`}>
      {children}
    </div>
  )
}