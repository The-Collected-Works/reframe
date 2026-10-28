/**
 * The grid's view filters (View options › Show). Each facet is something every item has exactly one
 * value of; every value is shown unless it's hidden. Within a facet, what's shown adds up; facets
 * narrow each other (hide Images and Variants: what's left is videos that aren't variants).
 */

export type FacetKey = 'item' | 'media' | 'framing' | 'export'

export interface Facet {
  key: FacetKey
  /** Its heading in the menu (Only shows one value of it, then all of it again). */
  label: string
  values: { key: string; label: string; title?: string }[]
}

/** In menu order. Adjustments and Export are about the artboard being edited (they follow the tab). */
export const FACETS: Facet[] = [
  {
    key: 'item',
    label: 'Item',
    values: [
      { key: 'source', label: 'Source files', title: 'The folder’s own files' },
      { key: 'variant', label: 'Variants' },
      { key: 'composition', label: 'Compositions' }
    ]
  },
  {
    key: 'media',
    label: 'Media',
    values: [
      { key: 'image', label: 'Images', title: 'Images, and compositions where nothing moves' },
      { key: 'video', label: 'Videos', title: 'Videos, and compositions with a video in them' }
    ]
  },
  {
    key: 'framing',
    label: 'Adjustments',
    values: [
      { key: 'default', label: 'Default' },
      { key: 'adjusted', label: 'Adjusted' }
    ]
  },
  {
    key: 'export',
    label: 'Export',
    values: [
      { key: 'included', label: 'Included' },
      { key: 'left-out', label: 'Excluded' }
    ]
  }
]

/** A value as it's kept in the hidden list: "facet:value" ("export:left-out"). */
export const valueId = (facet: FacetKey, value: string): string => `${facet}:${value}`

/** Every value's id and label, in menu order. */
export const VALUES = FACETS.flatMap((f) => f.values.map((v) => ({ id: valueId(f.key, v.key), facet: f.key, label: v.label })))
