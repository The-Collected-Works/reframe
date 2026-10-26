/** A muted video element for drawing from (never shown or heard): previews, scrubbing, trim frames. */
export function silentVideo(src: string): HTMLVideoElement {
  const v = document.createElement('video')
  v.crossOrigin = 'anonymous'
  v.muted = true
  v.playsInline = true
  v.preload = 'auto'
  v.src = src
  return v
}

/** Stops a video and lets go of its file and decoder (dropping the element alone can hold them a while). */
export function releaseVideo(v: HTMLVideoElement): void {
  v.pause()
  v.removeAttribute('src')
  v.load()
}
