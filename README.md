# roadmap-cef

Roadmap viewer for the [WIP Roadmap CEF](https://www.notion.so/cere/WIP-Roadmap-CEF-2cbd800083d680c8b22ced2c9c9b1cf2), running on Cere infrastructure.

**Problem:** The current [roadmap app](https://roadmap-six-alpha.vercel.app/) makes 50+ Notion API calls per page load. Slow, fragile, and not on our own stack.

**Solution:** Poll Notion on a schedule, store in Cubbies on DDC, serve via CEF. Frontend loads in one fetch. Every read/write verified by DAC.

## Architecture

```
Notion (editing source)
        │
        ▼  (poll every 15-30 min)
   ┌─────────┐     ┌──────────────┐     ┌──────────────────────┐
   │  Poller  │────▶│  Transformer │────▶│  Cubbies (on DDC)    │
   │ (crawl)  │     │ (parse)      │     │  + DAC verification  │
   └─────────┘     └──────────────┘     └──────────┬───────────┘
                                                    │
                                              ┌─────▼──────┐
                                              │  API / CEF  │  GET /api/roadmap
                                              └─────┬──────┘
                                                    │
                                              ┌─────▼──────┐
                                              │  Frontend   │  React/Vite
                                              └────────────┘
```

**Current state:** File-based cache (`src/cache/file-cache.js`) stands in for Cubbies until the DDC integration is wired up. Same `writeCache` / `readCache` interface — swap is a drop-in.

## What's built (Martijn)

| Component | File | Status |
|-----------|------|--------|
| Notion client | `src/poller/notion-client.js` | Done |
| Poller | `src/poller/poll.js` | Done — recursive tree crawl (depth 5), ~50s for full page |
| Transformer | `src/transformer/transform.js` | Done — Notion blocks → stickies, milestones, lanes |
| Constants | `src/transformer/constants.js` | Done — 24 lanes, 8 quarters |
| File cache | `src/cache/file-cache.js` | Done — temp stand-in for Cubbies, same interface |
| API server | `src/api/server.js` | Done — Express, `/api/roadmap` + `/api/health` |
| Frontend | `src/frontend/` | Done — React/Vite, reads from `/api/roadmap` |

### Frontend
Ported from [Brommah/roadmap](https://github.com/Brommah/roadmap). All Notion API calls stripped. Single `fetch('/api/roadmap')` replaces 50+ proxied calls.

- `App.tsx` — Main app (1186 lines, down from 2808). Rendering, filtering, zoom, drag-drop, modals
- `constants.tsx` — Lane definitions with icons, quarters, wiki links
- `types.ts` — StickyNote, Milestone, Lane, Quarter
- `utils.ts` — Date positioning, lane matching, sorting
- `components/` — Modal, NotesRenderer, StickyCard, Sidebar

## What Sergey needs to build

### 1. Cubbies storage adapter (replaces file cache)
- Expose a Cubbies instance on DDC for the roadmap data
- Implement `writeCache(data)` / `readCache()` against Cubbies REST API
- Drop-in replacement for `src/cache/file-cache.js` — same interface
- Data structure: single JSON document (stickies, milestones, lanes, quarters, _meta)

### 2. DAC verification on writes
- Each poller write produces a DAC receipt (Merkle-tree hash of the snapshot)
- Receipt ID stored in `_meta.dacReceiptId`
- Frontend can display: "data verified at [timestamp], receipt: [id]"

### 3. CEF hosting
- Run the API server as a CEF service instead of standalone Express
- Poller runs as a scheduled CEF task (every 15-30 min)
- Frontend served from CEF or built to static + CDN

### 4. Cron / auto-poll (interim)
- Until CEF scheduling is ready, trigger `npm run poll` via GitHub Action or cron
- Sergey to advise on preferred approach

## Quick start (with file cache stand-in)

```bash
# 1. Clone & install
git clone https://github.com/cere-io/roadmap-cef.git
cd roadmap-cef && npm install

# 2. Poll Notion (writes to file cache, will write to Cubbies later)
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
| GET | `/api/roadmap` | Full roadmap JSON from Cubbies (or file cache fallback) |
| GET | `/api/health` | Cache status, counts, last poll timestamp, DAC receipt |

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
  "_meta": { "polledAt": "...", "sourcePageId": "...", "blockCount": 479, "durationMs": 50000, "dacReceiptId": "..." }
}
```

## Source Notion page

[WIP Roadmap CEF](https://www.notion.so/cere/WIP-Roadmap-CEF-2cbd800083d680c8b22ced2c9c9b1cf2) — default page ID: `2cbd800083d680c8b22ced2c9c9b1cf2`

Override with: `NOTION_API_KEY=<key> node src/poller/poll.js --page-id=<other-page-id>`
