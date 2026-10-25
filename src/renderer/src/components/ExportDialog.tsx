import { useEffect, useMemo, useRef, useState } from 'react'
import { drawFrame, resolveSettings } from '@shared/layout'
import type { Artboard, AssetEntry, Clip, CropSettings, ExportPrefs } from '@shared/types'
import { api, loadImage, videoInfo } from '../media'
import { join } from '../paths'
import { useStore, useVisible, withMeta, type Asset, type AssetMeta } from '../store'
import { Icon, Segmented, Slider } from './ui'

interface Item {
  id: string
  board: Artboard
  asset: Asset
  settings: CropSettings
  /** The trim as it was when the export started. */
  clip: Clip
  output: string
  /** The artboard's folder inside the export folder; it gets the output marker. */
  boardDir: string
}

type Status = { state: 'queued' | 'running' | 'done' | 'error'; progress: number; error?: string }

const safe = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Artboard'
const stem = (name: string) => name.replace(/\.[^.]+$/, '')

const QUALITY: { value: string; label: string; crf: number }[] = [
  { value: 'high', label: 'High', crf: 16 },
  { value: 'medium', label: 'Medium', crf: 20 },
  { value: 'small', label: 'Small', crf: 26 }
]

/**
 * Every file the export will write. Names are compared ignoring case (Windows and macOS do), so
 * "A.jpg" and "a.png" can't both become "a.png" and overwrite each other.
 */
function plan(
  boards: Artboard[],
  entries: AssetEntry[],
  meta: Record<string, AssetMeta>,
  clips: Record<string, Clip>,
  out: string,
  prefs: ExportPrefs
): Item[] {
  const counts = new Map<string, number>()
  boards.forEach((b) => counts.set(safe(b.name).toLowerCase(), (counts.get(safe(b.name).toLowerCase()) ?? 0) + 1))
  const items: Item[] = []
  for (const board of boards) {
    const folder = counts.get(safe(board.name).toLowerCase())! > 1 ? `${safe(board.name)} ${board.width}x${board.height}` : safe(board.name)
    const used = new Set<string>()
    for (const entry of entries) {
      const asset = withMeta(entry, meta[entry.name])
      const settings = resolveSettings(board, asset.name)
      if (settings.skip || asset.error) continue
      const ext = asset.kind === 'video' ? 'mp4' : prefs.imageFormat
      // Subfolders are mirrored under the artboard's folder ("Square/Shoot A/clip.mp4").
      let file = `${stem(asset.name)}.${ext}`
      if (used.has(file.toLowerCase())) file = `${asset.name.replace(/\./g, '_')}.${ext}`
      used.add(file.toLowerCase())
      const boardDir = join(out, folder)
      const clip = clips[asset.name] ?? { start: 0, end: null }
      items.push({ id: `${board.id}/${asset.name}`, board, asset, settings, clip, output: join(boardDir, ...file.split('/')), boardDir })
    }
  }
  return items
}

async function renderImage(item: Item, prefs: ExportPrefs) {
  const img = await loadImage(item.asset.path)
  const { width: W, height: H } = item.board
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  drawFrame(ctx, img, img.naturalWidth, img.naturalHeight, W, H, item.settings, 1)
  const type = prefs.imageFormat === 'jpg' ? 'image/jpeg' : `image/${prefs.imageFormat}`
  const blob = await canvas.convertToBlob({ type, quality: prefs.imageQuality })
  await api.writeFile(item.output, await blob.arrayBuffer())
}

async function renderVideo(item: Item, prefs: ExportPrefs, cancelled: () => boolean) {
  let { w, h, duration, color } = item.asset
  if (!w || !color) ({ w, h, duration, color } = await videoInfo(item.asset.path))
  // Cancelled while that was loading: don't start.
  if (cancelled()) throw new Error('cancelled')
  const clip = item.clip
  await api.exportVideo({
    id: item.id,
    input: item.asset.path,
    output: item.output,
    width: item.board.width,
    height: item.board.height,
    srcWidth: w,
    srcHeight: h,
    color,
    settings: item.settings,
    clip,
    duration,
    crf: prefs.videoCrf
  })
}

