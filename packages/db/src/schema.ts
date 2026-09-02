// Drizzle table definitions — mirror 0001_init.sql for the query builder.
// Partitioning + RLS live in the SQL migration (Drizzle can't express them); this file is the
// typed surface the app queries through. Every tenant table carries workspace_id.

import {
  pgTable, uuid, text, jsonb, timestamp, integer, boolean, bigint, vector, unique, real, primaryKey,
} from 'drizzle-orm/pg-core';

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  settings: jsonb('settings').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  meetingRetentionDays: integer('meeting_retention_days').notNull().default(0), // D6: 0 = off
});

export const users = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  githubLogin: text('github_login'),
  linearId: text('linear_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const membership = pgTable('membership', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  role: text('role').notNull().default('engineer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.userId, t.workspaceId) }));

export const connection = pgTable('connection', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  provider: text('provider').notNull(),                 // github | linear | jira
  status: text('status').notNull().default('active'),   // active | error | disconnected
  externalAccountRef: text('external_account_ref'),
  secretRef: text('secret_ref'),                        // pointer into the secrets store, never the token
  syncCursor: jsonb('sync_cursor'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  mineWatermark: timestamp('mine_watermark', { withTimezone: true }).notNull().defaultNow(),
});

export const artifact = pgTable('artifact', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  source: text('source').notNull(),
  externalRef: text('external_ref').notNull(),
  type: text('type').notNull(),
  title: text('title'),
  body: text('body'),
  repoOrProject: text('repo_or_project'),
  aclTags: jsonb('acl_tags').notNull(),
  trustTier: text('trust_tier').notNull(),              // trusted | mixed | untrusted
  sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  isStale: boolean('is_stale').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  state: text('state'),                                 // merged | closed | open | completed | canceled | ...
  mergedClosedAt: timestamp('merged_closed_at', { withTimezone: true }),
});

export const artifactChunk = pgTable('artifact_chunk', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  trustTier: text('trust_tier').notNull(),
  embedding: vector('embedding', { dimensions: 1024 }).notNull(),
  embeddingModel: text('embedding_model').notNull(),
  embeddingVersion: text('embedding_version').notNull(),
});

export const decisionRecord = pgTable('decision_record', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  title: text('title').notNull(),
  decision: text('decision'),
  options: jsonb('options'),
  rationale: text('rationale'),
  dissent: text('dissent'),
  ownerUserId: uuid('owner_user_id'),
  status: text('status').notNull().default('unconfirmed'), // unconfirmed | confirmed | superseded
  supersedesId: uuid('supersedes_id'),
  confirmedBy: uuid('confirmed_by'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }), // feature 005: dismiss tombstone (orthogonal to status)
  sourceRef: text('source_ref'),
  revisitAt: timestamp('revisit_at', { withTimezone: true }),
  embedding: vector('embedding', { dimensions: 1024 }),
  embeddingModel: text('embedding_model'),
  embeddingVersion: text('embedding_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  origin: text('origin').notNull().default('manual'),   // ship 2: manual | mined (queue badges "Suggested from …")
  visibility: text('visibility').notNull().default('workspace'), // D13: workspace | attendees_only
  participants: jsonb('participants'),                           // D12: [{ userId, displayName }]
});

export const workDigest = pgTable('work_digest', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  generatedText: text('generated_text'),
  generatedAt: timestamp('generated_at', { withTimezone: true }),
  model: text('model'),
  modelVersion: text('model_version'),
  editedText: text('edited_text'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
}, (t) => ({ uq: unique().on(t.workspaceId, t.userId) }));

export const syncRun = pgTable('sync_run', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  connectionId: uuid('connection_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  status: text('status').notNull().default('ok'),
  error: text('error'),
  artifactsSynced: integer('artifacts_synced').notNull().default(0),
});

// Ship 2 (Decision Miner) — mine-once idempotency ledger (0005_decision_miner.sql). Not
// partitioned (low volume, one row per mined artifact).
export const minedArtifact = pgTable('mined_artifact', {
  workspaceId: uuid('workspace_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  minedAt: timestamp('mined_at', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').notNull(), // suggested | no_decision | error | deferred
  extractorVersion: text('extractor_version').notNull(),
  contentHash: text('content_hash').notNull(),
  decisionId: uuid('decision_id'),
  maxCandidateScore: real('max_candidate_score'),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.artifactId] }) }));

// ---------- In-Meeting Decision Listener (0006_in_meeting_listener.sql) ----------

export const meeting = pgTable('meeting', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  title: text('title'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull().defaultNow(),
  attendees: jsonb('attendees').notNull(),                 // [{ userId, displayName, isMember, isFalconUser }]
  designatedReviewerUserId: uuid('designated_reviewer_user_id'),
  transcriptRetainedUntil: timestamp('transcript_retained_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.id] }) }));

export const meetingTranscript = pgTable('meeting_transcript', {
  workspaceId: uuid('workspace_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  utterances: jsonb('utterances').notNull(),               // [{ idx, speaker, userId, text, tsMs }]
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.meetingId] }) }));

