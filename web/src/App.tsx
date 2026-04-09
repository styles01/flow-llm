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
              <h1 className="text-lg font-bold text-white">JAMES</h1>
              <p className="text-xs text-gray-500 mt-0.5">Local LLM Gateway</p>
            </div>
            <div className="flex-1 p-2 space-y-1">
              <NavLink
                to="/"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Models
              </NavLink>
              <NavLink
                to="/running"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Running
              </NavLink>
              <NavLink
                to="/chat"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Chat Test
              </NavLink>
              <NavLink
                to="/telemetry"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                Telemetry
              </NavLink>
              <NavLink
                to="/settings"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
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