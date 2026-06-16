import { memo } from 'react'
import type { Grid } from '../lib/csv.ts'

interface Props {
  grid: Grid
  onCellChange: (rowIndex: number, colIndex: number, value: string) => void
  onHeaderChange: (colIndex: number, value: string) => void
  onDeleteRow: (rowIndex: number) => void
}

function DataTableImpl({ grid, onCellChange, onHeaderChange, onDeleteRow }: Props) {
  if (grid.headers.length === 0) {
    return <p className="empty">No data yet. Import a CSV/TSV file or add a row.</p>
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="rownum">#</th>
            {grid.headers.map((h, c) => (
              <th key={c}>
                <input
                  value={h}
                  onChange={(e) => onHeaderChange(c, e.target.value)}
                  aria-label={`Header ${c + 1}`}
                />
              </th>
            ))}
            <th className="actions" />
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, r) => (
            <tr key={r}>
              <td className="rownum">{r + 1}</td>
              {row.map((cell, c) => (
                <td key={c}>
                  <input
                    value={cell}
                    onChange={(e) => onCellChange(r, c, e.target.value)}
                    aria-label={`Cell ${r + 1},${c + 1}`}
                  />
                </td>
              ))}
              <td className="actions">
                <button onClick={() => onDeleteRow(r)} title="Delete row">
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const DataTable = memo(DataTableImpl)
