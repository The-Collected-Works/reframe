<script lang="ts" generics="T extends string">
  import type { IconName } from '../icons'
  import Icon from './Icon.svelte'
  import Indicator from './Indicator.svelte'

  type Option = { value: T; label?: string; icon?: IconName; title?: string; disabled?: boolean }
  let { value, options, onChange }: { value: T; options: Option[]; onChange: (v: T) => void } = $props()
</script>

<div class="seg">
  <Indicator selector=":scope > button.on" key={`${value}/${options.length}`} />
  {#each options as o (o.value)}
    <button title={o.title} disabled={o.disabled} class={{ on: o.value === value }} onclick={() => onChange(o.value)}>
      {#if o.icon}<Icon name={o.icon} size={15} />{/if}{o.label ?? ''}
    </button>
  {/each}
</div>
