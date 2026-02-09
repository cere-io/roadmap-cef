import React from 'react';

export type StickyStatus = 'green' | 'yellow' | 'red';

export interface StickyNote {
  id: string;
  title: string;
  owner: string;
  laneId: string;
  quarterId: string;
  isDone: boolean;
  status: StickyStatus;
  wikiUrl?: string;
  blocker?: string;
  deliveryDate?: string;
  notes?: string;
  milestoneId?: string;
  milestoneTitle?: string;
}

export interface Milestone {
  id: string;
  title: string;
  quarterId: string;
  date: string;
  status: StickyStatus;
  description: string;
  colorClass: string;
}

export interface Lane {
  id: string;
  title: string;
  subtitle: string;
  colorClass: string;
  headerColorClass: string;
  icon: React.ReactNode;
  group: string;
}

export interface Quarter {
  id: string;
  label: string;
  year: number;
}
