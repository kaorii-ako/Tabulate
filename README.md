# Tabulate

**Problem:** Open tabs pile up and titles/URLs are weak signals — you can't tell a research tab from a shopping tab without clicking, so bulk cleanup means losing context.
**Solution:** Tabulate reads your open tabs plus a lightweight content signal from each page, sends them in one AI call that groups them into named, summarized clusters, and lets you archive a cluster (saved locally) and reopen the whole set later.

An AI-powered tab manager — Chrome extension, Manifest V3, TypeScript.

## Features

- One AI pass clusters every tab in the current window — never one call per tab
- Each cluster card shows a name, one-line summary, tab count, and favicon strip
- **Archive** a cluster: saves `{title, url, favicon, summary}` to `chrome.storage.local` under a timestamped session key, then closes those tabs
- **Archived Sessions** view: expand any past archive and **Reopen all**
- Result is cached, so reopening the popup doesn't re-hit the API — explicit **Re-cluster** button to refresh
- Handles 40+ tabs: per-tab content signal is truncated to stay under context limits
- Skips restricted pages gracefully (`chrome://`, extension pages, web store, PDFs, `view-source:`, …)

## Setup

```bash
npm install
npm run build        # outputs dist/
```

Then load it:

1. Open `chrome://extensions`
2. Toggle **Developer mode** (top right)
3. **Load unpacked** → select the `dist/` folder
4. Pin Tabulate and open the popup

### API key

The Anthropic key is **never hardcoded**. Two ways to provide it:

- **Options page (recommended):** right-click the icon → *Options*, paste your `sk-ant-...` key, **Save**. Stored in `chrome.storage.local`.
- **Build-time `.env`:** `cp .env.example .env`, set `ANTHROPIC_API_KEY`, then `npm run build`. The key is baked into the bundle.

`.env` is gitignored. The options-page key takes priority over a baked key.

> **Security note:** this is a client-only extension, so the API call runs in the browser and the key lives in browser storage (or the built bundle). Fine for a personal/portfolio build. For anything public, put the Anthropic call behind a small proxy server and never ship the key to the client. Don't publish your `dist/` if you baked a key into it.

## Develop

```bash
npm run dev          # esbuild watch → rebuilds dist/ on change
npm run typecheck    # tsc --noEmit
```

After a rebuild, hit the reload icon on the extension card in `chrome://extensions`.

## How it works

1. Popup asks the background service worker to cluster.
2. Background queries tabs in the current window and, for each eligible tab, injects a tiny function via `chrome.scripting.executeScript` to read `meta[name=description]` / `og:description` / first `<h1>` (truncated). Restricted pages are skipped.
3. All tabs go into **one** request to the Anthropic API (`claude-sonnet-4-6`). A JSON-only system prompt enforces the cluster schema.
4. The response is parsed, validated, cached in `chrome.storage.local`, and rendered as cards.

### Cluster schema

```json
{
  "clusters": [
    { "name": "string", "summary": "string", "tabIds": [123, 456] }
  ]
}
```

## Stack

esbuild + vanilla TypeScript/DOM. No UI framework. MV3 background service worker for tab access and the AI call; popup and options are plain HTML/CSS/TS.

## Out of scope (v1)

Multi-window support, cross-browser builds, settings beyond the API key.

## Layout

```
manifest.json          MV3 manifest
build.mjs              esbuild build (+ .env loader, static copy)
src/lib/types.ts       shared types + message contracts
src/lib/ai.ts          Anthropic call, JSON-only prompt, response parsing
src/background/        service worker: tab collection, content signal, clustering, cache
src/popup/             cluster cards + archived-sessions view
src/options/           API key entry
```
