# Tabulate

Import, edit, and export CSV/TSV data right in the browser. No server, no upload —
everything stays local.

## Features

- Import `.csv` / `.tsv` with a quote-aware parser (handles embedded commas, quotes, newlines)
- Inline edit of headers and cells
- Add / delete rows, add columns
- Live row filter
- Export back to CSV or TSV

## Stack

Vite + React + TypeScript. Pure client-side.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run preview    # serve the build
```

## Layout

- `src/lib/csv.ts` — parser / serializer (RFC-4180-ish)
- `src/components/DataTable.tsx` — editable grid
- `src/App.tsx` — toolbar, state, import/export wiring
