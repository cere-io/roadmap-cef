/**
 * Transform raw Notion block tree into roadmap data model.
 *
 * Replicates the client-side parsing from the original App.tsx,
 * but runs server-side during the poll so the frontend gets clean JSON.
 */

// Lane definitions (mirrored from original constants.tsx)
import { CEF_LANES, QUARTERS } from './constants.js';

export function transformBlocks(blocks) {
  const stickies = [];
  const milestones = [];

  let currentQuarterId = QUARTERS[0].id;
  let currentLaneId = CEF_LANES[0].id;
  let currentMilestoneId = undefined;
  let currentMilestoneTitle = undefined;

  for (const block of blocks) {
    const type = block.type;
    const text = extractText(block);

    // H1 → Milestone
    if (type === 'heading_1' && text) {
      const milestone = parseMilestone(block, text, currentQuarterId);
      if (milestone) {
        milestones.push(milestone);
        currentMilestoneId = milestone.id;
        currentMilestoneTitle = milestone.title;
        // Try to detect quarter from milestone title
        const q = findQuarter(text);
        if (q) currentQuarterId = q.id;
      }
    }

    // H2 → Lane marker
    if ((type === 'heading_2' || type === 'child_page') && text) {
      const lane = findLane(text);
      if (lane) {
        currentLaneId = lane.id;

        // If child_page, its _children contain checkpoints
        if (type === 'child_page' && block._children) {
          processChildPage(block._children, currentLaneId, currentQuarterId,
            currentMilestoneId, currentMilestoneTitle, stickies);
        }
      }
    }

    // H3 → Checkpoint / Deliverable (at top level)
    if (type === 'heading_3' && text) {
      const isCheckpoint = text.toLowerCase().includes('checkpoint') ||
                           text.toLowerCase().startsWith('deliverable');
      if (isCheckpoint) {
        const idx = blocks.indexOf(block);
        const siblings = collectSiblings(blocks, idx);
        const sticky = buildSticky(block, text, siblings, currentLaneId,
          currentQuarterId, currentMilestoneId, currentMilestoneTitle);
        if (sticky) stickies.push(sticky);
      }
    }

    // Synced block at top level — look inside for checkpoints
    if (type === 'synced_block' && block._children) {
      processSyncedBlock(block._children, currentLaneId, currentQuarterId,
        currentMilestoneId, currentMilestoneTitle, stickies);
    }

    // Divider → could signal section break (no action needed)
  }

  return { stickies, milestones, lanes: CEF_LANES, quarters: QUARTERS };
}

/**
 * Process children of a child_page (lane) to find checkpoints.
 */
function processChildPage(children, laneId, quarterId, milestoneId, milestoneTitle, stickies) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const type = child.type;
    const text = extractText(child);

    // Synced block inside child page
    if (type === 'synced_block' && child._children) {
      processSyncedBlock(child._children, laneId, quarterId, milestoneId, milestoneTitle, stickies);
      continue;
    }

    // H3 checkpoint
    if (type === 'heading_3' && text) {
      const isCheckpoint = text.toLowerCase().includes('checkpoint') ||
                           text.toLowerCase().startsWith('deliverable');
      if (isCheckpoint) {
        // Gather sibling blocks after this heading until next heading
        const siblings = collectSiblings(children, i);
        const sticky = buildSticky(child, text, siblings, laneId, quarterId, milestoneId, milestoneTitle);
        if (sticky) stickies.push(sticky);
      }
    }
  }
}

/**
 * Process children of a synced_block to find checkpoints.
 */
function processSyncedBlock(children, laneId, quarterId, milestoneId, milestoneTitle, stickies) {
  // Find checkpoint indices
  const checkpointIndices = [];
  children.forEach((child, idx) => {
    const text = extractText(child);
    if (text && child.type === 'heading_3' &&
        (text.toLowerCase().includes('checkpoint') || text.toLowerCase().startsWith('deliverable'))) {
      checkpointIndices.push(idx);
    }
  });

  for (let i = 0; i < checkpointIndices.length; i++) {
    const startIdx = checkpointIndices[i];
    const endIdx = i < checkpointIndices.length - 1 ? checkpointIndices[i + 1] : children.length;
    const block = children[startIdx];
    const text = extractText(block);
    const siblings = children.slice(startIdx + 1, endIdx);
    const sticky = buildSticky(block, text, siblings, laneId, quarterId, milestoneId, milestoneTitle);
    if (sticky) stickies.push(sticky);
  }
}

