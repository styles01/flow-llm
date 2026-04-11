import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ModelsPage from './pages/Models'
import RunningPage from './pages/Running'
import ChatPage from './pages/Chat'
import TelemetryPage from './pages/Telemetry'
import SettingsPage from './pages/Settings'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="flex h-screen bg-gray-950 text-gray-100">
          {/* Sidebar */}
          <nav className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col">
            <div className="p-4 border-b border-gray-800">
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-7 h-7" viewBox="0 0 32 32" fill="none">
                  <path d="M1 20 H4 V12 H6 V20 H8 V8 H10 V20 H12 V14 H14 V20 H16 V6 H18 V20 H20 V10 H22 V20 H24 V16 H26 V20 H28 V12 H31" stroke="#2dd4bf" strokeWidth="1.5" strokeMiterlimit="miter"/>
                  <path d="M1 24 H4 V18 H6 V24 H8 V16 H10 V24 H12 V20 H14 V24 H16 V14 H18 V24 H20 V18 H22 V24 H24 V22 H26 V24 H28 V20 H31" stroke="#e879f9" strokeWidth="1.5" strokeMiterlimit="miter" opacity="0.7"/>
                  <line x1="1" y1="16" x2="31" y2="16" stroke="#5eead4" strokeWidth="0.3" opacity="0.4"/>
                </svg>
                Flow
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">macOS LLM Orchestration</p>
            </div>
            <div className="flex-1 p-2 space-y-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Models
              </NavLink>
              <NavLink
                to="/running"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Running
              </NavLink>
              <NavLink
                to="/chat"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Chat Test
              </NavLink>
              <NavLink
                to="/telemetry"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Telemetry
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-teal-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Settings
              </NavLink>
            </div>
            <div className="p-4 border-t border-gray-800">
              <p className="text-xs text-gray-600">v0.1.0</p>
            </div>
          </nav>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            <Routes>
              <Route path="/" element={<ModelsPage />} />
              <Route path="/running" element={<RunningPage />} />
              <Route path="/chat" element={<ChatPage />} />
              <Route path="/telemetry" element={<TelemetryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App