import { it, expect } from 'vitest';
import { canSeeVisibility, orderChain, buildTimeline, type StructuralNode, type TimelineContent } from '@falcon/core';

const node = (id: string, supersedesId: string | null, over: Partial<StructuralNode> = {}): StructuralNode => ({
  id, supersedesId, visibility: 'workspace', participants: null,
  confirmedAt: new Date(`2026-0${id}-01T00:00:00Z`), origin: 'manual', status: 'superseded', ...over,
});

it('canSeeVisibility: workspace is visible to anyone; attendees_only only to a participant', () => {
  expect(canSeeVisibility('workspace', null, undefined)).toBe(true);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], 'u1')).toBe(true);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], 'u2')).toBe(false);
  expect(canSeeVisibility('attendees_only', [{ userId: 'u1' }], undefined)).toBe(false);
});

it('orderChain: linearizes a 3-node chain root->tip regardless of input order', () => {
  const rows = [node('3', '2', { status: 'confirmed' }), node('1', null), node('2', '1')];
  const { ordered, forked } = orderChain(rows);
  expect(ordered.map((n) => n.id)).toEqual(['1', '2', '3']);
  expect(forked).toBe(false);
});

it('buildTimeline: marks the tip current, the entry viewed, and masks nodes absent from content', () => {
  const rows = [node('1', null), node('2', '1', { visibility: 'attendees_only', participants: [{ userId: 'x' }] }), node('3', '2', { status: 'confirmed' })];
  const { ordered } = orderChain(rows);
  const content = new Map<string, TimelineContent>([
    ['1', { id: '1', title: 'SQLite', decision: 'use sqlite', rationale: 'simple', origin: 'manual', confirmedByName: 'Guru' }],
    ['3', { id: '3', title: 'Neon', decision: 'use neon', rationale: 'scale', origin: 'manual', confirmedByName: 'Dana' }],
  ]); // node 2 intentionally absent -> masked
  const tl = buildTimeline(ordered, content, '3');
  expect(tl).toHaveLength(3);
  expect(tl[0]).toMatchObject({ restricted: false, id: '1', isCurrent: false, isViewed: false });
  expect(tl[1]).toEqual({ restricted: true, isCurrent: false });
  expect(tl[2]).toMatchObject({ restricted: false, id: '3', isCurrent: true, isViewed: true });
});

it('buildTimeline: a masked TIP surfaces as restricted + isCurrent (current version you cannot see)', () => {
  const rows = [node('1', null), node('2', '1', { visibility: 'attendees_only', participants: [{ userId: 'x' }], status: 'confirmed' })];
  const { ordered } = orderChain(rows);
  const content = new Map<string, TimelineContent>([['1', { id: '1', title: 'A', decision: 'a', rationale: null, origin: 'manual', confirmedByName: null }]]);
  const tl = buildTimeline(ordered, content, '1');
  expect(tl[1]).toEqual({ restricted: true, isCurrent: true });
});

it('orderChain: a fork (two successors of one node) is deterministic by confirmedAt and flags forked', () => {
  const rows = [node('1', null), node('2', '1', { confirmedAt: new Date('2026-02-01') }), node('3', '1', { confirmedAt: new Date('2026-03-01') })];
  const { ordered, forked } = orderChain(rows);
  expect(forked).toBe(true);
  expect(ordered[0]!.id).toBe('1');
  expect(ordered[1]!.id).toBe('2'); // earliest successor wins deterministically
});
