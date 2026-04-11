import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
}

const variantClasses: Record<string, string> = {
  primary: 'bg-primary-dim hover:bg-teal-500 text-white focus:ring-teal-400/30',
  secondary: 'bg-bg-elevated hover:bg-gray-600 text-text-primary border border-border focus:ring-teal-400/30',
  danger: 'bg-accent-dim hover:bg-fuchsia-600 text-white focus:ring-fuchsia-400/30',
  ghost: 'bg-transparent hover:bg-bg-elevated text-text-secondary focus:ring-teal-400/30',
}

const sizeClasses: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={`rounded-md font-medium transition-colors duration-150 focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-700 disabled:text-gray-500 ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      />
    )
  }
)

Button.displayName = 'Button'