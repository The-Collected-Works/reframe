<!-- An info button that toggles a dropdown with the version and every shortcut. -->
<script lang="ts">
  import { version } from '../../../../../package.json'
  import { ALT, MOD, SHIFT } from '../../lib/keys'
  import { Button, Kbd, Popover } from '../../ui'

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

<div class="anchor">
  <Button
    variant="icon"
    icon="info"
    pressed={open}
    title="About Reframe and keyboard shortcuts"
    aria-label="About Reframe and keyboard shortcuts"
    onclick={() => (open = !open)}
  />
  <Popover {open} onClose={() => (open = false)} padding={0}>
    <div class="body">
      <header>
        <span class="release-version">Reframe</span>
        <span class="muted">{version}</span>
      </header>
      <div class="scroll">
        {#each SHORTCUTS as g (g.title)}
          <section class="keys">
            <h4>{g.title}</h4>
            {#each g.items as [label, keys] (label)}
              <div class="key-row">
                <span>{label}</span>
                <span class="key-combo">
                  {#each keys as k, i (i)}{#if k === '/'}<span class="key-or">/</span>{:else}<Kbd>{k}</Kbd>{/if}{/each}
                </span>
              </div>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  </Popover>
</div>

<style>
  .anchor {
    display: inline-flex;
    flex-shrink: 0;
  }

  .body {
    width: 320px;
    display: flex;
    flex-direction: column;
    padding: 6px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 6px;
    padding: 6px 6px 8px 12px;
    margin: 0 -6px 4px;
    border-bottom: 1px solid var(--line);
  }

  .release-version {
    font-weight: 600;
  }

  /* Its scrollbar is always shown, so it's clear there's more below. */
  .scroll {
    max-height: min(380px, calc(100vh - 160px));
    overflow-y: auto;
    padding: 4px 4px 2px 6px;
  }

  .scroll::-webkit-scrollbar-thumb {
    background-color: var(--line-strong);
  }

  .keys + .keys {
    margin-top: 10px;
  }

  h4 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }

  .key-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 24px;
  }

  .key-combo {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .key-or {
    color: var(--faint);
    padding: 0 1px;
  }
</style>
