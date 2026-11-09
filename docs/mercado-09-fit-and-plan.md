# Module 09 — Mercadeo Exploratorio: fit with the current code and build plan

Source contract: `09_Mercadeo_Exploratorio_CLAUDE_CODE_OFICIAL_v2.2.md` (cut 09-Nov-2026). Precedence: Constitución Transversal → this module doc → integration contracts.
This file is the Sprint 0 deliverable that §31 asks for: how the module fits the existing SOLU code, where the code contradicts the contract, the decision log (§32) and the wave plan (§29).

## 1. What already exists and will be reused (no duplication)

| Contract concept | Existing code | How Mercado uses it |
|---|---|---|
| Company / Account (§4.3) | `Account` (name, industry, `taxId`, credit fields), duplicate-NIT block in `accounts/actions.ts` (`nitKey`) | Stays the canonical company. Add aliases, roles, business group, plants. |
| Person (§4.10) | `Contact` (name, email, phone, `title`, one `accountId`) | Contact = Person. Employment (company/plant/area/role with dates) is new. |
| Need → Journey (§12) | `Deal` = Journey; `createNeedFromContext` (productos/actions.ts) creates a Journey from context | Need handoff (M6) extends this and links the Journey to its Exploration, Signal and evidence. |
| Payment behavior (§10) | `payHistory()` in billing.ts uses reconciled cash only (count + average delay) | M4 extends it to the §10.2 metrics; never uses unapplied bank movements. |
| Installed base (§4.8) | `installedContext()` in x360.ts (derived from Journeys), `ProductFact` (code-level facts with source/observedAt) | Becomes evidence for Plant/Asset observations. |
| Communication intake (§15.3) | `comm.ts` (rule-based FACT vs INFERENCE), `CommThread`/`CommItem` | Learnings from conversations feed Exploration and Relationship memory. |
| Signals | `ContinuitySignal` (per Journey), `ProductSignal` (product feedback) | Different purposes: kept as they are. Market signals are a new table. |
| Audit trail | `AuditEvent` + `audit-core.ts` (automatic) | New material models are added to `AUDITED`. |
| Money | `money.ts` | Financial snapshots and indicators use it. |
| Customer 360 | `/accounts/[id]` | Company Exploration is a view of the same company, not a second record. |

## 2. Contradictions to resolve before building (reported, not normalized)

1. **Suppliers are a separate table.** The contract (§4.3) wants one organization with several roles (customer, supplier, manufacturer…). `Supplier` and `Account` are separate today. Proposal: keep them separate in V1 and add an optional link (same NIT ⇒ same organization), so a company that is both shows both roles. Merging the tables would touch payments and bank verification (No Debt Zones).
2. **Person and employment are mixed.** `Contact` has one company and one title. Proposal: add `Employment` (person ↔ company/plant/area/role, from/to); keep `Contact.title` as the current job for existing screens.
3. **Roles.** The contract names Negotiator, Marketing, Administration/Credit and Management. SOLU has REP, MANAGER and ADMIN. Proposal: REP = Negotiator, ADMIN = Administration/Credit, MANAGER = Management; no Marketing role until there is a person in that job.
4. **Amount size.** Money columns are `Decimal(14,2)` (up to ~1 trillion). Large Colombian companies report revenues above COP 10 trillion. Financial snapshots need `Decimal(20,2)`.
5. **Geography and currency.** The product is "SOLU USA" (USD), while Economic Intelligence is designed around Colombia (NIT, Supersociedades, COP). Snapshots keep their own currency and scale; nothing is converted silently.
6. **AI is not connected** (no Anthropic key). Parts of the contract assume AI: natural-language search, voice notes, nameplate photos, choosing 2–5 discovery questions, Connection Brief drafts. V1 builds the rule-based version of each (clearly marked as such) with the AI step pluggable later. No inferred fact is ever stored as VERIFIED.
7. **No background worker** (Render free). Importing ~10,000 rows must run in chunks inside requests with a resumable import state, not as one long request.
8. **"LEAD" exists as a Journey stage.** The contract forbids a Lead entity. Mercado will not create Journeys from signals; a Journey is created only when a person confirms a Need.

## 3. Decision log (§32) — open, configurable, not invented in code

