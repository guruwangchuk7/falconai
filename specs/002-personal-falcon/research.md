# Phase 0 Research: Personal Falcon

All decisions reuse the Phase 1 spine; the only genuinely new design is the **grounded answer
path**. No open NEEDS CLARIFICATION remain.

## D-1: Grounded answer generation (the core new path)

- **Decision**: Retrieval-augmented generation with a *structured, verify-then-drop* grounding
  gate. Flow: (1) embed the question and retrieve top-k candidate chunks via the existing
  `retrieve.ts` (pgvector ANN + Voyage rerank), scoped by `withTenant` + ACL; (2) prompt Claude to
  answer using ONLY those candidates and to emit **structured output** — a list of claims, each
  with the artifact ID(s) it rests on; (3) a deterministic verifier drops any claim whose cited ID
  is not in the retrieved, ACL-checked candidate set; (4) if no claims survive, return the explicit
  "no grounded answer" state.
- **Rationale**: Constitution II gates on *retrieval, not generation*. Making the model cite
  retrieved IDs and then verifying them in code turns "grounded or silent" into an enforced
  invariant, not a prompt hope. Mirrors Gate 3 (no citation → no publish) applied to answers.
- **Alternatives rejected**: (a) trust-the-prompt (model told to cite) — unverifiable, violates II;
  (b) pure extractive answers (no LLM synthesis) — fails the "explain / summarize" use cases users
  asked for; (c) post-hoc fact-check against the whole corpus — slower and still ungrounded to the
  *retrieved* set.

## D-2: Provenance / ACL enforcement

- **Decision**: Reuse Phase 1's tenant-isolated, ACL-checked retrieval as the *only* source of
  candidate artifacts. The answer service never reads artifacts outside the `withTenant` +
  ACL-filtered result. Citations render as links the user can open to verify.
- **Rationale**: R25/§12.9 (isolation) and F9.1a/R15 (ACL) are already enforced at the DB layer via
  the `falcon_app` role (proven live). Building answers strictly on that result inherits the
  guarantee — no new trust boundary.
- **Alternatives rejected**: a separate answer-time ACL check layered on app code — duplicative and
  a place for drift; the DB boundary is the source of truth (Constitution III).

## D-3: Model + provider

- **Decision**: Claude **Haiku** (pinned explicit version, per PRD: participant/personal agents use
  Haiku) behind the existing `@falcon/llm` provider. Structured output for the claims+citations
  shape. Voyage for query embedding + rerank (existing).
- **Rationale**: Personal Q&A is high-volume and latency-sensitive; Haiku is the PRD-designated tier
  and keeps cost/latency low (SC-003). Constitution V: pin the version, no `-latest`; a change is
  gated on the eval.
- **Alternatives rejected**: Sonnet for every answer — overkill/cost for personal Q&A (Sonnet is the
  Coordinator tier); `-latest` — banned by §12.8/R22.

## D-4: Streaming vs batch

- **Decision**: Stream the answer to the panel (first tokens fast), then attach verified citations.
  Run the grounding verification server-side before/while streaming claims so an ungrounded claim is
  never shown.
- **Rationale**: SC-003 wants a snappy feel; streaming makes <10s feel instant. Pull model → no
  hard real-time bound, so correctness (verify before show) wins over raw speed.
- **Alternatives rejected**: block until the full verified answer — worse perceived latency.

## D-5: Conversation persistence + retention metric

- **Decision**: Persist conversations/questions/answers/citations in tenant-scoped tables (RLS +
  FORCE, granted to `falcon_app`). Log a lightweight **query event** (user, tenant, timestamp) on
  every ask to compute solo retention (SC-005) directly.
- **Rationale**: Multi-turn follow-ups (FR-011) need history; SC-005 (return-to-ask) is the D1
  confirm metric and must be measurable from day one. Keep query events minimal (no answer content
  needed for the metric).
- **Alternatives rejected**: stateless Q&A — loses follow-up context and the retention signal;
  external analytics only — retention is a first-class product gate, keep it in the tenant DB.

## D-6: Targeted prep summaries vs the existing digest

- **Decision**: Generalize the existing `digest.ts` into a scoped summary: same grounded-generation
  path as D-1 but seeded by a topic/time filter instead of a free question. Reuse the digest's
  edit-is-authoritative behavior (FR-009).
- **Rationale**: The digest is already a coarse self-context summary (shipped Phase 1); a targeted
  summary is the same machinery with a narrower retrieval scope — minimal new surface.
- **Alternatives rejected**: a separate summarization subsystem — needless duplication.

## D-7: Delivery surface

- **Decision**: A **panel/page in the existing Next.js dashboard** (`apps/web`), not the desktop
  app. Desktop panel arrives with the meeting/pairing phases.
- **Rationale**: Personal-first wants the cheapest path to value; the dashboard already hosts
  `/me/digest` and `/decisions` and is authed + tenant-scoped. WoZ users liked a readable sidebar.
- **Alternatives rejected**: Tauri desktop app now — that's Phase 3+ scope and unnecessary for pull
  Q&A.

## Open process items (not technical unknowns)

- **PRD amendment for D1** must land before implementation (Constitution I).
- Confirm whether any PRD §22 **AD-1…AD-8** governs the retrieval/answer path; resolve by spike in
  this phase if so.