export function ExportDialog({ closing = false }: { closing?: boolean }) {
  const project = useStore((s) => s.project)
  const assets = useStore((s) => s.assets)
  const meta = useStore((s) => s.meta)
  const selection = useStore((s) => s.selection)
  const dir = useStore((s) => s.dir)!
  const boardId = useStore((s) => s.boardId)
  const { setExportPrefs, setExportOpen } = useStore.getState()
  const prefs = project.export
  const out = prefs.dir ?? join(dir, 'export')

  const [boards, setBoards] = useState<Set<string>>(() => new Set(project.artboards.map((b) => b.id)))
  // What the grid shows (filters, collapsed folders); offered as a scope when it differs from all.
  const visible = useVisible()
  const [scope, setScope] = useState<'all' | 'visible' | 'selected'>(selection.length > 1 ? 'selected' : visible.length < assets.length ? 'visible' : 'all')
  const [phase, setPhase] = useState<'setup' | 'running' | 'done'>('setup')
  const [status, setStatus] = useState<Record<string, Status>>({})
  const cancelled = useRef(false)

  const items = useMemo(() => {
    const chosen = project.artboards.filter((b) => boards.has(b.id))
    const picked = new Set(selection)
    const pool = scope === 'selected' ? assets.filter((a) => picked.has(a.name)) : scope === 'visible' ? visible : assets
    return plan(chosen, pool, meta, project.clips, out, prefs)
  }, [project, boards, scope, assets, meta, visible, selection, out, prefs])

  const [frozen, setFrozen] = useState<Item[]>([])
  const list = phase === 'setup' ? items : frozen

  useEffect(
    () =>
      api.onExportProgress(({ id, progress }) =>
        setStatus((s) => (s[id] ? { ...s, [id]: { ...s[id], progress } } : s))
      ),
    []
  )

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'running') setExportOpen(false)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [phase, setExportOpen])

  const start = async () => {
    cancelled.current = false
    setFrozen(items)
    setStatus(Object.fromEntries(items.map((i) => [i.id, { state: 'queued', progress: 0 } as Status])))
    setPhase('running')
    // Mark the destinations first, so files appearing there are never picked up as assets.
    await api.markOutput([out, ...new Set(items.map((i) => i.boardDir))]).catch(() => {})
    const update = (id: string, s: Partial<Status>) => setStatus((prev) => ({ ...prev, [id]: { ...prev[id], ...s } }))
    // Images are quick: render a few in parallel, then run videos one at a time.
    const images = items.filter((i) => i.asset.kind === 'image')
    const videos = items.filter((i) => i.asset.kind === 'video')
    const run = async (item: Item) => {
      if (cancelled.current) return
      update(item.id, { state: 'running' })
      try {
        if (item.asset.kind === 'image') await renderImage(item, prefs)
        else await renderVideo(item, prefs, () => cancelled.current)
        update(item.id, { state: 'done', progress: 1 })
      } catch (e) {
        if (cancelled.current) update(item.id, { state: 'queued', progress: 0 })
        else update(item.id, { state: 'error', error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      }
    }
    const queue = [...images]
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (queue.length && !cancelled.current) await run(queue.shift()!)
    }))
    for (const v of videos) {
      if (cancelled.current) break
      await run(v)
    }
    setPhase('done')
  }

  const cancel = () => {
    cancelled.current = true
    api.cancelExport()
  }

  const done = Object.values(status).filter((s) => s.state === 'done').length
  const failed = Object.values(status).filter((s) => s.state === 'error').length
  const overall = list.length ? list.reduce((acc, i) => acc + (status[i.id]?.progress ?? 0), 0) / list.length : 0
  const imgCount = items.filter((i) => i.asset.kind === 'image').length
  const vidCount = items.length - imgCount
  // Progress on the taskbar / Dock icon while running.
  useEffect(() => {
    api.setProgress(phase === 'running' ? overall : -1)
  }, [phase, overall])
  useEffect(() => () => void api.setProgress(-1), [])

  // Finished while you were in another app: tell the OS.
  useEffect(() => {
    if (phase !== 'done' || cancelled.current || document.hasFocus()) return
    const n = new Notification(failed ? 'Export finished with errors' : 'Export complete', {
      body: failed ? `${done} exported, ${failed} failed` : `${done} file${done === 1 ? '' : 's'} exported`,
      silent: false
    })
    n.onclick = () => api.focusWindow()
  }, [phase])

  const crfKey = QUALITY.reduce((best, q) => (Math.abs(q.crf - prefs.videoCrf) < Math.abs(best.crf - prefs.videoCrf) ? q : best)).value

  return (
    <div className={'modal-backdrop' + (closing ? ' closing' : '')} onPointerDown={(e) => e.target === e.currentTarget && phase !== 'running' && setExportOpen(false)}>
      <div className="modal">
        <header className="modal-head">
          <span>Export</span>
          {phase !== 'running' && (
            <button className="icon-btn" onClick={() => setExportOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          )}
        </header>

        {phase === 'setup' ? (
          <div className="modal-body">
            <div className="field">
              <div className="field-label">Destination</div>
              <div className="dest">
                <span className="path" title={out}>
                  <bdi>{out}</bdi>
                </span>
                <button
                  className="ghost"
                  onClick={async () => {
                    const d = await api.chooseExportDir(out)
                    if (d) setExportPrefs({ dir: d })
                  }}
                >
                  Change
                </button>
              </div>
            </div>

            <div className="field">
              <div className="field-label">Artboards</div>
              <div className="checks">
                {project.artboards.map((b) => (
                  <label key={b.id} className={'check' + (boards.has(b.id) ? ' on' : '')}>
                    <input
                      type="checkbox"
                      checked={boards.has(b.id)}
                      onChange={(e) => {
                        const next = new Set(boards)
                        if (e.target.checked) next.add(b.id)
                        else next.delete(b.id)
                        setBoards(next)
                      }}
                    />
                    <span className="box">
                      <Icon name="check" size={12} />
                    </span>
                    <span>{b.name}</span>
                    <span className="muted">
                      {b.width}×{b.height}
                    </span>
                    {b.id === boardId && <span className="muted small">current</span>}
                  </label>
                ))}
              </div>
            </div>

            {(selection.length > 0 || visible.length < assets.length) && (
              <div className="field">
                <div className="field-label">Assets</div>
                <Segmented
                  value={scope}
                  options={[
                    { value: 'all' as const, label: `All ${assets.length}` },
                    ...(visible.length < assets.length ? [{ value: 'visible' as const, label: `Visible ${visible.length}`, title: 'What the grid shows' }] : []),
                    ...(selection.length > 0 ? [{ value: 'selected' as const, label: `Selected ${selection.length}` }] : [])
                  ]}
                  onChange={setScope}
                />
              </div>
            )}

            {imgCount > 0 && (
              <div className="field">
                <div className="field-label">Images</div>
                <div className="inline">
                  <Segmented
                    value={prefs.imageFormat}
                    options={[
                      { value: 'png', label: 'PNG' },
                      { value: 'jpg', label: 'JPG' },
                      { value: 'webp', label: 'WebP' }
                    ]}
                    onChange={(imageFormat) => setExportPrefs({ imageFormat })}
                  />
                  {prefs.imageFormat !== 'png' && (
                    <div className="slider-row grow">
                      <Slider value={prefs.imageQuality * 100} min={50} max={100} step={1} onChange={(v) => setExportPrefs({ imageQuality: v / 100 })} />
                      <span className="muted tabular">{Math.round(prefs.imageQuality * 100)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {vidCount > 0 && (
              <div className="field">
                <div className="field-label">Video · MP4</div>
                <Segmented
                  value={crfKey}
                  options={QUALITY.map((q) => ({ value: q.value, label: q.label }))}
                  onChange={(v) => setExportPrefs({ videoCrf: QUALITY.find((q) => q.value === v)!.crf })}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="modal-body progress-body">
            <div className="overall">
              <div className="bar">
                <div style={{ width: `${overall * 100}%` }} />
              </div>
              <div className="overall-meta">
                <span>
                  {phase === 'done' ? (cancelled.current ? 'Cancelled' : failed ? `${done} exported · ${failed} failed` : `${done} exported`) : `${done} / ${list.length}`}
                </span>
              </div>
            </div>
            <div className="jobs">
              {list.map((i) => {
                const st = status[i.id]
                return (
                  <div key={i.id} className={'job ' + (st?.state ?? '')} title={st?.error}>
                    <span className="job-name">{i.asset.name}</span>
                    <span className="muted small">{i.board.name}</span>
                    <span className="job-state">
                      {st?.state === 'running' && i.asset.kind === 'video' ? `${Math.round(st.progress * 100)}%` : st?.state === 'done' ? <Icon name="check" size={12} /> : st?.state === 'error' ? 'Failed' : ''}
                    </span>
                    {st?.error && <span className="job-error">{st.error}</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <footer className="modal-foot">
          {phase === 'setup' && (
            <>
              <span className="muted">{items.length ? `${items.length} file${items.length === 1 ? '' : 's'}` : 'Nothing to export'}</span>
              <div className="spacer" />
              <button className="primary" disabled={!items.length} onClick={start}>
                Export
              </button>
            </>
          )}
          {phase === 'running' && (
            <>
              <div className="spacer" />
              <button className="ghost" onClick={cancel}>
                Cancel
              </button>
            </>
          )}
          {phase === 'done' && (
            <>
              <button className="ghost" onClick={() => api.reveal(out)}>
                Show in folder
              </button>
              <div className="spacer" />
              <button className="primary" onClick={() => setExportOpen(false)}>
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
