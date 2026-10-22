/** Time of the frame used for a video's thumbnail: early, but past any fade-in. */
export const posterTime = (duration: number): number => (duration > 0 ? Math.min(1, duration * 0.1) : 0)
