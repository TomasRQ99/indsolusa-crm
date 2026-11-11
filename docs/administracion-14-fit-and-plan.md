# Módulo 14 · Administración (v1.2) — fit and plan

Source: `Downloads\14_Administracion_CLAUDE_CODE_OFICIAL_v1.2.md` (cut 2026-11-09, built 2026-11-11).
Mandate: Administración administers the company's resources — cash, credit, receivables, payments, budget, assets,
contracts, labour data and policies — so the other modules move knowing what is available, exposed and authorised.

## 1. What already existed (built in modules 9–13)

| Spec | In SOLU before this module | Gap closed here |
|---|---|---|
| §2A Treasury & Cash | Bank accounts and statements; "due in / out" by horizon in Informes | Confirmed balances, restricted / reserved money, Available Liquidity line by line, forecast 7 / 30 / 60 / 90, gap and levers |
| §2B, §6 Customer Credit | Cupos de crédito (limit, AR, accepted not invoiced, available, overdue), credit requests decided by Finanzas / Gerencia, credit exception on a Journey | Lent credit authority; nothing else needed |
| §2C, §7 AR & Collections | Cuentas por cobrar, invoice steps (submitted → approved for payment), promises judged against reconciled cash, cash blockers with root cause, payment behaviour | Expected payment date used in the cash forecast, apart from the contractual due date (AC4) |
| §2D Accounts Payable | Supplier payments with milestones, bank verification, approval, execution | Supplier invoice, three-way match, service acceptance, discount, payment calendar today / 7 / 30 |
| §2E Bank Reconciliation | Statement upload, suggestions, one-to-many and many-to-one matches, partial / unmatched | Classification extended to expense, payroll, tax, financing, investment, refund |
| §2F Budget, §2G Internal procurement | Nothing (Operaciones decision O-05 left them for this module) | Built |
| §2H Assets, §2I Contracts | Nothing | Built |
| §2J Accounting interface | Manual bridge state on each customer invoice | Files of facts for accounting, export log |
| §2K People admin, §15 Absence, §23–26 | Coverage of an absent person's Journeys (Comercial C8b) | Bond, formal assignment, pay, absences, support gaps |
| §2L Policy administration | Versioned policies spread over their own screens | One register; reason per version; Administración policy |
| §3 Módulo 12 | Built (closure, commissions 50 / 50, settlement run) | Linked from the Home; nothing duplicated |
| §10 Events | Audit trail of every material change | Named business events derived from the audit trail |
| §14 Travel | Interim rules travel-v1 (decision C-17) | Advance, outcome per expense, settlement, budget link (travel-v2) |
| §16 Temporary authority | Coverage gives access to Journeys, never approvals | Delegated authority for purchase approval, payment approval and credit |

## 2. Decisions

Defaults I took to keep building. The user confirmed A-01, A-03, A-04 and A-07 on 2026-11-11 (with two changes, written below); the rest are still my defaults. None is hard-coded where the spec asks for policy.

| # | Decision |
|---|---|
| A-01 | **People data.** Labour facts (bond, contract dates, absences, formal assignment) are seen and edited by Gerencia and the role Administración; each person sees their own. **Pay** is seen by Gerencia, Finanzas and the person, set by Gerencia only, kept in its own table, and its amount never goes to the change history. **Confirmed by the user 2026-11-11, who added Finanzas to those who see pay.** |
| A-02 | **Finanzas and Administración stay one money role** (decision 2026-11-10 unchanged), except for people data (A-01). |
| A-03 | **Administración policy starting values:** ask for a contract's decision 30 days before its notice date; materiality USD 0 (every obligation interrupts until Gerencia sets an amount); three-way-match tolerance USD 0; a lent authority lasts at most 60 days per version. Editable by Gerencia at Administración → Políticas. **Confirmed by the user 2026-11-11.** |
| A-04 | **Who assigns budgets:** Gerencia or Finanzas (**user decision 2026-11-11**). The owner keeps the forecast; Administración records commitments. Budgets are kept in USD. |
| A-05 | **Internal purchases use the existing purchase policy** (level by amount, never the requester). A purchase with no budget, or above what its budget has left, is an exception: higher level and a written reason. |
| A-06 | **Payment of a supplier invoice without a customer order** (internal purchase or none): approval by the purchase / payment policy, never by whoever recorded the invoice; paying is a later fact. Invoices of an order keep being paid through the order's payment requests. |
| A-07 | **Who lends authority:** Gerencia approves every delegation, never the person who receives it. Domains: approve purchases, approve supplier payments, decide credit requests. The delegate acts with the lender's role level, up to the cap, never on the lender's own request. **Confirmed by the user 2026-11-11.** |
| A-08 | **Absences:** asked by the person, decided by Administración or Gerencia (never the person). The kind of absence is visible only to the person, Administración and Gerencia; everyone else sees "away". |
| A-09 | **Accounting files** are downloaded by Gerencia and Finanzas (same as report exports, I-07). |
| A-10 | **Credit "committed exposure"** keeps the existing rule: accepted orders not yet invoiced use up the limit. It is not yet a switch in a policy. |

