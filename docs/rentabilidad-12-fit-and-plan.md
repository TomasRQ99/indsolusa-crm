# Módulo 12 · Rentabilidad, Costos, Comisiones y Participación Económica (v1.0) — fit and plan

Source: `Downloads\12_Rentabilidad_Costos_Comisiones_Participacion_CLAUDE_CODE_OFICIAL_v1.0.md` (shared 2026-11-11).
Standing rule from the document (§39–40): **the system must not invent any pending policy decision.** Structure is built
configurable; every rate, split, base and threshold is set by Gerencia in SOLU. Where nothing is configured, SOLU computes
nothing and says what is missing.

## 1. What already exists

| Spec | In SOLU today | Gap |
|---|---|---|
| §2 Three economies | Built in O9c: protected snapshot on the accepted quote, expected today, facts, FINAL snapshot (`economics-rules.ts`, `economics.ts`, `/deals/[id]/economia`, `/administracion/economia`) | Protected lacks explicit financing / import estimates as separate figures |
| §3 Eságara definition, `ESAGARA_POLICY` | Categories SUPPLIER, FREIGHT, DUTY, DELIVERY, BANK_FEE, TRAVEL, OTHER read from facts | Components are fixed in code, not a versioned policy; insurance, storage, installation, third-party services have no category of their own |
| §4 Deal Cost Ledger | `DealCost` holds only what no other record holds; other costs are read from their source | No single ledger with `cost_status` (ESTIMATED … REVERSED); provenance is the link to the source record |
| §5 Revenue side | Invoiced, cash (reconciled / pending) and withholdings are separate (`withholding.ts`) | Credit notes and disputed customer deductions do not exist |
| §6 Cost allocation | VALUE, UNITS, MANUAL with method and note kept (`splitShared`) | EQUAL, WEIGHT, VOLUME, TIME; approver on manual splits |
| §7 Bridge | Lines that add up exactly to the change | Fewer categories than the spec (no FX, financing, credit note, return lines) |
| §8 Closure readiness | States OPEN / SUBSTANTIAL / FINAL set by a person | The criteria checklist and a materiality policy |
| §9 Low-margin gate | `EsagaraException` with threshold from policy, reason code, approval by Director Comercial / Gerencia | Reason codes of §9.1 to align; **commission treatment** (§16) not recorded |
| §10–16 Commission | `CommissionPolicy` (tiers by Eságara %, new-client bonus, salePercent 50, lossDays 90), `CommissionEntry` per invoice half, owner only (`commission.ts`, `/gerencia/comisiones`) | Pool × functional pools (Commercial / Operational), allocations and splits, distinct Estimated / Earned / Payable / Paid, proportional collection release, reconciliation against final Eságara |
| §17–19 Role participation | Nothing | Whole mechanism; the five director roles do not exist as assignments with dates |
| §21–24 Settlement run, adjustments | "Enviar a Gerencia" with versions per person and period | Monthly idempotent run with frozen inputs, lines with explanation, adjustments, paid lines immutable |
| §25 Savings ledger | `SavingsEntry` with baseline, final, passed to customer | Shown in the bridge only through recovered claims |
| §26–28 Views | Commission page for management; Eságara real per Journey and list | Negotiator view, Dirección view, Administración home |
| §30–31 Analytics | Operations metrics only | Profitability by customer, supplier, product, period |
| AC42 Multi-entity | `SellingEntity` (USA active; Colombia off on purpose, user decision 2026-11-11) | Policies per entity: built keyed by entity, only USA used |

## 2. Conflicts with what exists (and how they were resolved)

| # | Conflict | Decision |
|---|---|---|
| R-01 | Sale half today is earned when the **invoice is issued**; the spec recommends when the **PO is accepted** | First answer 2026-11-11 was PO accepted; **reversed the same day and confirmed: at invoicing** (how SOLU already works). No change to the trigger |
| R-02 | Today the collection half is all-or-nothing when the invoice is fully reconciled, and is **lost 90 days** past due; the spec releases it in proportion to reconciled collection with no expiry | **User 2026-11-11: follow the document.** Proportional release; `lossDays` retired |
| R-03 | Today the whole commission goes to the Journey owner; the spec splits a pool between Commercial and Operational functions and between people | Build allocations; until a split is defined for a Journey, 100 % of the Commercial pool goes to its owner and the Operational pool is unassigned (shown as a blocker, not paid) |
| R-04 | Existing tiers by Eságara % and new-client bonus are placeholders | Kept as the shape of the rate (spec §33 allows "rate/tier"); values are Gerencia's |
| R-05 | Withholdings count as collected in commissions | Matches the spec (§13.4, AC17). No change |

## 3. Policy decisions still pending (§39) — never invented

Asked and answered: sale trigger (R-01), collection rule (R-02).
To be set by Gerencia in the policy screens when they are built: commission rate / tiers; Commercial vs Operational pool
percentages; rule when one person does both; team-split rules; treatment of advances; returns / warranty; commission for
Eságara below the threshold (chosen per exception); role participation rates and monthly base; thresholds, accelerators,
caps; double participation; closure materiality; adjustment window; financing and FX treatment (finance rate still pending).

