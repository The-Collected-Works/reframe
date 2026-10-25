<script lang="ts">
  import { FILLED, ICONS, type IconName } from './icons'

  let { name, size = 16 }: { name: IconName; size?: number } = $props()
  const Glyph = $derived(ICONS[name])
</script>

<Glyph {size} strokeWidth={1.4} absoluteStrokeWidth fill={FILLED.has(name) ? 'currentColor' : 'none'} />
