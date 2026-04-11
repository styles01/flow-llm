import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

type ToastVariant = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextType {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
}

const ToastContext = createContext<ToastContextType>({ success: () => {}, error: () => {}, info: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

const variantStyles: Record<ToastVariant, { border: string; icon: string }> = {
  success: { border: 'border-l-2 border-l-primary', icon: '✓' },
  error: { border: 'border-l-2 border-l-danger', icon: '✕' },
  info: { border: 'border-l-2 border-l-text-muted', icon: 'ℹ' },
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const style = variantStyles[toast.variant]

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className={`bg-bg-surface ${style.border} rounded-md shadow-lg p-3 flex items-start gap-2 min-w-[280px] max-w-[400px] osc-glow`}>
      <span className="text-sm font-bold shrink-0">{style.icon}</span>
      <p className="text-sm text-text-primary flex-1">{toast.message}</p>
      <button onClick={() => onDismiss(toast.id)} className="text-text-muted hover:text-text-primary shrink-0">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  )
}

import { useEffect } from 'react'

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  let nextId = 0

  const addToast = useCallback((message: string, variant: ToastVariant) => {
    const id = Date.now() + nextId++
    setToasts((prev) => [...prev.slice(-2), { id, message, variant }])
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const context = useCallback(() => ({
    success: (msg: string) => addToast(msg, 'success'),
    error: (msg: string) => addToast(msg, 'error'),
    info: (msg: string) => addToast(msg, 'info'),
  }), [addToast])

  return (
    <ToastContext.Provider value={context()}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}