## 4. Waves

- **R0 Economics foundations (no decision needed).** Versioned `esagaraPolicy` (which cost categories count, closure
  materiality); closure-readiness checklist derived from facts; revenue side shown in its separate parts; EQUAL split.
  **DONE 2026-11-11.** `EsagaraPolicy` (`counts` per category, `materialityUsd`; supplier cost can never be excluded) in `MarketSetting` key `esagaraPolicy`, edited by Gerencia on `/administracion/economia#politica`; `closureReadiness` (8 criteria) on the Journey's economics page and a ready column on the list; revenue side (sale, invoiced, reconciled, pending, withheld, outstanding); `EQUAL` split.
  **Limits:** no separate categories yet for insurance, storage, installation or third-party services (they go under Other); credit notes and disputed deductions do not exist; materiality is a USD figure only (no %); the checklist does not block a manual FINAL.
- **R1 Low-margin exception.** Reason codes of §9.1, commission treatment (NORMAL / REDUCED / SPECIAL / ZERO /
  CUSTOM_APPROVED) recorded on approval; negative Eságara never produces a normal commission (AC44).
- **R2 Commission engine.** Policy v2 (rate / tiers, functional pools, sale trigger, rounding), `CommissionAllocation`
  with versioned splits, pool calculation with the formula shown (AC10–14).
- **R3 Two tranches and four states.** Sale tranche at PO acceptance, collection tranche proportional to reconciled
  cash + withholdings, Estimated / Earned / Payable / Paid, reconciliation against final Eságara (AC15–19).
- **R4 Settlement.** Monthly idempotent run with frozen inputs, lines with explanation, preview, approval, payment
  evidence, adjustments instead of edits, blockers such as unallocated material costs (AC20, AC30–34, AC43).
- **R5 Role participation.** Role assignments with dates, participation policy per role, monthly base, optional
  threshold / factor / accelerator / cap, pro-rating (AC21–29, AC41).
- **R6 Views and analytics.** Negotiator, Dirección / Gerencia (contribution after variable), Administración home,
  profitability by customer / supplier / product with context, goals vs actual (AC35–39).

Existing commission screens keep working until R2–R4 replace them; historical `CommissionEntry` rows are never recalculated (AC40).

## 5. Policy values given by the user on 2026-11-11 (answers to §39)

| # | Decision |
|---|---|
| R-06 | Commission = **10 % of Eságara**, flat. **No new-customer bonus.** |
| R-07 | Fund split **50 % Commercial / 50 % Operational**. |
| R-08 | **Gerencia** sets splits between people. For now the Journey's negotiator does both functions and receives both parts (100 %). |
| R-09 | Eságara under the threshold: the commission **is paid** (normal), but the sale needs approval by Gerencia, or by levels (group leader first, then Gerencia). The level structure is not defined yet (see the 2025 authorisation ranges the user shared, to be validated). |
| R-10 | Paid **50 % at invoicing, 50 % at collection**; collection half in proportion to reconciled collection, no 90-day loss (R-02). |
| R-11 | Closure materiality: ignore for now (stays 0, nothing blocked). |
| R-12 | **No monthly role participation for now** (R5 not to be built until asked). A Director may receive commission and participation when it exists. |
| R-13 | **Cost of money 6 % a year.** No FX treatment: settlement is in USD, a purchase in another currency counts at the rate on the day it is paid (already how `dealEconomics` reads it), customers should pay in USD. |
| R-14 | The numbers must be changeable in SOLU: **Perfil → Configuración → Modificar números de Rentabilidad**; a change is proposed and Gerencia approves it. |

**Built 2026-11-11:** migration `20261225120000_m12_commission_policy_decisions` (columns `commercialPct`, `operationalPct`,
`proportionalCollection`; new `CommissionPolicy` version with R-06/07/10 effective 2026-11-11; `financeRate` 6 %);
`commission.ts` proportional collection with state `PARTIAL` (earned so far "X de Y"; approvable when the invoice is settled
in full); `PolicyChangeRequest` + `src/lib/rentabilidad-config.ts`, `src/lib/rentabilidad.ts`, `/profile/rentabilidad`
(propose: Finanzas / Administración / Gerencia; approve: Gerencia; approval writes new versions, never edits).
**Limits:** a partial collection half can't be paid out until settlement lines exist (R4); the pool split shows in the policy
but all of it still goes to the Journey owner (allocations per person are R2); advances, returns and warranty effect on
commission were not answered; Gerencia may approve its own proposal (single-manager company) and the record shows it;
the new policy applies to Journeys whose PO is accepted from 2026-11-11, older ones keep the earlier tiers.
## 6. R2 — commission shares between people — DONE 2026-11-11

