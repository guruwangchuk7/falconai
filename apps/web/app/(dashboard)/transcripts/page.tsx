import { TranscriptForm } from './TranscriptForm';

export const runtime = 'nodejs';

export default function TranscriptsPage() {
  return (
    <main>
      <h1 className="font-display text-[32px] font-medium leading-tight tracking-[-0.2px] text-ink">Add a transcript</h1>
      <p className="mt-3 max-w-2xl text-[15px] text-muted">
        Paste a meeting or call transcript and Falcon pulls out the decisions — each one lands in your
        Decisions queue as an unconfirmed draft, cited to the exact lines it came from. Confirm the ones that
        are real; only confirmed decisions become answerable memory.
      </p>
      <div className="mt-8 max-w-2xl">
        <TranscriptForm />
      </div>
    </main>
  );
}
