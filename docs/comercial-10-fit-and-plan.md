# Module 10 — Comercial: fit with the current code and build plan

Source contract: `10_Comercial_CLAUDE_CODE_OFICIAL_v1.3.md` (cut 09-Nov-2026), including updates v1.1 (Goals & Eságara Protection Gate), v1.2 (Cartera, Facturación y Recaudo Comercial) and v1.3 (Visits, Coverage, Focus, Improvement). Precedence: Constitución Transversal → this module → integration contracts.
This file is the Sprint 0 deliverable that §35 asks for: inventory of shared entities, gap analysis against the repository, contradictions, decisions pending (§34), and the wave plan.

Note on numbering: v1.3 reuses section numbers 57–63 already used by v1.2. In this file they are cited as "v1.3 §57" etc.

## 1. What already exists and will be reused (no duplication)

| Contract concept | Existing code | Fit |
|---|---|---|
| Need / Journey (§3) | `Deal` = Journey (`desiredResult`, `needSpecs`, `neededBy`, `impactIfNot`, `successMeasure`), `/deals/[id]` progressive workspace, Mercado M6 handoff (`needContext`, lineage) | Good. Need stays inside the Journey; no separate Need table unless a Journey needs several Needs (decision C-04). |
| Product identity (§4, §6) | `Part` + `PartAlias` (trigram search), `ProductFact` (alias/packing/compat/spec with source), `/productos/[code]` | Base for Technical Discovery; no "exact / probable / multiple / unknown" identity state yet. |
| Sourcing orchestration (§6) | `/localizar` (L1–L6): history, inbound, offers, purchases, web sources (robots-respecting), Mouser/Digi-Key APIs, supplier evidence (facts only) | Covers most of the §6 order. Missing: saving the search itself (query, candidates, why discarded). |
| RFQ (§7–8) | `Rfq` / `RfqRecipient`, `rfq.ts`, company template EN/ES, sent from sales@, reply tracking (E2) | Template must ask for logistics, origin, HS, documents and payment options by context (AC05). |
| Supplier quotes (§12) | `SupplierOffer` from PDF/proforma (`supplier-doc.ts`), bank numbers compared with verified profile | Missing: per-field evidence, payment options per offer, logistics per offer. |
| Supply Basis (§12) | `Quote.supplyPrimary` / `supplyAlt`, `supplierValidUntil`, `supplyConfirmed`; one-click SPO from supply basis | Partial: text fields, not a structured record linked to offers. |
| Economics (§15) | `Quote` cost stack (supplier, freight, other, FX + sources), protected snapshot `protSale/protCost/protEsagra/protPolicy`, `money.ts`, M4 expected payment days | Partial: no international/import/local/financial/contingency split, no status per cost, no cost of capital (pending decision). |
| Quote versions (§20) | `Quote.rev` (Rev N keeps number), frozen after presenting, `changeNote` | Good. Missing: line-by-line diff view between versions (AC13 already holds). |
| Customer decision / Commercial future (§21) | `/cotizaciones` Commercial Future zones, `decisionLabel/Path/Evidence`, `promiseDecideBy` | Good base; states differ slightly from §21 (map them). |
| Customer PO comparison (§22) | `/po/[id]`, `CustomerPO` + lines, `PoResolution`, material differences block | Good. Missing: IVA, entity, penalties, documents; many-to-many PO↔Journey allocations. |
| Acceptance (§23) | `PoAcceptance` (immutable + snapshot), "Aceptar PO" command with server preconditions, credit exception | Good. Revalidation of stock age (AC15) and Eságara gate not yet in preconditions. |
| Handoff to Operations (§24) | `SupplierPO`, `Shipment`, `Delivery`, Forward View, Journey context | Good. Dispatch Instruction (v1.3 §58) is new. |
| Cash journey (v1.2) | `BillingRequest`, Billing Readiness, `Invoice.syncState`, `PaymentPromise`, M4 Payment Behavior, `/administracion/cobrar`, `/administracion/cupos`, commission 50/50 released on collection | Partial: no invoice submitted / received / portal accepted / rejected states, no Delivery Blocker, no Payment Map, promises have no amount/status history, no credit review request. |
| Communication (§19, AC23) | `comm-policy.ts` (Carnegie, checks), Prepare Connection, template hints | Reused for PO-correction and presentation messages. |
| Audit | `audit-core.ts` (automatic, AUDITED list) | New material models go into AUDITED. |