`CommissionAllocation` (dealId, userId, pool COMMERCIAL | OPERATIONAL, splitPct, reason, setByName, supersededAt);
`CommissionEntry` is now unique per invoice + half + person; `src/lib/commission-split.ts` (`sharesOf`, `shareText`,
`splitProblem`); `computeCommissions` emits one row per person with their fraction and the formula; a person sees sales they
own and sales where Gerencia gave them a share; `saveAllocations` (Gerencia, with a reason; earlier split kept as history) and
the "QUIÉN RECIBE LA COMISIÓN DE ESTA VENTA" block on `/deals/[id]/economia`.
**Limits:** up to three people per function on the form; a split changed after a half was approved or paid does not move that
half (by design, AC33) and SOLU does not yet show the resulting difference as an adjustment (R4); no edit-deadline rule
(Gerencia is the only editor); fractions are rounded per person, so totals can differ by a cent.
**Not built, by user decision:** role participation (R5). **Next:** R1 (commission treatment on the low-Eságara exception;
approval levels wait for the validated authorisation ranges), R3/R4 (four states, monthly settlement with partial collection payouts).
## 7. R3 — collection half paid in parts — DONE 2026-11-11

`CommissionEntry.seq` (unique per invoice + half + person + seq); `collectionRelease` in `commission-split.ts`: what is newly
collected (reconciled cash or withholdings) becomes payable as a new part; earlier parts are never edited; if the final
figure ends below what was approved, the excess is reported ("aprobado de más") and nothing is taken back. Applies to
Journeys under a policy with `proportionalCollection` (from 2026-11-11). Verified on a live sale: 300 Eságara → sale half 15
at invoicing; 40 % collected → 6 payable; rest settled by a withholding → 9 payable as part 2, the 6 untouched.
**R1 resolved by decision R-09:** the commission is paid normally under the threshold, so no treatment selector is built;
a negative Eságara pays nothing (the tier starts at 0 %). Approval by levels waits for the validated authorisation ranges.
**Still not built:** a monthly settlement run with frozen inputs and an idempotency key (today approval and payment are per
person, on demand); adjustment lines for returns / warranty / excess (rules unanswered); the Dirección and Administración
home views; profitability analytics by customer / supplier / product; role participation (by decision).
## 8. R4 — settlement run — DONE 2026-11-11

`CommissionSettlementRun` (period YYYY-MM, version, status APPROVED | PAID, frozen `lines`, total, who approved / paid,
payroll reference) and `CommissionEntry.runId`; `src/lib/settlement.ts` (`settlementPreview`: every half payable now, minus
the approver's own; excess list); `/gerencia/liquidacion` (+ actions `approveRun`, `payRun`). Idempotent through the entry's
unique key (invoice, half, person, part): approving twice creates nothing twice. Paid lines never change. People without a
management or money role see only their own lines.
**Limits:** a run takes what is payable at the moment of approval, the month is its label (no cut-off by date); no export to
payroll (the reference is typed); adjustments are listed as "aprobado de más" but no adjustment line is created (rule
unanswered); the older per-person approve / pay buttons on Comisiones still work alongside; settlement is not blocked by
missing material costs (R-11: ignore for now); role participation is not part of the run (not built by decision).
**Module 12 status:** R0, R2, R3, R4 built; R1 resolved by decision; R5 not built by decision; R6 (Dirección and
Administración home views, profitability analytics by customer / supplier / product, goals vs actual) not built.
## 9. R6 summary screens and authorisation by level — DONE 2026-11-11

**Summary screens.** `src/lib/profit-summary.ts` (one computation over up to 80 accepted Journeys, commissions and runs);
`/gerencia/rentabilidad` (month's invoiced Eságara, expected Eságara of open business, to collect, commissions by state,
Eságara after commissions, why it moved, by customer: sale next to what it leaves) and `/administracion/cierre`
(ready to close, something missing, where Eságara moved most, costs in another currency, commissions ready, runs unpaid, excess).
Visible to Gerencia, Dirección Comercial, Finanzas and Administración. **Limits:** no goal-vs-actual (the Eságara goal lives in
Comercial's goals and is not read here); no view by supplier, product, sector or negotiator; sorted by sale on purpose, never a ranking.

**Authorisation by level (user: "work with the 2025 ranges for now, modifiable later").** `User.authLevel`
(EMPRENDEDOR | JUNIOR | SENIOR), `DealAuthorization`; `src/lib/auth-levels.ts` (`DEFAULT_AUTH_POLICY` = the 2025 table in
SMLV with SMLV 1,423,500; `authStep`; `cleanAuthPolicy`), `auth-levels-store.ts`; `/profile/autorizaciones` (ranges and each
person's level, Gerencia edits, versioned) and `/deals/[id]/autorizacion` (sale in USD → pesos at the official TRM of the day →
step required for the owner's level → who authorised, with mentor and partners notes).
**My assumptions, to confirm:** the ranges apply to the **sale value of the Journey**; the level is that of the Journey's
owner; the amount is converted from USD at the official TRM of the day.
**Limits:** it informs and records, it blocks nothing; mentor and MMS are typed names, not people in SOLU; "partners if relevant
risk" is a free note; not connected to purchase approval (still by USD amount) nor to the low-Eságara exception.