/**
 * Build a StickyNote from a checkpoint heading and its sibling blocks.
 */
function buildSticky(block, rawTitle, siblings, laneId, quarterId, milestoneId, milestoneTitle) {
  let title = rawTitle
    .replace(/^checkpoint\s*\d*[:\s]*/i, '')
    .replace(/^deliverable[:\s]*\d*[:\s]*/i, '')
    .trim();

  if (title.length <= 3) return null;

  let owner = 'Unassigned';
  let deliveryDate = '';
  let status = 'green';
  let blocker = '';
  let wikiUrl = '';
  const noteItems = [];

  for (const sib of siblings) {
    const sibType = sib.type;
    const richText = getRichText(sib);
    const sibText = richText.map(rt => rt.plain_text).join('');

    if (sibText.toLowerCase().startsWith('owner:')) {
      // Try mention first
      const mention = richText.find(rt => rt.type === 'mention' && rt.mention?.type === 'user');
      owner = mention ? (mention.mention.user?.name || mention.plain_text) : sibText.replace(/^owner[:\s]*/i, '').trim();
    } else if (sibText.toLowerCase().includes('delivery date') || sibText.toLowerCase().includes('delivery:')) {
      // Try date mention
      const dateMention = richText.find(rt => rt.type === 'mention' && rt.mention?.type === 'date');
      if (dateMention) {
        deliveryDate = dateMention.mention.date.start;
      } else {
        const dateMatch = sibText.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) deliveryDate = dateMatch[1];
      }
    } else if (sibText.toLowerCase().startsWith('status:')) {
      const val = sibText.replace(/^status[:\s]*/i, '').trim().toLowerCase();
      if (val.includes('red') || val.includes('<80%') || val.includes('at risk')) {
        status = 'red';
      } else if (val.includes('yellow') || val.includes('little off') || val.includes('>80%')) {
        status = 'yellow';
      } else {
        status = 'green';
      }
    } else if (sibText.toLowerCase().startsWith('blocker:') || sibText.toLowerCase().startsWith('blocked:')) {
      blocker = sibText.replace(/^block(?:er|ed)[:\s]*/i, '').trim();
    } else if (sibType === 'toggle') {
      // Toggle = weekly execution feedback → collect as notes
      const toggleContent = collectToggleContent(sib);
      if (toggleContent) noteItems.push(toggleContent);
    }

    // Extract wiki URL from links
    for (const rt of richText) {
      if (rt.href && rt.href.includes('notion.so')) {
        wikiUrl = rt.href.startsWith('/') ? `https://www.notion.so${rt.href}` : rt.href;
        break;
      }
      if (rt.type === 'mention' && rt.mention?.type === 'page') {
        wikiUrl = `https://www.notion.so/${rt.mention.page.id.replace(/-/g, '')}`;
        break;
      }
    }
  }

  // Determine quarter from delivery date
  let assignedQuarter = quarterId;
  if (deliveryDate) {
    const q = getQuarterFromDate(deliveryDate);
    if (q) assignedQuarter = q;
  }

  return {
    id: block.id,
    title,
    owner,
    laneId,
    quarterId: assignedQuarter,
    isDone: false,
    status,
    wikiUrl: wikiUrl || undefined,
    blocker: blocker || undefined,
    deliveryDate: deliveryDate || undefined,
    notes: noteItems.length > 0 ? noteItems.join('\n---\n') : undefined,
    milestoneId,
    milestoneTitle,
  };
}

/**
 * Parse a milestone from an H1 block.
 */
function parseMilestone(block, text, defaultQuarterId) {
  // Extract title, cleaning "Milestone X:" prefix
  let title = text.replace(/^milestone\s+\d+\s*[:–-]\s*/i, '').trim();
  if (!title) return null;

  // Try to extract date
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

  // Detect quarter
  const quarter = findQuarter(text);
  const quarterId = quarter ? quarter.id : defaultQuarterId;

  return {
    id: block.id,
    title,
    quarterId,
    date,
    status: 'green',
    description: text,
    colorClass: 'bg-blue-500',
  };
}

