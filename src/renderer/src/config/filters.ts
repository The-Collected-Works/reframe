/** The grid's view filters (View options › Show). */

export type FilterKey = 'sources' | 'variants' | 'compositions' | 'images' | 'videos' | 'adjusted' | 'excluded'

/**
 * Filters in groups: what an item is, what's in it, what's been done to it. Within a group they add
 * up (images and videos); across groups each narrows the others (variants that are videos).
 */
export const FILTER_GROUPS: FilterKey[][] = [
  ['sources', 'variants', 'compositions'],
  ['images', 'videos'],
  ['adjusted', 'excluded']
]

/** As they're called on screen. */
export const FILTER_LABELS: Record<FilterKey, string> = {
  sources: 'Source files',
  variants: 'Variants',
  compositions: 'Compositions',
  images: 'Images',
  videos: 'Videos',
  adjusted: 'Adjusted',
  excluded: 'Excluded from export'
}
