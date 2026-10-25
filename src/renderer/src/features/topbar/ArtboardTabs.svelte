<!--
  The artboard tabs when they overflow: fades on whichever side has more, the wheel scrolls them
  sideways, and click-dragging pans (a click that doesn't move still selects a tab). The active tab
  is kept in view when it changes.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { Attachment } from 'svelte/attachments'
  import { reducedMotion } from '../../lib/motion'
  import { app } from '../../state/app.svelte'

  let { children }: { children: Snippet } = $props()
  let el: HTMLElement
  let fade = $state({ left: false, right: false })
  const count = $derived(app.project.artboards.length)

  // Compares the outermost tabs with the strip's edges rather than scroll arithmetic, which can be
  // off by a fraction of a pixel at fractional display scaling.
  function update() {
    const tabs = el.querySelectorAll('.tab-wrap')
    if (!tabs.length) return (fade = { left: false, right: false })
    const strip = el.getBoundingClientRect()
    fade = {
      left: tabs[0].getBoundingClientRect().left < strip.left - 1,
      right: tabs[tabs.length - 1].getBoundingClientRect().right > strip.right + 1
    }
  }
  // Again whenever the strip or the tabs inside it change size (tabs added, removed, renamed).
  const watchSize: Attachment<HTMLElement> = (node) => {
    const ro = new ResizeObserver(update)
    ro.observe(node)
    void count
    node.querySelectorAll('.tab-wrap').forEach((t) => ro.observe(t))
    return () => ro.disconnect()
  }
  function onwheel(e: WheelEvent) {
    const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX
    if (!d || el.scrollWidth <= el.clientWidth) return
    e.preventDefault()
    el.scrollLeft += d
  }

  const intoView = (tab: Element | null | undefined) =>
    tab?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  $effect(() => {
    void app.boardId
    void count
    intoView(el.querySelector('.tab.on'))
  })

  let swallowClick = false
  const onpointerdown = (e: PointerEvent) => {
    if (e.button !== 0 || el.scrollWidth <= el.clientWidth) return
    const x0 = e.clientX
    const left0 = el.scrollLeft
    let dragging = false
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientX - x0) < 4) return
      if (!dragging) {
        dragging = true
        el.setPointerCapture(e.pointerId)
        el.classList.add('dragging')
      }
      el.scrollLeft = left0 - (ev.clientX - x0)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      if (!dragging) return
      el.classList.remove('dragging')
      swallowClick = true
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  const onclickcapture = (e: MouseEvent) => {
    if (swallowClick) {
      swallowClick = false
      return e.stopPropagation()
    }
    // Any clicked tab (including the active one, which opens its editor) comes fully into view.
    intoView((e.target as Element).closest('.tab'))
  }
</script>

<nav
  bind:this={el}
  class={['tabs', { 'fade-left': fade.left, 'fade-right': fade.right }]}
  {@attach watchSize}
  onscroll={update}
  onscrollend={update}
  {onwheel}
  {onpointerdown}
  {onclickcapture}
>
  {@render children()}
</nav>
