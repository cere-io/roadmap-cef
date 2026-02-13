/**
 * Transform raw Notion block tree into roadmap data model.
 *
 * DYNAMIC LANES: Extracts lanes from H2 headers in the Notion doc.
 * Groups are determined from parent H1 headers or toggle headers.
 */

import { QUARTERS } from './constants.js';

// Default styling by group (fallback colors)
const GROUP_STYLES = {
  'Core Infrastructure': { colorClass: 'bg-blue-50', headerColorClass: 'bg-blue-600' },
  'Runtimes': { colorClass: 'bg-sky-50', headerColorClass: 'bg-sky-600' },
  'Product & Demos': { colorClass: 'bg-orange-50', headerColorClass: 'bg-orange-500' },
  'B3: Marketing': { colorClass: 'bg-blue-50', headerColorClass: 'bg-blue-500' },
  'B4: Sales': { colorClass: 'bg-green-50', headerColorClass: 'bg-green-500' },
  'Team & Readiness': { colorClass: 'bg-slate-100', headerColorClass: 'bg-slate-500' },
  'Blockchain / Protocol': { colorClass: 'bg-purple-50', headerColorClass: 'bg-purple-600' },
  'DDC': { colorClass: 'bg-sky-50', headerColorClass: 'bg-sky-700' },
  'Tools': { colorClass: 'bg-orange-50', headerColorClass: 'bg-orange-600' },
  'Business': { colorClass: 'bg-green-50', headerColorClass: 'bg-green-600' },
  'default': { colorClass: 'bg-gray-50', headerColorClass: 'bg-gray-500' },
};

/**
 * Generate a lane ID from title.
 * E.g., "Data Onboarding (A1)" → "lane-a1"
 *       "Agent Runtime (A9)" → "lane-a9"
 *       "Custom Lane" → "lane-custom-lane"
 */
function generateLaneId(title) {
  // Try to extract code like (A1), (A8b), (Z1), (S0), (B1)
  const codeMatch = title.match(/\(([A-Z][0-9]+[a-z]?(?:\.\d+)?)\)/i);
  if (codeMatch) {
    return `lane-${codeMatch[1].toLowerCase()}`;
  }
  // Fallback: slugify the title
  return 'lane-' + title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
}

/**
 * Extract subtitle from title if present (after " - " or in parentheses after code)
 */
function extractSubtitle(title) {
  // "Data Onboarding (A1) - Ingestion Service" → "Ingestion Service"
  const dashMatch = title.match(/-\s*(.+)$/);
  if (dashMatch) return dashMatch[1].trim();
  return '';
}

/**
 * Get styling for a group
 */
function getGroupStyle(group) {
  // Try exact match first
  if (GROUP_STYLES[group]) return GROUP_STYLES[group];
  
  // Try partial match
  const groupLower = group.toLowerCase();
  for (const [key, style] of Object.entries(GROUP_STYLES)) {
    if (groupLower.includes(key.toLowerCase()) || key.toLowerCase().includes(groupLower)) {
      return style;
    }
  }
  
  return GROUP_STYLES['default'];
}

/**
 * First pass: Extract all lanes from H2 headers and child_page blocks.
 * Returns a Map of laneId → lane object
 */
function extractLanes(blocks, parentGroup = 'Ungrouped') {
  const lanesMap = new Map();
  let currentGroup = parentGroup;

  for (const block of blocks) {
    const type = block.type;
    const text = extractText(block);

    // H1 or toggle with ALL CAPS text → likely a group header
    if ((type === 'heading_1' || type === 'toggle') && text) {
      // Check if it's a group header (ALL CAPS or known group pattern)
      const isGroupHeader = text === text.toUpperCase() || 
        /^(Core|Runtimes|Product|Marketing|Sales|Team|Blockchain|DDC|Tools|Business|B[0-9]:)/i.test(text);
      
      if (isGroupHeader && !text.match(/milestone/i)) {
        currentGroup = text.replace(/^[▶▼]\s*/, '').trim();
        
        // If it's a toggle with children, process them with this group
        if (type === 'toggle' && block._children) {
          const childLanes = extractLanes(block._children, currentGroup);
          childLanes.forEach((lane, id) => lanesMap.set(id, lane));
        }
        continue;
      }
    }

    // H2 or child_page → Lane definition
    if ((type === 'heading_2' || type === 'child_page') && text) {
      const laneId = generateLaneId(text);
      const style = getGroupStyle(currentGroup);
      
      // Extract wiki URL from child_page or linked pages
      let wikiUrl = '';
      if (type === 'child_page') {
        wikiUrl = `https://www.notion.so/${block.id.replace(/-/g, '')}`;
      }
      
      // Check for links in rich_text
      const richText = getRichText(block);
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

      const lane = {
        id: laneId,
        group: currentGroup,
        title: text,
        subtitle: extractSubtitle(text),
        ...style,
        wikiUrl: wikiUrl || undefined,
      };
      
      // Only add if not already present (first occurrence wins)
      if (!lanesMap.has(laneId)) {
        lanesMap.set(laneId, lane);
      }

      // Process children of child_page for nested content
      if (type === 'child_page' && block._children) {
        // Don't extract lanes from children, but process them later for stickies
      }
    }

    // Recurse into synced blocks
    if (type === 'synced_block' && block._children) {
      const childLanes = extractLanes(block._children, currentGroup);
      childLanes.forEach((lane, id) => {
        if (!lanesMap.has(id)) lanesMap.set(id, lane);
      });
    }
  }

  return lanesMap;
}

/**
 * Main transform function
 */
