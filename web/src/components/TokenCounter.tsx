/**
 * TokenCounter — odometer-style token counter.
 *
 * 4 fixed digit slots, right-aligned. Digits roll vertically when they
 * change. Commas are purely visual separators between groups. Starts at
 * 0000 and each slot rolls independently as its value changes.
 */

import { useRef, useEffect, useState } from 'react'

interface DigitSlotProps {
  digit: number
}

function DigitSlot({ digit }: DigitSlotProps) {
  // Leading zeros show blank so 42 displays as "  ,42" not "0,042"
  return (
    <div className="h-7 w-4 overflow-hidden relative">
      <div
        className="transition-transform duration-[300ms] ease-out"
        style={{ transform: `translateY(-${digit * 100}%)` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-7 w-4 flex items-center justify-center font-mono text-2xl text-teal-400">
            {i === 0 ? '' : i}
          </div>
        ))}
      </div>
    </div>
  )
}

interface TokenCounterProps {
  count: number
  rate: number | null
}

export function TokenCounter({ count, rate }: TokenCounterProps) {
  // Update display at ~4Hz
  const [displayCount, setDisplayCount] = useState(count)
  const lastUpdateRef = useRef(0)

  useEffect(() => {
    const now = performance.now()
    if (now - lastUpdateRef.current >= 250) {
      setDisplayCount(count)
      lastUpdateRef.current = now
    } else {
      const delay = 250 - (now - lastUpdateRef.current)
      const timer = setTimeout(() => {
        setDisplayCount(count)
        lastUpdateRef.current = performance.now()
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [count])

  // Extract 4 digits, right-aligned: 1423 → [1, 4, 2, 3], 42 → [0, 0, 4, 2]
  const d0 = Math.floor((displayCount % 10000) / 1000)
  const d1 = Math.floor((displayCount % 1000) / 100)
  const d2 = Math.floor((displayCount % 100) / 10)
  const d3 = displayCount % 10

  const isFast = rate != null && rate > 30

  return (
    <div className="flex items-baseline gap-0.5">
      <div
        className={`flex items-center ${isFast ? 'osc-glow-active' : ''}`}
        style={isFast ? { textShadow: '0 0 8px rgba(45, 212, 191, 0.5)' } : undefined}
      >
        <DigitSlot digit={d0} />
        <span className="font-mono text-2xl text-teal-400/60 w-1.5 text-center">,</span>
        <DigitSlot digit={d1} />
        <DigitSlot digit={d2} />
        <DigitSlot digit={d3} />
      </div>
      {rate != null && (
        <span className="text-xs text-teal-500/60 ml-2 font-mono">
          {rate.toFixed(1)} tok/s
        </span>
      )}
    </div>
  )
}