/**
 * WebSocket hook with auto-reconnect and message dispatch.
 * Used by the Monitor page for real-time request tracking updates.
 */

import { useEffect, useRef } from 'react'

export interface WSMessage {
  type: string
  data: any
  ts?: number
}

export function useWebSocket(
  url: string,
  onMessage: (msg: WSMessage) => void,
  enabled: boolean = true,
) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  onMessageRef.current = onMessage

  useEffect(() => {
    if (!enabled) return

    let reconnectTimer: ReturnType<typeof setTimeout>
    let shouldReconnect = true

    function connect() {
      if (!shouldReconnect) return

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${protocol}//${window.location.host}${url}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe' }))
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as WSMessage
          onMessageRef.current(msg)
        } catch {}
      }

      ws.onclose = () => {
        if (shouldReconnect) {
          reconnectTimer = setTimeout(connect, 2000)
        }
      }

      ws.onerror = () => {
        // onclose will fire after this, which handles reconnect
      }
    }

    connect()

    return () => {
      shouldReconnect = false
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [url, enabled])
}