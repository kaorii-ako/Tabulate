import { useCallback, useMemo, useRef, useState } from 'react'
import { DataTable } from './components/DataTable.tsx'
import { parse, serialize, type Delimiter, type Grid } from './lib/csv.ts'

const SAMPLE: Grid = {
  headers: ['name', 'role', 'hours'],
  rows: [
    ['Ada', 'engineer', '12'],
    ['Linus', 'maintainer', '40'],
    ['Grace', 'compiler', '27'],
  ],
}

export default function App() {
  const [grid, setGrid] = useState<Grid>(SAMPLE)
  const [delimiter, setDelimiter] = useState<Delimiter>(',')
  const [filter, setFilter] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const setCell = useCallback((r: number, c: number, value: string) => {
    setGrid((g) => {
      const rows = g.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? value : cell)) : row))
      return { ...g, rows }
    })
  }, [])

  const setHeader = useCallback((c: number, value: string) => {
    setGrid((g) => ({ ...g, headers: g.headers.map((h, j) => (j === c ? value : h)) }))
  }, [])

  const deleteRow = useCallback((r: number) => {
    setGrid((g) => ({ ...g, rows: g.rows.filter((_, i) => i !== r) }))
  }, [])

  const addRow = useCallback(() => {
    setGrid((g) => ({ ...g, rows: [...g.rows, Array(g.headers.length).fill('')] }))
  }, [])

  const addColumn = useCallback(() => {
    setGrid((g) => ({
      headers: [...g.headers, `col${g.headers.length + 1}`],
      rows: g.rows.map((row) => [...row, '']),
    }))
  }, [])

  const onImport = useCallback(async (file: File) => {
    const text = await file.text()
    setGrid(parse(text))
  }, [])

  const onExport = useCallback(() => {
    const blob = new Blob([serialize(grid, delimiter)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = delimiter === '\t' ? 'tabulate.tsv' : 'tabulate.csv'
    a.click()
    URL.revokeObjectURL(url)
  }, [grid, delimiter])

  const view = useMemo<Grid>(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return grid
    return { ...grid, rows: grid.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q))) }
  }, [grid, filter])

  return (
    <div className="app">
      <header>
        <h1>Tabulate</h1>
        <span className="tag">{grid.rows.length} rows · {grid.headers.length} cols</span>
      </header>

      <div className="toolbar">
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void onImport(f)
            e.target.value = ''
          }}
        />
        <button onClick={onExport}>Export</button>
        <button onClick={addRow}>+ Row</button>
        <button onClick={addColumn}>+ Column</button>

        <select value={delimiter} onChange={(e) => setDelimiter(e.target.value as Delimiter)}>
          <option value=",">CSV (,)</option>
          <option value={'\t'}>TSV (tab)</option>
        </select>

        <input
          className="filter"
          placeholder="Filter rows…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <DataTable
        grid={view}
        onCellChange={setCell}
        onHeaderChange={setHeader}
        onDeleteRow={deleteRow}
      />
    </div>
  )
}
