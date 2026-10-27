# Reframe

Batch-crop a folder of images and videos into one or more artboard sizes, then export everything at once.

## Use

1. Open (or drop) a folder. Every image and video shows up cropped into the current artboard.
2. With nothing selected, the inspector edits the artboard's **defaults**, which apply to every asset.
3. Select one or more assets to **override** settings. A blue dot marks an override; click the dot to reset that setting.
4. Add more artboards with **+**. Each one keeps its own defaults and overrides. On the current tab, click the name to rename it, or the rest of the tab to change its size. Middle-click a tab to delete it (Ctrl+Z brings it back).
5. To leave assets out of an artboard's export, select them and use the leave-out button in the inspector footer (or the right-click menu).
6. **Export** writes `<destination>/<artboard name>/<file>`. Images go out as PNG, JPG or WebP, and videos as H.264 MP4.

**Compositions** put several items on one artboard: select them and press **⌘/Ctrl+G**, then open the composition (double-click it, or **E**). Its editor has two modes, switched at its top left:

- **Layout** arranges the cells. Click a cell to select it; click again (or **Esc**) for the group it's in. The **+** on each edge of the selection adds a cell there. Drag a cell onto another cell's edge to put it beside it, onto its middle to swap the two, or into the margin to put it beside everything. Drag a gap to resize the cells either side (on this artboard; double-click the gap to make them equal again). The toolbar over a selected group turns it from side by side to stacked, makes its cells equal, or spreads them into the group around it. The inspector shows the whole structure.
- **Frame** positions what a cell shows, as for a single asset. Double-clicking a cell in Layout frames it.

A group runs the same way on every artboard; set it to **Auto** in the inspector to have it follow each artboard's shape instead. Sizes are each artboard's own.

Edits autosave to `.reframe.json` inside the folder, so reopening the folder restores them.

| | |
|---|---|
| Drag empty grid space | Box select (**Shift** / **⌘/Ctrl** add to the selection) |
| Drag (grid or single view) | Move. Snaps to edges and centre with guides; **Shift** locks an axis, **Alt** turns snapping off |
| Drag a corner handle | Scale from the opposite corner (**Alt**: from the centre); sticks at 100% |
| Drag just outside a corner | Rotate (**Shift**: 15° steps); right angles are sticky |
| Scroll / pinch (single view) | Zoom about the cursor |
| Double-click (single view) | Reset position, scale and rotation |
| Middle-click a value | Reset it |
| `I` | Eyedropper: click any image or video to set the background to its exact colour |
| `E` / `Esc` | Grid ↔ single view / back or deselect |
| `←` `→` | Previous / next asset |
| `Space` | Open the selection (grid), play / pause (single view) |
| `⌘/Ctrl` + `Z`, `⇧Z` | Undo / redo |
| `⌘/Ctrl` + `C`, `V` | Copy / paste settings between assets |
| `⌘/Ctrl` + `A`, `E`, `O`, `1–9` | Select all, export, open folder, switch artboard |

The full list is under the **ⓘ** button in the app.

## Develop

```sh
npm install
npm run dev        # Linux/macOS/Windows: opens in the local Electron
npm run dev:win    # from WSL: opens as a native Windows window, with hot reload from WSL
```

```sh
npm test           # unit tests (the playback engine, compositions)
npm run e2e        # builds, then drives the app over the DevTools protocol on generated media
```

`npm run e2e` makes its test media with the bundled ffmpeg (once, kept in the system temp folder under `reframe-e2e/media`), runs each suite on a fresh copy with a throwaway profile, and cleans up after itself. On Linux it runs in a virtual display (`xvfb-run`) so no window appears; `E2E_SHOW=1` shows it. `node scripts/e2e/run.mjs grid` runs one suite (`grid`, `single`, `compositions`).

