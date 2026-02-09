/**
 * Minimal Notion API client for polling roadmap data.
 * No SDK dependency — just fetch.
 */

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export function createNotionClient(apiKey) {
  if (!apiKey) throw new Error('NOTION_API_KEY is required');

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };

  async function getBlockChildren(blockId, pageSize = 100) {
    const allBlocks = [];
    let cursor = undefined;

    do {
      const url = new URL(`${NOTION_API_BASE}/blocks/${blockId}/children`);
      url.searchParams.set('page_size', String(pageSize));
      if (cursor) url.searchParams.set('start_cursor', cursor);

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Notion API error ${res.status}: ${body}`);
      }

      const data = await res.json();
      allBlocks.push(...data.results);
      cursor = data.has_more ? data.next_cursor : undefined;
    } while (cursor);

    return allBlocks;
  }

  async function getPage(pageId) {
    const res = await fetch(`${NOTION_API_BASE}/pages/${pageId}`, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Notion API error ${res.status}: ${body}`);
    }
    return res.json();
  }

  return { getBlockChildren, getPage };
}
