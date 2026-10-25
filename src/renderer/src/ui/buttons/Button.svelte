<!--
  Every button in the app, in one of a few looks:
  - `ghost`: text (with an optional icon), no surface until hovered
  - `primary`: the main action, an accent tint
  - `icon`: a square icon button (`round` for the circular ones over media)
  - `tool`: a tinted square, for tool rows
  - `chip`: small and tinted, for quick picks
  `pressed` marks a toggle that's on (or what it opens being open); `tone` colours it for a
  destructive action (`danger`) or a mode that's armed (`accent`); `dot` adds an accent dot in the
  corner (something is filtered, say); `block` makes it full width, content centred. Other
  attributes (title, disabled, onclick…) go on the button.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import Icon from '../icons/Icon.svelte'
  import type { IconName } from '../icons/icons'

  type Props = HTMLButtonAttributes & {
    variant?: 'ghost' | 'primary' | 'icon' | 'tool' | 'chip'
    icon?: IconName
    iconSize?: number
    pressed?: boolean
    tone?: 'danger' | 'accent'
    round?: boolean
    dot?: boolean
    block?: boolean
    children?: Snippet
  }
  let {
    variant = 'ghost',
    icon,
    iconSize = 16,
    pressed = false,
    tone,
    round = false,
    dot = false,
    block = false,
    children,
    class: className,
    ...rest
  }: Props = $props()
</script>

<button class={['button', variant, tone, { pressed, round, dot, block }, className]} {...rest}>
  {#if icon}<Icon name={icon} size={iconSize} />{/if}{@render children?.()}
</button>

<style>
  .button {
    position: relative;
    border-radius: var(--radius);
    color: var(--muted);
    transition:
      background-color var(--t-fast) var(--ease),
      color var(--t-fast) var(--ease),
      box-shadow var(--t-fast) var(--ease),
      transform var(--t-fast) var(--ease),
      opacity var(--t-fast) var(--ease);
  }

  .button:active:not(:disabled) {
    transform: scale(0.95);
  }

  .ghost,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--control);
    padding: 0 10px;
  }

  .ghost:hover:not(:disabled),
  .icon:hover:not(:disabled) {
    color: var(--text);
    background: var(--tint-2);
  }

  /* The main action: an accent tint (like the destructive red, in blue), not a solid fill. */
  .primary {
    padding: 0 14px;
    background: rgba(110, 155, 255, 0.18);
    color: #a8c2ff;
    font-weight: 600;
  }

  .primary:has(:global(svg)) {
    padding-left: 11px;
  }

  .primary:hover:not(:disabled) {
    background: rgba(110, 155, 255, 0.28);
    color: #c3d5ff;
  }

  .icon {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: var(--control);
    height: var(--control);
  }

  .icon.pressed {
    color: var(--text);
    background: var(--tint-2);
  }

  /* Over media: circular, and bright. */
  .icon.round {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--text);
  }

  .tool {
    display: grid;
    place-items: center;
    height: var(--control);
    background: var(--tint-1);
  }

  .tool:hover {
    color: var(--text);
    background: var(--tint-2);
  }

  .tool.pressed {
    color: var(--text);
    background: var(--tint-3);
  }

  .chip {
    height: 26px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--tint-1);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .chip:hover {
    color: var(--text);
    background: var(--tint-2);
  }

  .chip.pressed {
    color: var(--text);
    background: var(--tint-3);
  }

  .block {
    width: 100%;
    justify-content: center;
  }

  /* Destructive: highlights in its own colour, like destructive menu items. */
  .danger,
  .danger:hover:not(:disabled) {
    color: var(--danger);
  }

  .danger:hover:not(:disabled) {
    background: rgba(255, 107, 107, 0.12);
  }

  /* Armed (the eyedropper while it's picking). */
  .accent {
    color: var(--accent);
  }

  .dot::after {
    content: '';
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
</style>
