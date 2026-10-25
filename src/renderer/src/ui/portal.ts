/** Moves an element to the end of document.body for as long as it exists. */
export function portal(node: HTMLElement): { destroy(): void } {
  document.body.appendChild(node)
  return { destroy: () => node.remove() }
}
