import { signIn } from '@/lib/auth';

export const runtime = 'nodejs';

// Friendly copy for the error codes Auth.js appends to the sign-in URL on failure.
const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked: 'That email is already linked to a different sign-in method. Use the one you signed up with.',
  AccessDenied: 'Access was denied. If this is a private pilot, your account may not be on the list yet.',
  Configuration: 'Sign-in is misconfigured on our end. Hang tight — we’re on it.',
  Verification: 'That sign-in link has expired. Please try again.',
};

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 4.7 18 5 18 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5A11.5 11.5 0 0 0 23.5 12C23.5 5.7 18.3.5 12 .5z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5H1.2v3.1C3.2 21.3 7.3 24 12 24z" />
      <path fill="#FBBC05" d="M5.2 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.2A12 12 0 0 0 0 12c0 1.9.5 3.8 1.2 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.3 0 3.2 2.7 1.2 6.6l4 3.1c1-2.9 3.7-4.9 6.8-4.9z" />
    </svg>
  );
}

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string; error?: string }> }) {
  const { callbackUrl, error } = await searchParams;
  const redirectTo = callbackUrl && callbackUrl.startsWith('/') ? callbackUrl : '/';
  const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-soft px-6">
      <div className="w-full max-w-[380px]">
        <div className="rounded-2xl border border-hairline bg-surface px-8 py-9 shadow-[0_1px_3px_rgba(12,10,9,0.04)]">
          {/* brand */}
          <div className="flex items-center gap-2.5 text-ink">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/falcon.png" alt="Falcon" width={36} height={36} className="h-9 w-9 object-contain" />
            <span className="font-display text-[19px] font-medium">Falcon</span>
          </div>

          <h1 className="mt-7 font-display text-[24px] font-medium leading-tight text-ink">Sign in to Falcon</h1>
          <p className="mt-2 text-[14px] text-muted">
            Your work memory — what your team discussed, decided, and shipped, with the source behind every answer.
          </p>

          {error && (
            <p className="mt-5 rounded-xl border border-hairline bg-surface-strong/60 px-3.5 py-2.5 text-[13px] text-body">
              {ERRORS[error] ?? 'Something went wrong signing in. Please try again.'}
            </p>
          )}

          <div className="mt-7 flex flex-col gap-2.5">
            {/* GitHub — primary, for engineers (also powers repo sync) */}
            <form
              action={async () => {
                'use server';
                await signIn('github', { redirectTo });
              }}
            >
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2.5 rounded-full bg-primary px-4 py-3 text-[14.5px] font-medium text-white transition-colors hover:bg-ink"
              >
                <GitHubIcon />
                Continue with GitHub
              </button>
            </form>

            {/* Google — for pilot testers without GitHub */}
            {googleEnabled && (
              <form
                action={async () => {
                  'use server';
                  await signIn('google', { redirectTo });
                }}
              >
                <button
                  type="submit"
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-hairline-strong bg-surface px-4 py-3 text-[14.5px] font-medium text-ink transition-colors hover:bg-surface-strong"
                >
                  <GoogleIcon />
                  Continue with Google
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-[12px] leading-relaxed text-muted-soft">
            By continuing you agree to Falcon’s pilot terms. Private by default — your work stays in your own workspace.
          </p>
        </div>

        <p className="mt-6 text-center text-[12.5px] text-muted-soft">Falcon · private beta</p>
      </div>
    </main>
  );
}
