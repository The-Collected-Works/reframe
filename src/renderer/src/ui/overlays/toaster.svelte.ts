/** A brief confirmation over the content (copy, paste, undo…). Each one restarts the animation. */
let current = $state.raw<{ text: string; n: number } | null>(null)

export const toast = {
  get current() {
    return current
  }
}

export function showToast(text: string): void {
  current = { text, n: (current?.n ?? 0) + 1 }
}
