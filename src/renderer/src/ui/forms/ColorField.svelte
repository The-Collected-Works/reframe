<!-- A hex colour field with a swatch. Commits on Enter or leaving it; anything that isn't a colour is dropped. -->
<script lang="ts">
  import { parseHex } from './color'
  import { middleReset } from './middle-reset'

  let { value, onChange, onReset }: { value: string; onChange: (v: string) => void; onReset?: () => void } = $props()

  let draft = $state<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const hex = parseHex(draft)
    if (hex) onChange(hex)
    draft = null
  }
</script>

<label class="color" {...middleReset(onReset && (() => ((draft = null), onReset())))}>
  <span class="swatch" style:background={value}></span>
  <input
    class="hex"
    value={draft ?? value.replace('#', '').toUpperCase()}
    spellcheck="false"
    oninput={(e) => (draft = e.currentTarget.value)}
    onfocus={(e) => e.currentTarget.select()}
    onblur={commit}
    onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
  />
</label>

<style>
  .color {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control);
    padding: 0 8px 0 4px;
    background: var(--tint-1);
    border-radius: 6px;
  }

  .color:focus-within {
    background: var(--tint-2);
    box-shadow: 0 0 0 1px var(--accent);
  }

  .swatch {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .hex {
    flex: 1;
    background: none;
    border: 0;
    outline: 0;
    font-variant-numeric: tabular-nums;
    text-transform: uppercase;
    min-width: 0;
  }
</style>
