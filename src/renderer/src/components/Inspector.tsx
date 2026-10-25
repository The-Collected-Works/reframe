import type { ReactNode } from 'react'
import { DEFAULT_SETTINGS, normDeg, resolveSettings } from '@shared/layout'
import type { CropSettings, FitMode, SettingKey } from '@shared/types'
import { ZOOM_MAX, ZOOM_MIN } from '../interact'
import { combo, MOD, SHIFT } from '../keys'
import { pickBackground } from '../media'
import { resetSelection } from '../menus'
import { baseName, hasOverrides, useBoard, useStore, type Asset } from '../store'
import { ColorField, fmtTime, Icon, NumberField, Segmented, Slider, Toggle } from './ui'

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
  const { edit, editEach, resetKeys, makeDefault, clearSelection, copy, paste } = useStore.getState()

  const editing = selection.length > 0
  const primaryAsset = assets.find((a) => a.name === (focus && selection.includes(focus) ? focus : selection[0]))
  const primary = editing ? (focus && selection.includes(focus) ? focus : selection[0]) : null
  const s: CropSettings = primary ? resolveSettings(board, primary) : board.defaults
  const W = board.width
  const H = board.height

  const overridden = (keys: SettingKey[]) =>
    editing && selection.some((n) => keys.some((k) => board.overrides[n]?.[k] !== undefined))

  const hasVideo = editing ? selection.some((n) => assets.find((a) => a.name === n)?.kind === 'video') : assets.some((a) => a.kind === 'video')
  const anyOverride = editing && selection.some((n) => hasOverrides(board, n))

  const rp = (keys: SettingKey[]) => ({
    overridden: overridden(keys),
    onReset: () => resetKeys(keys),
    onMakeDefault: () => makeDefault(keys)
  })

  // Middle-click on a field: an asset drops that override and follows the artboard again;
  // the artboard's own defaults go back to the built-in values.
  const back = (...keys: SettingKey[]) => () =>
    editing ? resetKeys(keys) : edit(Object.fromEntries(keys.map((k) => [k, DEFAULT_SETTINGS[k]])) as Partial<CropSettings>)

  const chosen = assets.filter((a) => selection.includes(a.name))
  const title = selection.length === 1 ? baseName(primary!) : `${selection.length} assets`
  const tags = !editing
    ? [`${board.width}×${board.height}`, plural(assets.length, 'asset'), plural(assets.filter((a) => hasOverrides(board, a.name)).length, 'adjusted', 'adjusted')]
    : selection.length === 1 && primaryAsset
      ? describe(primaryAsset)
      : [
          ...(chosen.some((a) => a.kind === 'video') ? [plural(chosen.filter((a) => a.kind === 'video').length, 'video')] : []),
          ...(chosen.some((a) => a.kind === 'image') ? [plural(chosen.filter((a) => a.kind === 'image').length, 'image')] : []),
          fmtSize(chosen.reduce((n, a) => n + a.size, 0))
        ]

  return (
    <aside className="inspector">
      <header className="insp-head">
        {/* Breadcrumb: the artboard's defaults are the parent of whatever is selected. */}
        <nav className="crumbs">
          {editing ? (
            <button className="crumb" title="Edit the defaults every asset follows (Esc)" onClick={clearSelection}>
              {board.name}
            </button>
          ) : (
            <span className="crumb current">{board.name}</span>
          )}
          {editing && (
            <>
              <span className="crumb-sep">
                <Icon name="next" size={12} />
              </span>
              <span className="crumb current" title={selection.length === 1 ? primary! : title}>
                {title}
              </span>
            </>
          )}
        </nav>
        <div className="tags">
          {tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
      </header>

      <div className="insp-body">
        <RowView label="Fit" {...rp(['fit'])}>
          <Segmented value={s.fit} options={FITS} onChange={(fit) => edit({ fit })} />
        </RowView>

        <RowView label="Position" {...rp(['anchorX', 'anchorY', 'offsetX', 'offsetY'])}>
          <div className="position">
            <AnchorGrid x={s.anchorX} y={s.anchorY} onChange={(anchorX, anchorY) => edit({ anchorX, anchorY, offsetX: 0, offsetY: 0 })} />
            <div className="xy">
              <NumberField label="X" value={s.offsetX * W} step={1} onChange={(v) => edit({ offsetX: v / W })} onReset={back('offsetX')} />
              <NumberField label="Y" value={s.offsetY * H} step={1} onChange={(v) => edit({ offsetY: v / H })} onReset={back('offsetY')} />
            </div>
          </div>
        </RowView>

        <RowView label="Transform" {...rp(['zoom', 'scaleX', 'scaleY', 'rotation', 'flipX', 'flipY'])}>
          <div className="pair">
            <NumberField label="Scale" value={s.zoom * 100} step={1} min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} suffix="%" onChange={(v) => edit({ zoom: v / 100 })} onReset={back('zoom')} />
            <NumberField label="Angle" value={s.rotation} step={0.1} min={-180} max={180} suffix="°" onChange={(v) => edit({ rotation: normDeg(v) })} onReset={back('rotation')} />
          </div>
          {/* Only once stretched from an edge in the single view. */}
          {(s.scaleX !== 1 || s.scaleY !== 1) && (
            <div className="pair">
              <NumberField label="W" value={s.scaleX * 100} step={1} min={2} max={1000} suffix="%" onChange={(v) => edit({ scaleX: v / 100 })} onReset={back('scaleX')} />
              <NumberField label="H" value={s.scaleY * 100} step={1} min={2} max={1000} suffix="%" onChange={(v) => edit({ scaleY: v / 100 })} onReset={back('scaleY')} />
            </div>
          )}
          <div className="tool-grid">
            <button className={'tool' + (s.flipX ? ' on' : '')} title="Flip horizontal" onClick={() => editEach((x) => ({ flipX: !x.flipX }))}>
              <Icon name="flipH" />
            </button>
            <button className={'tool' + (s.flipY ? ' on' : '')} title="Flip vertical" onClick={() => editEach((x) => ({ flipY: !x.flipY }))}>
              <Icon name="flipV" />
            </button>
            <button className="tool" title="Rotate left" onClick={() => editEach((x) => ({ rotation: normDeg(x.rotation - 90) }))}>
              <Icon name="rotateL" />
            </button>
            <button className="tool" title="Rotate right" onClick={() => editEach((x) => ({ rotation: normDeg(x.rotation + 90) }))}>
              <Icon name="rotateR" />
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
              <ColorField value={s.bgColor} onChange={(bgColor) => edit({ bgColor })} onReset={back('bgColor')} />
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
              <Slider value={s.blur} min={0} max={200} step={1} curve={1.6} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
              <NumberField value={s.blur} step={1} min={0} max={400} width={64} onChange={(blur) => edit({ blur })} onReset={back('blur')} />
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
          <button className="ghost" disabled={!anyOverride} title={`Reset to defaults (${combo(MOD, SHIFT, 'R')})`} onClick={resetSelection}>
            <Icon name="reset" size={14} /> Reset
          </button>
          <div className="spacer" />
          <button className="icon-btn" title={`Copy settings (${combo(MOD, 'C')})`} onClick={copy} disabled={!focus}>
            <Icon name="copy" size={14} />
          </button>
          <button className="icon-btn" title={`Paste settings (${combo(MOD, 'V')})`} onClick={paste} disabled={!clipboard}>
            <Icon name="paste" size={14} />
          </button>
        </footer>
      )}
    </aside>
  )
}

const fmtSize = (bytes: number) =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

/** ["1920×1080", "0:04.0", "29.97 fps", "3.2 MB"]. The name above already shows the type. */
function describe(a: Asset): string[] {
  const parts: string[] = []
  if (a.w) parts.push(`${a.w}×${a.h}`)
  if (a.kind === 'video' && a.duration > 0) parts.push(fmtTime(a.duration))
  // Two decimals at most: 23.976 reads as 23.98, 30.00 as 30.
  if (a.kind === 'video' && a.fps) parts.push(`${Number(a.fps.toFixed(2))} fps`)
  parts.push(fmtSize(a.size))
  return parts.filter(Boolean)
}

function RowView({
  label,
  overridden,
  onReset,
  onMakeDefault,
  children
}: {
  label: string
  overridden: boolean
  onReset: () => void
  onMakeDefault: () => void
  children: ReactNode
}) {
  return (
    <div className="row">
      <div className="row-label">
        {label}
        {overridden && <button className="dot" title="Reset to default" onClick={onReset} />}
        {/* Revealed on hover: promote this value to the artboard's default. */}
        {overridden && (
          <button className="row-action" title="Use this value as the default for every asset" onClick={onMakeDefault}>
            Make default
          </button>
        )}
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