export const decisionSpan = pgTable('decision_span', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  decisionId: uuid('decision_id').notNull(),
  kind: text('kind').notNull(),                            // decision | rationale
  speaker: text('speaker'),
  tsMs: bigint('ts_ms', { mode: 'number' }),
  utteranceIdx: integer('utterance_idx'),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.id] }) }));

export const minedMeeting = pgTable('mined_meeting', {
  workspaceId: uuid('workspace_id').notNull(),
  meetingId: uuid('meeting_id').notNull(),
  minedAt: timestamp('mined_at', { withTimezone: true }).notNull().defaultNow(),
  result: text('result').notNull(),                        // suggested | no_decision | error | deferred
  extractorVersion: text('extractor_version').notNull(),
  transcriptRetainedUntil: timestamp('transcript_retained_until', { withTimezone: true }),
  decisionId: uuid('decision_id'),
  maxCandidateScore: real('max_candidate_score'),
}, (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.meetingId] }) }));

// ---------- Phase 2: Personal Falcon (0002_personal_falcon.sql) ----------

export const conversation = pgTable('conversation', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  title: text('title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const question = pgTable('question', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  conversationId: uuid('conversation_id').notNull(),
  userId: uuid('user_id').notNull(),
  text: text('text').notNull(),
  kind: text('kind').notNull().default('qa'),          // qa | summary
  scope: jsonb('scope'),                               // summary: { topic?, from?, to? }
  askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
});

export const answer = pgTable('answer', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  questionId: uuid('question_id').notNull(),
  status: text('status').notNull(),                    // grounded | no_grounded_answer
  generatedText: text('generated_text'),
  model: text('model'),
  modelVersion: text('model_version'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  editedText: text('edited_text'),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  dataAsOf: timestamp('data_as_of', { withTimezone: true }),
});

export const answerCitation = pgTable('answer_citation', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  answerId: uuid('answer_id').notNull(),
  artifactId: uuid('artifact_id').notNull(),
  chunkId: uuid('chunk_id'),
  claimRef: text('claim_ref'),
});

export const queryEvent = pgTable('query_event', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull().default('qa'),          // qa | summary
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Phase 3: Pairing (0003_pairing.sql) ----------
// Durable, tenant-scoped records. Live session state (merged transcript, open-thread folds,
// membership) lives in Redis Streams and is replayed (CX-1); these tables hold durable/finalized
// data. Raw audio is never persisted anywhere (§12.3/R6). See specs/004-pairing/data-model.md.

export const session = pgTable('session', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionKey: text('session_key').notNull(),           // calendar event id | team-auto id | code id
  origin: text('origin').notNull(),                    // calendar | team_auto | code
  status: text('status').notNull().default('active'),  // active | ended
  ownerFencingToken: bigint('owner_fencing_token', { mode: 'number' }).notNull().default(0), // §12.5/R14
  retentionClass: text('retention_class').notNull().default('standard'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

export const sessionMembership = pgTable('session_membership', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleProfile: text('role_profile').notNull().default('engineer'), // F11 Context Pack
  joinOrigin: text('join_origin').notNull(),           // calendar | team_auto | code
  consentState: text('consent_state').notNull().default('granted'), // granted | revoked
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }), // null = present
});

export const sessionCode = pgTable('session_code', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  code: text('code').notNull(),                        // 6-char, F7.3
  scope: text('scope').notNull().default('workspace'), // workspace | cross_workspace
  maxJoins: integer('max_joins').notNull().default(10),
  joinCount: integer('join_count').notNull().default(0),
  createdBy: uuid('created_by').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // TTL
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.workspaceId, t.code) }));

export const consentPair = pgTable('consent_pair', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),         // initiating workspace = RLS scope
  userLo: uuid('user_lo').notNull(),                   // canonical-ordered so the pair is unique
  userHi: uuid('user_hi').notNull(),
  isCrossWorkspace: boolean('is_cross_workspace').notNull().default(false), // if true, always re-prompt (§7.2)
  grantedAt: timestamp('granted_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => ({ uq: unique().on(t.workspaceId, t.userLo, t.userHi) }));

export const openThread = pgTable('open_thread', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  topicEmbedding: vector('topic_embedding', { dimensions: 1024 }), // voyage-code-4 (§12.9)
  embeddingModel: text('embedding_model'),
  embeddingVersion: text('embedding_version'),
  firstSeenSeq: bigint('first_seen_seq', { mode: 'number' }).notNull(),
  lastSeenSeq: bigint('last_seen_seq', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('open'),    // open | merged | split (F6.1a)
  mergedInto: uuid('merged_into'),
});

export const sessionVisibilityScope = pgTable('session_visibility_scope', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  membershipVersion: integer('membership_version').notNull(), // bumped on join/leave (F9.1a)
  artifactScope: jsonb('artifact_scope').notNull(),    // intersection of all participants' ACL-visible artifacts
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.workspaceId, t.sessionId) }));

export const sessionEvent = pgTable('session_event', {
  id: uuid('id').notNull().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sessionId: uuid('session_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),    // per-session monotonic
  type: text('type').notNull(),                        // member_joined | utterance_final | thread_* | ...
  payload: jsonb('payload').notNull(),                 // NO raw audio (§12.3)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
