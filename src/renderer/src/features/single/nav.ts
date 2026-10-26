/**
 * What a wheel event over the single view's stage asks for. Trackpads: pinch zooms (Chromium
 * reports it as a wheel with ctrlKey), two fingers pan. A mouse wheel zooms. Mouse notches come in
 * whole multiples of 120 with no sideways component; once a gesture looks like a trackpad it stays
 * one, so momentum never flips into zooming. Keep one per stage.
 */
export class WheelNav {
  private trackpadUntil = 0

  read(e: WheelEvent, stage: DOMRect): { zoom: number; at: { x: number; y: number } } | { pan: { dx: number; dy: number } } {
    const at = { x: e.clientX - stage.left, y: e.clientY - stage.top }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.height : 1
    const dx = e.deltaX * unit
    const dy = e.deltaY * unit
    const now = performance.now()
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
    const notch = e.deltaMode !== 0 || (e.deltaX === 0 && legacy !== 0 && legacy % 120 === 0)
    if (e.ctrlKey || e.metaKey) return { zoom: Math.exp(-dy * (notch ? 0.0015 : 0.01)), at }
    if (notch && now > this.trackpadUntil) return { zoom: Math.exp(-dy * 0.0015), at }
    this.trackpadUntil = now + 300
    return { pan: { dx: -dx, dy: -dy } }
  }
}
