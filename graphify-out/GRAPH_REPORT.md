# Graph Report - .  (2026-08-27)

## Corpus Check
- 5 files · ~52,634 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 184 nodes · 243 edges · 24 communities (9 shown, 15 thin omitted)
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 30 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Governance & Product Constraints
- Landing Page & Marketing Site
- Coordinator & Mediation Publishing
- Audio Capture & Cost Governance
- Participant Agents & Triage
- Context Ingestion & Decision Records
- Pairing, Merge & Resilience
- Intervention Gates & Eval/Model Governance
- Quiet Voltage Design Tokens
- Desktop Distribution Risks
- Session Data Model
- Setup & Integrations
- Goal: Frictionless Pairing
- Goal: Exact Attribution
- Goal: Grounded Interventions
- Goal: Decision Records
- Phase 6 Platform
- Risk: Incumbent Bundling
- Risk: IT Blocks Apps
- Risk: Annoying Interventions
- Risk: Privacy Perception
- Risk: Physical Cross-talk
- Risk: VAD/Triage Cost
- Sessions Table

## God Nodes (most connected - your core abstractions)
1. `Falcon Landing Page Design (design.md)` - 14 edges
2. `Quiet Voltage Design System` - 13 edges
3. `PRD.md (Product Source of Truth)` - 11 edges
4. `Main Coordinator` - 10 edges
5. `F9.1a Publish-time ACL Intersection` - 10 edges
6. `FalconAI Engineering Constitution` - 9 edges
7. `Participant Agent` - 8 edges
8. `Spec-Driven Development (Spec Kit) Workflow` - 8 edges
9. `§12.6 Load & Cost Governance` - 7 edges
10. `§12.5 Resilience Architecture` - 6 edges

## Surprising Connections (you probably didn't know these)
- `Principle V: Measure the Judgments, Pin the Models` --semantically_similar_to--> `PRD.md (Product Source of Truth)`  [INFERRED] [semantically similar]
  .specify/memory/constitution.md → CLAUDE.md
- `Principle IV: Honest Degradation Over Confident Wrongness` --references--> `PRD.md (Product Source of Truth)`  [EXTRACTED]
  .specify/memory/constitution.md → CLAUDE.md
- `Principle I: PRD Is Law, Traceability Is Mandatory` --references--> `PRD.md (Product Source of Truth)`  [EXTRACTED]
  .specify/memory/constitution.md → CLAUDE.md
- `FalconAI Engineering Constitution` --references--> `Blame-Neutral Shared Cards`  [EXTRACTED]
  .specify/memory/constitution.md → CLAUDE.md
- `FalconAI Engineering Constitution` --references--> `Decision Record Lifecycle`  [EXTRACTED]
  .specify/memory/constitution.md → CLAUDE.md

## Hyperedges (group relationships)
- **Audio → Transcript Pipeline** — prd_client, prd_silero_vad, prd_deepgram, prd_session_merge_service, prd_triage_router [EXTRACTED 0.95]
- **§12.9 Four Substrate Requirements** — prd_tenant_isolation, prd_secrets_manager, prd_stt_circuit_breaker, prd_session_end_consistency, prd_platform_substrate [EXTRACTED 0.95]
- **Publish-time ACL Boundary Flow** — prd_coordinator, prd_mediation_card, prd_private_nudge, prd_f9_1a [EXTRACTED 0.85]
- **Grain-Surface Elements (one grainy surface rule)** — design_marble_surface, design_team_tier, design_build_log_mosaic, design_feturbulence_grain [INFERRED 0.85]
- **Four Pricing Tiers** — design_solo_tier, design_team_tier, design_enterprise_tier, design_pilot_tier [INFERRED 0.95]
- **Quiet Voltage Color Token Set** — design_canvas_token, design_ink_token, design_primary_token, design_hairline_token, design_forest_token, design_brass_token [INFERRED 0.85]
- **The Five FalconAI Constitution Core Principles** — _specify_memory_constitution_prd_is_law, _specify_memory_constitution_grounded_or_silent, _specify_memory_constitution_security_boundaries, _specify_memory_constitution_honest_degradation, _specify_memory_constitution_measure_judgments [INFERRED 0.95]
- **Spec Kit Stage Sequence** — claude_speckit_constitution, claude_speckit_specify, claude_speckit_clarify, claude_speckit_plan, claude_speckit_tasks, claude_speckit_analyze, claude_speckit_implement [INFERRED 0.95]
- **FalconAI Source-of-Truth Document Set** — claude_prd, claude_design, _specify_memory_constitution [INFERRED 0.85]

## Communities (24 total, 15 thin omitted)

