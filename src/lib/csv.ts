// Minimal RFC-4180-ish CSV/TSV parser and serializer.
// Handles quoted fields, escaped quotes (""), embedded newlines and delimiters.

export type Delimiter = ',' | '\t'

export interface Grid {
  headers: string[]
  rows: string[][]
}

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
  const commas = (firstLine.match(/,/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  return tabs > commas ? '\t' : ','
}

export function parse(text: string, delimiter: Delimiter = detectDelimiter(text)): Grid {
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      record.push(field)
      field = ''
    } else if (ch === '\n') {
      record.push(field)
      records.push(record)
      field = ''
      record = []
    } else if (ch === '\r') {
      // swallow; handled by following \n
    } else {
      field += ch
    }
  }

  // flush trailing field/record if non-empty
  if (field.length > 0 || record.length > 0) {
    record.push(field)
    records.push(record)
  }

  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0]
  const width = headers.length
  const rows = records.slice(1).map((r) => normalizeWidth(r, width))
  return { headers, rows }
}

function normalizeWidth(row: string[], width: number): string[] {
  if (row.length === width) return row
  if (row.length > width) return row.slice(0, width)
  return [...row, ...Array(width - row.length).fill('')]
}

export function serialize(grid: Grid, delimiter: Delimiter = ','): string {
  const lines = [grid.headers, ...grid.rows].map((row) =>
    row.map((cell) => escapeCell(cell, delimiter)).join(delimiter),
  )
  return lines.join('\n')
}

function escapeCell(cell: string, delimiter: Delimiter): string {
  if (cell.includes('"') || cell.includes(delimiter) || cell.includes('\n')) {
    return '"' + cell.replace(/"/g, '""') + '"'
  }
  return cell
}
