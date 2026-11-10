# Módulo 11 — Operaciones v1.2: fit with the code, conflicts, decisions and build plan

Source: `Downloads/11_Operaciones_CLAUDE_CODE_OFICIAL_v1.2.md` (cut 2026-11-09). Sprint 0 analysis written 2026-11-10.
Precedence: Constitución Transversal → this module's document → integration contracts → higher version wins.
Section references: the v1.2 update at the end of the document reuses numbers 44–47; they are cited here as "v1.2 §44–47".

## 1. What already exists (reuse, don't rebuild)

| Spec area | In SOLU today | Gap |
|---|---|---|
| Handoff Comercial → Operaciones (§2.1) | Accepted PO (`PoAcceptance` snapshot with the full commitment), scope lines, supply basis, protected economics, `DispatchInstruction`, credit review, payment behaviour, logistics passport and import experience all exist on the Journey | No single "Operational Handoff" view assembled at acceptance |
| Purchase Requirement (§5) | `/compras`: requirement derived from the Journey, one-click Supplier PO from the supply basis | No PR object, purpose typology, allocations to several Deals, MOQ / unallocated quantity, readiness reading |
| Purchase authority (§7–11) | None for purchases. Payments: Director / Finanzas ≤ USD 25k, Gerencia unlimited, written in code | Versioned, configurable matrix by entity / purpose / role / person / amount; delegation; anti-fragmentation; authorization context; downside view |
| Profitability gate, savings (§12–13) | Supplier evidence (facts only), offers, RFQ comparison | Opportunities before buying, negotiation window, Savings Ledger |
| Supplier PO (§14) | `SupplierPO` with versions, "Liberar" command, history, lines, incoterm, terms | Separate facts authorized / sent / acknowledged / confirmed; diff on new version needs authorization rule |
| Supplier confirmation (§15–16) | `confirmedAt` only | Confirmation record compared with the PO (price, qty, scope, date, payment, incoterm, documents, warranty, packaging, new condition), functional scope included / excluded / optional / required |
| Payment obligation, authorization, execution (§17–21) | `PaymentRequirement` (milestones), `SupplierPayment` (request → independent bank verification → approve → execute), duplicate check, bank-change hard stop, `PaymentExecution` SENT / UNCERTAIN / CONFIRMED / FAILED | Maker–checker by policy and amount, payment method comparison at authorization, fees and effective FX on execution, sent / debited / supplier received / order released as separate facts |
| Supplier tracking (§22–24) | PO dates (ready, shipped, ETA), carrier ETA with source | Structured commitments (reported vs committed vs occurred), adaptive milestones by kind (stock, manufactured, service, repair), waiting-with-control thresholds |
| Logistics readiness, freight (§25–28) | `LogisticsObservation` passport with sources (never overwritten), supply option logistics | Freight Requirement, option comparison ("cost to fulfill") |
| Shipment, ETA architecture (§29–30) | `Shipment` with lines, events, decisions, customs hold, disputed receipt, five truths, protected / at risk | Consolidation of several POs / Deals and partial shipment balance; full date set; promise health with four states and its reason |
| Freight audit, claims (§31) | None | Carrier rating rules, four-way match, variances, tolerances, claims with real recovery |
| Customs (§32–33) | Customs hold on shipment, `ImportExperience` | Import readiness by applicability, Customs Case, expected vs actual time and cost |
| Goods receipt, inventory (§34) | Receipt confirmation on shipment creates the remisión | Identity / condition / completeness checks, receiving exceptions, quarantine, physical / allocated / available stock. **SOLU has no inventory at all** |
| Evidence, product experience (§35–36) | Product 360, `ProductFact`, part aliases, visit attachments | Guided photo capture at receipt and before dispatch feeding passport and experience |
| Showcase / SEO (§37) | None | Publication candidates, eligibility, public pages, public Need intake |
| Delivery, remission, POD (§38–39, v1.2 §44) | `Delivery` + lines + serials, POD flag, reception code, `DispatchInstruction` (C6), "sin despachar", "entregado sin facturar" | Dispatch order and state model, Delivery Profile by company + site, resources, attempts, evidence, customer entry reference (MIGO) as its own waiting state |
| Invoice readiness (§40) | Billing Readiness checklist, DIAN recording, accounting bridge | Billing Basis on the Deal (order, delivery, acceptance, milestone, advance + balance, recurring) |
| Collection, bank reconciliation (§41–42) | Promises, expected pay date, aging, `CustomerPayment` applied to invoices, reconcile with residual note | Bank Transaction import and matching (suggested / confirmed / partial / unmatched), one-to-many, withholdings, internal transfers, cards |
| Final economics (§43–44) | Protected snapshot; "final" box on accepted quotes (executed supplier payments + expected freight) | Deal cost ledger, shared-cost allocation rule, protected / current / final, variance bridge, close states |
| Customer result (§45) | Result & Closure (states, evidence, recovery, continuity signal) | Warranty / claim case |
| Home, future, exceptions (§46–50) | Per-area lists; attention bell; coverage scan | Operations Home with the six blocks, Operations Future, Commercial Impact Gate, one Operational Exception object |
| Carrier gateway, DHL (§53) | Manual tracking entry | Gateway + adapters, carrier accounts, DHL MyDHL API |
| Security, audit (§54) | Roles, audit trail, bank verification, no self-approval in Eságara / travel / credit | Separation of system admin vs policy authority |
| Coverage (v1.2 §46) | `CoverageAssignment` + emergency scan (Comercial C8b) | Add pickups, supplier payments, customs events, dispatches and claims to the scan |

