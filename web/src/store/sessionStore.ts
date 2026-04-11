/**
 * Ephemeral session store — lives in memory while the app is open.
 * Survives route changes, gone on page refresh.
 * Uses useSyncExternalStore for React integration.
 */

import { useSyncExternalStore } from 'react'
import type { TelemetryRecord } from '../api/client'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
  reasoningContent?: string
  isError?: boolean
}

interface SessionState {
  // Chat
  messages: Message[]
  selectedModel: string
  systemPrompt: string
  includeTools: boolean
  streaming: boolean
  lastTelemetry: TelemetryRecord | null
  processingProgress: number | null
  // Logs
  logLines: string[]
  logModelFilter: string
  logAutoScroll: boolean
}

const state: SessionState = {
  messages: [],
  selectedModel: '',
  systemPrompt: 'You are a helpful assistant.',
  includeTools: false,
  streaming: false,
  lastTelemetry: null,
  processingProgress: null,
  logLines: [],
  logModelFilter: '',
  logAutoScroll: true,
}

type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach(l => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Snapshot for useSyncExternalStore — must return new ref when state changes
let snapshotVersion = 0
let lastSnapshot: SessionState = { ...state } as SessionState

function getSnapshot(): SessionState {
  if ((lastSnapshot as any).__v !== snapshotVersion) {
    // Shallow-copy so referential equality changes trigger re-renders
    lastSnapshot = { ...state, __v: snapshotVersion } as any
  }
  return lastSnapshot
}

function getServerSnapshot(): SessionState {
  return state
}

function update(partial: Partial<SessionState>) {
  Object.assign(state, partial)
  snapshotVersion++
  emit()
}

// --- Chat actions ---

export const chatActions = {
  setMessages(messages: Message[]) { update({ messages }) },
  setSelectedModel(id: string) { update({ selectedModel: id }) },
  setSystemPrompt(prompt: string) { update({ systemPrompt: prompt }) },
  setIncludeTools(v: boolean) { update({ includeTools: v }) },
  setStreaming(v: boolean) { update({ streaming: v }) },
  setLastTelemetry(t: TelemetryRecord | null) { update({ lastTelemetry: t }) },
  setProcessingProgress(p: number | null) { update({ processingProgress: p }) },
  clearChat() { update({ messages: [], lastTelemetry: null, processingProgress: null }) },
}

// --- Log actions ---

export const logActions = {
  setLogLines(lines: string[]) { update({ logLines: lines }) },
  appendLogLines(lines: string[]) {
    // Only append new lines (dedup by checking last few)
    const existing = state.logLines
    if (lines.length === 0) return
    if (existing.length === 0) {
      update({ logLines: lines })
      return
    }
    // Find overlap — check from the end
    let overlapIdx = -1
    for (let i = Math.max(0, existing.length - lines.length); i < existing.length; i++) {
      if (existing[i] === lines[0]) {
        // Verify consecutive match
        let match = true
        for (let j = 0; j < lines.length && i + j < existing.length; j++) {
          if (existing[i + j] !== lines[j]) { match = false; break }
        }
        if (match) { overlapIdx = i; break }
      }
    }
    if (overlapIdx >= 0) {
      const newLines = lines.slice(existing.length - overlapIdx)
      if (newLines.length > 0) {
        update({ logLines: [...existing, ...newLines] })
      }
    } else {
      // No overlap — full replace (server rotated)
      update({ logLines: lines })
    }
  },
  setLogModelFilter(f: string) { update({ logModelFilter: f }) },
  setLogAutoScroll(v: boolean) { update({ logAutoScroll: v }) },
}

// --- React hook ---

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}