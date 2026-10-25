/** Text for numbers the app shows: times, file sizes, counts. */

export const fmtTime = (t: number): string => {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}

export const fmtSize = (bytes: number): string =>
  bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : bytes >= 1e6
      ? `${(bytes / 1e6).toFixed(bytes >= 1e8 ? 0 : 1)} MB`
      : `${Math.max(1, Math.round(bytes / 1e3))} KB`

/** "1 asset", "3 assets". */
export const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`