export function transformBlocks(blocks) {
  // First pass: Extract all lanes dynamically
  const lanesMap = extractLanes(blocks);
  const lanes = Array.from(lanesMap.values());
  
  // Sort lanes by group, then by title
  lanes.sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return a.title.localeCompare(b.title);
  });

  // Second pass: Extract stickies and milestones
  const stickies = [];
  const milestones = [];

  let currentQuarterId = QUARTERS[0].id;
  let currentLaneId = lanes[0]?.id || 'lane-unknown';
  let currentMilestoneId = undefined;
  let currentMilestoneTitle = undefined;

  for (const block of blocks) {
    const type = block.type;
    const text = extractText(block);

    // H1 → Milestone (but not group headers)
    if (type === 'heading_1' && text) {
      const isGroupHeader = text === text.toUpperCase() && !text.match(/milestone/i);
      
      if (!isGroupHeader) {
        const milestone = parseMilestone(block, text, currentQuarterId);
        if (milestone) {
          milestones.push(milestone);
          currentMilestoneId = milestone.id;
          currentMilestoneTitle = milestone.title;
          const q = findQuarter(text);
          if (q) currentQuarterId = q.id;
        }
      }
    }

    // H2 or child_page → Lane marker
    if ((type === 'heading_2' || type === 'child_page') && text) {
      const laneId = generateLaneId(text);
      if (lanesMap.has(laneId)) {
        currentLaneId = laneId;

        if (type === 'child_page' && block._children) {
          processChildPage(block._children, currentLaneId, currentQuarterId,
            currentMilestoneId, currentMilestoneTitle, stickies, lanesMap);
        }
      }
    }

    // H3 → Checkpoint / Deliverable
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

    // Synced block → process for checkpoints
    if (type === 'synced_block' && block._children) {
      processSyncedBlock(block._children, currentLaneId, currentQuarterId,
        currentMilestoneId, currentMilestoneTitle, stickies, lanesMap);
    }

    // Toggle → might contain lanes or content
    if (type === 'toggle' && block._children) {
      // Check if toggle text is a group header
      const isGroupHeader = text === text.toUpperCase();
      if (isGroupHeader) {
        // Process children with updated context
        processToggleGroup(block._children, text, currentQuarterId,
          currentMilestoneId, currentMilestoneTitle, stickies, lanesMap);
      }
    }
  }

  return { 
    stickies, 
    milestones, 
    lanes,  // Now dynamically generated!
    quarters: QUARTERS 
  };
}

/**
 * Process children of a toggle group
 */
function processToggleGroup(children, groupName, quarterId, milestoneId, milestoneTitle, stickies, lanesMap) {
  let currentLaneId = null;
  
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const type = child.type;
    const text = extractText(child);

    // H2 or child_page → Lane
    if ((type === 'heading_2' || type === 'child_page') && text) {
      const laneId = generateLaneId(text);
      if (lanesMap.has(laneId)) {
        currentLaneId = laneId;
        
        if (type === 'child_page' && child._children) {
          processChildPage(child._children, currentLaneId, quarterId,
            milestoneId, milestoneTitle, stickies, lanesMap);
        }
      }
    }

    // H3 → Checkpoint
    if (type === 'heading_3' && text && currentLaneId) {
      const isCheckpoint = text.toLowerCase().includes('checkpoint') ||
                           text.toLowerCase().startsWith('deliverable');
      if (isCheckpoint) {
        const siblings = collectSiblings(children, i);
        const sticky = buildSticky(child, text, siblings, currentLaneId,
          quarterId, milestoneId, milestoneTitle);
        if (sticky) stickies.push(sticky);
      }
    }

    // Synced block
    if (type === 'synced_block' && child._children && currentLaneId) {
      processSyncedBlock(child._children, currentLaneId, quarterId,
        milestoneId, milestoneTitle, stickies, lanesMap);
    }
  }
}

/**
 * Process children of a child_page (lane) to find checkpoints.
 */
function processChildPage(children, laneId, quarterId, milestoneId, milestoneTitle, stickies, lanesMap) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const type = child.type;
    const text = extractText(child);

    if (type === 'synced_block' && child._children) {
      processSyncedBlock(child._children, laneId, quarterId, milestoneId, milestoneTitle, stickies, lanesMap);
      continue;
    }

    if (type === 'heading_3' && text) {
      const isCheckpoint = text.toLowerCase().includes('checkpoint') ||
                           text.toLowerCase().startsWith('deliverable');
      if (isCheckpoint) {
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
function processSyncedBlock(children, laneId, quarterId, milestoneId, milestoneTitle, stickies, lanesMap) {
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
      const mention = richText.find(rt => rt.type === 'mention' && rt.mention?.type === 'user');
      owner = mention ? (mention.mention.user?.name || mention.plain_text) : sibText.replace(/^owner[:\s]*/i, '').trim();
    } else if (sibText.toLowerCase().includes('delivery date') || sibText.toLowerCase().includes('delivery:')) {
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
      const toggleContent = collectToggleContent(sib);
      if (toggleContent) noteItems.push(toggleContent);
    }

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
  let title = text.replace(/^milestone\s+\d+\s*[:–-]\s*/i, '').trim();
  if (!title) return null;

  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : '';

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
    if (child._children) {
      for (const nested of child._children) {
        const nestedText = extractText(nested);
        if (nestedText) lines.push(`    ${nestedText}`);
      }
    }
  }
  return lines.join('\n');
}

function findQuarter(text) {
  const yearMatch = text.match(/202[5-7]/);
  const qMatch = text.match(/Q[1-4]/i);
  if (yearMatch && qMatch) {
    const year = yearMatch[0];
    const q = qMatch[0].toUpperCase();
    return QUARTERS.find(qu => qu.year === parseInt(year) && qu.label === q);
  }
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