## 3. Built — 2026-11-11 (one wave)

Schema: migration `20270104120000_m14_administracion` (additive only): `CashBalance`, `CashReserve`, `CashPlanItem`,
`SupplierInvoice`, `Budget`, `BudgetEntry`, `InternalPurchase`, `Asset`, `AssetEvent`, `Obligation`, `PersonAdmin`,
`PersonCompensation`, `PersonRoleAssignment`, `AbsenceRecord`, `DelegatedAuthority`, `SupportGap`, `DomainEvent`,
`AccountingExport`; new columns on `CommercialMission` (budget, advance, settlement), `MissionExpense` (outcome) and
`MarketSetting` (reason). It also marks the expenses of trips reconciled earlier as valid.

Pure rules: `src/lib/admin-rules.ts` (policy, obligations, three-way match, budget, internal purchases, assets,
delegated authority, absences, travel settlement), `src/lib/treasury-rules.ts` (liquidity, projection, low point,
levers, expected collection), `src/lib/domain-events.ts` (audit row → business events).
Reads: `admin-store.ts`, `treasury.ts`, `admin-home.ts`, `internal-purchase.ts`, `admin-attention.ts`,
`accounting-export.ts`, `admin-daily.ts` (job `ADMIN_DAILY`), `fd.ts` (form reading).

Screens (menu Administración, now grouped Hoy / Dinero / Recursos / Cierre / Configuración):

- **Inicio** `/administracion` (§4, AC17): eight sections plus People, only actionable exceptions, each with impact,
  reason and where to act; what is fine is one quiet line. Other roles see what is theirs.
- **Exposición de recursos** `/administracion/exposicion` (§5, AC13): cash, customers, suppliers, stock, currency,
  assets, contracts — seven separate blocks, never one score.
- **Tesorería** `/administracion/tesoreria` (§2A, §8, §17, AC1, AC16): bank → restricted → reserved → committed →
  available; projection at 7 / 30 / 60 / 90; gap with the levers that exist; future money by kind (contracted and
  invoice-ready are kept apart from receivables); confirmed balances with source and date; reserves with purpose and
  authority; plan items (payroll, taxes, financing) with confidence, source and observed date.
- **Cuentas por pagar** `/administracion/pagar` (§2D, AC7, AC8): payment calendar, open discounts, supplier invoices
  against order and receipt, service acceptance, accepted differences, approval and payment as separate facts.
- **Presupuesto** `/administracion/presupuesto` (§2F, AC10): budget / committed / spent / left / owner's forecast,
  with where each figure comes from.
- **Compras internas** `/administracion/compras-internas` (§2G): need first, budget and authority, TCO for assets.
- **Activos** `/administracion/activos` (§2H, AC11): asset record, custody history that is never edited, vehicles.
- **Contratos y obligaciones** `/administracion/obligaciones` (§2I, AC12): alerts only while a decision changes the outcome.
- **Personas** `/administracion/personas` (§2K, §15, §23–26, AC18): bond, formal assignment history (contract title
  and SOLU role kept side by side), pay, absences, assets in care, support gaps.
- **Autoridad prestada** `/administracion/autoridad` (§16, §24): ends by itself; more time is a new version.
- **Contabilidad** `/administracion/contabilidad` (§2J, AC19): six files of facts, export log, bridge state.
- **Políticas** `/administracion/politicas` (§2L, AC9, AC15): register of every versioned policy.
- **Eventos** `/administracion/eventos` (§10).

Wired into existing work: purchase approvals, supplier-payment approvals and credit-request decisions accept a lent
authority and record whose it was; an approved absence removes that day's capacity in Mi Plan and shows in Cobertura
when nobody covers; the trip page gained advance, outcome per expense and settlement; the bell and the Administración
counter include obligations to decide, internal purchases, absences and overdue support; Historial de cambios names
the new records; bank movements can be classified as expense, payroll, tax, financing, investment or refund.

## 4. Verification status

- Type check: clean. Production build: passes.
- Pure rules: 127 checks passed: policy cleaning, every obligation state and boundary day, materiality, due dates
  with month-end clamping, three-way match kinds and tolerance, budget arithmetic, delegation window (start inclusive,
  end exclusive), caps and requester exclusion, absences, travel settlement, expected collection, liquidity,
  projection, low point (out before in on the same day), events.
- Database (local, after the user applied the migration): 77 checks passed: liquidity and projection deltas, reserve
  past its date and released, budget commits on approval and turns to spent when bought, purchase authority (never
  the requester, over budget and no budget go to level 2), delegation (cap, lender's own request, other domain,
  expired, revoked, lender deactivated), three-way match through an internal purchase, duplicate invoice refused,
  custody history, home sections and items, exposure blocks, bell per person, absence → Mi Plan capacity, pay and
  absence kind kept out of the audit trail, events written from audit rows, daily job idempotent, accounting files.
