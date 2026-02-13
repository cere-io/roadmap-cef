import React, { useState, useEffect, useMemo } from 'react';
import { StickyCard } from './components/StickyCard';
import { Modal } from './components/Modal';
import { NotesRenderer } from './components/NotesRenderer';
import { CEF_LANES, CERE_LANES, QUARTERS, INITIAL_STICKIES, INITIAL_MILESTONES } from './constants';
import { StickyNote, Milestone, StickyStatus, Lane, Quarter } from './types';
import {
  Plus, Flag, Search, ChevronDown, ChevronRight, Save, Trash2,
  Filter, Calendar, Info, CheckCircle, AlertTriangle, BookOpen,
  Folder, FolderOpen, ExternalLink, RefreshCw, Copy, XCircle, Loader2, Globe,
  ZoomIn, ZoomOut, Database, Cpu, Rocket, Users, Handshake, Activity, Settings
} from 'lucide-react';
import { getUniqueOwners, getUniqueGroups, findLane, findQuarter, getDatePositionInQuarter, sortStickyByDate, getQuarterFromDate, getTodayPosition, extractOutcome } from './utils';

// ============================================================
// Zoom / Timeline Helpers
// ============================================================

type ZoomLevel = 'quarter' | 'month' | 'week';

interface TimelineColumn {
  id: string;
  label: string;
  quarterId: string;
  startDate: Date;
  endDate: Date;
}

function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  return Math.ceil((date.getDate() + firstDay.getDay()) / 7);
}

function getISOWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function generateTimelineColumns(zoomLevel: ZoomLevel, referenceDate: Date): TimelineColumn[] {
  const columns: TimelineColumn[] = [];

  if (zoomLevel === 'quarter') {
    // One column per quarter — matches the original layout
    for (const q of QUARTERS) {
      const quarterNum = parseInt(q.label.replace('Q', ''));
      const startMonth = (quarterNum - 1) * 3;
      columns.push({
        id: q.id,
        label: `${q.label} ${q.year}`,
        quarterId: q.id,
        startDate: new Date(q.year, startMonth, 1),
        endDate: new Date(q.year, startMonth + 3, 0),
      });
    }
  } else if (zoomLevel === 'month') {
    for (const q of QUARTERS) {
      const quarterNum = parseInt(q.label.replace('Q', ''));
      const startMonth = (quarterNum - 1) * 3;
      for (let m = 0; m < 3; m++) {
        const monthIndex = startMonth + m;
        const start = new Date(q.year, monthIndex, 1);
        const end = new Date(q.year, monthIndex + 1, 0);
        const monthName = start.toLocaleString('default', { month: 'short' });
        columns.push({
          id: `${q.id}-m${m}`,
          label: `${monthName} ${q.year}`,
          quarterId: q.id,
          startDate: start,
          endDate: end,
        });
      }
    }
  } else {
    // week
    for (const q of QUARTERS) {
      const quarterNum = parseInt(q.label.replace('Q', ''));
      const startMonth = (quarterNum - 1) * 3;
      const qStart = new Date(q.year, startMonth, 1);
      const qEnd = new Date(q.year, startMonth + 3, 0);
      let current = new Date(qStart);
      // align to Monday
      const day = current.getDay();
      if (day !== 1) {
        current.setDate(current.getDate() - ((day + 6) % 7));
      }
      while (current <= qEnd) {
        const weekStart = new Date(current);
        const weekEnd = new Date(current);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekNum = getISOWeekNumber(weekStart);
        columns.push({
          id: `${q.id}-w${weekNum}`,
          label: `W${weekNum}`,
          quarterId: q.id,
          startDate: weekStart,
          endDate: weekEnd,
        });
        current.setDate(current.getDate() + 7);
      }
    }
  }

  return columns;
}

function getPositionInColumn(dateStr: string, column: TimelineColumn): number {
  if (!dateStr) return 50;
  const date = new Date(dateStr);
  const total = column.endDate.getTime() - column.startDate.getTime();
  if (total <= 0) return 50;
  const offset = date.getTime() - column.startDate.getTime();
  return Math.max(0, Math.min(100, (offset / total) * 100));
}

function stickyBelongsInColumn(sticky: StickyNote, column: TimelineColumn): boolean {
  if (!sticky.deliveryDate) {
    return sticky.quarterId === column.quarterId;
  }
  const date = new Date(sticky.deliveryDate);
  return date >= column.startDate && date <= column.endDate;
}

function getCardSizeClass(zoomLevel: ZoomLevel): string {
  switch (zoomLevel) {
    case 'week':
      return 'max-w-[60px] text-[9px]';
    case 'month':
      return 'max-w-[80px] text-[10px]';
    default:
      return 'max-w-[100px] text-xs';
  }
}

function getColumnWidth(zoomLevel: ZoomLevel): number {
  switch (zoomLevel) {
    case 'week':
      return 120;
    case 'month':
      return 240;
    default:
      return 360;
  }
}

// ============================================================
// App Component
// ============================================================

