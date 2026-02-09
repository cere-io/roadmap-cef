/**
 * Simple file-based cache.
 * Phase 1: JSON file on disk.
 * Phase 2: Swap to Cubbies API (same interface).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(__dirname, 'roadmap-data.json');

export function writeCache(data) {
  // Ensure directory exists
  const dir = dirname(CACHE_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function readCache() {
  if (!existsSync(CACHE_FILE)) return null;

  try {
    const raw = readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getCachePath() {
  return CACHE_FILE;
}
