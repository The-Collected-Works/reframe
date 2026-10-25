/** One run of release-note text: plain, **bold** or `code`. */
export type Span = { text: string; style?: 'strong' | 'code' }
export type Block = { kind: 'h' | 'p'; spans: Span[] } | { kind: 'ul'; items: Span[][] }

/**
 * Release notes, from GitHub Markdown: headings, bullet and numbered lists, paragraphs, bold and
 * inline code. Parsed into plain data (rendered as text, never HTML), so whatever the notes contain
 * is just text; links show their text, and raw HTML tags are dropped.
 */
export function parseNotes(text: string): Block[] {
  const blocks: Block[] = []
  let list: string[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', spans: inline(para.join(' ')) })
    if (list.length) blocks.push({ kind: 'ul', items: list.map(inline) })
    para = []
    list = []
  }
  for (const raw of text.replace(/<[^>]*>/g, '').split(/\r?\n/)) {
    const line = raw.trim()
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    const item = /^(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (!line) flush()
    else if (heading) {
      flush()
      blocks.push({ kind: 'h', spans: inline(heading[1]) })
    } else if (item) {
      if (para.length) flush()
      list.push(item[1])
    } else if (list.length) list[list.length - 1] += ' ' + line
    else para.push(line)
  }
  flush()
  return blocks
}

/** **bold**, `code` and [text](url) → text. GitHub links shrink to "#12" or "v0.1.0…v0.2.0". */
function inline(raw: string): Span[] {
  const text = raw
    .replace(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/(\d+)/g, '#$1')
    .replace(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/compare\/(\S+?)\.\.\.(\S+)/g, '$1…$2')
  const out: Span[] = []
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]*\)/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    if (m[1] != null) out.push({ text: m[1], style: 'strong' })
    else if (m[2] != null) out.push({ text: m[2], style: 'code' })
    else out.push({ text: m[3] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