## 2. Contradictions and conflicts (reported, not normalized)

1. **Per-person goals vs the "no surveillance / no per-person rankings" rule.** v1.1 asks for individual goals per negotiator (Eságara, useful contacts, visits, Needs, presentations), pace per person and an Improvement Engine against each person's baseline. The standing rule says no surveillance metrics or rankings. Proposal: goals visible only to the person and their manager; no team ranking; no activity counts (only "useful" contacts with evidence, as the spec itself requires). **Needs your decision (C-01).**
2. **Which company sells and imports.** The spec assumes a Colombian importer (IVA, Colombian tariff subheading, VUCE, RETIE, INVIMA). The product is "SOLU USA" and markets are Colombia + USA. Import/compliance rules depend on whether the selling entity imports into Colombia or sells FOB/DAP from the USA. **Needs your decision (C-02).**
3. **Fixed pipeline stages.** `Deal.stage` (LEAD → … → WON) is a manual pipeline; §2 forbids a rigid funnel and asks for derived, reversible readiness (READY_TO_SOURCE / PRICE / PRESENT / ACCEPT). Proposal: keep `stage` for existing screens and reports, add derived readiness; stop asking people to move stages by hand where readiness can be derived.
4. **Eságara formula.** Current protected Eságara = sale − (supplier + freight + other). §43 adds bank/FX, financing and import costs. Financing needs a cost-of-money rate (already on the pending list). Until then, financing cost shows in days, not money, and the gate uses the costs we have — stated on screen.
5. **Roles.** The spec has Negociador Comercial, Negociador Operativo, Finanzas, Director Comercial, Gerencia. SOLU has REP, MANAGER, ADMIN, MARKETING. **Needs your decision (C-03).**
6. **AI is not connected.** AC01 (WhatsApp/photo → Need draft), post-visit audio/photo learnings and proposal drafting assume AI. V1 builds the rule-based version (forms with known data prefilled) and leaves the AI step pluggable — same approach as Mercado.
7. **No durable worker / outbox** (Render free, gap #7). Idempotency is done with keys inside requests (already used for RFQ and mail). Recalculations run on save, not in background.
8. **Modules not yet received.** v1.2/v1.3 reference Module 12 (commissions), Module 14 (Administración: TravelBudget/Expense) and Module 11 (Operaciones). Commission-waiting-for-collection can use the existing 50/50 commission code; travel budget waits for Module 14.
9. **Credit limits.** Today a manager edits `creditLimit` directly on Cupos. v1.2 §63 wants Comercial to *request* and Administración to *decide*, versioned. Proposal: add the request; keep the manager edit as the decision step, now recorded against the request.
10. **Payment promises.** `PaymentPromise` has no amount, no status, no "replaced" history; M4 derives kept/broken. §61 wants stored status (OPEN/KEPT/PARTIALLY_KEPT/MISSED/REPLACED) and amount. Proposal: add amount + `replacedById`; keep status derived from reconciled cash (one truth), stored only when a person marks REPLACED.

## 3. Decision log (§34 + v1.1–v1.3) — configurable, not invented in code

| ID | Decision | Status |
|---|---|---|
| C-01 | Personal goals: who sees them, no ranking | **Decided 2026-11-09:** only the person and their manager. No team ranking, no activity counts. |
| C-02 | Selling/importing entity per market (USA, Colombia) | **Decided 2026-11-09:** both, depending on the deal — each Journey states which entity sells (built in a later wave). |
| C-03 | Role mapping (Negociador Comercial/Operativo, Finanzas, Director) | Proposal (to confirm): Negociador Comercial/Operativo → REP; Director Comercial / Gerencia → MANAGER; Finanzas → ADMIN until a FINANCE role exists. |
| C-04 | One Journey = one Need, or several Needs per Journey | Proposal: one Need per Journey (as today). |
| C-05 | Eságara gate threshold | **Frozen by spec:** 20.00 % on net sale, strictly below triggers; stored as versioned policy (`MarketSetting` key `comPolicy`). **Built in C2.** |
| C-06 | Who approves a low-Eságara exception, amount bands | **Decided 2026-11-09:** MANAGER or ADMIN, never the requester. No amount bands yet. **Built in C2.** |
| C-07 | Tolerance before re-approval after a change ("no loops for cents") | **Built in C2 as editable policy:** approval holds while Eságara drops < 1 point AND sale moves ≤ 5 %. |
| C-08 | Cost of capital, day base, FX valuation, IVA treatment | Open (financing already on pending list). |
| C-09 | Aging buckets | Proposal (spec default): current, 1–30, 31–60, 61–90, >90 — configurable. |
| C-10 | Delivery blocker / delivered-not-invoiced rules (days before alert) | Open. Proposal: ready > 3 days, delivered > 2 working days without invoice. |
| C-11 | Daily close time | Spec default 17:00, configurable. |
| C-12 | Stock / offer revalidation age before accepting (AC15) | Open. Proposal: 7 days for stock, offer validity date when present. |
| C-13 | Mandatory presentation criteria | Open. V1 only recommends (SEND_DIRECTLY / PRESENT_RECOMMENDED / PRESENT_BEFORE_SENDING) with reasons. |
| C-14 | Industry Solutions value attributes catalog with evidence (§17) | Open — content from the business; V1 ships an editable catalog with no default claims. |

## 4. Build plan by waves

Spec waves (§33) plus the v1.1–v1.3 updates, ordered by value and by what already exists. Each wave ships schema + commands + screens + audit/provenance + tests + a realistic sample, committed separately.

- **C0 Foundations:** policy register for Comercial (versioned settings: Eságara threshold, tolerances, aging, alert days), derived readiness for Journeys, role mapping, ADRs above.
- **C1 Technical & Scope (§4–5):** technical facts by product family with identity state; Assembly Scope Matrix (requested / required assembly / quoted / included / excluded / optional / customer-supplied / to confirm); ambiguous words detector ("completo", "kit"…); product relationships with evidence; Carnegie clarification message. AC02, AC03.
- **C2 Eságara Protection Gate (v1.1 §43–49) — DONE 2026-11-09:** `esagara-rules.ts` (pure), `esagara-gate.ts`, `EsagaraException` (audited), quote card, `/comercial/esagara` (queue with §47 context, my requests, 90-day pattern by customer, policy form), bell alerts, cost-drop needs a reason. Spec scope was: projected Eságara on every quote version, gate below threshold, Low Eságara Exception Request with reasons, approver view (with credit/payment behavior), authority policy (amount + Eságara + risk), anti-splitting check, analytics flag. AC v1.1 6–15.
- **C3 Commercial Cash Journey (v1.2):** Money Desk (Entregar / Facturar / Cobrar / Liberar crédito) on My Day and Comercial; Delivery Blocker with root cause ≠ owner; Delivered-not-invoiced; invoice submitted/received/accepted/rejected; Payment Map; promises with amount and history; contractual vs expected aging; credit review request; Revenue Leakage; Cash Conversion Delay; commission waiting for collection.
- **C4 Sourcing & Supply (§6–13):** saved searches; RFQ asking only relevant fields with reasons (AC05); supplier response per field with evidence; Supply Options → Supply Basis record; Scope Equivalence in supplier comparison (AC04); Payment Method Compare (AC09–10); Product Logistics Passport from observations (AC06–07); Import Experience precedents (AC08).
- **C5 Solution Case & Proposal (§14–20):** Solution Case, Value Bridge with evidence-only claims (AC12), Quick Quote vs Solution Proposal, presentation recommendation and briefing, quote diff view, cost stack + Protected vs Current vs Final.
- **C6 PO, Acceptance & Dispatch (§22–24, v1.3 §58):** PO diff extended (IVA, entity, documents, penalties), PO↔Journey allocations, acceptance revalidation (stock age, credit, gate, compliance), Dispatch Instruction to Operations, Golden Journey E2E (§32).
- **C7 Goals & Future Creation (v1.1 §37–42, §50):** goal plans versioned by period/role/person, useful-contact definitions, pace with working-day calendar, bottleneck explanations — subject to C-01.
- **C8 Visits, Coverage, Focus, Improvement, Closes (v1.3):** Visit Plan/Brief/Outcome, missions (travel budget waits for Module 14), absence coverage with expiring delegated authority, High-Value Focus views, Improvement Engine vs personal baseline (subject to C-01), daily/weekly/monthly closes.

Not built: opaque scores, call-count KPIs, automatic sending, automatic acceptance of POs, automatic payments.
