import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadEnv, secretsEnv } from '@falcon/config';

/**
 * Dedicated secrets store for third-party OAuth tokens (PRD R26, §12.9, constitution III).
 * Tokens are NEVER stored in the app DB — the app DB holds only the returned `secret_ref`.
 * Envelope encryption: a random per-secret DEK encrypts the token; the KEK (from the secrets
 * env, ultimately a KMS in prod) encrypts the DEK. Only ciphertext is persisted.
 */

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  scope?: string;
  meta?: Record<string, string>;
}

export interface SecretRefInput {
  workspaceId: string;
  provider: 'github' | 'linear' | 'jira';
  connectionId: string;
}

export interface SecretStore {
  put(ref: SecretRefInput, token: OAuthToken): Promise<string>; // returns secret_ref
  get(secretRef: string): Promise<OAuthToken>; // worker-only
  rotate(secretRef: string, token: OAuthToken): Promise<void>;
  revoke(secretRef: string): Promise<void>;
}

interface Envelope {
  encDek: string; // base64 — DEK encrypted under the KEK
  dekIv: string;
  dekTag: string;
  iv: string;
  ct: string; // base64 — token ciphertext under the DEK
  tag: string;
}

const KEK_ALG = 'aes-256-gcm';

function seal(kek: Buffer, plaintext: Buffer): Envelope {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv(KEK_ALG, dek, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const dekIv = randomBytes(12);
  const dekCipher = createCipheriv(KEK_ALG, kek, dekIv);
  const encDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
  const dekTag = dekCipher.getAuthTag();
  return {
    encDek: encDek.toString('base64'),
    dekIv: dekIv.toString('base64'),
    dekTag: dekTag.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function open(kek: Buffer, env: Envelope): Buffer {
  const dekDecipher = createDecipheriv(KEK_ALG, kek, Buffer.from(env.dekIv, 'base64'));
  dekDecipher.setAuthTag(Buffer.from(env.dekTag, 'base64'));
  const dek = Buffer.concat([dekDecipher.update(Buffer.from(env.encDek, 'base64')), dekDecipher.final()]);
  const decipher = createDecipheriv(KEK_ALG, dek, Buffer.from(env.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
}

function refKey(ref: SecretRefInput): string {
  return `${ref.workspaceId}/${ref.provider}/${ref.connectionId}`;
}

/**
 * Dev/self-host backend: an envelope-encrypted JSON file kept OUTSIDE the app database. Prod
 * should use the Infisical backend (or a cloud Secrets Manager) — see createSecretStore.
 */
export class FileSecretStore implements SecretStore {
  constructor(private readonly kek: Buffer, private readonly path: string) {}

  private async load(): Promise<Record<string, Envelope>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, Envelope>;
    } catch {
      return {};
    }
  }
  private async save(all: Record<string, Envelope>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    // Atomic write: temp file + rename, so a crash mid-write can't corrupt the store.
    // (Dev backend — cross-process write races are still possible; prod uses a real SM.)
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(all), { mode: 0o600 });
    await rename(tmp, this.path);
  }

  async put(ref: SecretRefInput, token: OAuthToken): Promise<string> {
    const key = refKey(ref);
    const all = await this.load();
    all[key] = seal(this.kek, Buffer.from(JSON.stringify(token), 'utf8'));
    await this.save(all);
    return key;
  }
  async get(secretRef: string): Promise<OAuthToken> {
    const all = await this.load();
    const env = all[secretRef];
    if (!env) throw new Error(`secret not found: ${secretRef}`);
    return JSON.parse(open(this.kek, env).toString('utf8')) as OAuthToken;
  }
  async rotate(secretRef: string, token: OAuthToken): Promise<void> {
    const all = await this.load();
    if (!all[secretRef]) throw new Error(`secret not found: ${secretRef}`);
    all[secretRef] = seal(this.kek, Buffer.from(JSON.stringify(token), 'utf8'));
    await this.save(all);
  }
  async revoke(secretRef: string): Promise<void> {
    const all = await this.load();
    delete all[secretRef];
    await this.save(all);
  }
}

/** Placeholder for the production backend. Wire an Infisical/cloud-SM client here (research D3). */
export class InfisicalSecretStore implements SecretStore {
  constructor(_url: string, _token: string) {}
  private nope(): never {
    throw new Error('InfisicalSecretStore not implemented — configure the production secrets backend (research D3).');
  }
  put(): Promise<string> { return Promise.resolve(this.nope()); }
  get(): Promise<OAuthToken> { return Promise.resolve(this.nope()); }
  rotate(): Promise<void> { return Promise.resolve(this.nope()); }
  revoke(): Promise<void> { return Promise.resolve(this.nope()); }
}

export function createSecretStore(): SecretStore {
  const env = loadEnv(secretsEnv);
  const kek = Buffer.from(env.SECRETS_KEK, 'base64');
  if (kek.length !== 32) throw new Error('SECRETS_KEK must be 32 bytes (base64-encoded).');
  if (env.SECRETS_BACKEND === 'infisical') {
    if (!env.INFISICAL_URL || !env.INFISICAL_TOKEN) throw new Error('INFISICAL_URL and INFISICAL_TOKEN are required.');
    return new InfisicalSecretStore(env.INFISICAL_URL, env.INFISICAL_TOKEN);
  }
  return new FileSecretStore(kek, env.SECRETS_FILE_PATH ?? '.secrets/store.enc.json');
}
