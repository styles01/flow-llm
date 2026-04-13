/**
 * TokenCounter — LM Studio-style token counter with rolling digit animation.
 * Updates at a visual cadence (~10Hz) rather than every WS push, so the digits
 * are readable. Each digit rolls into place with a vertical translate transition.
 */

import { useRef, useEffect, useState } from 'react'

interface DigitRollerProps {
  digit: number
}

function DigitRoller({ digit }: DigitRollerProps) {
  return (
    <div className="h-7 w-4 overflow-hidden relative">
      <div
        className="transition-transform duration-[200ms] ease-out"
        style={{ transform: `translateY(-${digit * 100}%)` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-7 w-4 flex items-center justify-center font-mono text-2xl text-teal-400">
            {i}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Format a token count to a readable string with commas: 1423 → "1,423" */
function formatCount(n: number): string {
  return n.toLocaleString()
}

interface TokenCounterProps {
  count: number
  rate: number | null
}

export function TokenCounter({ count, rate }: TokenCounterProps) {
  // Render at ~10Hz for readability — not on every WS push
  const [displayCount, setDisplayCount] = useState(count)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    const now = performance.now()
    // Update visual at most every 100ms
    if (now - lastUpdateRef.current >= 100) {
      setDisplayCount(count)
      lastUpdateRef.current = now
    } else {
      // Schedule the update for when the 100ms window passes
      const delay = 100 - (now - lastUpdateRef.current)
      const timer = setTimeout(() => {
        setDisplayCount(count)
        lastUpdateRef.current = performance.now()
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [count])

  const digits = formatCount(displayCount).split('')
  const isFast = rate != null && rate > 30

  return (
    <div className="flex items-baseline gap-0.5">
      <div
        className={`flex items-center ${isFast ? 'osc-glow-active' : ''}`}
        style={isFast ? { textShadow: '0 0 8px rgba(45, 212, 191, 0.5)' } : undefined}
      >
        {digits.map((d, i) => (
          d === ','
            ? <span key={i} className="font-mono text-2xl text-teal-400/60 w-2">,</span>
            : <DigitRoller key={i} digit={parseInt(d)} />
        ))}
      </div>
      {rate != null && (
        <span className="text-xs text-teal-500/60 ml-2 font-mono">
          {rate.toFixed(1)} tok/s
        </span>
      )}
    </div>
  )
}