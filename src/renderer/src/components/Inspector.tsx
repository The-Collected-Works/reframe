import type { ReactNode } from 'react'
import { normDeg, resolveSettings } from '@shared/layout'
import type { CropSettings, FitMode, SettingKey } from '@shared/types'
import { ZOOM_MAX, ZOOM_MIN } from '../interact'
import { pickBackground } from '../media'
import { hasOverrides, useBoard, useStore } from '../store'
import { ColorField, Icon, NumberField, Segmented, Slider, Toggle } from './ui'

const FITS: { value: FitMode; label: string; title: string }[] = [
  { value: 'fill', label: 'Fill', title: 'Cover the artboard' },
  { value: 'fit', label: 'Fit', title: 'Fit inside the artboard' },
  { value: 'width', label: 'W', title: 'Fit width' },
  { value: 'height', label: 'H', title: 'Fit height' },
  { value: 'stretch', label: 'Stretch', title: 'Stretch to fill' }
]

export function Inspector() {
  const board = useBoard()
  const selection = useStore((s) => s.selection)
  const focus = useStore((s) => s.focus)
  const assets = useStore((s) => s.assets)
  const clipboard = useStore((s) => s.clipboard)
  const picking = useStore((s) => s.picking)
  const { edit, editEach, resetKeys, clearSelection, copy, paste } = useStore.getState()

  const editing = selection.length > 0
  const primary = editing ? (focus && selection.includes(focus) ? focus : selection[0]) : null
  const s: CropSettings = primary ? resolveSettings(board, primary) : board.defaults
  const W = board.width
  const H = board.height

  const overridden = (keys: SettingKey[]) =>
    editing && selection.some((n) => keys.some((k) => board.overrides[n]?.[k] !== undefined))

  const hasVideo = editing ? selection.some((n) => assets.find((a) => a.name === n)?.kind === 'video') : assets.some((a) => a.kind === 'video')
  const anyOverride = editing && selection.some((n) => hasOverrides(board, n))

  const rp = (keys: SettingKey[]) => ({ overridden: overridden(keys), onReset: () => resetKeys(keys) })

  return (
    <aside className="inspector">
      <header className="insp-head">
        {editing ? (
          <>
            <div className="insp-title" title={primary ?? ''}>
              {selection.length > 1 ? `${selection.length} selected` : primary}
            </div>
            <button className="chip" onClick={clearSelection} title="Edit defaults (Esc)">
              Defaults
            </button>
          </>
        ) : (
          <>
            <div className="insp-title">Defaults</div>
            <span className="muted small">{board.name}</span>
          </>
        )}
      </header>

      <div className="insp-body">
        <RowView label="Fit" {...rp(['fit'])}>
          <Segmented value={s.fit} options={FITS} onChange={(fit) => edit({ fit })} />
        </RowView>

        <RowView label="Position" {...rp(['anchorX', 'anchorY', 'offsetX', 'offsetY'])}>
          <div className="position">
            <AnchorGrid x={s.anchorX} y={s.anchorY} onChange={(anchorX, anchorY) => edit({ anchorX, anchorY, offsetX: 0, offsetY: 0 })} />
            <div className="xy">
              <NumberField label="X" value={s.offsetX * W} step={1} onChange={(v) => edit({ offsetX: v / W })} />
              <NumberField label="Y" value={s.offsetY * H} step={1} onChange={(v) => edit({ offsetY: v / H })} />
            </div>
          </div>
        </RowView>

        <RowView label="Transform" {...rp(['zoom', 'rotation', 'flipX', 'flipY'])}>
          <div className="pair">
            <NumberField label="Scale" value={s.zoom * 100} step={1} min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} suffix="%" onChange={(v) => edit({ zoom: v / 100 })} />
            <NumberField label="Angle" value={s.rotation} step={0.1} min={-180} max={180} suffix="°" onChange={(v) => edit({ rotation: normDeg(v) })} />
          </div>
          <div className="tool-row">
            <button className="icon-btn" title="Rotate left" onClick={() => editEach((x) => ({ rotation: normDeg(x.rotation - 90) }))}>
              <Icon name="rotateL" />
            </button>
            <button className="icon-btn" title="Rotate right" onClick={() => editEach((x) => ({ rotation: normDeg(x.rotation + 90) }))}>
              <Icon name="rotateR" />
            </button>
            <button className={'icon-btn' + (s.flipX ? ' on' : '')} title="Flip horizontal" onClick={() => editEach((x) => ({ flipX: !x.flipX }))}>
              <Icon name="flipH" />
            </button>
            <button className={'icon-btn' + (s.flipY ? ' on' : '')} title="Flip vertical" onClick={() => editEach((x) => ({ flipY: !x.flipY }))}>
              <Icon name="flipV" />
            </button>
          </div>
        </RowView>

        <RowView label="Background" {...rp(['bg', 'bgColor', 'blur'])}>
          <Segmented
            value={s.bg}
            options={[
              { value: 'color', label: 'Color' },
              { value: 'blur', label: 'Blur', title: 'Blurred copy of the media' }
            ]}
            onChange={(bg) => edit({ bg })}
          />
          {s.bg === 'color' ? (
            <div className="color-row">
              <ColorField value={s.bgColor} onChange={(bgColor) => edit({ bgColor })} />
              <button
                className={'icon-btn' + (picking ? ' on' : '')}
                title="Pick from media (I)"
                onClick={pickBackground}
              >
                <Icon name="pipette" />
              </button>
            </div>
          ) : (
            <div className="slider-row">
              <Slider value={s.blur} min={0} max={200} step={1} curve={1.6} onChange={(blur) => edit({ blur })} />
              <NumberField value={s.blur} step={1} min={0} max={400} width={64} onChange={(blur) => edit({ blur })} />
            </div>
          )}
        </RowView>

        {hasVideo && (
          <RowView label="Mute audio" {...rp(['mute'])}>
            <Toggle value={s.mute} onChange={(mute) => edit({ mute })} />
          </RowView>
        )}

        {editing && (
          <RowView label="Include in export" {...rp(['skip'])}>
            <Toggle value={!s.skip} onChange={(v) => edit({ skip: !v })} />
          </RowView>
        )}
      </div>

      {editing && (
        <footer className="insp-foot">
          <button className="ghost" disabled={!anyOverride} onClick={() => resetKeys(Object.keys(s) as SettingKey[])}>
            <Icon name="reset" size={14} /> Reset
          </button>
          <div className="spacer" />
          <button className="icon-btn" title="Copy settings (⌘C)" onClick={copy} disabled={!focus}>
            <Icon name="copy" size={14} />
          </button>
          <button className="icon-btn" title="Paste settings (⌘V)" onClick={paste} disabled={!clipboard}>
            <Icon name="paste" size={14} />
          </button>
        </footer>
      )}
    </aside>
  )
}

function RowView({
  label,
  overridden,
  onReset,
  children
}: {
  label: string
  overridden: boolean
  onReset: () => void
  children: ReactNode
}) {
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {overridden && <button className="dot" title="Reset to default" onClick={onReset} />}
      </div>
      <div className="row-body">{children}</div>
    </div>
  )
}

function AnchorGrid({ x, y, onChange }: { x: number; y: number; onChange: (x: number, y: number) => void }) {
  const cells = [0, 0.5, 1].flatMap((ay) => [0, 0.5, 1].map((ax) => [ax, ay] as const))
  return (
    <div className="anchor">
      {cells.map(([ax, ay]) => (
        <button key={`${ax}${ay}`} className={Math.abs(ax - x) < 0.01 && Math.abs(ay - y) < 0.01 ? 'on' : ''} onClick={() => onChange(ax, ay)}>
          <span />
        </button>
      ))}
    </div>
  )
}
