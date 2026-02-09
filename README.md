# roadmap-cef

CEF-powered roadmap viewer for the [WIP Roadmap CEF](https://www.notion.so/cere/WIP-Roadmap-CEF-2cbd800083d680c8b22ced2c9c9b1cf2) Notion page.

**Problem:** The current [roadmap app](https://roadmap-six-alpha.vercel.app/) makes 50+ Notion API calls on every page load via a server-side proxy. Slow, fragile, and burns Notion rate limits.

**Solution:** Poll Notion once, cache the result, serve a single JSON endpoint. Frontend loads in one fetch.

## Architecture

```
Notion (source of truth)
        │
        ▼
   ┌─────────┐     ┌──────────────┐     ┌────────────┐
   │  Poller  │────▶│  Transformer │────▶│   Cache    │
   │ (crawl)  │     │ (parse)      │     │ (JSON/disk)│
   └─────────┘     └──────────────┘     └─────┬──────┘
                                               │
                                         ┌─────▼──────┐
                                         │  API Server │  GET /api/roadmap
                                         └─────┬──────┘
                                               │
                                         ┌─────▼──────┐
                                         │  Frontend   │  React/Vite
                                         └────────────┘
```

**Phase 2 swap:** Replace file cache with Cubbies API on DDC. Same interface, distributed + verifiable storage.

## What's built (Martijn)

| Component | File | Status |
|-----------|------|--------|
| Notion client | `src/poller/notion-client.js` | Done |
| Poller | `src/poller/poll.js` | Done — recursive tree crawl (depth 5), ~50s for full page |
| Transformer | `src/transformer/transform.js` | Done — Notion blocks → stickies, milestones, lanes |
| Constants | `src/transformer/constants.js` | Done — 24 lanes, 8 quarters |
| File cache | `src/cache/file-cache.js` | Done — JSON read/write, designed for Cubbies swap |
| API server | `src/api/server.js` | Done — Express, `/api/roadmap` + `/api/health` |
| Frontend | `src/frontend/` | Done — React/Vite, reads from `/api/roadmap` |

### Frontend details
Ported from [Brommah/roadmap](https://github.com/Brommah/roadmap). All Notion API calls stripped out. Single `fetch('/api/roadmap')` replaces 50+ proxied calls.

- `App.tsx` — Main app (1186 lines, down from 2808). All rendering, filtering, zoom, drag-drop, modals
- `constants.tsx` — Lane definitions with icons, quarters, wiki links
- `types.ts` — StickyNote, Milestone, Lane, Quarter
- `utils.ts` — Date positioning, lane matching, sorting
- `components/` — Modal, NotesRenderer, StickyCard, Sidebar

**Tested:** Build passes. API serves cached data. Frontend renders from single endpoint.

## What Sergey needs to build

### 1. Cubbies storage adapter (replaces file cache)
- Expose a Cubbies instance for the roadmap data
- REST API endpoint that accepts the same JSON structure the poller outputs
- Read endpoint that returns the full cached object (or a query pattern if preferred)
- This is the file-cache.js swap — same `writeCache(data)` / `readCache()` interface, backed by Cubbies on DDC

### 2. DAC verification on cache writes
- Each poller write should produce a DAC receipt (Merkle-tree hash of the roadmap snapshot)
- Receipt ID stored in the `_meta` object alongside `polledAt`, `blockCount`, etc.
- Enables: "this roadmap data was verified at [timestamp] and hasn't been tampered with"

### 3. CEF hosting (optional, later)
- Run the API server + poller as a V8 isolate on CEF instead of a standalone Node process
- Not blocking — the current Express server works fine for now

### 4. Cron / auto-poll
- Trigger `npm run poll` on a schedule (every 15-30 min)
- Could be a GitHub Action, a CEF scheduled task, or a simple cron on the Mac Mini
- Sergey to advise on preferred approach for CEF-native scheduling

## Quick start

```bash
# 1. Clone & install
git clone https://github.com/cere-io/roadmap-cef.git
cd roadmap-cef && npm install

# 2. Poll Notion (generates cache)
NOTION_API_KEY=<key> npm run poll

# 3. Run everything (API + frontend dev server)
npm run dev
# API:      http://localhost:3001/api/roadmap
# Frontend: http://localhost:3000

# Or run separately:
npm run dev:api   # API on :3001
npm run dev:ui    # Vite dev on :3000 (proxies /api → :3001)

# Production build
npm run build     # Outputs to dist/
npm run start     # Serves API + built frontend on :3001
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/roadmap` | Full roadmap JSON (stickies, milestones, lanes, quarters) |
| GET | `/api/health` | Cache status, sticky/milestone counts, last poll timestamp |

## Data model

```json
{
  "stickies": [{
    "id": "...", "title": "...", "owner": "...",
    "laneId": "lane-a1", "quarterId": "2026-Q1",
    "status": "green|yellow|red", "deliveryDate": "2026-03-15",
    "blocker": "...", "wikiUrl": "...",
    "milestoneId": "...", "milestoneTitle": "...", "notes": "..."
  }],
  "milestones": [{ "id": "...", "title": "...", "quarterId": "...", "date": "...", "status": "..." }],
  "lanes": [{ "id": "...", "title": "...", "group": "..." }],
  "quarters": [{ "id": "...", "label": "...", "year": 2026 }],
  "_meta": { "polledAt": "...", "sourcePageId": "...", "blockCount": 479, "durationMs": 50000 }
}
```

## Source Notion page

[WIP Roadmap CEF](https://www.notion.so/cere/WIP-Roadmap-CEF-2cbd800083d680c8b22ced2c9c9b1cf2) — default page ID: `2cbd800083d680c8b22ced2c9c9b1cf2`

Override with: `NOTION_API_KEY=<key> node src/poller/poll.js --page-id=<other-page-id>`
