# Calibrating `DECISION_MEETING_MIN_CONFIDENCE`

The suggest-time confidence cutoff (`packages/config`, currently **0.75 — a guess**) is the merged→pilot-ready gap for the in-meeting listener. Extraction on *real conversation* — intra-meeting reversals, overlapping speech, rationale minutes from the decision — is where it actually bites, and none of that has been through real audio yet. This is the tooling to replace the guess with a measurement.

## The blocker is data, not tooling
The harness is built and tested (`packages/core/src/calibrate.ts`, `tests/unit/calibrate.test.ts`). What's missing is a **labeled meeting corpus**. That's the reason the opt-in full-transcript retention setting (design D6) exists — turn it on for consenting pilot workspaces, collect real finalized transcripts, and hand-label the decisions.

## Corpus format
A JSON array of `LabeledMeeting` (see `sample-meeting-corpus.json`):

```jsonc
[
  {
    "id": "some-meeting",
    "gold": [{ "title": "Use GitHub Actions for CI" }],   // decisions a human says SHOULD be extracted; [] = a genuine no-decision meeting
    "utterances": [
      { "idx": 0, "speaker": "Guru", "text": "…" }         // the finalized transcript, in order
    ]
  }
]
```

**Include no-decision meetings** (`"gold": []`). Without them you can't measure false positives — the whole point of a cutoff is to *suppress* weak candidates, and a corpus of only-real-decisions makes every threshold look good.

## Run it

```bash
pnpm --filter @falcon/core calibrate docs/calibration/sample-meeting-corpus.json
```

It runs the **real extractor** once (one LLM call per chunk per meeting — costs money), caches the scored candidates, then sweeps thresholds and prints:

```
threshold  TP  FP  FN   precision  recall   F1
  0.75      12   1   4      0.92     0.75   0.83
  …
Recommended (max F1): 0.70  (current default: 0.75)
```

## Picking the number
Max-F1 is the harness default, but **decide deliberately**: a suggestion queue that a human confirms usually wants a **precision floor** (don't flood the queue with weak guesses) even at some recall cost — a missed decision can be logged manually; a queue full of noise gets ignored and the ritual dies (design D3). Matching is a normalized-title heuristic (`titlesMatch`, Jaccard ≥ 0.5); hand-verify borderline matches before trusting a tight decision.
