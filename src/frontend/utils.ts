import { StickyNote, Lane, Quarter } from './types';
import { LANES, QUARTERS } from './constants';

export function getInitials(name: string): string {
  if (!name || name === 'Unassigned') return '?';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

export function extractOutcome(title: string): string {
  if (!title) return '';
  let cleaned = title.replace(/^[A-Z]{1,3}\d+(\.\d+)?\s*[:–-]\s*/i, '');
  cleaned = cleaned.replace(/^Milestone\s+\d+\s*[:–-]\s*/i, '');
  cleaned = cleaned.replace(/\s+by\s+\d{4}-\d{2}-\d{2}\s*$/i, '');
  return cleaned.trim();
}

export function getAvatarColor(name: string): string {
  if (!name || name === 'Unassigned') return 'bg-slate-300';
  const colors = [
    'bg-red-400', 'bg-orange-400', 'bg-amber-400',
    'bg-green-400', 'bg-emerald-400', 'bg-teal-400',
    'bg-cyan-400', 'bg-sky-400', 'bg-blue-400',
    'bg-indigo-400', 'bg-violet-400', 'bg-purple-400',
    'bg-fuchsia-400', 'bg-pink-400', 'bg-rose-400'
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function getUniqueOwners(stickies: StickyNote[]): string[] {
  const owners = new Set(stickies.map(s => s.owner).filter(Boolean));
  return Array.from(owners).sort();
}

export function getUniqueGroups(lanes: Lane[]): string[] {
  const groups = new Set(lanes.map(l => l.group).filter(Boolean));
  return Array.from(groups).sort();
}

export function findQuarter(text: string): Quarter | undefined {
  const yearMatch = text.match(/202[5-7]/);
  const qMatch = text.match(/Q[1-4]/i);

  if (yearMatch && qMatch) {
    const year = yearMatch[0];
    const q = qMatch[0].toUpperCase();
    return QUARTERS.find(qu => qu.year === parseInt(year) && qu.label === q);
  }

  return QUARTERS.find(q => text.includes(q.id) || (text.includes(q.label) && text.includes(String(q.year))));
}

export function getQuarterFromDate(deliveryDate: string | undefined): string | undefined {
  if (!deliveryDate) return undefined;

  let date: Date;
  try {
    date = new Date(deliveryDate);
    if (isNaN(date.getTime())) return undefined;
  } catch {
    return undefined;
  }

  const year = date.getFullYear();
  const month = date.getMonth();

  let qNum: number;
  if (month <= 2) qNum = 1;
  else if (month <= 5) qNum = 2;
  else if (month <= 8) qNum = 3;
  else qNum = 4;

  const quarterId = `${year}-Q${qNum}`;
  const exists = QUARTERS.find(q => q.id === quarterId);
  return exists ? quarterId : undefined;
}

export function findLane(text: string, lanes: Lane[]): Lane | undefined {
  const clean = text.toLowerCase().replace(/\(.*\)/, '').trim();
  const textUpper = text.toUpperCase();

  const KEYWORD_LANE_MAP: Record<string, string[]> = {
    's0': ['lane-s0'], 'content wiki': ['lane-s0'], 'core content': ['lane-s0'], 'product content': ['lane-s0'],
    's2': ['lane-s2'], 'cef website': ['lane-s2'], 'website': ['lane-s2'], 'vertical pages': ['lane-s2'],
    's3': ['lane-s3'], 'campaigns': ['lane-s3'], 'cef campaigns': ['lane-s3'],
    'b3': ['lane-b3'], 'product marketing': ['lane-b3'],
    's1': ['lane-s1'], 'cef demo': ['lane-s1'], 'sales collateral': ['lane-s1'], 'decks': ['lane-s1'],
    's4': ['lane-s4'], 'enterprise gtm': ['lane-s4'], 'enterprise g2m': ['lane-s4'],
    'g2m wiki': ['lane-b4'], 'b4': ['lane-b4'],
    'dac': ['lane-dac'], 'inspection': ['lane-dac'],
    'blockchain': ['lane-blockchain'],
    'payouts': ['lane-payouts'], 'payout': ['lane-payouts'],
    'ddc core': ['lane-ddc'], 'ddc node': ['lane-ddc-nodes'],
    'cross-chain': ['lane-cross-chain'], 'cross chain': ['lane-cross-chain'],
    'indexer': ['lane-indexer'],
    'marketing': ['lane-marketing', 'lane-b3'],
    'content distribution': ['lane-content'],
    'community': ['lane-community'],
    'growth': ['lane-growth'],
  };

  const textLower = text.toLowerCase();
  for (const [keyword, laneIds] of Object.entries(KEYWORD_LANE_MAP)) {
    if (textLower.includes(keyword)) {
      for (const laneId of laneIds) {
        const lane = lanes.find(l => l.id === laneId);
        if (lane) return lane;
      }
    }
  }

  let found = lanes.find(l => l.id === text);
  if (found) return found;

  const lanesWithCodes = lanes.map(l => {
    const code = l.title.match(/\(([A-Z][0-9]+[a-z]?(?:\.\d+)?)\)/i)?.[1]?.toUpperCase();
    return { lane: l, code };
  }).filter(lc => lc.code);

  lanesWithCodes.sort((a, b) => (b.code?.length || 0) - (a.code?.length || 0));

  for (const { lane, code } of lanesWithCodes) {
    if (code && textUpper.includes(code)) return lane;
  }

  return lanes.find(l => {
    const lClean = l.title.toLowerCase().replace(/\(.*\)/, '').trim();
    return lClean.includes(clean) || clean.includes(lClean);
  });
}

export function getDatePositionInQuarter(deliveryDate: string | undefined, quarterId: string): number {
  if (!deliveryDate) return 50;

  const qMatch = quarterId.match(/(\d{4})-Q(\d)/);
  if (!qMatch) return 50;

  const qYear = parseInt(qMatch[1]);
  const qNum = parseInt(qMatch[2]);

  const quarterStartMonth = (qNum - 1) * 3;
  const quarterStart = new Date(qYear, quarterStartMonth, 1);
  const quarterEnd = new Date(qYear, quarterStartMonth + 3, 0);

  let date: Date;
  try {
    date = new Date(deliveryDate);
    if (isNaN(date.getTime())) return 50;
  } catch {
    return 50;
  }

  const quarterDuration = quarterEnd.getTime() - quarterStart.getTime();
  const dateOffset = date.getTime() - quarterStart.getTime();

  return Math.max(5, Math.min(95, (dateOffset / quarterDuration) * 100));
}

export function sortStickyByDate(stickies: StickyNote[]): StickyNote[] {
  return [...stickies].sort((a, b) => {
    if (!a.deliveryDate && !b.deliveryDate) return 0;
    if (!a.deliveryDate) return 1;
    if (!b.deliveryDate) return -1;

    const dateA = new Date(a.deliveryDate).getTime();
    const dateB = new Date(b.deliveryDate).getTime();

    if (isNaN(dateA) && isNaN(dateB)) return 0;
    if (isNaN(dateA)) return 1;
    if (isNaN(dateB)) return -1;

    return dateA - dateB;
  });
}

export function getTodayPosition(quarters: Quarter[]): { quarterId: string; position: number } | null {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  let qNum: number;
  if (month <= 2) qNum = 1;
  else if (month <= 5) qNum = 2;
  else if (month <= 8) qNum = 3;
  else qNum = 4;

  const quarterId = `${year}-Q${qNum}`;
  const quarter = quarters.find(q => q.id === quarterId);
  if (!quarter) return null;

  const quarterStartMonth = (qNum - 1) * 3;
  const quarterStart = new Date(year, quarterStartMonth, 1);
  const quarterEnd = new Date(year, quarterStartMonth + 3, 0);

  const quarterDuration = quarterEnd.getTime() - quarterStart.getTime();
  const todayOffset = today.getTime() - quarterStart.getTime();

  const position = Math.max(0, Math.min(100, (todayOffset / quarterDuration) * 100));
  return { quarterId, position };
}