// --- Helpers ---

function extractText(block) {
  if (!block) return '';
  const type = block.type;
  if (type === 'child_page') return block.child_page?.title || '';
  const richText = block[type]?.rich_text;
  if (Array.isArray(richText)) return richText.map(rt => rt.plain_text).join('');
  return '';
}

function getRichText(block) {
  if (!block) return [];
  const type = block.type;
  if (type === 'callout') return block.callout?.rich_text || [];
  return block[type]?.rich_text || [];
}

function collectSiblings(blocks, startIdx) {
  const siblings = [];
  for (let i = startIdx + 1; i < blocks.length; i++) {
    const block = blocks[i];
    // Stop at next heading or divider
    if (block.type === 'heading_1' || block.type === 'heading_2' || block.type === 'heading_3' || block.type === 'divider') break;
    siblings.push(block);
  }
  return siblings;
}

function collectToggleContent(block) {
  const title = extractText(block);
  if (!block._children || block._children.length === 0) return title;

  const lines = [title];
  for (const child of block._children) {
    const childText = extractText(child);
    if (childText) lines.push(`  ${childText}`);
    // Nested toggles
    if (child._children) {
      for (const nested of child._children) {
        const nestedText = extractText(nested);
        if (nestedText) lines.push(`    ${nestedText}`);
      }
    }
  }
  return lines.join('\n');
}

function findLane(text) {
  const textUpper = text.toUpperCase();
  const textLower = text.toLowerCase();

  // Keyword mappings
  const KEYWORD_LANE_MAP = {
    's0': 'lane-s0', 'content wiki': 'lane-s0', 'core content': 'lane-s0',
    's2': 'lane-s2', 'cef website': 'lane-s2', 'website': 'lane-s2',
    's3': 'lane-s3', 'campaigns': 'lane-s3',
    's1': 'lane-s1', 'cef demo': 'lane-s1',
    's4': 'lane-s4', 'enterprise gtm': 'lane-s4',
  };

  for (const [keyword, laneId] of Object.entries(KEYWORD_LANE_MAP)) {
    if (textLower.includes(keyword)) {
      return CEF_LANES.find(l => l.id === laneId);
    }
  }

  // Code match (A1, A8b, A8, etc.)
  const lanesWithCodes = CEF_LANES.map(l => {
    const match = l.title.match(/\(([A-Z][0-9]+[a-z]?(?:\.\d+)?)\)/i);
    return { lane: l, code: match?.[1]?.toUpperCase() };
  }).filter(lc => lc.code).sort((a, b) => (b.code?.length || 0) - (a.code?.length || 0));

  for (const { lane, code } of lanesWithCodes) {
    if (code && textUpper.includes(code)) return lane;
  }

  return undefined;
}

function findQuarter(text) {
  const yearMatch = text.match(/202[5-7]/);
  const qMatch = text.match(/Q[1-4]/i);
  if (yearMatch && qMatch) {
    const year = yearMatch[0];
    const q = qMatch[0].toUpperCase();
    return QUARTERS.find(qu => qu.year === parseInt(year) && qu.label === q);
  }
  // Try date match
  const dateMatch = text.match(/(\d{4})-(\d{2})-\d{2}/);
  if (dateMatch) {
    return getQuarterFromDateInternal(dateMatch[0]);
  }
  return undefined;
}

function getQuarterFromDate(dateStr) {
  const q = getQuarterFromDateInternal(dateStr);
  return q?.id;
}

function getQuarterFromDateInternal(dateStr) {
  if (!dateStr) return undefined;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return undefined;
  const year = date.getFullYear();
  const month = date.getMonth();
  let qNum;
  if (month <= 2) qNum = 1;
  else if (month <= 5) qNum = 2;
  else if (month <= 8) qNum = 3;
  else qNum = 4;
  const quarterId = `${year}-Q${qNum}`;
  return QUARTERS.find(q => q.id === quarterId);
}