- Browser (headless Edge on the production build): 93 checks passed, no browser errors: every new screen renders,
  menu groups, phone width; treasury, budget, internal purchase (requester sees no decision form, Finanzas inside
  budget, Gerencia with a reason over budget), lent authority used and recorded, payables (duplicate refused,
  recorder cannot approve, approve is not pay), assets, obligations, people (who sees pay and who does not),
  absences, support gap, policies, accounting file (403 for other roles), events, and the whole trip flow
  (advance cap, outcome per expense, reconcile, settlement of −180, budget spend).
- Not checked in a browser: a three-way match against a real goods receipt of a supplier order (the rule and the
  query are covered by the pure and database checks through internal purchases), supplier-payment approval and
  credit-request decision with a lent authority (same `actWith` path as purchases, which was checked), statement
  balance suggestion, and the English texts.

## 5. Acceptance criteria (§13, §18, §26)

| AC | Where | Status |
|---|---|---|
| 1 Available Liquidity explained | Tesorería → Liquidez disponible | Built |
| 2 Commercial cannot change the limit | `canDecideCredit` (existing) | Existing |
| 3 Credit request keeps reason, amount, evidence, authority, outcome | `CreditReviewRequest` (existing) | Existing |
| 4 Contractual due vs expected payment | Forecast item keeps `due` and `on` | Built |
| 5 Promise compared with real cash | `promiseStatus` (existing); events fulfilled / missed by the daily job | Existing + built |
| 6 Partial, one-to-many, many-to-one | `BankMatch` (existing) | Existing |
| 7 PO + receipt / acceptance + invoice | `threeWay`, Cuentas por pagar | Built |
| 8 Payment approval apart from purchase approval | Existing for orders; built for internal purchases | Built |
| 9 Policies versioned, with validity | Políticas register | Built (see limits) |
| 10 Commitments use the budget before payment | `budgetView` | Built |
| 11 Custody history | `AssetEvent` | Built |
| 12 Obligations alert by date and materiality | `obligationView` | Built |
| 13 No single exposure score | Exposición | Built |
| 14 Settlement explains every peso | Módulo 12 settlement run | Existing |
| 15 No silent recalculation | Records keep `policyVersion` | Built |
| 16 Source and observed_at on material figures | Balances, plan items, forecast items, supplier invoices | Built |
| 17 Home shows actionable exceptions | Inicio | Built |
| 18 Compensation / personal data protected | `canSeePay`, `canAdminPeople`, audit exclusions | Built |
| 19 Export does not alter facts | Read-only route + log | Built |
| 20 Every movement explained or openly unmatched | Bank classes + "Dinero sin conciliar" | Built |
| v1.1 No expense validated without evidence / outcome | `MissionExpense.outcome` | Built |
| v1.1 Absence changes availability | Mi Plan, Cobertura | Built |
| v1.1 Delegation cannot outlive its end without a new version | `delegationActive`, `extendAuthority` | Built |
| v1.1 Future billing not shown as AR | Buckets CONTRACTED / INVOICE_READY | Built |
| v1.2 Contract title vs operating role, with history and dates | `PersonRoleAssignment` | Built |
| v1.2 Temporary access expires | Delegation and coverage both time-checked on use | Built |
| v1.2 Administración does not edit values or private evaluations | Nothing of the kind exists here | Built |
| v1.2 Support Gap can be escalated | `SupportGap` | Built |

## 6. Limits

- **Policy validity:** a version is in force from the moment it is saved until the next one; there is no future
  `effective_from` and no draft-then-approve step except for the profitability numbers (Módulo 12). The reason is
  stored only for versions saved from Políticas; other policy forms don't ask for it yet.
- **Money in other currencies** is never converted: balances, payments and obligations not in USD are listed apart
  and left out of liquidity and the projection. Budgets are USD only.
- **Stock has no book value:** Inventory Exposure shows units by state and approved stock purchases.
- **Forecast sources** are written in Spanish only. Committed payroll and taxes exist only if someone types them.
- **Credit committed exposure** is not a policy switch (A-10). Lent credit authority covers credit requests, not
  changing a limit directly or granting a Journey exception.
- **Delegation scope** is domain + cap + dates; "over what" is a note for people, not enforced.
- **Authority provisioning from role (§24):** a role change takes effect at once (roles are read on every request)
  and a deactivated lender's delegations stop, but there is no screen listing "permissions to retire" on a change.
- **Support gaps** are raised by hand; they will come from `RoleProfile` when Módulo 16 exists.
- **Vacation balance** is days approved this year against a typed allowance; SOLU computes no statutory accrual,
  payroll or benefits.
- **Integrations (§11):** no bank, accounting, payroll, DIAN or document-storage connection; the events table and
  the files are what an adapter would read. Obligations are not sent to Outlook.
- **Accounting files:** no stock movements file and no tax / withholding summary beyond what each receipt records.
- **Events** start on the day this module is deployed; `cash.allocated` for applications created together with a
  payment carries a summary, not one event per invoice.
- **No sample data** was added for this module.
