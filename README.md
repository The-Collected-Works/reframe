# Reframe

Batch-crop a folder of images and videos into one or more artboard sizes, then export everything at once.

## Use

1. Open (or drop) a folder. Every image and video shows up cropped into the current artboard.
2. With nothing selected, the inspector edits the artboard's **defaults**, which apply to every asset.
3. Select one or more assets to **override** settings. A blue dot marks an override; click the dot to reset that setting.
4. Add more artboards with **+**. Each one keeps its own defaults and overrides. Click the active tab to rename or resize it.
5. **Export** writes `<destination>/<artboard name>/<file>`. Images go out as PNG, JPG or WebP, and videos as H.264 MP4.

Edits autosave to `.reframe.json` inside the folder, so reopening the folder restores them.

| | |
|---|---|
| Drag empty grid space | Box select (**Shift** / **⌘/Ctrl** add to the selection) |
| Drag (grid or single view) | Move. Snaps to edges and centre with guides; **Shift** locks an axis, **Alt** turns snapping off |
| Drag a corner handle | Scale from the opposite corner (**Alt**: from the centre); sticks at 100% |
| Drag just outside a corner | Rotate (**Shift**: 15° steps); right angles are sticky |
| Scroll / pinch (single view) | Zoom about the cursor |
| Double-click (single view) | Reset position, scale and rotation |
| `I` | Eyedropper: click any image or video to set the background to its exact colour |
| `G` / `E` / `Esc` | Grid / single view / back or deselect |
| `←` `→` | Previous / next asset |
| `Space` | Play / pause |
| `⌘/Ctrl` + `Z`, `⇧Z` | Undo / redo |
| `⌘/Ctrl` + `C`, `V` | Copy / paste settings between assets |
| `⌘/Ctrl` + `A`, `E`, `O`, `1–9` | Select all, export, open folder, switch artboard |

## Develop

```sh
npm install
npm run dev        # Linux/macOS/Windows: opens in the local Electron
npm run dev:win    # from WSL: opens as a native Windows window, with hot reload from WSL
```

`dev:win` keeps Windows copies of Electron and ffmpeg in `%LOCALAPPDATA%\Reframe-dev`. Both have to live on the Windows drive: Chromium won't start its GPU process from a `\\wsl.localhost` path, and launching ffmpeg from there takes about 1.4s instead of about 3ms. Dev builds use their own profile (`Reframe Dev`), so they can run alongside the packaged app.

## Build

```sh
npm run dist:win     # dist/Reframe-<version>-win-x64.exe (portable, no installer)
npm run dist:mac     # dist/Reframe-<version>-mac-{arm64,x64}.zip (run on a Mac)
```

Windows builds work from Linux/WSL. Mac builds must run on macOS. The `Build` GitHub Action builds both when you push a `v*` tag, or when you run it by hand.

The Mac build is ad-hoc signed, not notarized. On first launch, right-click the app and choose **Open**, or run `xattr -cr Reframe.app`.

ffmpeg is a static build from [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), released under the GPL. It is fetched per platform into `vendor/` at build time.
