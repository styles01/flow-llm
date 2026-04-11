/**
 * Map raw API errors to human-friendly messages.
 */
export function formatError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()

    // Network / connection
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
      return "Cannot connect to the server. Is Flow running?"
    }

    // HTTP status codes
    if (msg.includes('404') || msg.includes('not found')) {
      return "Model not found. It may have been deleted."
    }
    if (msg.includes('503') || msg.includes('service unavailable')) {
      return "The server is temporarily unavailable. Please try again in a moment."
    }
    if (msg.includes('500') || msg.includes('internal server error')) {
      return "Something went wrong on the server. Please try again."
    }
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
      return "Too many requests. Please wait a moment and try again."
    }
    if (msg.includes('401') || msg.includes('unauthorized')) {
      return "Authentication required. Check your API key."
    }
    if (msg.includes('403') || msg.includes('forbidden')) {
      return "You don't have permission to do this."
    }

    // Connection refused
    if (msg.includes('econnrefused') || msg.includes('connection refused')) {
      return "Connection refused. The model may not be running on that port."
    }

    // Timeout
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return "The request timed out. The model may be taking too long to respond."
    }

    // Disk space
    if (msg.includes('enospc') || msg.includes('no space left')) {
      return "Not enough disk space to complete this operation."
    }

    // Return the original message as a fallback, but strip the "Error:" prefix
    return err.message.replace(/^error:\s*/i, '')
  }

  if (typeof err === 'string') {
    return err
  }

  return 'An unexpected error occurred. Please try again.'
}