<!--
  A pill that slides to whichever child matches `selector` inside the nearest positioned container.
  It measures after layout (again whenever `key` changes), and only animates once it has a first
  position.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import type { Attachment } from 'svelte/attachments'

  let { selector, key, class: className = '' }: { selector: string; key: unknown; class?: string } = $props()

  let box = $state<{ x: number; y: number; w: number; h: number } | null>(null)
  let ready = $state(false)

  // Layout offsets (summed up to the host, in case the target sits in its own positioned wrapper),
  // not screen rects: rects include transforms, so measuring while a button is pressed (scaled
  // down) or a popover is scaling in left the pill off-centre.
  const track: Attachment<HTMLElement> = (el) => {
    void key
    const host = el.parentElement!
    const measure = () => {
      const on = host.querySelector<HTMLElement>(selector)
      let x = 0
      let y = 0
      let n: HTMLElement | null = on
      while (n && n !== host) {
        x += n.offsetLeft
        y += n.offsetTop
        n = n.offsetParent as HTMLElement | null
      }
      box = on && n === host ? { x, y, w: on.offsetWidth, h: on.offsetHeight } : null
      if (box && !ready) requestAnimationFrame(() => (ready = true))
    }
    untrack(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    host.querySelectorAll(':scope > *').forEach((c) => ro.observe(c))
    return () => ro.disconnect()
  }
</script>

<span
  aria-hidden="true"
  class={['indicator', className, { ready }]}
  style={box ? `width: ${box.w}px; height: ${box.h}px; transform: translate(${box.x}px, ${box.y}px)` : 'opacity: 0'}
  {@attach track}
></span>
