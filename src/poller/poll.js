#!/usr/bin/env node

/**
 * Notion Roadmap Poller
 *
 * Crawls the CEF roadmap page from Notion, flattens the block tree,
 * and writes structured JSON to the cache directory.
 *
 * Usage:
 *   NOTION_API_KEY=xxx node src/poller/poll.js
 *   NOTION_API_KEY=xxx node src/poller/poll.js --page-id=<custom-id>
 *
 * Output: src/cache/roadmap-data.json
 */

import { createNotionClient } from './notion-client.js';
import { transformBlocks } from '../transformer/transform.js';
import { writeCache } from '../cache/file-cache.js';

const DEFAULT_PAGE_ID = '2cbd800083d680c8b22ced2c9c9b1cf2';

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('Error: NOTION_API_KEY environment variable is required');
    process.exit(1);
  }

  // Parse optional page ID from args
  const pageIdArg = process.argv.find(a => a.startsWith('--page-id='));
  const pageId = pageIdArg ? pageIdArg.split('=')[1] : DEFAULT_PAGE_ID;
  const formattedId = formatId(pageId);

  console.log(`[poll] Starting Notion crawl for page: ${pageId}`);
  const startTime = Date.now();

  const notion = createNotionClient(apiKey);

  // Step 1: Crawl the full block tree
  console.log('[poll] Fetching top-level blocks...');
  const topBlocks = await notion.getBlockChildren(formattedId);
  console.log(`[poll] Found ${topBlocks.length} top-level blocks`);

  // Step 2: Recursively fetch children for blocks that have them
  console.log('[poll] Crawling nested blocks...');
  const fullTree = await crawlTree(notion, topBlocks, 0, 5);

  // Step 3: Transform into roadmap data model
  console.log('[poll] Transforming to roadmap data model...');
  const roadmapData = transformBlocks(fullTree);

  // Step 4: Write to cache
  const metadata = {
    polledAt: new Date().toISOString(),
    sourcePageId: pageId,
    blockCount: countBlocks(fullTree),
    durationMs: Date.now() - startTime,
  };

  writeCache({ ...roadmapData, _meta: metadata });

  console.log(`[poll] Done in ${metadata.durationMs}ms`);
  console.log(`[poll] ${roadmapData.stickies.length} stickies, ${roadmapData.milestones.length} milestones`);
  console.log(`[poll] Cache written to src/cache/roadmap-data.json`);
}

/**
 * Recursively crawl block children up to maxDepth.
 */
async function crawlTree(notion, blocks, depth, maxDepth) {
  if (depth >= maxDepth) return blocks;

  for (const block of blocks) {
    if (block.has_children) {
      try {
        const children = await notion.getBlockChildren(block.id);
        block._children = await crawlTree(notion, children, depth + 1, maxDepth);
      } catch (e) {
        console.warn(`[poll] Failed to fetch children of ${block.id}: ${e.message}`);
        block._children = [];
      }
    }
  }

  return blocks;
}

function countBlocks(blocks) {
  let count = blocks.length;
  for (const block of blocks) {
    if (block._children) count += countBlocks(block._children);
  }
  return count;
}

function formatId(id) {
  if (id.includes('-')) return id;
  if (id.length !== 32) return id;
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

main().catch(err => {
  console.error('[poll] Fatal error:', err);
  process.exit(1);
});
