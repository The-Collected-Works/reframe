<script lang="ts">
  import { middleReset } from './middle-reset'

  let { value, onChange, onReset }: { value: string; onChange: (v: string) => void; onReset?: () => void } = $props()

  let draft = $state<string | null>(null)
  const commit = () => {
    if (draft == null) return
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(draft.trim())
    if (m) {
      const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
      onChange('#' + h.toLowerCase())
    }
    draft = null
  }
</script>

<div class="color" {...middleReset(onReset && (() => ((draft = null), onReset())))}>
  <label class="swatch" style:background={value}>
    <input type="color" {value} oninput={(e) => onChange(e.currentTarget.value)} />
  </label>
  <input
    class="hex"
    value={draft ?? value.replace('#', '').toUpperCase()}
    oninput={(e) => (draft = e.currentTarget.value)}
    onfocus={(e) => e.currentTarget.select()}
    onblur={commit}
    onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
  />
</div>

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
    position: relative;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }

  .swatch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    height: 100%;
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