// Map group names to icons (since icons can't come from API)
function getIconForGroup(group: string): React.ReactNode {
  const groupLower = group.toLowerCase();
  if (groupLower.includes('infrastructure') || groupLower.includes('core')) return <Database />;
  if (groupLower.includes('runtime')) return <Cpu />;
  if (groupLower.includes('product') || groupLower.includes('demo')) return <Rocket />;
  if (groupLower.includes('marketing')) return <Users />;
  if (groupLower.includes('sales')) return <Handshake />;
  if (groupLower.includes('blockchain') || groupLower.includes('protocol')) return <Activity />;
  if (groupLower.includes('ddc')) return <Database />;
  if (groupLower.includes('tools')) return <Settings />;
  if (groupLower.includes('business')) return <Globe />;
  return <Settings />; // default
}

export default function App() {
  // -- State --
  const [activeView, setActiveView] = useState<'cef' | 'cere'>('cef');
  const [stickies, setStickies] = useState<StickyNote[]>(INITIAL_STICKIES);
  const [milestones, setMilestones] = useState<Milestone[]>(INITIAL_MILESTONES);
  const [lanes, setLanes] = useState<Lane[]>(CEF_LANES); // Now dynamic from API
  const LANES = lanes; // Use API lanes (with icon fallback)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StickyStatus | 'done' | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('quarter');
  const [referenceDate, setReferenceDate] = useState<Date>(new Date());
  const timelineColumns = useMemo(() => generateTimelineColumns(zoomLevel, referenceDate), [zoomLevel, referenceDate]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set()); // Will expand based on content
  const [hasInitializedGroups, setHasInitializedGroups] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSticky, setEditingSticky] = useState<Partial<StickyNote> | null>(null);
  const [selectedMilestone, setSelectedMilestone] = useState<Milestone | null>(null);
  const [isMilestoneModalOpen, setIsMilestoneModalOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<{
    stickyId: string;
    targetLaneId: string;
    targetQuarterId: string;
    newDeliveryDate: string;
  } | null>(null);

  // -- API Fetch (replaces Notion direct calls) --
  useEffect(() => {
    async function fetchRoadmapData() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/roadmap');
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        const data = await response.json();

        // Use lanes from API (dynamically extracted from H2 headers)
        // Add icons since they can't come from JSON
        const apiLanes = (data.lanes || []).map((lane: Lane) => ({
          ...lane,
          icon: getIconForGroup(lane.group),
        }));
        setLanes(apiLanes.length > 0 ? apiLanes : CEF_LANES);
        setStickies(data.stickies || []);
        setMilestones(data.milestones || []);
        setLoading(false);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to fetch roadmap');
        setLoading(false);
      }
    }
    fetchRoadmapData();
  }, [activeView]);

  // -- Derived Data --
  const uniqueOwners = useMemo(() => getUniqueOwners(stickies), [stickies]);
  const uniqueGroups = useMemo(() => getUniqueGroups(LANES), []);

  const healthStats = useMemo(() => ({
    red: stickies.filter(s => s.status === 'red' && !s.isDone).length,
    yellow: stickies.filter(s => s.status === 'yellow' && !s.isDone).length,
    green: stickies.filter(s => s.status === 'green' && !s.isDone).length,
    done: stickies.filter(s => s.isDone).length,
  }), [stickies]);

  // Auto-expand groups that have stickies after data loads
  useEffect(() => {
    if (!hasInitializedGroups && stickies.length > 0 && !loading) {
      // Find which groups have stickies
      const groupsWithContent = new Set<string>();
      stickies.forEach(sticky => {
        const lane = LANES.find(l => l.id === sticky.laneId);
        if (lane) {
          groupsWithContent.add(lane.group);
        }
      });

      // Only collapse groups WITHOUT content
      const allGroups = new Set(LANES.map(l => l.group));
      const groupsToCollapse = new Set<string>();
      allGroups.forEach(group => {
        if (!groupsWithContent.has(group)) {
          groupsToCollapse.add(group);
        }
      });

      setCollapsedGroups(groupsToCollapse);
      setHasInitializedGroups(true);
    }
  }, [stickies, loading, hasInitializedGroups]);

  // -- Actions --

  const handleCopyPrompt = () => {
    const prompt = `Create a detailed Multi-Year Roadmap Board for 2026 and 2027.\nStructure:\nColumns: Q1-Q4 2026, Q1-Q4 2027.\nRows: 1. Product Features, 2. Core Platform, 3. Commercial, 4. Partnerships, 5. Team.\nContent: High density, past tense verbs (outcomes only). No "planning" or "research".`;
    navigator.clipboard.writeText(prompt);
    alert("Miro Prompt copied to clipboard!");
  };

  const toggleGroup = (groupName: string) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupName)) newCollapsed.delete(groupName);
    else newCollapsed.add(groupName);
    setCollapsedGroups(newCollapsed);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, laneId: string, quarterId: string) => {
    e.preventDefault();
    if (!draggedId) return;

    // Find the sticky being moved
    const sticky = stickies.find(s => s.id === draggedId);
    if (!sticky) return;

    // Calculate a suggested date based on the target quarter
    const quarter = QUARTERS.find(q => q.id === quarterId);
    let suggestedDate = '';
    if (quarter) {
      const quarterMonth = (parseInt(quarter.label.replace('Q', '')) - 1) * 3 + 1; // 1, 4, 7, 10
      const year = quarter.year;
      suggestedDate = `${year}-${String(quarterMonth + 1).padStart(2, '0')}-15`; // Middle of second month
    }

    // Open confirmation modal
    setPendingMove({
      stickyId: draggedId,
      targetLaneId: laneId,
      targetQuarterId: quarterId,
      newDeliveryDate: sticky.deliveryDate || suggestedDate,
    });
    setDraggedId(null);
  };

  const confirmMove = () => {
    if (!pendingMove) return;
    setStickies(prev => prev.map(note =>
      note.id === pendingMove.stickyId
        ? {
            ...note,
            laneId: pendingMove.targetLaneId,
            quarterId: pendingMove.targetQuarterId,
            deliveryDate: pendingMove.newDeliveryDate
          }
        : note
    ));
    setPendingMove(null);
  };

  const cancelMove = () => {
    setPendingMove(null);
  };

  const handleResetBoard = () => {
    if (window.confirm("Reload roadmap data?")) {
      window.location.reload();
    }
  };

  // Sticky Modal Handlers
  const openNewStickyModal = (laneId: string, quarterId: string) => {
    setEditingSticky({
      id: undefined, // New
      title: '',
      owner: '',
      laneId,
      quarterId,
      status: 'green',
      isDone: false,
      blocker: '',
      wikiUrl: '',
      deliveryDate: '',
      notes: ''
    });
    setIsModalOpen(true);
  };

  const openEditModal = (note: StickyNote) => {
    setEditingSticky({ ...note });
    setIsModalOpen(true);
  };

  const saveSticky = () => {
    if (!editingSticky || !editingSticky.title) return;
    if (editingSticky.id) {
      setStickies(prev => prev.map(s => s.id === editingSticky.id ? editingSticky as StickyNote : s));
    } else {
      const newNote: StickyNote = {
        ...(editingSticky as StickyNote),
        id: Date.now().toString(),
        owner: editingSticky.owner || 'Unassigned',
      };
      setStickies(prev => [...prev, newNote]);
    }
    setIsModalOpen(false);
    setEditingSticky(null);
  };

  const deleteEditingSticky = () => {
    if (editingSticky?.id) {
      if (window.confirm("Are you sure you want to delete this?")) {
        setStickies(prev => prev.filter(s => s.id !== editingSticky.id));
        setIsModalOpen(false);
      }
    }
  };

  // Milestone Handlers
  const openMilestoneModal = (milestone: Milestone) => {
    setSelectedMilestone(milestone);
    setIsMilestoneModalOpen(true);
  };

  const addMilestone = (quarterId: string) => {
    const title = prompt("New Milestone Title:");
    if (!title) return;
    const newMilestone: Milestone = {
      id: Date.now().toString(),
      title,
      quarterId,
      date: 'TBD',
      status: 'yellow',
      description: 'Add description...',
      colorClass: 'bg-slate-600'
    };
    setMilestones([...milestones, newMilestone]);
  };

  const deleteMilestone = (id: string) => {
    if(window.confirm("Delete this milestone?")) {
        setMilestones(prev => prev.filter(m => m.id !== id));
    }
  };

  // Filter Logic
  const filteredStickies = stickies.filter(s => {
    // 1. Search Query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matches = s.title.toLowerCase().includes(q) || s.owner.toLowerCase().includes(q);
      if (!matches) return false;
    }

    // 2. Status Filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'done' && !s.isDone) return false;
      if (statusFilter !== 'done' && s.status !== statusFilter) return false;
      if (statusFilter !== 'done' && s.isDone) return false;
    }

    // 3. Owner Filter
    if (ownerFilter !== 'all' && s.owner !== ownerFilter) return false;

    // 4. Group Filter
    if (groupFilter !== 'all') {
      const lane = LANES.find(l => l.id === s.laneId);
      if (!lane || lane.group !== groupFilter) return false;
    }

    return true;
  });

  const isSaveDisabled = !editingSticky?.title || editingSticky.title.trim().length === 0;

  // Grouping Logic
  const groupedLanes = LANES.reduce((acc, lane) => {
    if (!acc[lane.group]) acc[lane.group] = [];
    acc[lane.group].push(lane);
    return acc;
  }, {} as Record<string, Lane[]>);

  const STATUS_DOT_COLORS: Record<StickyStatus, string> = {
    green: 'bg-green-500',
    yellow: 'bg-amber-400',
    red: 'bg-red-500',
  };

  // -- Render --

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-white text-gray-900">

      {/* === HEADER (60px, Minimal) === */}
      <header className="h-[60px] shrink-0 bg-white border-b border-gray-100 px-6 flex items-center justify-between z-50">

         {/* Left: Logo + Filters */}
         <div className="flex items-center gap-8">
            {/* Logo */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                  <FolderOpen size={16} className="text-white" />
              </div>
              <div>
                  <h1 className="text-base font-semibold text-gray-900 leading-tight">Outcome Roadmap</h1>
              </div>
            </div>

              {/* CEF/CERE Toggle */}
              <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setActiveView('cef')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    activeView === 'cef'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  CEF
                </button>
                <button
                  onClick={() => setActiveView('cere')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    activeView === 'cere'
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  CERE
                </button>
              </div>
            </div>

            {/* Filters (Ghost Button Style) */}
            <div className="flex items-center gap-1">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                <input
                  type="text"
                  placeholder="Search..."
                  className="pl-9 pr-3 py-2 bg-gray-100 rounded-lg text-sm w-48 focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none placeholder:text-gray-400"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StickyStatus | 'done' | 'all')}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg bg-transparent border-none outline-none cursor-pointer"
              >
                <option value="all">Status</option>
                <option value="green">● On Track</option>
                <option value="yellow">● At Risk</option>
                <option value="red">● Blocked</option>
                <option value="done">○ Done</option>
              </select>

              {/* Owner Filter */}
              <select
                value={ownerFilter}
                onChange={(e) => setOwnerFilter(e.target.value)}
                className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg bg-transparent border-none outline-none cursor-pointer"
              >
                <option value="all">Owner</option>
                {uniqueOwners.filter(o => o !== 'Unassigned').map(owner => (
                  <option key={owner} value={owner}>{owner}</option>
                ))}
                <option value="Unassigned">Unassigned</option>
              </select>

            </div>
         </div>

         {/* Right: KPIs + Actions */}
         <div className="flex items-center gap-6">
            {/* KPI Dots (Minimal) */}
            <div className="flex items-center gap-4">
              <button
                onClick={() => setStatusFilter('green')}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
                title="On Track"
              >
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="font-medium">{healthStats.green}</span>
              </button>
              <button
                onClick={() => setStatusFilter('yellow')}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
                title="At Risk"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                <span className="font-medium">{healthStats.yellow}</span>
              </button>
              <button
                onClick={() => setStatusFilter('red')}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"
                title="Blocked"
              >
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                <span className="font-medium">{healthStats.red}</span>
              </button>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopyPrompt}
                title="Copy Miro AI Prompt"
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <Copy size={16} />
              </button>
              <button
                onClick={handleResetBoard}
                title="Refresh roadmap"
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <RefreshCw size={16} />
              </button>
            </div>
         </div>
      </header>

      {/* === MAIN CONTENT === */}
      <div className="flex-1 overflow-auto relative bg-gray-50">

        {/* Loading State */}
        {loading && (
          <div className="absolute inset-0 z-[60] flex flex-col items-center justify-center bg-white">
             <Loader2 size={32} className="text-gray-400 animate-spin mb-4" />
             <p className="text-gray-500 text-sm">Loading roadmap...</p>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
           <div className="p-6 m-6 bg-white rounded-lg flex items-center gap-4">
             <AlertTriangle size={20} className="text-red-500" />
             <div className="flex-1">
               <p className="text-sm text-gray-900 font-medium">Failed to sync</p>
               <p className="text-xs text-gray-500 mt-0.5">{error}</p>
             </div>
             <button onClick={() => window.location.reload()} className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm font-medium">Retry</button>
           </div>
        )}

        {/* === ROADMAP GRID === */}
        {!loading && (
          <div className="min-w-max pb-12 relative">

            {/* TODAY LINE */}
            {(() => {
              const todayInfo = getTodayPosition(QUARTERS);
              if (!todayInfo) return null;

              const quarterIndex = QUARTERS.findIndex(q => q.id === todayInfo.quarterId);
              if (quarterIndex === -1) return null;

              const leftOffset = 200 + (quarterIndex * 360) + (todayInfo.position / 100 * 360);

              return (
                <div
                  className="absolute top-0 bottom-0 z-50 pointer-events-none"
                  style={{ left: leftOffset }}
                >
                  <div className="w-px h-full bg-red-400"></div>
                  <div className="absolute top-3 -translate-x-1/2 left-1/2 bg-red-500 text-white text-[10px] font-medium px-2 py-0.5 rounded whitespace-nowrap">
                    Today
                </div>
                </div>
              );
            })()}

            {/* === STICKY HEADER === */}
            <div className="sticky top-0 z-40 bg-white">
              {/* Quarter Headers */}
              <div className="flex border-b border-gray-100">
                <div className="w-[200px] shrink-0 py-4 px-4">
                  <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Timeline</span>
                </div>
                {QUARTERS.map((quarter) => (
                  <div
                    key={quarter.id}
                    className="w-[360px] shrink-0 py-4 px-4"
                  >
                    <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                      {quarter.label} {quarter.year}
                    </span>
                  </div>
                ))}
              </div>

              {/* Milestones Row (Subtle Pills) */}
              <div className="flex border-b border-gray-100 bg-gray-50/50">
                <div className="w-[200px] shrink-0 py-3 px-4 flex items-center">
                  <span className="text-xs font-medium text-gray-500">Milestones</span>
                </div>
                <div className="flex">
                    {QUARTERS.map((quarter) => {
                      const cellMilestones = milestones.filter(m => m.quarterId === quarter.id);
                      return (
                        <div
                          key={`milestone-${quarter.id}`}
                          className="w-[360px] shrink-0 py-2 px-3 flex flex-wrap gap-2 items-center min-h-[44px]"
                        >
                          {cellMilestones.map(m => (
                            <button
                              key={m.id}
                              onClick={() => openMilestoneModal(m)}
                              className="px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-medium rounded-md hover:bg-blue-100 transition-colors"
                            >
                              {extractOutcome(m.title)}
                             </button>
                          ))}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>

            {/* === SWIMLANES === */}
            <div className="flex flex-col">
              {Object.entries(groupedLanes).map(([groupName, lanes]) => {
                const isGroupCollapsed = collapsedGroups.has(groupName);

                return (
                  <div key={groupName}>

                    {/* Group Header (Minimal) */}
                    <div
                      onClick={() => toggleGroup(groupName)}
                      className="sticky left-0 z-30 bg-gray-50 py-2.5 px-4 flex items-center gap-2 cursor-pointer hover:bg-gray-100"
                    >
                      <ChevronRight
                        size={14}
                        className={`text-gray-400 transition-transform ${!isGroupCollapsed ? 'rotate-90' : ''}`}
                      />
                      <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{groupName}</span>
                    </div>

                    {/* Lanes */}
                    {!isGroupCollapsed && (
                      <div className="flex flex-col">
                        {lanes.map((lane) => {
                          // Get wiki URL for this lane
                          const laneWikiUrls: Record<string, string> = {
                            'lane-a8b': 'https://www.notion.so/cere/Gaming-Use-Case-A8b-2a0d800083d68033a8dffa19cbaf0620',
                            'lane-a7': 'https://www.notion.so/cere/A7-Nightingale-Integration-Wiki',
                            'lane-s1': 'https://www.notion.so/cere/S1-CEF-Demos-2ccd800083d680cc883bf8e4fa986e04',
                            'lane-s2': 'https://www.notion.so/cere/S2-CEF-Website-Vertical-Pages-2ccd800083d68020891ed6d9f4061b3e',
                            'lane-s3': 'https://www.notion.so/cere/CEF-ICP-S3-2ccd800083d68003be72ddc9a1ce2f03',
                            'lane-s4': 'https://www.notion.so/cere/CEF-Campaigns-S4-2ccd800083d6808e9b92df0c93146347',
                            'lane-b3': 'https://www.notion.so/cere/CEF-AI-Product-Marketing-B3-293d800083d680fb9b48e6a9b47aaf77',
                            'lane-b4': 'https://www.notion.so/cere/B4-CEF-AI-Enterprise-G2M-Wiki',
                          };
                          const wikiUrl = laneWikiUrls[lane.id];

                          return (
                            <div key={lane.id} className="flex border-b border-gray-100 bg-white group/lane">

                              {/* Lane Header - Click opens wiki */}
                              <div className="w-[200px] shrink-0 sticky left-0 z-20 bg-white">
                                <a
                                  href={wikiUrl || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="py-3 px-4 cursor-pointer hover:bg-blue-50 flex items-center justify-between group/link"
                                  title={`Open ${lane.title} Wiki`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900 group-hover/link:text-blue-600">{lane.title}</span>
                                      </div>
                                  <ExternalLink
                                    size={14}
                                    className="text-gray-300 group-hover/link:text-blue-500"
                                  />
                                </a>
                              </div>

                              {/* Quarter Cells */}
                              <div className="flex">
                                {QUARTERS.map((quarter, qIndex) => {
                                  const cellStickies = filteredStickies.filter(s => s.laneId === lane.id && s.quarterId === quarter.id);

                                  // --- TIMELINE VIEW (always shown) ---
                                    const sortedCellStickies = sortStickyByDate(cellStickies);

                                    // Calculate height based on stacked cards
                                    const collapsedHeight = Math.max(44, 8 + sortedCellStickies.length * 28);

                                    return (
                                      <div
                                        key={`${lane.id}-${quarter.id}-collapsed`}
                                        onDragOver={handleDragOver}
                                        onDrop={(e) => handleDrop(e, lane.id, quarter.id)}
                                        className="w-[360px] shrink-0 px-2 py-2 relative hover:bg-gray-50/50"
                                        style={{ minHeight: `${collapsedHeight}px` }}
                                      >
                                        {/* Subtle month dividers */}
                                        <div className="absolute inset-0 pointer-events-none">
                                          <div className="h-full w-px bg-gray-100 absolute" style={{ left: '33.33%' }} />
                                          <div className="h-full w-px bg-gray-100 absolute" style={{ left: '66.66%' }} />
                                          </div>

                                        {/* Stack cards vertically when they overlap */}
                                        {sortedCellStickies.map((sticky, idx) => {
                                          const position = getDatePositionInQuarter(sticky.deliveryDate, quarter.id);
                                          const hasDate = sticky.deliveryDate && sticky.deliveryDate.length > 0;

                                          // Calculate vertical offset based on how many previous cards are close
                                          let verticalIndex = 0;
                                          for (let i = 0; i < idx; i++) {
                                            const prevPos = getDatePositionInQuarter(sortedCellStickies[i].deliveryDate, quarter.id);
                                            if (Math.abs(position - prevPos) < 25) {
                                              verticalIndex++;
                                            }
                                          }

                                  return (
                                    <div
                                          key={sticky.id}
                                              draggable
                                              onDragStart={(e) => handleDragStart(e, sticky.id)}
                                            onClick={() => openEditModal(sticky)}
                                              className="absolute flex items-center gap-1.5 px-2 py-1 bg-white border border-gray-200 rounded-md hover:border-gray-300 hover:-translate-y-px cursor-grab active:cursor-grabbing"
                                              style={{
                                                left: hasDate ? `${Math.max(2, Math.min(75, position - 10))}%` : '5%',
                                                top: `${4 + verticalIndex * 28}px`,
                                              }}
                                              title={`${extractOutcome(sticky.title)}${sticky.milestoneTitle ? `\n📌 ${extractOutcome(sticky.milestoneTitle)}` : ''}`}
                                            >
                                              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_COLORS[sticky.status]} shrink-0`}></span>
                                              <span className={`text-xs font-medium truncate max-w-[100px] ${sticky.isDone ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                                                {extractOutcome(sticky.title)}
                                            </span>
                                              {sticky.milestoneTitle && (
                                                <span className="text-[9px] text-blue-500 ml-1" title={`Milestone: ${extractOutcome(sticky.milestoneTitle)}`}>📌</span>
                                              )}
                                          </div>
                                          );
                                        })}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>
        )}
      </div>

      {/* === SIDE DRAWER (Delivery Details) === */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingSticky?.title || 'New Deliverable'}
        footer={
          <div className="flex items-center justify-between w-full">
            {editingSticky?.id && (
               <button
                onClick={deleteEditingSticky}
                className="text-gray-500 hover:text-red-600 text-sm"
               >
                 Delete
               </button>
            )}
            <div className="flex items-center gap-3 ml-auto">
            <button
              onClick={() => setIsModalOpen(false)}
                className="text-gray-500 hover:text-gray-700 text-sm"
            >
              Cancel
            </button>
            <button
              onClick={saveSticky}
              disabled={isSaveDisabled}
              className={`
                  px-4 py-2 rounded-lg text-sm font-medium
                ${isSaveDisabled
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gray-900 text-white hover:bg-gray-800'}
              `}
            >
                Save
            </button>
            </div>
          </div>
        }
      >
        <div className="space-y-6">
           {/* Status Row */}
           <div className="flex items-center justify-between">
             <div className="flex items-center gap-2">
               <span className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                 editingSticky?.isDone ? 'bg-gray-100 text-gray-600' :
                 editingSticky?.status === 'green' ? 'bg-green-50 text-green-700' :
                 editingSticky?.status === 'yellow' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'
               }`}>
                 {editingSticky?.isDone ? 'Shipped' :
                  editingSticky?.status === 'green' ? 'On Track' :
                  editingSticky?.status === 'yellow' ? 'At Risk' : 'Blocked'}
               </span>
               <select
                  value={editingSticky?.status || 'green'}
                  onChange={e => setEditingSticky(prev => prev ? ({ ...prev, status: e.target.value as StickyStatus }) : null)}
                  className="text-xs text-gray-400 bg-transparent border-none cursor-pointer hover:text-gray-600"
                >
                  <option value="green">On Track</option>
                  <option value="yellow">At Risk</option>
                  <option value="red">Blocked</option>
                </select>
             </div>
             <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500">
             <input
                  type="checkbox"
                  checked={editingSticky?.isDone || false}
                  onChange={e => setEditingSticky(prev => prev ? ({ ...prev, isDone: e.target.checked }) : null)}
                  className="w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-500"
                />
                Shipped
              </label>
           </div>

           {/* Title */}
           <div>
             <label className="block text-xs text-gray-400 mb-1.5">Title</label>
             <textarea
               autoFocus
               value={editingSticky?.title || ''}
               onChange={e => setEditingSticky(prev => prev ? ({ ...prev, title: e.target.value }) : null)}
               placeholder="Deliverable title..."
               className="w-full p-3 bg-gray-100 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 resize-none h-20 focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none"
             />
           </div>

           {/* Associated Milestone */}
           {editingSticky?.milestoneTitle && (
             <div className="flex items-center gap-2 p-2.5 bg-blue-50 rounded-lg border border-blue-100">
               <span className="text-blue-600">📌</span>
               <div className="flex-1 min-w-0">
                 <span className="text-[10px] text-blue-400 uppercase tracking-wide block">Milestone</span>
                 <span className="text-sm font-medium text-blue-700 truncate block">{extractOutcome(editingSticky.milestoneTitle)}</span>
              </div>
             </div>
           )}

           {/* Owner + Date */}
           <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Owner</label>
                <select
                  value={editingSticky?.owner || 'Unassigned'}
                  onChange={e => setEditingSticky(prev => prev ? ({ ...prev, owner: e.target.value }) : null)}
                  className="w-full p-2.5 bg-gray-100 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none"
                >
                  <option value="Unassigned">Unassigned</option>
                  {uniqueOwners.filter(o => o !== 'Unassigned').map(owner => (
                    <option key={owner} value={owner}>{owner}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Delivery Date</label>
                <input
                  type="date"
                  value={editingSticky?.deliveryDate?.split('T')[0] || ''}
                  onChange={e => setEditingSticky(prev => prev ? ({ ...prev, deliveryDate: e.target.value }) : null)}
                  className="w-full p-2.5 bg-gray-100 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none"
                />
              </div>
           </div>

           {/* Blocker */}
           {editingSticky?.status === 'red' && (
             <div>
                <label className="block text-xs text-red-500 mb-1.5">Blocker</label>
                <input
                  type="text"
                  value={editingSticky?.blocker || ''}
                  onChange={e => setEditingSticky(prev => prev ? ({ ...prev, blocker: e.target.value }) : null)}
                  placeholder="What's blocking this?"
                  className="w-full p-2.5 bg-red-50 rounded-lg text-sm focus:ring-2 focus:ring-red-200 outline-none"
                />
             </div>
           )}

           {/* Knowledge Base */}
              <div>
              <label className="block text-xs text-gray-400 mb-1.5 flex items-center gap-2">
                Knowledge Base
                {editingSticky?.wikiUrl && (
                  <a
                    href={editingSticky.wikiUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 hover:text-blue-600"
                  >
                    <ExternalLink size={10} />
                  </a>
                )}
              </label>
                 <input
                   type="url"
                   value={editingSticky?.wikiUrl || ''}
                   onChange={e => setEditingSticky(prev => prev ? ({ ...prev, wikiUrl: e.target.value }) : null)}
                placeholder="https://notion.so/..."
                className="w-full p-2.5 bg-gray-100 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none"
                 />
              </div>

           {/* Notes */}
           {editingSticky?.notes && (
              <div>
               <label className="block text-xs text-gray-400 mb-1.5">Notes</label>
               <div className="text-sm text-gray-600 leading-relaxed space-y-1">
                 {editingSticky.notes.split('\n').map((line, idx) => {
                   // Check if line is a URL (engineering or other link)
                   if (line.trim().startsWith('🔗 ')) {
                     const url = line.trim().replace('🔗 ', '');
                     const isEngineering = editingSticky.notes!.split('\n')[idx - 1]?.includes('Engineering');
                     return (
                       <a
                         key={idx}
                         href={url}
                         target="_blank"
                         rel="noopener noreferrer"
                         className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline pl-2"
                       >
                         🔗 {isEngineering ? 'View Engineering Deliverable' : 'Open Link'}
                         <ExternalLink size={12} />
                       </a>
                     );
                   }
                   // Check if line contains a Notion URL
                   if (line.includes('notion.so/')) {
                     const urlMatch = line.match(/(https:\/\/www\.notion\.so\/[^\s]+)/);
                     if (urlMatch) {
                       const url = urlMatch[1];
                       const prefix = line.split('https://')[0];
                       return (
                         <div key={idx} className="flex items-center gap-1">
                           <span>{prefix}</span>
                           <a
                             href={url}
                             target="_blank"
                             rel="noopener noreferrer"
                             className="text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1"
                           >
                             Open <ExternalLink size={12} />
                           </a>
              </div>
                       );
                     }
                   }
                   return <p key={idx}>{line}</p>;
                 })}
           </div>
           </div>
           )}
        </div>
      </Modal>

      {/* --- Milestone Detail Modal --- */}
      {selectedMilestone && (
        <Modal
          isOpen={isMilestoneModalOpen}
          onClose={() => setIsMilestoneModalOpen(false)}
          title="Key Milestone Details"
          footer={
             <div className="w-full flex justify-between items-center">
               <button
                  onClick={() => {
                     if(window.confirm("Delete this milestone?")) {
                        deleteMilestone(selectedMilestone.id);
                        setIsMilestoneModalOpen(false);
                     }
                  }}
                  className="text-red-500 hover:bg-red-50 px-3 py-2 rounded text-xs font-bold"
               >
                 Delete Milestone
               </button>
               <button
                  onClick={() => setIsMilestoneModalOpen(false)}
                  className="bg-slate-900 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-slate-800"
               >
                 Close
               </button>
             </div>
          }
        >
          <div className="space-y-8">
            {/* Header Section */}
            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
               <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-1">{selectedMilestone.title}</h2>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                       <span className="flex items-center gap-1.5"><Calendar size={14} /> {selectedMilestone.date}</span>
                       <span className="flex items-center gap-1.5 font-medium px-2 py-0.5 rounded-full bg-white border border-slate-200 text-xs">
                          {selectedMilestone.quarterId}
                       </span>
                    </div>
                  </div>
                  <div className={`px-4 py-1.5 rounded-full text-white text-xs font-bold uppercase tracking-wider ${
                     selectedMilestone.status === 'green' ? 'bg-green-500' :
                     selectedMilestone.status === 'yellow' ? 'bg-amber-500' : 'bg-red-500'
                  }`}>
                     {selectedMilestone.status === 'green' ? 'On Track' : selectedMilestone.status === 'yellow' ? 'At Risk' : 'Blocked'}
                  </div>
               </div>

               <div className="mt-4 pt-4 border-t border-slate-200/50">
                  <p className="text-slate-700 leading-relaxed text-sm whitespace-pre-wrap">{selectedMilestone.description}</p>
               </div>
            </div>

            {/* Adjacent Deliverables */}
            <div>
               <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                 <CheckCircle size={14} /> Adjacent Deliverables ({selectedMilestone.quarterId})
               </h3>

               <div className="space-y-4">
                  {LANES.map(lane => {
                     const laneStickies = filteredStickies.filter(
                       s => s.quarterId === selectedMilestone.quarterId && s.laneId === lane.id
                     );

                     if (laneStickies.length === 0) return null;

                     return (
                        <div key={lane.id} className="border border-slate-200 rounded-lg overflow-hidden">
                           <div className={`px-3 py-2 ${lane.headerColorClass} bg-opacity-10 border-b border-slate-100 flex items-center gap-2`}>
                              <div className={`p-1 rounded-full text-white ${lane.headerColorClass} shadow-sm`}>
                                 {React.cloneElement(lane.icon as React.ReactElement, { size: 12 })}
                              </div>
                              <span className="text-xs font-bold text-slate-800">{lane.title}</span>
                           </div>
                           <div className="bg-slate-50 p-2 space-y-2">
                              {laneStickies.map(sticky => (
                                 <div key={sticky.id} onClick={() => {setIsMilestoneModalOpen(false); openEditModal(sticky)}} className="bg-white p-3 rounded border border-slate-200 shadow-sm hover:shadow-md cursor-pointer transition-all flex items-start gap-3">
                                    <div className={`w-1 self-stretch rounded-full ${
                                       sticky.status === 'green' ? 'bg-green-500' : sticky.status === 'yellow' ? 'bg-yellow-500' : 'bg-red-500'
                                    }`}></div>
                                    <div className="flex-1 min-w-0">
                                       <span className={`text-xs font-medium truncate block ${sticky.isDone ? 'line-through text-slate-400' : 'text-slate-800'}`}>{sticky.title}</span>
                                       {sticky.owner && sticky.owner !== 'Unassigned' && <div className="text-[10px] text-slate-500 mt-0.5">Owner: {sticky.owner}</div>}
                                    </div>
                                    {sticky.blocker && !sticky.isDone && (
                                       <AlertTriangle size={14} className="text-red-500 shrink-0" />
                                    )}
                                    {sticky.isDone && (
                                       <CheckCircle size={14} className="text-green-500 shrink-0" />
                                    )}
                                 </div>
                              ))}
                           </div>
                        </div>
                     )
                  })}

                  {filteredStickies.filter(s => s.quarterId === selectedMilestone.quarterId).length === 0 && (
                     <div className="text-center py-8 text-slate-400 text-sm bg-slate-50 rounded-lg border border-dashed border-slate-200">
                        No deliverables linked to this quarter yet.
                     </div>
                  )}
               </div>
            </div>
          </div>
        </Modal>
      )}

      {/* === MOVE CONFIRMATION MODAL === */}
      {pendingMove && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={cancelMove} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-float w-full max-w-sm p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Update Delivery Date
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Set the new delivery date for this outcome.
              </p>

              {/* Show outcome name */}
              <div className="mb-4 p-3 bg-gray-50 rounded-md">
                <p className="text-sm font-medium text-gray-800">
                  {extractOutcome(stickies.find(s => s.id === pendingMove.stickyId)?.title || '')}
                </p>
              </div>

              {/* Date input */}
              <div className="mb-6">
                <label className="block text-xs text-gray-400 mb-1.5">Delivery Date</label>
                <input
                  type="date"
                  autoFocus
                  value={pendingMove.newDeliveryDate}
                  onChange={(e) => setPendingMove({ ...pendingMove, newDeliveryDate: e.target.value })}
                  className="w-full p-3 bg-gray-100 rounded-lg text-sm focus:bg-white focus:ring-2 focus:ring-gray-200 outline-none"
                />
              </div>

              {/* Buttons */}
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={cancelMove}
                  className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmMove}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800"
                >
                  Confirm Move
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
