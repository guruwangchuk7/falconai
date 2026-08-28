import { eq } from 'drizzle-orm';
import { schema, type TenantTx } from '@falcon/db';
import { EMBEDDING_MODEL, EMBEDDING_VERSION, type EmbeddingProvider } from '@falcon/llm';
import type { ArtifactInput, TrustTier } from '@falcon/integrations';

const CHUNK_SIZE = 1200;

/** Type-aware chunking (F2.2). Simple char-window splitter over title + body; each chunk
 *  inherits the artifact's ingestion trust tier (F7.2). */
export function chunkArtifact(a: { title: string | null; body: string | null; trustTier: TrustTier }): { content: string; trustTier: TrustTier }[] {
  const text = [a.title, a.body].filter((x): x is string => !!x).join('\n\n');
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE));
  if (chunks.length === 0) chunks.push(a.title ?? '');
  return chunks.map((content) => ({ content, trustTier: a.trustTier }));
}

/** Upsert an artifact (idempotent on workspace_id+source+external_ref). Must run inside withTenant. */
export async function upsertArtifact(tx: TenantTx, workspaceId: string, userId: string, input: ArtifactInput): Promise<string> {
  const updatedAt = input.sourceUpdatedAt ? new Date(input.sourceUpdatedAt) : null;
  const rows = await tx
    .insert(schema.artifact)
    .values({
      workspaceId, userId, source: input.source, externalRef: input.externalRef, type: input.type,
      title: input.title, body: input.body, repoOrProject: input.repoOrProject,
      aclTags: input.aclTags, trustTier: input.trustTier, sourceUpdatedAt: updatedAt,
      lastSyncedAt: new Date(), isStale: false,
    })
    .onConflictDoUpdate({
      target: [schema.artifact.workspaceId, schema.artifact.source, schema.artifact.externalRef],
      set: {
        title: input.title, body: input.body, aclTags: input.aclTags, trustTier: input.trustTier,
        sourceUpdatedAt: updatedAt, lastSyncedAt: new Date(), isStale: false,
      },
    })
    .returning({ id: schema.artifact.id });
  return rows[0]!.id;
}

/** Chunk + embed + (re)index an artifact's chunks. Idempotent: replaces prior chunks. */
export async function indexArtifact(tx: TenantTx, workspaceId: string, artifactId: string, embeddings: EmbeddingProvider): Promise<void> {
  const arts = await tx.select().from(schema.artifact).where(eq(schema.artifact.id, artifactId)).limit(1);
  const a = arts[0];
  if (!a) return;
  const chunks = chunkArtifact({ title: a.title, body: a.body, trustTier: a.trustTier as TrustTier });
  const vectors = await embeddings.embed(chunks.map((c) => c.content), 'document');
  await tx.delete(schema.artifactChunk).where(eq(schema.artifactChunk.artifactId, artifactId));
  await tx.insert(schema.artifactChunk).values(
    chunks.map((c, i) => ({
      workspaceId, artifactId, chunkIndex: i, content: c.content, trustTier: c.trustTier,
      embedding: vectors[i]!, embeddingModel: EMBEDDING_MODEL, embeddingVersion: EMBEDDING_VERSION,
    })),
  );
}
