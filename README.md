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
                                         │  Frontend   │  (not ported yet)
                                         └────────────┘
```

**Phase 2 swap:** Replace file cache with Cubbies API on DDC. Same interface, distributed + verifiable storage.

## What's built (Martijn)

| Component | File | Status |
|-----------|------|--------|
| Notion client | `src/poller/notion-client.js` | Done — zero-dependency fetch client with pagination |
| Poller | `src/poller/poll.js` | Done — recursive tree crawl (depth 5), ~50s for full page |
| Transformer | `src/transformer/transform.js` | Done — converts Notion blocks → stickies, milestones, lanes |
| Constants | `src/transformer/constants.js` | Done — 24 lanes, 8 quarters (mirrored from original app) |
| File cache | `src/cache/file-cache.js` | Done — JSON read/write, designed for Cubbies swap |
| API server | `src/api/server.js` | Done — Express, single `/api/roadmap` endpoint |

**Tested:** Poller crawls 479 blocks, transformer outputs 13 stickies + 1 milestone. API serves cached data correctly.

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

## What's left (Martijn)

### Frontend port
The current frontend ([Brommah/roadmap](https://github.com/Brommah/roadmap)) is a React/Vite app that parses Notion blocks client-side in a massive `App.tsx`. Need to:
- Strip out all Notion API proxy calls
- Replace with single `fetch('/api/roadmap')`
- Data model already matches — stickies, milestones, lanes, quarters are identical types

### Polish transformer
- Some stickies may be missed if Notion structure varies (synced blocks, nested toggles)
- Compare output against live roadmap and fix edge cases

## Quick start

```bash
# 1. Clone
git clone https://github.com/cere-io/roadmap-cef.git
cd roadmap-cef

# 2. Install
npm install

# 3. Set env
cp .env.example .env
# Add your Notion API key to .env

# 4. Poll Notion (generates cache)
NOTION_API_KEY=<key> npm run poll

# 5. Serve API
npm run serve
# → http://localhost:3001/api/roadmap
# → http://localhost:3001/api/health
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/roadmap` | Full roadmap JSON (stickies, milestones, lanes, quarters) |
| GET | `/api/health` | Cache status, sticky/milestone counts, last poll timestamp |

## Data model

The transformer outputs:

```
{
  stickies: [{
    id, title, owner, laneId, quarterId,
    status (green/yellow/red), deliveryDate,
    blocker, wikiUrl, milestoneId, milestoneTitle, notes
  }],
  milestones: [{ id, title, quarterId, date, status }],
  lanes: [{ id, title, group }],
  quarters: [{ id, label, year }],
  _meta: { polledAt, sourcePageId, blockCount, durationMs }
}
```

## Source Notion page

[WIP Roadmap CEF](https://www.notion.so/cere/WIP-Roadmap-CEF-2cbd800083d680c8b22ced2c9c9b1cf2) — default page ID: `2cbd800083d680c8b22ced2c9c9b1cf2`

Override with: `NOTION_API_KEY=<key> node src/poller/poll.js --page-id=<other-page-id>`
