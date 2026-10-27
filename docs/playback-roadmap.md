# Playback: where it stands, and what's next

Notes for picking up work on the `grids` branch on another machine. Everything here was measured in the Windows Electron dev build (`npm run dev:win` from WSL) on a Ryzen 9 7950X (32 threads) with an RTX 4090, using 4K60 H.264 game captures at 90–136 Mbps with a keyframe every ~4.2s. Those are the files this was tuned for, and the worst case for browser playback.

## How playback works now

Everything that plays video goes through `src/renderer/src/lib/playback/`: the single view, compositions and the grid's hover previews (a one-track `Player`). One player bar (`features/single/PlayerBar.svelte`) serves videos and compositions.

The engine is plain TypeScript with no Svelte inside. It's told what to do through methods, and it says when something changed through change signals (`emitter.ts`). The media worker comes in as an interface (`host.ts`), so the engine runs in Node against fakes: `npm test` runs its unit tests. `state/playback.svelte.ts` is the one place it meets Svelte:
- the app's single `Copies` store, wrapped so each read follows what it depends on (what's made or wanted, and for progress, each step);
- `Player`, a `Playback` for components, with its outputs as reactive state and one effect per input (tracks, range, sound, hold).

- **`copies.ts`** knows which playback copies exist and decides what's made next.
  - Copies are 960 and 1920px on the long side, capped at the source's size.
  - Every frame is a keyframe, at the source frame rate (up to 60), H.264 High 4.2, CRF 20, lanczos scaling, converted to BT.709 as export converts.
  - They're made one at a time by the media worker, in priority order: `NOW` (on screen) < `SOON` (filmstrip neighbours) < sharper copies of what's on screen < `LATER` (every other video in the folder, made ahead of time at low CPU priority).
  - A more urgent copy stops a less urgent one. While anything plays or scrubs, and for 2s after, only `NOW` copies are made.
  - Copies are kept on disk between sessions (`<userData>/posters/copies`, 8 GB, least recently used first). When a folder opens, one call looks up which are already made.
