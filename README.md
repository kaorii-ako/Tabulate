# Tabulate

**Problem:** Open tabs pile up and titles/URLs are weak signals — you can't tell a research tab from a shopping tab without clicking, so bulk cleanup means losing context.
**Solution:** Tabulate reads your open tabs plus a lightweight content signal from each page, sends them in one AI call that groups them into named, summarized clusters, and lets you archive a cluster (saved locally) and reopen the whole set later — all from a full-page dashboard.

An AI-powered tab manager — Chrome extension, Manifest V3, TypeScript.

## What it looks like

Clicking the toolbar icon opens a full-page **dashboard** (served from the
extension itself — no server, works offline) with four views:

- **Overview** — live stats: open tabs, current clusters, archived sessions, total tabs archived, plus recent archives.
- **Clusters** — one AI pass groups every tab in the current window into cards (name, summary, count, favicon strip, **Archive**). Expand a card to act on individual tabs; double-click a name to rename.
- **Archived** — searchable history of past archives; expand any session to see its tabs, open one in a click, **Reopen all**, or **Delete**.
- **Settings** — pick any AI provider, set model + key (show/hide), live config readout, JSON backup/restore, and a danger zone to clear the cache or wipe all sessions.

## Bring your own AI provider

Tabulate isn't tied to one vendor. Settings has a provider dropdown — pick one, set the model, paste the key:

- **Anthropic** (Claude) · **OpenAI** · **Google Gemini** · **Groq** · **OpenRouter** · **DeepSeek** · **Mistral** · **xAI (Grok)** · **Together AI**
- **Custom (OpenAI-compatible)** — any `/chat/completions` endpoint (local LLMs, self-hosted, niche providers): just give it a base URL.

Three request shapes under the hood — Anthropic `/v1/messages`, OpenAI-style `/chat/completions` (covers most), and Gemini `generateContent`. The clustering call runs from the extension's service worker, which has host permissions for all hosts, so it isn't blocked by browser CORS. Provider, model, base URL and key all live in `chrome.storage.local`.

## v0.2 — quality-of-life improvements

Three additions that make the difference between a demo and a tool you'd actually keep:

1. **Quick Switch (`⌘K` / `Ctrl+K`, or `/`)** — a command palette that fuzzy-searches every open tab across all windows by title or host. Arrow keys + Enter jump straight to the tab and focus its window. Finding one tab among 40 no longer means squinting at a strip of favicons.
2. **Editable clusters** — the AI's first guess is a starting point, not a verdict. Expand any cluster to see its tabs, click one to jump to it, or close it inline (`✕`). Double-click a cluster name to rename it. Edits persist to the cache.
3. **Backup & restore** — export all archived sessions to a JSON file from Settings, and import a backup on another machine. Imports merge (timestamp-keyed), so they never clobber existing sessions.

Plus a redesigned dashboard: animated ambient field, glass surfaces, mouse-tracked stat cards, per-cluster color, staggered motion, and keyboard navigation (`1`–`4` switch views).

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

Keys are **never hardcoded**. Two ways to provide one:

- **Settings view (recommended):** dashboard → Settings → pick provider → set model + key → Save. Stored in `chrome.storage.local`.
- **Build-time `.env`:** `cp .env.example .env`, set `ANTHROPIC_API_KEY`, then `npm run build`. Baked into the bundle as a fallback — applies only to the default Anthropic provider.

`.env` is gitignored. A key set in Settings always takes priority.

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
4. All tabs go into **one** request to whichever provider is configured (Anthropic / OpenAI-style / Gemini). A JSON-only system prompt enforces the cluster schema.
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
src/lib/providers.ts   provider registry (Anthropic / OpenAI-style / Gemini / custom)
src/lib/ai.ts          multi-provider call, JSON-only prompt, response parsing
src/background/        service worker: open dashboard, tab collection, signal, clustering, cache
src/dashboard/         full-page app: overview, clusters, archived history, settings
src/icons/             generated 16/48/128 PNGs
```
