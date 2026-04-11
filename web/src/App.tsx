import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ModelsPage from './pages/Models'
import RunningPage from './pages/Running'
import ChatPage from './pages/Chat'
import TelemetryPage from './pages/Telemetry'
import SettingsPage from './pages/Settings'
import { ToastProvider } from './components/Toast'
import { Sidebar } from './components/Sidebar'
import { ConnectionBanner } from './components/ConnectionBanner'

const queryClient = new QueryClient()

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
      <BrowserRouter>
        <div className="flex h-screen bg-gray-950 text-gray-100">
          <Sidebar />

          {/* Main content */}
          <main className="flex-1 overflow-auto relative osc-scanlines">
            <ConnectionBanner />
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
      </ToastProvider>
    </QueryClientProvider>
  )
}

export default App