// tcgcsv.com CSV parsing for API routes. Same logic as parseCSVText/parseCsv in
// scripts/lib/catalog-sync.mjs (duplicated across the runtime boundary on purpose — that module
// signs into Firebase at import time).
//
// Never split a tcgcsv file on '\n' first: quoted fields (card rules text) contain line breaks,
// and a line-split parse shifts every later column of those rows.

// A whole CSV file → rows of fields, honoring escaped `""` and quoted fields that span lines.
export function parseCSVText(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') { row.push(cur); cur = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else cur += ch
  }
  row.push(cur)
  if (row.some((v) => v !== '')) rows.push(row)
  return rows
}

// Rows as objects keyed by the header row (trimmed values). Read columns by name — TCGplayer's
// column order differs between games and even between groups.
export function parseCsvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCSVText(text)
  if (!header) return []
  const keys = header.map((h) => h.trim())
  return rows.map((cols) => Object.fromEntries(keys.map((k, j) => [k, (cols[j] ?? '').trim()])))
}
