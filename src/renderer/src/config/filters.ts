/**
 * The grid's view filters (View options › Show). Each facet is something every item has exactly one
 * value of; every value is shown unless it's hidden. Within a facet, what's shown adds up; facets
 * narrow each other (hide Images and Variants: what's left is videos that aren't variants).
 */

export type FacetKey = 'item' | 'media' | 'framing' | 'export'

export interface Facet {
  key: FacetKey
  values: { key: string; label: string; title?: string }[]
  /** Its values are about the artboard being edited (they change with the tab): Adjustments. */
  board?: true
}

export const FACETS: Facet[] = [
  {
    key: 'item',
    values: [
      { key: 'source', label: 'Source files', title: 'The folder’s own files' },
      { key: 'variant', label: 'Variants' },
      { key: 'composition', label: 'Compositions' }
    ]
  },
  {
    key: 'media',
    values: [
      { key: 'image', label: 'Images', title: 'Images, and compositions where nothing moves' },
      { key: 'video', label: 'Videos', title: 'Videos, and compositions with a video in them' }
    ]
  },
  {
    key: 'framing',
    board: true,
    values: [
      { key: 'default', label: 'Default' },
      { key: 'adjusted', label: 'Adjusted' }
    ]
  },
  {
    key: 'export',
    board: true,
    values: [
      { key: 'included', label: 'Included in export' },
      { key: 'left-out', label: 'Excluded from export' }
    ]
  }
]

/** A value as it's kept in the hidden list: "facet:value" ("export:left-out"). */
export const valueId = (facet: FacetKey, value: string): string => `${facet}:${value}`

/** Every value's id and label, in menu order. */
export const VALUES = FACETS.flatMap((f) => f.values.map((v) => ({ id: valueId(f.key, v.key), facet: f.key, label: v.label })))
