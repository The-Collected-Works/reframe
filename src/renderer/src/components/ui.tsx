import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../media'
import { usePresence } from '../motion'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  FileOutput,
  ClipboardPaste,
  Copy,
  ListFilter,
  Eye,
  EyeOff,
  Info,
  Download,
  CopyPlus,
  FlipHorizontal2,
  FlipVertical2,
  Folder,
  FolderOpen,
  LayoutGrid,
  Maximize2,
  Pause,
  Pipette,
  Play,
  Plus,
  RotateCcw,
  Share,
  SlidersHorizontal,
  Trash2,
  RotateCcwSquare,
  RotateCwSquare,
  Square,
  Volume1,
  Volume2,
  VolumeX,
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
  open: Maximize2,
  chevronDown: ChevronDown,
  edit: SlidersHorizontal,
  duplicate: CopyPlus,
  trash: Trash2,
  reveal: FolderOpen,
  include: FileOutput,
  export: Share,
  update: ArrowUp,
  viewOptions: ListFilter,
  exclude: EyeOff,
  show: Eye,
  info: Info,
  download: Download,
  prev: ChevronLeft,
  next: ChevronRight,
  volumeHigh: Volume2,
  volumeLow: Volume1,
  volumeOff: VolumeX,
  rotateL: RotateCcwSquare,
  rotateR: RotateCwSquare,
  // Lucide names these by the axis line, not the motion: mirroring left-right is the vertical-axis glyph.
  flipH: FlipVertical2,
  flipV: FlipHorizontal2
} satisfies Record<string, LucideIcon>

const FILLED = new Set<keyof typeof ICONS>(['play', 'pause'])

export type IconName = keyof typeof ICONS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.4} absoluteStrokeWidth fill={FILLED.has(name) ? 'currentColor' : 'none'} />
}

/**
 * A pill that slides to whichever child matches `selector` inside the nearest positioned
 * container. It measures after layout, and only animates once it has a first position.
 */
export function Indicator({ selector, deps, className }: { selector: string; deps: unknown[]; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current!
    const host = el.parentElement!
    // Layout offsets (summed up to the host, in case the target sits in its own positioned
    // wrapper), not screen rects: rects include transforms, so measuring while a button is
    // pressed (scaled down) or a popover is scaling in left the pill off-centre.
    const measure = () => {
      const on = host.querySelector<HTMLElement>(selector)
      if (!on) return setBox(null)
      let x = 0
      let y = 0
      let n: HTMLElement | null = on
      while (n && n !== host) {
        x += n.offsetLeft
        y += n.offsetTop
        n = n.offsetParent as HTMLElement | null
      }
      if (n !== host) return setBox(null)
      setBox({ x, y, w: on.offsetWidth, h: on.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    host.querySelectorAll(':scope > *').forEach((c) => ro.observe(c))
    return () => ro.disconnect()
  }, deps)
  useEffect(() => {
    if (box && !ready) requestAnimationFrame(() => setReady(true))
  }, [box, ready])
  return (
    <span
      ref={ref}
      aria-hidden
      className={'indicator ' + (className ?? '') + (ready ? ' ready' : '')}
      style={box ? { width: box.w, height: box.h, transform: `translate(${box.x}px, ${box.y}px)` } : { opacity: 0 }}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode; title?: string; disabled?: boolean }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg">
      <Indicator selector=":scope > button.on" deps={[value, options.length]} />
      {options.map((o) => (
        <button key={o.value} title={o.title} disabled={o.disabled} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
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
/**
 * Middle-click resets a value field. Handled on press so the browser's autoscroll (and, on
 * Linux, primary-selection paste) never starts.
 */
function middleReset(onReset?: () => void) {
  if (!onReset) return {}
  return {
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      onReset()
    },
    onAuxClick: (e: React.MouseEvent) => e.button === 1 && e.preventDefault()
  }
}

export function NumberField({
  value,
  onChange,
  label,
  step = 1,
  min = -Infinity,
  max = Infinity,
  suffix,
  width,
  onReset
}: {
  value: number
  onChange: (v: number) => void
  /** Middle-click: back to the default. */
  onReset?: () => void
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
    if (e.button !== 0) return
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
    <label className="num" style={width ? { width } : undefined} {...middleReset(onReset && (() => (setDraft(null), onReset())))}>
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
  curve = 1,
  onReset
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
  onReset?: () => void
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
      {...middleReset(onReset)}
      onChange={(e) => {
        const v = fromPos(Number(e.target.value) / 1000)
        const shown = display ? display(v) : v
        const snapped = Math.round(shown / step) * step
        onChange(parse ? parse(snapped) : snapped)
      }}
    />
  )
}

export function ColorField({ value, onChange, onReset }: { value: string; onChange: (v: string) => void; onReset?: () => void }) {
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
    <div className="color" {...middleReset(onReset && (() => (setDraft(null), onReset())))}>
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

/**
 * Floats below the element it's declared in. Rendered into document.body (a placeholder stays in
 * place to find the anchor), so no ancestor's overflow, mask or transform can clip it.
 */
export function Popover({
  open = true,
  onClose,
  children,
  className
}: {
  open?: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const placeholder = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const { mounted, closing } = usePresence(open, 120)
  useLayoutEffect(() => {
    if (!mounted) return setPos(null)
    const el = ref.current!
    const anchor = placeholder.current!.parentElement!.getBoundingClientRect()
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - el.offsetWidth - 8))
    // Anchored in the top bar: open clear of the bar's edge, not just below the anchor.
    const bar = placeholder.current!.closest('.topbar')?.getBoundingClientRect()
    setPos({ left, top: Math.max(anchor.bottom + 8, bar ? bar.bottom + 6 : 0) })
  }, [mounted])
  // Registered once, in the capture phase (so nothing that stops propagation can keep it open),
  // ignoring the press that opened it. Presses on the anchor are left to the anchor's own click,
  // so it toggles rather than closing here and immediately reopening.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    const opened = performance.now()
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      const anchor = placeholder.current?.parentElement
      if (e.timeStamp < opened || ref.current?.contains(t) || anchor?.contains(t)) return
      onCloseRef.current()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current()
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    // Clicks on the title bar's drag region never reach the page, but dragging the window closes it.
    const offMove = api.onWindowMoving(() => onCloseRef.current())
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key)
      offMove()
    }
  }, [open])
  return (
    <>
      <span ref={placeholder} hidden />
      {mounted &&
        createPortal(
          <div ref={ref} className={'popover ' + (className ?? '') + (closing ? ' closing' : '')} style={pos ?? { visibility: 'hidden' }}>
            {children}
          </div>,
          document.body
        )}
    </>
  )
}

export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
