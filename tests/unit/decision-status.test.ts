import { describe, it, expect } from 'vitest';
import { resolveDecisionStatus, DECISION_QUEUE_LINK } from '@falcon/core';
import type { ResolverClaim, UnconfirmedMatch } from '@falcon/core';

// Feature 005 US2 — the pure four-state resolver (Constitution II; spec §5). No DB/LLM.

const decisionClaim = (id: string): ResolverClaim => ({ citations: [{ type: 'decision', artifactId: id }] });
const artifactClaim: ResolverClaim = { citations: [{ type: 'commit', artifactId: 'art-1' }] };
const match = (id: string, sourceRef: string | null): UnconfirmedMatch => ({ id, sourceRef, createdAt: '2026-09-01T00:00:00.000Z', distance: 0.1 });

describe('resolveDecisionStatus (four-state boundary)', () => {
  it('none → undefined when no decision citation and no unconfirmed match', () => {
    expect(resolveDecisionStatus([artifactClaim], [])).toBeUndefined();
  });

  it('settled → a confirmed decision grounded the answer', () => {
    const s = resolveDecisionStatus([decisionClaim('dec-1')], []);
    expect(s).toEqual({ settled: { decisionId: 'dec-1', changed: false } });
  });

  it('settled.changed = true when the grounded decision supersedes an earlier one', () => {
    const s = resolveDecisionStatus([decisionClaim('dec-1')], [], new Set(['dec-1']));
    expect(s!.settled).toEqual({ decisionId: 'dec-1', changed: true });
  });

  it('proposed → only an unconfirmed candidate matches (nothing confirmed grounded)', () => {
    const s = resolveDecisionStatus([], [match('u1', '#41')]);
    expect(s).toEqual({ proposed: { count: 1, sourceRefs: ['#41'], queueLink: DECISION_QUEUE_LINK } });
    expect(s!.settled).toBeUndefined();
  });

  it('settled + pendingChange CO-OCCUR when a confirmed decision AND an unconfirmed candidate both match', () => {
    const s = resolveDecisionStatus([decisionClaim('dec-1')], [match('u1', '#41')]);
    expect(s!.settled).toEqual({ decisionId: 'dec-1', changed: false });
    expect(s!.pendingChange).toEqual({ count: 1, sourceRefs: ['#41'], queueLink: DECISION_QUEUE_LINK });
    expect(s!.proposed).toBeUndefined(); // pending rides alongside settled, not as a standalone
  });

  it('carries ONLY metadata for unconfirmed candidates — never content (FR-008)', () => {
    const s = resolveDecisionStatus([], [match('u1', '#41'), match('u2', null)]);
    // The only keys a PendingRef exposes are count / sourceRefs / queueLink.
    expect(Object.keys(s!.proposed!).sort()).toEqual(['count', 'queueLink', 'sourceRefs']);
    expect(s!.proposed!.count).toBe(2);
    expect(s!.proposed!.sourceRefs).toEqual(['#41', null]);
  });
});
