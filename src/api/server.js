/**
 * API server for the roadmap app.
 *
 * Serves pre-cached roadmap data from a single endpoint.
 * No Notion proxy needed — all data is pre-fetched by the poller.
 */

import express from 'express';
import cors from 'cors';
import { readCache } from '../cache/file-cache.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());

// Single endpoint: return all roadmap data
app.get('/api/roadmap', (req, res) => {
  const data = readCache();

  if (!data) {
    return res.status(503).json({
      error: 'No cached data available. Run the poller first: npm run poll',
    });
  }

  res.json(data);
});

// Health check
app.get('/api/health', (req, res) => {
  const data = readCache();
  res.json({
    status: 'ok',
    hasCachedData: !!data,
    polledAt: data?._meta?.polledAt || null,
    stickies: data?.stickies?.length || 0,
    milestones: data?.milestones?.length || 0,
  });
});

// Serve static frontend in production
const distPath = path.join(__dirname, '../../dist');
app.use(express.static(distPath));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);
  console.log(`[api] Roadmap data: http://localhost:${PORT}/api/roadmap`);
  console.log(`[api] Health check: http://localhost:${PORT}/api/health`);
});
