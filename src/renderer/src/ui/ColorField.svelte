<script lang="ts">
  import { middleReset } from '../lib/format'

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