| Decision | Status |
|---|---|
| External financial-intelligence provider beyond manual files | Open. V1: manual XLSX/CSV only. |
| Formal credit evaluation formula/policy | Open. Mercado only shows evidence; `creditLimit` stays an Administration decision. |
| Thresholds for financial signals (e.g. "revenue fell > X %") | Open. Stored as a versioned configuration with a proposed default, editable by management. |
| What ImportSoluciones data may be shared | Open. Not used until decided. |
| Retention of datasets and documents | Open. Original files are kept; no deletion policy yet. |
| Meeting recording/transcription policy | Open. Not built. |
| Allowed web sources and refresh cadence | Partly covered by `web-fetch.ts` (robots.txt, blocked hosts). |
| Initial Discovery Playbook catalog | Open. V1 seeds the examples from §6.2 as editable rows. |
| Access to financial detail by role | Proposal: summary for REP, detail for ADMIN/MANAGER (§18). |
| Markets | **Decided (2026-11-09):** Colombia and USA. Each company keeps its own currency; no silent conversion. |
| Customer vs supplier company | **Decided:** keep `Account` and `Supplier` separate and link them by NIT (`Supplier.taxId`, first 9 digits). The workspace shows "También proveedor". |
| Marketing role | **Decided:** new role `MARKETING` ("Mercadeo"). Same access as REP: explores and adds facts, never sees bank or credit detail. |

**Status:** M0 + M1 delivered (2026-11-09). M2 delivered (2026-11-09): `/mercado/empresas/[id]` and `/mercado/plantas/[id]`, `AccountAlias`, `AccountInsight` (OPERATE/DECIDE/BUY/VALUE/HURT; VALUE requires evidence; replaced observations keep `supersededAt`), `InstalledAsset`, `ImpactProfile` (REPORTED range or GUIDED: min = units/h × contribution, max = min + scrap/h + idle labor/h, restart cost shown apart — a proposed rule, adjustable), `Employment`, rule-based discovery questions (§6, max 5, only about unknowns). Voice/photo capture stays off until the AI key exists. M3 delivered (2026-11-09): MERCADO tabs "Economía" (/mercado/economia, everyone) and "Fuentes" (/mercado/fuentes, ADMIN/MANAGER/MARKETING). Upload XLSX/CSV (25 MB, original kept, duplicate files refused) -> map columns (template remembered per source) -> scale, currency and number format chosen explicitly -> per-row checks (DIAN check digit, year, negative assets, assets = liabilities + equity within 1 %, duplicates, other name, other version) -> grouped review -> one all-or-nothing save. FinancialSnapshot rows are immutable; a second file for the same year is a new version. Indicators show their formula and inputs (fin-v1); signal thresholds are versioned in MarketSetting; the default values were confirmed by the user on 2026-11-09 and Gerencia can change them at any time in Fuentes. ECONOMIC signals go only to linked customers/prospects. Tested with synthetic files only: a real Supersociedades export still has to be mapped once.

## 4. Build plan by waves (contract §29, adapted to current constraints)

Each wave ships schema + commands + screens + audit/provenance + tests + a realistic seeded example, and is committed separately.

- **M0 Foundation:** `Exploration` (purpose, hypothesis, scope, owner, movement state MOVE/WAIT/TRIGGER/CLARITY_NEEDED, lifecycle), entity links, `MarketSignal`, `KnowledgeGap`, `WhiteSpace`, `Plant`, `Employment`, company aliases/roles, and a shared provenance shape (source type/reference, observed at, confidence VERIFIED/REPORTED/INFERRED/UNKNOWN, captured by). `FutureOpportunity` (v2.2 §41) with horizons 0–30 / 31–90 / 91–365 / >365 days and no probabilities.
- **M1 Mercado Home + Exploration Workspace:** new first tab "Explorar" in MERCADO. Cards: "Para explorar", active explorations, white spaces, what changed, relationships that can grow. One-sentence creation; Next Movement via Task.
- **M2 Company / Plant:** Company Exploration and Plant Exploration views with "How this account works" (operate / decide / buy / value / what hurts), installed equipment observations and operational impact ranges. Voice/photo stays off until the AI key exists.
- **M3 Economic Intelligence:** Intelligence Sources screen, XLSX/CSV import with the §23 states, column mapping, scale/currency/year checks, NIT matching with review, immutable annual snapshots, explainable trends, Economic Explorer filters. Needs a real Supersociedades file to map.
- **M4 Payment Behavior:** contractual vs actual days, 6/12/24-month windows, on-time ratio, promise reliability, trend, `expectedPaymentDays` for Comercial; never changes credit.
- **M5 Relationship + Prepare Connection:** relationship memory, open loops, Connection Readiness Brief, adaptive discovery questions, one central Communication Policy (Carnegie) shared with the existing email templates, human review before any external send.
- **M6 Need handoff:** "create Need" from an Exploration with inherited context and lineage; Golden Exploration end-to-end test (§25).

Not built before the Golden Exploration works end to end: mass outreach, campaign engine, opaque scores (§29).
