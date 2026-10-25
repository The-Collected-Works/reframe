<!-- An info button that toggles a dropdown with the version and every shortcut. -->
<script lang="ts">
  import { version } from '../../../../../package.json'
  import { ALT, MOD, SHIFT } from '../../lib/keys'
  import Icon from '../../ui/Icon.svelte'
  import Popover from '../../ui/Popover.svelte'

  /** Every shortcut, grouped. Keys are shown as separate chips; " / " separates alternatives. */
  const SHORTCUTS: { title: string; items: [string, string[]][] }[] = [
    {
      title: 'View',
      items: [
        ['Grid / single view', ['E']],
        ['Open selected', ['Space']],
        ['Back to grid, deselect', ['Esc']],
        ['Previous / next asset', ['←', '→']],
        ['Switch artboard', [MOD, '1–9']]
      ]
    },
    {
      title: 'Edit',
      items: [
        ['Copy / paste settings', [MOD, 'C', '/', MOD, 'V']],
        ['Undo / redo', [MOD, 'Z', '/', MOD, SHIFT, 'Z']],
        ['Select all', [MOD, 'A']],
        ['Pick background color', ['I']],
        ['Reset asset to defaults', [MOD, SHIFT, 'R']],
        ['Reset a value', ['Middle-click']]
      ]
    },
    {
      title: 'Single view',
      items: [
        ['Play / pause', ['Space']],
        ['Fit to view', [MOD, '0']],
        ['Zoom in / out', [MOD, '+', '/', MOD, '−']],
        ['Zoom', ['Scroll wheel', '/', 'Pinch']],
        ['Pan', ['Two-finger scroll', '/', 'Middle-drag']],
        ['Scale media', [ALT, 'Scroll']],
        ['Reset transform', ['Double-click']]
      ]
    },
    {
      title: 'While dragging',
      items: [
        ['Stretch (edges, corners)', [SHIFT]],
        ['Scale from center', [ALT]],
        ['Lock axis (move)', [SHIFT]],
        ['15° steps (rotate)', [SHIFT]],
        ['No snapping', [MOD]]
      ]
    },
    {
      title: 'File',
      items: [
        ['Open folder', [MOD, 'O']],
        ['Export', [MOD, 'E']]
      ]
    }
  ]

  let open = $state(false)
</script>

<div class="update-wrap">
  <button
    class={['icon-btn', { on: open }]}
    title="About Reframe and keyboard shortcuts"
    aria-label="About Reframe and keyboard shortcuts"
    onclick={() => (open = !open)}
  >
    <Icon name="info" size={16} />
  </button>
  <Popover {open} onClose={() => (open = false)} class="app-info">
    <div class="app-info-body">
      <header class="app-info-head">
        <span class="release-version">Reframe</span>
        <span class="muted">{version}</span>
      </header>
      <div class="changelog-scroll">
        {#each SHORTCUTS as g (g.title)}
          <section class="keys">
            <h4>{g.title}</h4>
            {#each g.items as [label, keys] (label)}
              <div class="key-row">
                <span>{label}</span>
                <span class="key-combo">
                  {#each keys as k, i (i)}{#if k === '/'}<span class="key-or">/</span>{:else}<kbd>{k}</kbd>{/if}{/each}
                </span>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </Popover>
</div>
