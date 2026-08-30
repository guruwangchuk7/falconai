// Shared constants for the authed e2e (T028): seeded ids + the fixed local server the global-setup
// boots. Imported by both global-setup.ts and the spec so they agree on ids/secret/port.

export const A = '00000000-0000-0000-0000-0000000000aa'; // workspace
export const UA = '00000000-0000-0000-0000-0000000000a1'; // user
export const ART = '00000000-0000-0000-0000-0000000000f1'; // seeded artifact

export const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

// A throwaway secret used ONLY for this offline e2e — the spawned server and the cookie minter must
// share it so the minted session decodes. Never a production value (the fake-LLM seam is non-prod too).
export const TEST_AUTH_SECRET = 'e2e-test-secret-not-for-production-00000000000000';
