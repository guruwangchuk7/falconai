// Drizzle table definitions — mirror 0001_init.sql for the query builder.
// Partitioning + RLS live in the SQL migration (Drizzle can't express them); this file is the
// typed surface the app queries through. Every tenant table carries workspace_id.

import {
  pgTable, uuid, text, jsonb, timestamp, integer, boolean, vector, unique,
} from 'drizzle-orm/pg-core';

export const workspace = pgTable('workspace', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  settings: jsonb('settings').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
  sourceRef: text('source_ref'),
  revisitAt: timestamp('revisit_at', { withTimezone: true }),
  embedding: vector('embedding', { dimensions: 1024 }),
  embeddingModel: text('embedding_model'),
  embeddingVersion: text('embedding_version'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
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
