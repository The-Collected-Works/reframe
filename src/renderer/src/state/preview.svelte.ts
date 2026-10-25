import { storedVolume, storeVolume } from './prefs'

/** How videos play in the app (not in exports): the preview volume, shared and remembered. */
class Preview {
  volume = $state.raw(storedVolume())
  /** The volume to unmute back to. */
  private lastVolume = storedVolume() || 0.8

  setVolume(volume: number): void {
    const v = Math.min(1, Math.max(0, volume))
    this.volume = v
    if (v > 0) this.lastVolume = v
    storeVolume(v)
  }

  toggleMute(): void {
    this.setVolume(this.volume > 0 ? 0 : this.lastVolume)
  }
}

export const preview = new Preview()