Rough reading: about a third of the module exists in some form; purchasing control, freight audit, inventory, bank matching, final economics and the carrier gateway are new.

## 2. Contradictions and conflicts (reported, not normalized)

1. **Currency.** The document's examples run in COP (sale COP 180M, credit in COP). SOLU keeps everything in USD before IVA (C-21). Authority limits, exposure and credit need one stated base currency. **Decision O-02.**
2. **"Margin" vs Eságara.** The document says margin / Protected Margin; SOLU's canonical word is Eságara, shown in $ and %. Screens will say Eságara.
3. **Who owns bank reconciliation and collection.** §41–42 put them in Operaciones; the module flow says Administración administers resources, the pages already live under Administración, and Module 14 has not arrived. **Decision O-06.**
4. **Hard-coded authority.** Payment limits (USD 25k) are written in code and Gerencia has every power; §7 requires a configurable, versioned matrix and that a technical administrator can't raise their own limit. **Decisions O-02, O-03.**
5. **Inventory.** The document assumes stock (physical / allocated / available, quarantine). SOLU has none, and it is not known whether the company holds stock or only passes goods through. **Decision O-01.**
6. **Internal, asset and project purchases.** Today every Supplier PO needs a Journey. Budgets and cost centres belong to Module 14. **Decision O-05.**
7. **DHL integration needs things only the company can get:** an active DHL Express account with MyDHL API access and credentials (kept in Render's environment, never in chat or code). The adapter must be written from DHL's official documentation, not from memory, and cannot be verified without those credentials. **Decision O-07.**
8. **File storage.** Receipt and dispatch photos, labels, PODs and integration evidence are stored as bytes in the database, on Neon's free plan (about 0.5 GB). This module will outgrow it. **Decision O-08.**
9. **Public surfaces.** The Showcase / SEO pages with a public Need form (§37) and "Track your solution" (§53.7) are pages for people without a login: a different kind of product surface (privacy, spam, what is exposed). **Decisions O-12, O-13.**
10. **AI and WhatsApp.** Extraction, guided capture and the official WhatsApp channel are assumed; SOLU's AI is off and WhatsApp is manual. V1 is rule-based with the AI step pluggable, as in the other modules.
11. **Events.** §52 asks for domain events with ids, causation and idempotency keys. SOLU has an audit trail and a durable job table, not an event bus. Proposal: keep the audit trail as the record and use the job table as inbox / outbox for integrations; add an explicit integration-attempt record.
12. **Roles.** §49 lists eleven functional roles; SOLU has six. Proposal: keep the six and express treasury maker / checker, receiver and logistics as permissions granted by policy, not new roles. **Decision O-04.**
13. **"SOLU expected = ETA + 3 + 1 days"** is written in code; §30 asks for the full date architecture with configurable rules.
14. **Tariff classification.** SOLU may record and compare, never choose a classification because it pays less (§12.3, AC39). No professional validation exists inside SOLU.
15. **Two selling companies.** Authority, carrier accounts and legal entity on purchases must be per company (USA / Colombia); the Colombian company's accounting gaps (pesos with IVA, withholdings) are still open from Comercial.

## 3. Decision log — configurable, not invented in code

| ID | Decision | Status |
|---|---|---|
| O-01 | Does the company hold stock, and where is goods receipt done (Miami warehouse, Colombia, both)? | Open — needed for O6 |
| O-02 | Purchase authority matrix: levels, amounts, base currency, per company | Open — needed for O2 |
| O-03 | Who may change limits and policies, and who must confirm (admin can't raise own limit) | Open — needed for O2 |
| O-04 | Maker–checker: which combinations one person may hold, by amount | Open — needed for O4 |
| O-05 | Internal, asset and project purchases: now, or wait for Module 14 | Open — needed for O1 |
| O-06 | Bank reconciliation: which banks, how statements arrive (file, manual), where it lives in the menu | Open — needed for O9 |
| O-07 | DHL Express account and API access; which company owns it; other carriers / forwarders in use | Open — needed for O5b |
| O-08 | Where photos and documents are stored once they outgrow the free database | Open — needed for O6 |
| O-09 | Freight audit: volumetric divisor, rounding and tolerances per carrier / service | Open — needed for O7 |
| O-10 | Savings: what counts as the baseline (first quote, last purchase, supply basis) | Open — needed for O3 |
| O-11 | When a Journey's economics are "substantially complete" and "final" | Open — needed for O9 |
| O-12 | Customer tracking page without login, and which milestones notify the customer | Open — needed for O5b |
| O-13 | Showcase / SEO: build it, on which website, who approves publication | Open — proposed last |
| O-14 | Delivery: own messenger / vehicle, national carriers, customer pickup; Delivery Profile requirements | Open — needed for O8 |
| O-15 | Waiting-with-control and materiality thresholds (days without evidence, exposure increase that escalates) | Open — needed for O0/O2 |
| O-16 | Cash context for approvers: SOLU has no bank balances; show only what it knows, or wait for bank data | Open — needed for O2 |

## 4. Build plan by waves

Each wave is committed separately, tested, and starts with its open decisions being asked.

- **O0 Handoff, Operations Home and Exceptions (§2.1, §46–48, §50; AC35, AC37).** Operational Handoff assembled at PO acceptance from existing records (no re-typing). Operations Home with the six blocks and Operations Future, built over what exists. One `OperationalException` object (expected, actual, impact, options, owner, deadline). Commercial Impact Gate. Coverage scan extended (v1.2 §46). No new business rules needed beyond O-15: fastest value.
- **O1 Purchase Requirement (§4–6; AC1–2).** PR with purpose, item type, economic nature; lines; allocation to one or several Deals; MOQ and unallocated quantity as Inventory Exposure; Purchase Readiness as a derived reading with blocker, impact, path, owner.
- **O2 Purchase authority (§7–11; AC3–7).** Versioned matrix per company; temporary delegation (reusing coverage); anti-fragmentation (Related Commitment Total); approval request with full context (purchase, customer credit and exposure, supplier exposure, cash, downside view); approve / ask / return / escalate.
- **O3 Buying well (§12–16; AC11–13, AC38–39).** Profitability gate with negotiation window; Savings Ledger (gross, passed to customer, retained); Supplier PO facts authorized / sent / acknowledged / confirmed; Supplier Confirmation compared with the PO; functional scope confirmation.
- **O4 Paying (§17–24; AC8–10, AC14).** Buy vs pay as separate authorizations; maker–checker by policy; payment method comparison; execution record with fees, FX and the four facts; supplier commitments; adaptive milestones; waiting with control.
- **O5a Freight and shipments (§25–30; AC15–17).** Logistics readiness, Freight Requirement, option comparison, consolidation and partial shipment, full date set, promise health with its reason. Carrier Gateway with the manual adapter.
- **O5b DHL adapter (§53; AC41–52).** Carrier accounts, rate, capability, create shipment, labels, pickup, tracking, pieces, POD, documents, landed cost as contrast, customer communication, tracking page. Starts only with DHL credentials (O-07) and after reading DHL's official documentation.
- **O6 Receipt, inventory and evidence (§34–36; AC21–24).** Goods receipt checks, receiving exceptions, quarantine, stock states, guided evidence capture feeding passport and product experience.
- **O7 Freight audit and customs (§31–33; AC18–20).** Carrier rating rules, four-way match, variances, tolerances, claims with real recovery; import readiness and Customs Case.
- **O8 Dispatch and delivery (§38–40, v1.2 §44–45, §47; AC27).** Dispatch order and states, Delivery Profile, resources, attempts, evidence, customer entry reference, Billing Basis, High-Value Commitment.
- **O9 Money closing (§41–45; AC28–34, AC40).** Bank transactions and matching, withholdings, internal transfers, cards; Deal cost ledger and shared-cost allocation; protected / current / final with variance bridge and close states; warranty case; metrics (§55–63).
- **O10 Showcase / SEO (§37; AC25–26).** Publication candidates and eligibility; public pages and Need intake. Proposed last, subject to O-13.

Not built: opaque scores, automatic payments, automatic sending of customs information, automatic publication, any tariff classification chosen for a lower duty.
