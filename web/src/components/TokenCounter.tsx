/**
 * TokenCounter — odometer-style token counter with smooth catch-up animation.
 *
 * Uses requestAnimationFrame to smoothly interpolate toward the real token count,
 * so digits roll naturally like an odometer rather than teleporting. Carry-borrow
 * (9→0) transitions use a two-strip technique so digits roll through rather than snap.
 *
 * Digits appear dynamically as the number grows — no fixed width, no blank leading
 * zeros. Commas separate thousands groups. Leading zeros are dimmed.
 */

import { useRef, useEffect, useState } from 'react'

// --- DigitRoller: a single digit column that slides vertically ---

interface DigitRollerProps {
  digit: number
  prevDigit: number | null
  dimmed?: boolean
}

function DigitRoller({ digit, prevDigit, dimmed }: DigitRollerProps) {
  const isCarry = prevDigit !== null && digit < prevDigit

  const baseColor = dimmed ? 'text-teal-400/30' : 'text-teal-400'
  const slotH = 28 // h-7 = 1.75rem = 28px

  // For non-carry transitions: smooth slide to the new digit
  // For carry transitions: current strip jumps to new digit position,
  // and an overlay strip shows the old digit sliding out upward
  const [showCarry, setShowCarry] = useState(false)

  useEffect(() => {
    if (isCarry) {
      setShowCarry(true)
      const timer = setTimeout(() => setShowCarry(false), 300)
      return () => clearTimeout(timer)
    } else {
      setShowCarry(false)
    }
  }, [digit, isCarry])

  return (
    <div className="h-7 w-[18px] overflow-hidden relative">
      {/* Main digit strip — always positioned at current digit */}
      <div
        className="transition-transform duration-[200ms] ease-out"
        style={{ transform: `translateY(-${digit * slotH}px)` }}
      >
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            className={`h-7 w-[18px] flex items-center justify-center font-mono text-2xl ${baseColor}`}
          >
            {i}
          </div>
        ))}
      </div>
      {/* Carry overlay: previous digit strip sliding up and out */}
      {showCarry && prevDigit !== null && (
        <div
          className="absolute inset-0 transition-transform duration-[300ms] ease-out"
          style={{
            transform: `translateY(-${(prevDigit + 1) * slotH}px)`,
            opacity: 0.6,
          }}
        >
          {Array.from({ length: 10 }, (_, i) => (
            <div
              key={i}
              className={`h-7 w-[18px] flex items-center justify-center font-mono text-2xl ${baseColor}`}
            >
              {i}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Format number into groups of digits with comma separators ---

interface DigitGroup {
  digits: number[]
  isLeadingGroup: boolean
}

function formatToDigitGroups(n: number): DigitGroup[] {
  if (n === 0) return [{ digits: [0], isLeadingGroup: true }]

  const str = Math.floor(n).toString()
  const groups: DigitGroup[] = []

  for (let i = str.length; i > 0; i -= 3) {
    const start = Math.max(0, i - 3)
    const chunk = str.slice(start, i)
    groups.unshift({
      digits: chunk.split('').map(Number),
      isLeadingGroup: start === 0,
    })
  }

  return groups
}

// --- TokenCounter: smooth odometer with catch-up interpolation ---

interface TokenCounterProps {
  count: number
  rate: number | null
}

export function TokenCounter({ count, rate }: TokenCounterProps) {
  const [displayCount, setDisplayCount] = useState(count)
  const prevDigitsRef = useRef<Record<number, number>>({})
  const rafRef = useRef<number>(0)

  // Smooth interpolation via requestAnimationFrame
  useEffect(() => {
    // Capture current display at effect creation time
    let current = displayCount

    function tick() {
      if (current < count) {
        // Faster catch-up when far behind, smooth when close
        const diff = count - current
        const step = diff > 100 ? Math.ceil(diff * 0.12) : diff > 20 ? 3 : 1
        current = Math.min(current + step, count)
        setDisplayCount(current)
        rafRef.current = requestAnimationFrame(tick)
      }
      // If caught up, stop the loop — will restart when count changes
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [count]) // Only restart rAF when the target count changes

  const groups = formatToDigitGroups(displayCount)
  const isFast = rate != null && rate > 30

  // Build the current digit map for prevDigit comparison
  const currentDigits: Record<number, number> = {}
  let gi = 0
  for (const group of groups) {
    for (let di = 0; di < group.digits.length; di++) {
      currentDigits[gi] = group.digits[di]
      gi++
    }
  }

  // Compute prevDigits: use stored values for carry detection
  const prevDigits = prevDigitsRef.current

  // After rendering, store current digits as prev for next render
  useEffect(() => {
    prevDigitsRef.current = { ...currentDigits }
  })

  // Reset prev if count jumps backward (new request starting from 0)
  if (count === 0 && displayCount > 0) {
    prevDigitsRef.current = {}
  }

  let globalIdx = 0

  return (
    <div className="flex items-baseline gap-0.5">
      <div
        className={`flex items-center ${isFast ? 'osc-glow-active' : ''}`}
        style={isFast ? { textShadow: '0 0 8px rgba(45, 212, 191, 0.5)' } : undefined}
      >
        {groups.map((group, gi) => (
          <span key={gi} className="flex items-center">
            {gi > 0 && (
              <span className="font-mono text-2xl text-teal-400/40 w-2.5 text-center">,</span>
            )}
            {group.digits.map((d, di) => {
              const idx = globalIdx++
              // Dim leading zeros in the leftmost group (e.g. "042" → dim the 0)
              const isFirstDigitOverall = gi === 0 && di === 0
              const hasMoreDigits = globalIdx < 3 // only dim if there are other visible digits
              const dimmed = isFirstDigitOverall && d === 0 && hasMoreDigits
              return (
                <DigitRoller
                  key={`${gi}-${di}`}
                  digit={d}
                  prevDigit={prevDigits[idx] !== undefined ? prevDigits[idx] : null}
                  dimmed={dimmed}
                />
              )
            })}
          </span>
        ))}
      </div>
      {rate != null && (
        <span className="text-xs text-teal-500/60 ml-1.5 font-mono">
          {rate.toFixed(1)} tok/s
        </span>
      )}
    </div>
  )
}