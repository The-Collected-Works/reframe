<!-- An info button that toggles a dropdown with the version and every shortcut (from keymaps.ts). -->
<script lang="ts">
  import { version } from '../../../../../package.json'
  import { chips } from '../../lib/keymap.svelte'
  import { Button, Kbd, Popover } from '../../ui'
  import { KEYMAPS } from '../keymaps'

  // Each keymap's actions and unsectioned notes, then its notes under their own sub-headings.
  const sections = KEYMAPS.map((m) => {
    const notes = m.notes ?? []
    const subs = [...new Set(notes.flatMap((n) => n.section ?? []))]
    return {
      title: m.title,
      groups: [
        { title: '', rows: [...Object.values(m.actions), ...notes.filter((n) => !n.section)] },
        ...subs.map((t) => ({ title: t, rows: notes.filter((n) => n.section === t) }))
      ]
    }
  })

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
        {#each sections as g (g.title)}
          <section class="keys">
            <h4>{g.title}</h4>
            {#each g.groups as sub (sub.title)}
              {#if sub.title}<h5>{sub.title}</h5>{/if}
              {#each sub.rows as row, r (r)}
                <div class="key-row">
                  <span>{row.label}</span>
                  <span class="key-combo">
                    {#each chips(row) as k, i (i)}{#if k === '/'}<span class="key-or">/</span>{:else}<Kbd>{k}</Kbd>{/if}{/each}
                  </span>
                </div>
              {/each}
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

  h5 {
    margin: 6px 0 2px;
    font-size: 11px;
    font-weight: 500;
    color: var(--faint);
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
