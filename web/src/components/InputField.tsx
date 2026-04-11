import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react'

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, hint, error, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-300 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full px-3 py-2 bg-bg-surface border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:border-primary ${
            error ? 'border-danger focus:ring-danger/30' : 'border-border focus:ring-primary-glow'
          } ${className}`}
          {...props}
        />
        {hint && !error && <p className="text-xs text-text-muted mt-1">{hint}</p>}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
    )
  }
)

InputField.displayName = 'InputField'

interface TextAreaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
}

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(
  ({ label, hint, error, className = '', id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-gray-300 mb-1">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={`w-full px-3 py-2 bg-bg-surface border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:border-primary ${
            error ? 'border-danger focus:ring-danger/30' : 'border-border focus:ring-primary-glow'
          } ${className}`}
          {...props}
        />
        {hint && !error && <p className="text-xs text-text-muted mt-1">{hint}</p>}
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
    )
  }
)

TextAreaField.displayName = 'TextAreaField'