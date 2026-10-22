import { useEffect, useState } from 'react'
import type { Artboard } from '@shared/types'
import { api } from '../media'
import { PRESETS, useStore } from '../store'
import { Icon, NumberField, Popover, Segmented } from './ui'

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function TopBar({ onOpen }: { onOpen: () => void }) {
  const dir = useStore((s) => s.dir)
  const boards = useStore((s) => s.project.artboards)
  const boardId = useStore((s) => s.boardId)
  const view = useStore((s) => s.view)
  const cellSize = useStore((s) => s.cellSize)
  const editor = useStore((s) => s.boardEditor)
  const { setBoard, setView, setCellSize, setExportOpen, setBoardEditor, addBoard } = useStore.getState()
  const [adding, setAdding] = useState(false)
  const update = useUpdateCheck()

  return (
    <header className={'topbar ' + api.platform}>
      <button className="folder" onClick={onOpen} title={dir ?? 'Open folder'}>
        <Icon name="folder" size={15} />
        <span>{dir ? basename(dir) : 'Open folder'}</span>
      </button>

      {dir && (
        <nav className="tabs">
          {boards.map((b, i) => (
            <div key={b.id} className="tab-wrap">
              <button
                className={'tab' + (b.id === boardId ? ' on' : '')}
                title={i < 9 ? `⌘${i + 1}` : undefined}
                onClick={() => (b.id === boardId ? setBoardEditor(editor === b.id ? null : b.id) : setBoard(b.id))}
              >
                <span>{b.name}</span>
                <span className="dims">
                  {b.width}×{b.height}
                </span>
              </button>
              {editor === b.id && <BoardEditor board={b} canDelete={boards.length > 1} />}
            </div>
          ))}
          <div className="tab-wrap">
            <button className="icon-btn" title="Add artboard" onClick={() => setAdding(!adding)}>
              <Icon name="plus" size={14} />
            </button>
            {adding && (
              <Popover onClose={() => setAdding(false)} className="menu">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    className="menu-item"
                    onClick={() => {
                      addBoard(p.name, p.width, p.height)
                      setAdding(false)
                    }}
                  >
                    <span>{p.name}</span>
                    <span className="muted">
                      {p.width}×{p.height}
                    </span>
                  </button>
                ))}
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    addBoard('Custom', 1200, 1200)
                    setAdding(false)
                    setBoardEditor(useStore.getState().boardId)
                  }}
                >
                  Custom…
                </button>
              </Popover>
            )}
          </div>
        </nav>
      )}

      <div className="drag-fill" />

      {update && (
        <button className="update" title={`Reframe ${update} is available. Open the download page.`} onClick={() => api.openRelease()}>
          <Icon name="update" size={14} />
          {update}
        </button>
      )}

      {dir && (
        <div className="tools">
          {view === 'grid' && (
            <input
              type="range"
              className="slider size"
              min={120}
              max={480}
              value={cellSize}
              style={{ ['--p' as string]: `${((cellSize - 120) / 360) * 100}%` }}
              onChange={(e) => setCellSize(Number(e.target.value))}
              title="Thumbnail size"
            />
          )}
          <Segmented
            value={view}
            options={[
              { value: 'grid', label: <Icon name="grid" size={15} />, title: 'Grid (G)' },
              { value: 'loupe', label: <Icon name="loupe" size={15} />, title: 'Single (E)' }
            ]}
            onChange={setView}
          />
          <button className="primary" onClick={() => setExportOpen(true)} title="Export (⌘E)">
            Export
          </button>
        </div>
      )}
    </header>
  )
}

/** Checks for a newer release shortly after launch and every few hours; null until there is one. */
function useUpdateCheck(): string | null {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    const check = () => api.checkUpdate().then((u) => setVersion(u?.version ?? null), () => {})
    const first = setTimeout(check, 3000)
    const every = setInterval(check, 6 * 60 * 60 * 1000)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])
  return version
}

function BoardEditor({ board, canDelete }: { board: Artboard; canDelete: boolean }) {
  const { updateBoard, duplicateBoard, removeBoard, setBoardEditor } = useStore.getState()
  const [confirm, setConfirm] = useState(false)
  const size = (n: number) => Math.max(16, Math.min(8192, Math.round(n)))
  return (
    <Popover onClose={() => setBoardEditor(null)} className="board-editor">
      <input
        className="text"
        defaultValue={board.name}
        autoFocus
        onFocus={(e) => e.target.select()}
        onBlur={(e) => e.target.value.trim() && updateBoard(board.id, { name: e.target.value.trim() })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="wh">
        <NumberField label="W" value={board.width} min={16} max={8192} onChange={(v) => updateBoard(board.id, { width: size(v) })} />
        <button className="icon-btn" title="Swap" onClick={() => updateBoard(board.id, { width: board.height, height: board.width })}>
          ⇄
        </button>
        <NumberField label="H" value={board.height} min={16} max={8192} onChange={(v) => updateBoard(board.id, { height: size(v) })} />
      </div>
      <div className="presets">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className={'chip' + (p.width === board.width && p.height === board.height ? ' on' : '')}
            onClick={() => updateBoard(board.id, { width: p.width, height: p.height })}
          >
            {p.width}×{p.height}
          </button>
        ))}
      </div>
      <div className="menu-sep" />
      <div className="editor-actions">
        <button className="ghost" onClick={() => duplicateBoard(board.id)}>
          Duplicate
        </button>
        {canDelete &&
          (confirm ? (
            <button className="ghost danger" onClick={() => removeBoard(board.id)}>
              Delete artboard?
            </button>
          ) : (
            <button className="ghost" onClick={() => setConfirm(true)}>
              Delete
            </button>
          ))}
      </div>
    </Popover>
  )
}
