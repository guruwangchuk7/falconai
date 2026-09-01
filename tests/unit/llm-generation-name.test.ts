import { describe, it, expect } from 'vitest';
import { generationName } from '@falcon/llm';

describe('generationName', () => {
  it('uses meta.name when present', () => expect(generationName({ name: 'mine' })).toBe('mine'));
  it('falls back to "chat"', () => expect(generationName(undefined)).toBe('chat'));
});
