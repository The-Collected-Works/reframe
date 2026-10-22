#!/bin/sh
# electron-vite spawns this in place of Electron (see dev-win.mjs). Windows processes only see
# variables listed in WSLENV, and an inherited ELECTRON_RUN_AS_NODE would stop the window opening.
unset ELECTRON_RUN_AS_NODE
export WSLENV="ELECTRON_RENDERER_URL/w:REFRAME_FFMPEG/pw"
exec "$REFRAME_ELECTRON_WIN" "$@"
