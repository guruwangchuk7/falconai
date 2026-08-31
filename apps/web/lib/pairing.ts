import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { schema, type TenantTx } from '@falcon/db';
import { deps } from '@/lib/deps';
import type { ActiveSession } from '@/lib/session';

/**
 * Pairing core (spec 004-pairing, US1). Session bootstrap + membership + consent, all tenant-scoped
 * through `deps().db.withTenant` (RLS enforced at the DB layer, §12.9). Strictly plumbing — no cards
 * or nudges (Phase 4). Calendar/team/code are the three join paths (F7.1–F7.3); consent is once per
 * pair (§7.2).
 */

/** Typed error whose `status` maps directly to the route's HTTP response. */
export class PairingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

/** Canonical (lo, hi) ordering so a pair is unique regardless of who initiates (matches the
 *  consent_pair CHECK user_lo < user_hi). */
export function canonicalPair(a: string, b: string): { lo: string; hi: string } {
  return a < b ? { lo: a, hi: b } : { lo: b, hi: a };
}

const CODE_TTL_MS = 60 * 60 * 1000; // 1h
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function makeCode(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}

export interface ResolveResult {
  sessionId: string;
  origin: 'calendar' | 'team_auto' | 'code';
  /** True if any current co-member pair lacks a live internal consent (or is cross-workspace). */
  needsConsent: boolean;
}

/**
 * Resolve or create the session for a calendar event (F7.1), and add the caller as a member. Two
 * people in the same invite land in the same session automatically. Returns whether consent is still
 * required before capture may start (§7.2).
 */
export async function resolveByCalendar(s: ActiveSession, calendarEventId: string): Promise<ResolveResult> {
  return deps().db.withTenant(s.workspaceId, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.session)
      .where(and(eq(schema.session.sessionKey, calendarEventId), eq(schema.session.status, 'active')))
      .limit(1);

    let sessionId = existing[0]?.id;
    if (!sessionId) {
      const created = await tx
        .insert(schema.session)
        .values({ workspaceId: s.workspaceId, sessionKey: calendarEventId, origin: 'calendar' })
        .returning({ id: schema.session.id });
      sessionId = created[0]!.id;
    }

    await ensureMember(tx, s, sessionId, 'calendar');
    const needsConsent = await consentNeeded(tx, s, sessionId);
    return { sessionId, origin: 'calendar' as const, needsConsent };
  });
}

/** Accept a team auto-pair prompt (F7.2): join an already-offered candidate session. */
export async function ackTeamAuto(s: ActiveSession, candidateSessionId: string): Promise<ResolveResult> {
  return deps().db.withTenant(s.workspaceId, async (tx) => {
    const sess = await tx.select().from(schema.session).where(eq(schema.session.id, candidateSessionId)).limit(1);
    if (!sess[0] || sess[0].status !== 'active') throw new PairingError('candidate session not available', 410);
    await ensureMember(tx, s, candidateSessionId, 'team_auto');
    return { sessionId: candidateSessionId, origin: 'team_auto' as const, needsConsent: await consentNeeded(tx, s, candidateSessionId) };
  });
}

/** Join via a 6-char code (F7.3): TTL + max-joins + scope enforced; a leaked code is bounded. */
export async function joinByCode(s: ActiveSession, code: string): Promise<ResolveResult> {
  return deps().db.withTenant(s.workspaceId, async (tx) => {
    const rows = await tx.select().from(schema.sessionCode).where(eq(schema.sessionCode.code, code)).limit(1);
    const rec = rows[0];
    if (!rec) throw new PairingError('unknown code', 404);
    if (rec.expiresAt.getTime() < Date.now()) throw new PairingError('code expired', 410);
    if (rec.joinCount >= rec.maxJoins) throw new PairingError('code join limit reached', 429);

    await tx.update(schema.sessionCode).set({ joinCount: rec.joinCount + 1 }).where(eq(schema.sessionCode.id, rec.id));
    await ensureMember(tx, s, rec.sessionId, 'code');
    return { sessionId: rec.sessionId, origin: 'code' as const, needsConsent: await consentNeeded(tx, s, rec.sessionId) };
  });
}

/** Mint a session code with TTL + rate/scope (F7.3). */
export async function mintCode(
  s: ActiveSession,
  sessionId: string,
): Promise<{ code: string; expiresAt: Date; maxJoins: number; scope: string }> {
  return deps().db.withTenant(s.workspaceId, async (tx) => {
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const code = makeCode();
    await tx.insert(schema.sessionCode).values({
      workspaceId: s.workspaceId,
      sessionId,
      code,
      createdBy: s.userId,
      expiresAt,
    });
    return { code, expiresAt, maxJoins: 10, scope: 'workspace' };
  });
}

