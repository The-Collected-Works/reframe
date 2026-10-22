import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  CircleArrowUp,
  ClipboardPaste,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  Folder,
  LayoutGrid,
  Pause,
  Pipette,
  Play,
  Plus,
  RotateCcw,
  RotateCcwSquare,
  RotateCwSquare,
  Square,
  X,
  type LucideIcon
} from 'lucide-react'

// Lucide (ISC), https://lucide.dev
const ICONS = {
  folder: Folder,
  grid: LayoutGrid,
  loupe: Square,
  plus: Plus,
  play: Play,
  pause: Pause,
  close: X,
  reset: RotateCcw,
  copy: Copy,
  paste: ClipboardPaste,
  check: Check,
  pipette: Pipette,
  update: CircleArrowUp,
  rotateL: RotateCcwSquare,
  rotateR: RotateCwSquare,
  flipH: FlipHorizontal2,
  flipV: FlipVertical2
} satisfies Record<string, LucideIcon>

const FILLED = new Set<keyof typeof ICONS>(['play', 'pause'])

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.4} absoluteStrokeWidth fill={FILLED.has(name) ? 'currentColor' : 'none'} />
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const round = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)))
  return Number(v.toFixed(d))
}

/** Numeric input that commits on enter/blur, steps with arrow keys, and scrubs by dragging its label. */
export function NumberField({
  value,
  onChange,
  label,
  step = 1,
  min = -Infinity,
  max = Infinity,
  suffix,
  width
}: {
  value: number
  onChange: (v: number) => void
  label?: string
  step?: number
  min?: number
  max?: number
  suffix?: string
  width?: number
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const clampv = (v: number) => Math.min(max, Math.max(min, round(v, step)))
  const commit = () => {
    if (draft == null) return
    const v = parseFloat(draft)
    if (Number.isFinite(v)) onChange(clampv(v))
    setDraft(null)
  }
  const scrub = (e: React.PointerEvent) => {
    const startX = e.clientX
    const start = value
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => onChange(clampv(start + (ev.clientX - startX) * step * (ev.shiftKey ? 10 : 1)))
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <label className="num" style={width ? { width } : undefined}>
      {label && (
        <span className="num-label" onPointerDown={scrub}>
          {label}
        </span>
      )}
      <input
        value={draft ?? String(round(value, step))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setDraft(null)
            ;(e.target as HTMLInputElement).blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            setDraft(null)
            onChange(clampv(value + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)))
          }
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </label>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  display,
  parse,
  curve = 1
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  display?: (v: number) => number
  parse?: (v: number) => number
  suffix?: string
  /** >1 gives more resolution at the low end. */
  curve?: number
}) {
  const toPos = (v: number) => Math.pow((v - min) / (max - min), 1 / curve)
  const fromPos = (p: number) => min + Math.pow(p, curve) * (max - min)
  const pos = Math.min(1, Math.max(0, toPos(value)))
  return (
    <input
      type="range"
      className="slider"
      min={0}
      max={1000}
      value={Math.round(pos * 1000)}
      style={{ ['--p' as string]: `${pos * 100}%` }}
      onChange={(e) => {
        const v = fromPos(Number(e.target.value) / 1000)
        const shown = display ? display(v) : v
        const snapped = Math.round(shown / step) * step
        onChange(parse ? parse(snapped) : snapped)
      }}
    />
  )
}

export function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(draft.trim())
    if (m) {
      const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
      onChange('#' + h.toLowerCase())
    }
    setDraft(null)
  }
  return (
    <div className="color">
      <label className="swatch" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <input
        className="hex"
        value={draft ?? value.replace('#', '').toUpperCase()}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <button className={'toggle' + (value ? ' on' : '')} role="switch" aria-checked={value} onClick={() => onChange(!value)} />
}

/** Floats below its parent element; fixed positioning so scroll containers don't clip it. */
export function Popover({ onClose, children, className }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    const anchor = el.parentElement!.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))
    setPos({ left, top: anchor.bottom + 8 })
  }, [])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const t = setTimeout(() => window.addEventListener('pointerdown', down))
    window.addEventListener('keydown', key)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  return (
    <div ref={ref} className={'popover ' + (className ?? '')} style={pos ?? { visibility: 'hidden' }}>
      {children}
    </div>
  )
}

export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
