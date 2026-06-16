# Tabulate

**Problem:** Open tabs pile up and titles/URLs are weak signals — you can't tell a research tab from a shopping tab without clicking, so bulk cleanup means losing context.
**Solution:** Tabulate reads your open tabs plus a lightweight content signal from each page, sends them in one AI call that groups them into named, summarized clusters, and lets you archive a cluster (saved locally) and reopen the whole set later — all from a full-page dashboard.

An AI-powered tab manager — Chrome extension, Manifest V3, TypeScript.

## What it looks like

Clicking the toolbar icon opens a full-page **dashboard** (served from the
extension itself — no server, works offline) with four views:

- **Overview** — live stats: open tabs, current clusters, archived sessions, total tabs archived, plus recent archives.
- **Clusters** — one AI pass groups every tab in the current window into cards (name, summary, count, favicon strip, **Archive**).
- **Archived** — searchable history of past archives; expand any session to see its tabs, open one in a click, **Reopen all**, or **Delete**.
- **Settings** — API key entry (show/hide), model info, and a danger zone to clear the cache or wipe all sessions.

## Features

- One AI pass clusters every tab in the current window — never one call per tab
- Archive a cluster: saves `{title, url, favicon, summary}` to `chrome.storage.local` under a timestamped session key, then closes those tabs
- Reopen a whole archived session, or any single tab from it
- Result is cached, so reopening the dashboard doesn't re-hit the API — explicit **Re-cluster** to refresh
- Handles 40+ tabs: per-tab content signal is truncated to stay under context limits
- Skips restricted pages gracefully (`chrome://`, extension pages, web store, PDFs, `view-source:`, …) and never clusters its own dashboard tab

## Setup

```bash
npm install
npm run build        # outputs dist/
```

Then load it:

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Click the Tabulate toolbar icon → the dashboard opens in a tab
5. Go to **Settings**, paste your Anthropic API key, **Save**

### API key

The Anthropic key is **never hardcoded**. Two ways to provide it:

- **Settings view (recommended):** dashboard → Settings → paste `sk-ant-...` → Save. Stored in `chrome.storage.local`.
- **Build-time `.env`:** `cp .env.example .env`, set `ANTHROPIC_API_KEY`, then `npm run build`. The key is baked into the bundle.

`.env` is gitignored. The Settings key takes priority over a baked key.

> **Security note:** this is a client-only extension, so the API call runs in the browser and the key lives in browser storage (or the built bundle). Fine for a personal/portfolio build. For anything public, put the Anthropic call behind a small proxy server and never ship the key to the client. Don't publish your `dist/` if you baked a key into it.

## Develop

```bash
npm run dev          # esbuild watch → rebuilds dist/ on change
npm run icons        # regenerate PNG icons from make-icons.mjs
npm run typecheck    # tsc --noEmit
```

After a rebuild, hit the reload icon on the extension card in `chrome://extensions`.

## How it works

1. The toolbar icon has no popup — clicking it tells the background service worker to open (or focus) the dashboard tab.
2. From the dashboard, the Clusters view asks the background worker to cluster.
3. Background queries tabs in the current window and, for each eligible tab, injects a tiny function via `chrome.scripting.executeScript` to read `meta[name=description]` / `og:description` / first heading (truncated). Restricted pages and the extension's own pages are skipped.
4. All tabs go into **one** request to the Anthropic API (`claude-sonnet-4-6`). A JSON-only system prompt enforces the cluster schema.
5. The response is parsed, validated, cached in `chrome.storage.local`, and rendered as cards. Archiving writes a `session_<timestamp>` entry and closes the tabs.

### Cluster schema

```json
{
  "clusters": [
    { "name": "string", "summary": "string", "tabIds": [123, 456] }
  ]
}
```

## Stack

esbuild + vanilla TypeScript/DOM. No UI framework. Icons are generated
dependency-free (`make-icons.mjs`, raw PNG via zlib). MV3 background service
worker handles tab access, the content signal, and the AI call; the dashboard
is a plain HTML/CSS/TS single-page app with hash routing.

## Out of scope (v1)

Multi-window support, cross-browser builds, settings beyond the API key.

## Layout

```
manifest.json          MV3 manifest (action opens dashboard, no popup)
build.mjs              esbuild build (+ .env loader, static + icon copy)
make-icons.mjs         dependency-free PNG icon generator
src/lib/types.ts       shared types + message contracts
src/lib/ai.ts          Anthropic call, JSON-only prompt, response parsing
src/background/        service worker: open dashboard, tab collection, signal, clustering, cache
src/dashboard/         full-page app: overview, clusters, archived history, settings
src/icons/             generated 16/48/128 PNGs
```