/** Graceful leave: mark the membership left; the caller's agent teardown + visibility recompute
 *  (F9.1a) are wired in US2. */
export async function leaveSession(s: ActiveSession, sessionId: string): Promise<void> {
  await deps().db.withTenant(s.workspaceId, (tx) =>
    tx
      .update(schema.sessionMembership)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(schema.sessionMembership.sessionId, sessionId),
          eq(schema.sessionMembership.userId, s.userId),
          isNull(schema.sessionMembership.leftAt),
        ),
      ),
  );
}

export interface SessionView {
  id: string;
  status: string;
  members: { userId: string; roleProfile: string; present: boolean }[];
}

/** Session metadata + current membership (no transcript — that's the SSE stream). 404 for non-members
 *  and cross-tenant ids (RLS makes another tenant's session simply invisible). */
export async function getSessionView(s: ActiveSession, sessionId: string): Promise<SessionView> {
  return deps().db.withTenant(s.workspaceId, async (tx) => {
    const sess = await tx.select().from(schema.session).where(eq(schema.session.id, sessionId)).limit(1);
    if (!sess[0]) throw new PairingError('session not found', 404);
    const members = await tx.select().from(schema.sessionMembership).where(eq(schema.sessionMembership.sessionId, sessionId));
    if (!members.some((m) => m.userId === s.userId && m.leftAt === null)) {
      throw new PairingError('not a session member', 404);
    }
    return {
      id: sess[0].id,
      status: sess[0].status,
      members: members.map((m) => ({ userId: m.userId, roleProfile: m.roleProfile, present: m.leftAt === null })),
    };
  });
}

/** Record once-per-pair consent (§7.2). Cross-workspace pairs are flagged so they always re-prompt. */
export async function recordConsent(
  s: ActiveSession,
  otherUserId: string,
  granted: boolean,
  isCrossWorkspace = false,
): Promise<void> {
  const { lo, hi } = canonicalPair(s.userId, otherUserId);
  await deps().db.withTenant(s.workspaceId, async (tx) => {
    const existing = await tx
      .select()
      .from(schema.consentPair)
      .where(and(eq(schema.consentPair.userLo, lo), eq(schema.consentPair.userHi, hi)))
      .limit(1);
    const patch = granted ? { grantedAt: new Date(), revokedAt: null } : { revokedAt: new Date() };
    if (existing[0]) {
      await tx.update(schema.consentPair).set(patch).where(eq(schema.consentPair.id, existing[0].id));
    } else {
      await tx.insert(schema.consentPair).values({ workspaceId: s.workspaceId, userLo: lo, userHi: hi, isCrossWorkspace, ...patch });
    }
  });
}

// ---------- internals ----------

/** Add the caller as a member if not already present (idempotent re-join). */
async function ensureMember(tx: TenantTx, s: ActiveSession, sessionId: string, origin: 'calendar' | 'team_auto' | 'code'): Promise<void> {
  const present = await tx
    .select()
    .from(schema.sessionMembership)
    .where(and(eq(schema.sessionMembership.sessionId, sessionId), eq(schema.sessionMembership.userId, s.userId), isNull(schema.sessionMembership.leftAt)))
    .limit(1);
  if (present[0]) return;
  await tx.insert(schema.sessionMembership).values({
    workspaceId: s.workspaceId,
    sessionId,
    userId: s.userId,
    joinOrigin: origin,
  });
}

/** True if any current co-member lacks a live internal consent with the caller (cross-workspace pairs
 *  always count as needing a prompt, §7.2). */
async function consentNeeded(tx: TenantTx, s: ActiveSession, sessionId: string): Promise<boolean> {
  const members = await tx
    .select()
    .from(schema.sessionMembership)
    .where(and(eq(schema.sessionMembership.sessionId, sessionId), isNull(schema.sessionMembership.leftAt)));
  const others = members.filter((m) => m.userId !== s.userId);
  for (const m of others) {
    const { lo, hi } = canonicalPair(s.userId, m.userId);
    const c = await tx
      .select()
      .from(schema.consentPair)
      .where(and(eq(schema.consentPair.userLo, lo), eq(schema.consentPair.userHi, hi)))
      .limit(1);
    const rec = c[0];
    if (!rec || rec.grantedAt === null || rec.revokedAt !== null || rec.isCrossWorkspace) return true;
  }
  return false;
}
