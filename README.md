# Reframe

Batch-crop a folder of images and videos into one or more artboard sizes, then export everything at once.

## Use

1. Open (or drop) a folder. Every image and video shows up cropped into the current artboard.
2. With nothing selected, the inspector edits the artboard's **defaults**, which apply to every asset.
3. Select one or more assets to **override** settings. A blue dot marks an override; click the dot to reset that setting.
4. Add more artboards with **+**. Each one keeps its own defaults and overrides. On the current tab, click the name to rename it, or the rest of the tab to change its size. Middle-click a tab to delete it (Ctrl+Z brings it back).
5. To leave assets out of an artboard's export, select them and use the leave-out button in the inspector footer (or the right-click menu).
6. **Export** writes `<destination>/<artboard name>/<file>`. Images go out as PNG, JPG or WebP, and videos as H.264 MP4.

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

`dev:win` keeps Windows copies of Electron and ffmpeg in `%LOCALAPPDATA%\Reframe-dev`. Both have to live on the Windows drive: Chromium won't start its GPU process from a `\\wsl.localhost` path, and launching ffmpeg from there takes about 1.4s instead of about 3ms. Dev builds use their own profile (`Reframe Dev`), so they can run alongside the packaged app.

### Code layout

The renderer (`src/renderer/src`) is Svelte 5:

- `state/`: app state as small stores by concern (`library`, `project` with its undo history, `view`, `selection`, `shell`, `preview`). `actions.ts` holds anything that spans several of them; `model/` is plain data helpers.
- `ui/`: the UI kit (buttons, fields, menus, popovers, dialogs, the colour picker, the eyedropper), exported from `ui/index.ts`. Nothing in it knows about app state; it takes props and reports through callbacks.
- `features/`: the app's screens (top bar, grid, single view, inspector, export). Each feature's root component is its only connection to state; the parts inside it take props.
- `features/keymaps.ts`: every keyboard shortcut. The app runs them and the shortcuts panel lists them, so new ones go here.
- `lib/`: plumbing with no app state (the bridge to the main process, media loading, drag tracking, motion).
- `lib/playback/`: the playback engine everything that plays video uses (the single view, compositions, hover previews), in plain TypeScript with unit tests (`npm test`). A `Playback` is one clock and any number of tracks; each track's pictures come from a `Clip`, fed from playback copies sized to what's on screen (`Copies`: small, every frame a keyframe, made by the media worker for every video ahead of time, what's open first, and kept between sessions), and from the exact frame when the clock stops. Sound plays from the original file, apart from the pictures. `state/playback.svelte.ts` is the one place it meets Svelte: the app's copy store and `Player`, a playback with reactive outputs. See `docs/playback-roadmap.md`.
- `styles/`: theme tokens, base element styles, a few utility classes and shared keyframes. Everything else is scoped to its component.

The main process (`src/main`) scans folders, runs ffmpeg and writes exports. `src/shared` is what both sides use: the crop geometry (`layout.ts`), and compositions (`composition/`). `compose()` turns a composition into layers (each with its source, place, framing and timing) that the grid, the editor, playback and export all work from, so what's previewed is what's exported. Each type of composition places its layers its own way; so far there's `bento` (cells in a tree of splits).

## Build

```sh
npm run dist:win     # dist/Reframe-<version>-win-x64.exe (portable, no installer)
npm run dist:mac     # dist/Reframe-<version>-mac-{arm64,x64}.zip (run on a Mac)
```

Windows builds work from Linux/WSL. Mac builds must run on macOS. The `Build` GitHub Action builds both when you push a `v*` tag, or when you run it by hand.

The Mac build is ad-hoc signed, not notarized. On first launch, right-click the app and choose **Open**, or run `xattr -cr Reframe.app`.

ffmpeg is a static build from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), released under the GPL. It is fetched per platform into `vendor/` at build time.