`dev:win` keeps Windows copies of Electron and ffmpeg in `%LOCALAPPDATA%\Reframe-dev`. Both have to live on the Windows drive: Chromium won't start its GPU process from a `\\wsl.localhost` path, and launching ffmpeg from there takes about 1.4s instead of about 3ms. Dev builds use their own profile (`Reframe Dev`), so they can run alongside the packaged app.

### Code layout

The code is in layers. Each may import only from the layers before it in this table (`src/layers.test.ts` checks, as part of `npm test`):

| Layer | What it is | May import |
|---|---|---|
| `src/shared/` | The domain core, plain TypeScript, used by both processes | nothing outside it |
| `src/main/`, `src/preload/` | The main process: folders, ffmpeg, exports, updates | `shared` |
| `renderer/src/lib/` | Engines and plumbing that know nothing of the app | `shared` |
| `renderer/src/ui/` | The UI kit | `shared`, `lib` |
| `renderer/src/config/` | Static app data that several layers read | `shared`, `lib` |
| `renderer/src/state/` | App state, actions, and where engines meet it | the above |
| `renderer/src/features/` | The screens and tools | the above |
| `renderer/src/` (root) | `App.svelte` and `main.ts`, wiring it all up | everything |

What's in each:

- `shared/`:
  - `framing/`: how an asset sits in a frame (`framing.ts`: placement, drawing, settings) and snapping it to edges and centres (`snapping.ts`).
  - `composition/`: compositions. `compose()` turns one into layers (each with its source, place, framing and timing) that the grid, the editor, playback and export all work from, so what's previewed is what's exported. Each type places its layers its own way; so far there's `bento` (cells in a tree of splits).
  - `media/`: file types, colour handling, and the ffmpeg arguments export uses.
  - `types.ts`: the data both processes share (projects, artboards, items, export jobs, the bridge's API).
- `lib/`: the bridge to the main process, media loading, drag tracking, motion, the keymap engine; and `playback/`, the playback engine everything that plays video uses (the single view, compositions, hover previews), with unit tests. A `Playback` is one clock and any number of tracks; each track's pictures come from a `Clip`, fed from playback copies sized to what's on screen (`Copies`: small, every frame a keyframe, made for every video ahead of time, a few at once, what's open first, and kept between sessions), and from the exact frame when the clock stops. See `docs/playback-roadmap.md`.
- `ui/`: buttons, fields, menus, popovers, dialogs, the colour picker, the eyedropper, exported from `ui/index.ts`. Nothing in it knows about app state; it takes props and reports through callbacks.
- `config/`: plain data read across layers: every keyboard shortcut (`keymaps.ts`: the app runs them and the shortcuts panel lists them), artboard presets, view filters, composition types. Config is static: no state, nothing that reads the project. Something only one module uses stays in that module.
- `state/`: small stores by concern (`library`, `project` with its undo history, `view`, `selection`, `shell`, `preview`), `actions.ts` for anything that spans several, `model/` for plain data helpers, and where engines meet app state: `playback.svelte.ts` (the copy store and `Player`, a playback with reactive outputs) and `composition.ts` (a composition as the app shows it).
- `features/`: the top bar, grid, single view, inspector and export. Each feature's root component is its only connection to state; the parts inside it take props.
- `styles/`: theme tokens, base element styles, a few utility classes and shared keyframes. Everything else is scoped to its component.

## Build

```sh
npm run dist:win     # dist/Reframe-<version>-win-x64.exe (portable, no installer)
npm run dist:mac     # dist/Reframe-<version>-mac-{arm64,x64}.zip (run on a Mac)
```

Windows builds work from Linux/WSL. Mac builds must run on macOS. The `Build` GitHub Action builds both when you push a `v*` tag, or when you run it by hand.

The Mac build is ad-hoc signed, not notarized. On first launch, right-click the app and choose **Open**, or run `xattr -cr Reframe.app`.

ffmpeg is a static build from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), released under the GPL. It is fetched per platform into `vendor/` at build time.