### Community 0 - "Governance & Product Constraints"
Cohesion: 0.11
Nodes (27): FalconAI Engineering Constitution, Principle II: Grounded or Silent, Principle IV: Honest Degradation Over Confident Wrongness, Principle V: Measure the Judgments, Pin the Models, Principle I: PRD Is Law, Traceability Is Mandatory, Principle III: Security Boundaries Are Code, Not Prose, Blame-Neutral Shared Cards, Decision Record Lifecycle (+19 more)

### Community 1 - "Landing Page & Marketing Site"
Cohesion: 0.11
Nodes (27): Falcon Landing Page Design (design.md), Build Log Mosaic Tiles, Differentiator / Compare Section, Enterprise Tier, Features Section, feTurbulence Fractal-Noise Grain, Footer, Founder Story Section (+19 more)

### Community 2 - "Coordinator & Mediation Publishing"
Cohesion: 0.11
Nodes (25): AD-2 Orchestration Substrate (LangGraph vs Hand-rolled), AD-3 Latency SLO as Percentiles, §12.10 Capacity Model, Main Coordinator, §6.3 Deployment Topology, F7.2 Untrusted Input Isolation, F9 Publishing, F9.1a Publish-time ACL Intersection (+17 more)

### Community 3 - "Audio Capture & Cost Governance"
Cohesion: 0.11
Nodes (20): AD-6 Client↔Server API Versioning, AssemblyAI STT Fallback, BullMQ, Falcon Client, §12.2 COGS per Meeting-hour, Deepgram Nova STT, F4 Audio Capture & Transcription, §12.6 Load & Cost Governance (+12 more)

### Community 4 - "Participant Agents & Triage"
Cohesion: 0.15
Nodes (16): AD-8 Agent Retrieval on the Hot Path, Claude Haiku, Context Pack, F11 Roles, F3 Session Bootstrap, F6 Triage Router, F6.5 Directed Question Detection, F7 Participant Agent Behaviour (+8 more)

### Community 5 - "Context Ingestion & Decision Records"
Cohesion: 0.18
Nodes (15): AD-4 Webhook Rollout Order, AD-5 Durable-data DR Posture, Decision Record, F10 Post-Meeting, F10.1 Decision Records with Truth-state, F10.3 Action-item Drafts, F2 Context Ingestion, §15.1 Integration Reliability (+7 more)

### Community 6 - "Pairing, Merge & Resilience"
Cohesion: 0.19
Nodes (14): AD-1 Clock Reconstruction vs Server-arrival Ordering, F5 Transcript Merge, Node.js + Fastify, Pairing, Phase 0 Validation, Phase 3 Pairing, Phase 5 Enterprise / Zoom, R1 Install Friction (+6 more)

### Community 7 - "Intervention Gates & Eval/Model Governance"
Cohesion: 0.17
Nodes (12): AD-7 Runtime Configuration Layer, Claude Sonnet, §12.7 Evaluation Harness, F8 Coordinator Intervention Gates, G3 Real-time disagreement detection, G5 Interventions are wanted, Langfuse, §12.8 Model Governance (+4 more)

### Community 8 - "Quiet Voltage Design Tokens"
Cohesion: 0.22
Nodes (11): Brass Deep Accent Token, Canvas Surface Token, Forest Accent Token, Hairline Token, Ink Text Token, Instrument Sans Font, Inter Font, Primary Token (+3 more)

## Knowledge Gaps
- **72 isolated node(s):** `Session`, `F1 Setup & Integrations`, `F3 Session Bootstrap`, `F11 Roles`, `G1 Near-zero-friction pairing` (+67 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Main Coordinator` connect `Coordinator & Mediation Publishing` to `Participant Agents & Triage`, `Context Ingestion & Decision Records`, `Pairing, Merge & Resilience`, `Intervention Gates & Eval/Model Governance`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Why does `Participant Agent` connect `Participant Agents & Triage` to `Coordinator & Mediation Publishing`, `Audio Capture & Cost Governance`?**
  _High betweenness centrality (0.055) - this node is a cross-community bridge._
- **Why does `Decision Record` connect `Context Ingestion & Decision Records` to `Coordinator & Mediation Publishing`, `Audio Capture & Cost Governance`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `Session`, `F1 Setup & Integrations`, `F3 Session Bootstrap` to the rest of the system?**
  _72 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Governance & Product Constraints` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._
- **Should `Landing Page & Marketing Site` be split into smaller, more focused modules?**
  _Cohesion score 0.10826210826210826 - nodes in this community are weakly interconnected._
- **Should `Coordinator & Mediation Publishing` be split into smaller, more focused modules?**
  _Cohesion score 0.11333333333333333 - nodes in this community are weakly interconnected._