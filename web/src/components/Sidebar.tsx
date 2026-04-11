import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

// Oscilloscope-themed nav icons — all 20x20, stroke-width 1.5, round caps/joins
const icons = {
  models: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="2" width="14" height="4" rx="1" />
      <rect x="3" y="8" width="14" height="4" rx="1" />
      <rect x="3" y="14" width="14" height="4" rx="1" />
    </svg>
  ),
  instances: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="7" strokeDasharray="3 3" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  ),
  chat: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4h14a1 1 0 011 1v8a1 1 0 01-1 1H7l-4 3v-3H3a1 1 0 01-1-1V5a1 1 0 011-1z" />
      <path d="M6 8h2M10 8h4" />
    </svg>
  ),
  telemetry: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15l4-5 3 3 4-7 3 4" />
      <line x1="3" y1="17" x2="17" y2="17" />
      <line x1="3" y1="3" x2="3" y2="17" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4" />
    </svg>
  ),
}

const navItems = [
  { to: '/', label: 'Models', icon: icons.models, badge: null as string | null },
  { to: '/running', label: 'Instances', icon: icons.instances, badge: 'running' as const },
  { to: '/chat', label: 'Chat', icon: icons.chat, badge: null as string | null },
  { to: '/telemetry', label: 'Telemetry', icon: icons.telemetry, badge: null as string | null },
  { to: '/settings', label: 'Settings', icon: icons.settings, badge: null as string | null },
]

const LogoIcon = ({ size }: { size: 'sm' | 'lg' }) => (
  <svg className={size === 'sm' ? 'w-5 h-5' : 'w-7 h-7'} viewBox="0 0 32 32" fill="none">
    <line x1="1" y1="8" x2="31" y2="8" stroke="#5eead4" strokeWidth="0.15" opacity="0.15"/>
    <line x1="1" y1="24" x2="31" y2="24" stroke="#5eead4" strokeWidth="0.15" opacity="0.15"/>
    <line x1="1" y1="16" x2="31" y2="16" stroke="#5eead4" strokeWidth="0.5" opacity="0.35"/>
    <path d="M1 16 H4 V10 H8 V16 H12 V12 H16 V16 H20 V8 H24 V16 H28 V14 H31" stroke="#2dd4bf" strokeWidth="1.5" strokeMiterlimit="miter"/>
    <path d="M1 16 H4 V22 H8 V16 H12 V20 H16 V16 H20 V24 H24 V16 H28 V18 H31" stroke="#e879f9" strokeWidth="1.5" strokeMiterlimit="miter" opacity="0.8"/>
  </svg>
)

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('flow.sidebar_collapsed')
    return saved === 'true'
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  // Fetch running models count for badge
  const { data: runningData } = useQuery({
    queryKey: ['running'],
    queryFn: () => api.listRunning(),
    refetchInterval: 10000,
  })

  const runningCount = runningData?.models?.length ?? 0

  useEffect(() => {
    localStorage.setItem('flow.sidebar_collapsed', String(collapsed))
  }, [collapsed])

  // Close mobile sidebar on route change
  const closeMobile = () => setMobileOpen(false)

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          aria-label="Open navigation"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <LogoIcon size="sm" />
        <span className="text-lg font-bold text-white">Flow</span>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60" onClick={closeMobile} />
          <nav className="relative w-64 bg-gray-900 border-r border-gray-800 flex flex-col shadow-2xl osc-glow">
            <SidebarContent collapsed={false} runningCount={runningCount} onNavClick={closeMobile} />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav className={`hidden md:flex ${collapsed ? 'w-14' : 'w-56'} bg-gray-900 border-r border-gray-800 flex-col transition-all duration-200 ease-out`}>
        <SidebarContent collapsed={collapsed} runningCount={runningCount} onToggleCollapse={() => setCollapsed(!collapsed)} />
      </nav>

      {/* Spacer for mobile top bar */}
      <div className="md:hidden h-12" />
    </>
  )
}

function SidebarContent({ collapsed, runningCount, onToggleCollapse, onNavClick }: {
  collapsed: boolean
  runningCount: number
  onToggleCollapse?: () => void
  onNavClick?: () => void
}) {
  return (
    <>
      {/* Logo area */}
      <div className={`p-4 border-b border-gray-800 ${collapsed ? 'flex justify-center' : ''}`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'}`}>
          <LogoIcon size={collapsed ? 'sm' : 'lg'} />
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-white">Flow</h1>
              <p className="text-xs text-gray-400 -mt-0.5">macOS LLM Orchestration</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav items */}
      <div className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={onNavClick}
            className={({ isActive }) => {
              let cls = 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-150 relative'
              if (isActive) {
                cls += ' bg-teal-400/10 text-white border-l-2 border-l-teal-400 osc-border-active'
              } else {
                cls += ' text-gray-400 hover:bg-gray-800 hover:text-white'
              }
              if (collapsed) {
                cls += ' justify-center px-0'
              }
              return cls
            }}
          >
            <span className="shrink-0">{item.icon}</span>
            {!collapsed && <span>{item.label}</span>}
            {item.badge === 'running' && runningCount > 0 && !collapsed && (
              <span className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
            {item.badge === 'running' && runningCount > 0 && collapsed && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            )}
          </NavLink>
        ))}
      </div>

      {/* Collapse toggle & version */}
      {onToggleCollapse && (
        <div className={`p-4 border-t border-gray-800 flex ${collapsed ? 'justify-center' : 'items-center justify-between'}`}>
          {!collapsed && <p className="text-xs text-gray-600">v0.1.0</p>}
          <button
            onClick={onToggleCollapse}
            className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg className="w-4 h-4 transition-transform" style={{ transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7M18 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      )}
    </>
  )
}