- **`stream.ts`** plays a copy while it's still being made. The worker writes a video's first copy twice from one encode (ffmpeg's `tee` muxer): the normal file, plus a fragmented MP4 in quarter-second fragments. `StreamFeed` reads the growing file through the `media:` protocol using byte ranges and feeds it to a `MediaSource`.
- **`clip.ts`** is one video's pictures from whatever source it's given:
  - only the newest seek target is kept;
  - the last frame is held during a seek, captured asynchronously and only just before seeking;
  - a new source takes over only once it has the right frame, so there's never a gap.
- **`playback.ts`** is one clock with any number of tracks: a single video is one track, a composition is one per video layer.
  - Each track's source, in order of preference: its best copy for its size on screen, then the stream of its copy being made, then (single view only) the original.
  - Sound plays from the original file through a separate `Audio` element.
  - Exact frames come from ffmpeg when paused, but only when no copy is sharp enough (zoomed in past 1920).
  - Scrubbing shows a second clip on the smallest copy.
- The worker side is `src/main/ffmpeg.ts`: `copy`, `copiesMade`, `cancelCopy`, `frame` (tagged, so a newer request replaces an older one), `cacheSize`, `clearCache`.
- The UI that shows this work:
  - a progress ring on thumbnails while a copy is made;
  - "Preparing…" above the player bars;
  - "Preparing videos N of M" in the title bar;
  - a green cache line on each timeline's rail;
  - right-click the folder name for Open in Explorer and Clear Cache.

### Numbers to keep (four 4K60 clips)

| | Page fps | Distinct pictures/s |
|---|---|---|
| Composition of four, playing | 144 | 60–72 |
| Composition, scrubbing | 113 | 53 |
| Single video from its copy | 109–137 | 45–60 |
| Single video, scrubbing | 133 | 58 |
| Single video with no copy (streaming) | – | 59–61 from the first second |

A 15s capture's 960 copy takes ~2.6s to make. The limit is decoding the 4K source, not encoding.

## Already ruled out

- **GPU encoding for copies (NVENC).** It halves CPU time (18 vs 38 CPU-seconds for a 37s capture), but wall-clock time is the same (~9.5s), because decoding 4K60 at ~235 fps is the floor either way. NVENC's all-intra files are also 4–5× larger (273 MB vs 59 MB). NVENC also refuses `-g 1`; an all-intra stream needs `-g 2 -bf 0 -forced-idr 1 -force_key_frames expr:1`.
- **Exact frames on every pause.** Decoding the 4K original with ffmpeg on every pause, scrub settle and zoom ate CPU and produced a stream of cancelled-request errors. Copies are colour-accurate, so their own frame is used unless you've zoomed past them.
- **Copies cleared on quit.** Tried, then reverted at the user's request: keeping them means a folder opened again plays at once.

## Improvements, most valuable first

### 1. Split the engine into a plain TypeScript core and one Svelte adapter (done)

Done on 2026-10-26: see "How playback works now" above. What changed:
- `Copies`, `Clip`, `StreamFeed` and `Playback` are ordinary classes. Inputs arrive through methods; outputs leave through `changed` (and `Copies.progressed`, kept apart so progress never re-picks sources: the cause of `bbaf853`). `Copies.changed` is batched to one notification per microtask, so listeners never run in the middle of the change that set them off.
- The store's queue is worked out once per change, not on every read.
- The worker, video elements, the clock and timers are passed in (`MediaHost`, `ClipLike`, `Scheduler`, `StreamEnv`).
- Tests (`*.test.ts` beside each file, fakes in `lib/playback/test/`) cover queue priority and preemption, the 2s idle hold, finding earlier copies, status and progress, lost and failed copies, source choice (copy, stream, original, sharper), clock sync with loop and hold, steady playback through copy progress, re-renders, scrubbing, holding, and `StreamFeed` with 404, 416, new bytes and a full buffer.

### 2. Put sound in the copies

**Now:** copies are silent (`-an`). The single view plays sound from a second element reading the 136 Mbps original, and re-seeks it whenever it drifts more than 0.2s, which is audible.
**Do:** add a small AAC track to copies (`-c:a aac -b:a 128k`, about 1% of the file), then play sound from the copy's own video element, unmuted, in the single view. Pictures and sound then share a clock, and the separate original read goes away.
**Watch for:**
- the cache key needs a new version (`copy1` → `copy2` in `copyPath`);
- the streamed fMP4 then carries two tracks, so `StreamFeed`'s MIME type becomes `video/mp4; codecs="avc1.64002A, mp4a.40.2"`;
- composition sound (mixing layers via Web Audio) builds on this.

**Files:** `main/ffmpeg.ts` (`buildCopy`), `lib/playback/stream.ts`, `lib/playback/playback.ts` (`updateSound`, `sync`), `lib/playback/clip.ts` (videos are `silentVideo`s now).

### 3. Make more than one copy at a time (done)

Done on 2026-10-26. `Copies` runs up to `slots` copies at once: `state/playback.svelte.ts` gives it one per 12 threads (2 on a 32-thread machine, 1 on 16 or fewer, at most 3). Each first copy streams on its own, and with every slot busy, something more urgent stops only the least urgent copy. The worker no longer queues copies (the renderer decides how many run), and `cancelCopy(id)` stops one by the renderer's id. Not yet measured on the 4K captures this was tuned for.

### 4. Key the cache by content, not path (done)

Done on 2026-10-26. Copies and posters are named by the file's size and a hash of 64 KB from its start, middle and end, read once per file per session. Moving, renaming or a sync service reorganising a folder keeps them. Ones made under the old path-based names are renamed the first time they're looked up.

### 5. Scrubbing past the cache line

**Now:** while a copy streams, scrubbing ahead of the green line holds the last frame until the encoder reaches that point. That's usually a second or two, but long videos can make you wait.
**Do (only if it's hit in practice):** when a scrub settles well past what's encoded, start a second encode from that point (`-ss`), as its own stream, and switch the clip to it. Its timestamps need offsetting (`timestampOffset` on the `SourceBuffer`, or `-output_ts_offset`).

### 6. The playback buffer while streaming

**Now:** `StreamFeed.append` handles `QuotaExceededError` by removing everything more than 10s behind the playhead. Scrubbing back into that removed section waits until the finished copy takes over.
**Do:** probably nothing until videos of several minutes are common. If they are, keep a window around the playhead and re-fetch removed ranges (the stream is a file, so they can be read again).

### 7. Exact frames past the sharpest copy

**Now:** zoomed in beyond 1920, a paused frame is decoded from the 4K original by ffmpeg on the CPU (~0.3–1s).
**Do:** add `-hwaccel auto` to `grabFrame`, or make a full-resolution all-intra copy only when someone zooms that far.

### 8. Commit the test harness (done)

Done on 2026-10-26, as `npm run e2e` (`scripts/e2e/`): it builds, makes its test media with the bundled ffmpeg, and drives the app over the DevTools protocol with real input events. There are three suites: the grid, the single view (playback in every codec, scrubbing, trimming, the gizmo, export), and compositions. It runs on Linux (in `xvfb-run`) and should run as is on Windows and macOS (it launches the platform's Electron from `node_modules`). Not yet in it: the 4K timing numbers above (it has `Page.pictures()` for pictures per second, but its media is small), and driving a Windows Electron from WSL.

## Other open threads

- **Finer control over arrangements.** The user wants to define compositions more precisely than the bento's split tree allows. The ideas discussed were a column-and-row grid where cells span tracks, typed-in sizes, and saved templates per artboard. Not started. The column-and-row grid fits as a second composition type next to `bento`.
- **Composition sound.** Compositions are silent in preview and export. It depends on #2 (sound in the copies).
- **An unreproduced bug.** The user once saw playback stop after "deleting an asset from the grid". Removing cells and deleting a variant used by a composition were both tested, and work. It may have been the rescan bug fixed in `4a90136`. If it comes back, get the exact steps.
- **Clear Cache is global.** It clears every folder's copies, not just the open one's. Fine for now; per-folder would need copies grouped by folder.
