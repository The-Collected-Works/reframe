<script lang="ts">
  /** `mixed`: some of what it stands for is on and some off; turning it on turns all on. */
  let { value, mixed = false, onChange }: { value: boolean; mixed?: boolean; onChange: (v: boolean) => void } = $props()
</script>

<button
  class={['toggle', { on: value && !mixed, mixed }]}
  role="switch"
  aria-checked={mixed ? 'mixed' : value}
  aria-label="Toggle"
  onclick={() => onChange(mixed || !value)}
></button>

<style>
  .toggle {
    position: relative;
    width: 28px;
    height: 16px;
    border-radius: 8px;
    background: var(--line-strong);
    flex-shrink: 0;
  }

  .toggle::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    /* Pill, not circle (radius = half the height), so pressing stretches it into a longer pill. */
    border-radius: 6px;
    background: var(--muted);
  }

  .toggle,
  .toggle::after {
    transition: background-color 220ms var(--ease), transform 260ms var(--spring), width 260ms var(--spring);
  }

  .on {
    background: var(--accent);
  }

  .on::after {
    transform: translateX(12px);
    background: #fff;
  }

  /* Some on, some off: half-lit, the knob in the middle. */
  .mixed {
    background: color-mix(in srgb, var(--accent) 45%, var(--line-strong));
  }

  .mixed::after {
    transform: translateX(6px);
    background: #fff;
  }

  .toggle:active::after {
    width: 15px;
  }

  .on:active::after {
    transform: translateX(9px);
  }
</style>
