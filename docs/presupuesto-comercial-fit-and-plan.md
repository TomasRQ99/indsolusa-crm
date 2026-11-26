# Presupuesto comercial — fit, decisions and plan

Source: `SOLU_Especificacion_Presupuesto_Comercial_2027_Final.md` (ImportSoluciones SAS, v1.0, 2026-11-26), given by the owner on 2026-11-26 with "crear una opción de generar presupuestos comerciales".

## What was built (wave 1, 2026-11-26)

COMERCIAL → Mi trabajo → **Presupuesto comercial** (`/comercial/presupuesto`), four screens:

| Spec | Screen | Address |
|---|---|---|
| P01 Mis empresas | list, filter, order, add a company, prospects line | `/comercial/presupuesto` |
| P02 Empresa 360 + P03 Propuesta + P04 Simulador | history with sources, assumptions, 12 months, approval trail | `/comercial/presupuesto/[accountId]` and `/prospectos` |
| P05 Consolidación | company → team → negotiator → customer, 12 months, objective and gap, checks, publish, CSV | `/comercial/presupuesto/consolidacion` |
| P06 Aprobaciones | waiting for me, my proposals, all in view, movements | `/comercial/presupuesto/aprobaciones` |
| P07 Cumplimiento y radar | real vs budget on working days, pace, projection, radar with to-dos | `/comercial/presupuesto/cumplimiento` |

Code: `src/lib/sales-budget-rules.ts` (pure rules, `BUDGET_RULES` holds every threshold), `src/lib/sales-budget.ts` (reads), `src/lib/trm-store.ts` (official TRM by day, table `TrmDay`), `src/app/(app)/comercial/presupuesto/*` (pages, `actions.ts`, `Editor.tsx` client form, `presupuesto.css` prefix `pc-`). Tables (migration `20270128120000_sales_budget`, additive): `SalesBudget`, `SalesBudgetLine`, `SalesBudgetEvent`, `SalesBudgetYear`, `TrmDay`. Proposals sent for approval also show in Pendientes por aprobar (`src/lib/pending.ts`).

## How each figure is counted

- Requests = Needs created (month created). Quotes = one per Need, month of first presentation, value of the last presented revision. Purchase orders = customer POs **accepted** (`PoAcceptance`), on the acceptance date; rejected or not yet accepted ones don't count. Invoicing = SOLU invoices by issue date. Eságara of POs = PO value × margin of its quote.
- Pesos: a document made in pesos uses its own fixed rate; a dollar figure uses the official TRM of its date (kept in `TrmDay`). Each fact keeps original amount, currency, rate, rate date and source. A dollar figure without a stored TRM is shown as "sin tasa" and left out of totals.
- Attribution: by the owner of the Need (100 %, once). Real figures of a person without their own budget for a company go to the budget of the company's owner (else the first budget of that company); sales to companies without any budget go to the person's "Reactivaciones y prospectos" line; otherwise "Real sin presupuesto".
- Suggestion = projected close of the year before × (1 + growth), spread by the company's own seasonality (≥ 12 complete months and ≥ 6 with orders) or evenly. Projected close = complete months + the months to come at the average of the months with history (≥ 3).
- Rates by cohort over 24 months, decided quotes only, requests older than 30 days, minimum 5 cases; when the company alone has too few, the negotiator's whole portfolio is used and the screen says so.

## Decisions — all are my defaults, NOT confirmed by the owner (spec §11 leaves them open)

| # | Default taken |
|---|---|
| PC-01 | PO counts when accepted in SOLU ("Aceptar PO"), on that date. Differs from Tabla de bateo, which counts POs when received. |
| PC-02 | Invoicing comes from SOLU's invoices; there is no Siigo reading, no credit notes (SOLU has none) and no reconciliation (AT-11 not met). |
| PC-03 | Thresholds in `BUDGET_RULES`: 5 cases, 24-month window, 30-day maturity, 3 months to project, 12/6 months for seasonality, suggestions rounded to 0.1 M; radar: 85 % pace, −30 % requests, +20 % quotes, −3 margin points, Pareto = 80 % of 12-month POs. |
| PC-04 | One negotiator per Need = 100 % attribution; no split percentages; two negotiators may each budget the same company for their own Needs. |
| PC-05 | Approver = the person's leader (role assignment or team leader); without one, Gerencia or Dirección Comercial; never oneself. |
| PC-06 | "Vigente" = approved + the year published by Gerencia / Dirección Comercial on the Consolidación screen. |
| PC-07 | Who reads: own; leaders their people; Gerencia, Dirección Comercial, Finanzas and Administración everything. Who writes a proposal: the negotiator, Gerencia or Dirección Comercial. |
| PC-08 | Company objective is annual (not monthly), three figures; it only shows the gap. |
| PC-09 | Justification is required to send when any month differs from SOLU's own suggestion (growth 0) or there is no suggestion. Empty month = 0. |
| PC-10 | Money typed and shown in millions of pesos. Years offered: the one in course and the next. |
| PC-11 | Anulados: SOLU has no "cancelled" state for a Need, so every non-internal Need counts as a request. |

## Acceptance criteria

| AT | State | How checked |
|---|---|---|
| 01 annual = sum of months | met | rules test + browser |
| 02 roll-up without double counting | met | data test (shared company, catch-all) + browser total = sum of rows |
| 03 three revisions count once | met | data test |
| 04 cancelled PO not real; credit note | partly | rejected / unaccepted PO excluded; SOLU has no credit notes |
| 05 transfer keeps history | met | data test |
| 06 February invoicing from earlier POs | met | data test |
| 07 percentages from totals | met | rules test |
| 08 no basis → says so | met | rules + browser (prospects) |
| 09 open quote not a loss | met | data test |
| 10 approved locked; correction = version | met | browser |
| 11 Siigo reconciliation | not built | needs the Siigo mapping (PC-02) |
| 12 current month by working days | met | rules test + browser |
| 13 attribution 100 % | met by construction | one owner per Need |
| 14 prospects not a company's history | met | browser + data test |
| 15 AI mail only with figures and links | not built | phase 5 |

Checked on 2026-11-26: 62 rule/data checks on the local database; 68 browser checks on a production build (negotiator, leader, another negotiator in English, Gerencia; phone width). The official TRM was really fetched and stored (449 days). Not checked: the live site after deploy; real company data (the sample history is small); a leader assigned through a role agreement instead of a team.

## Not built (next waves)

1. History loaded from outside SOLU (2024–2026 from the old system / Siigo): today the history is only what SOLU itself holds, so most real companies will say "sin base suficiente" until then.
2. Siigo Nube invoicing and credit notes, with reconciliation per period (AT-11).
3. Reforecast (confirmed / probable POs, scheduled invoices) compared with the frozen official budget.
4. AI daily insight and evening email (phase 5), alerts table with owner and due date beyond the to-do.
5. Deliveries budget, sites / plants per company, attribution percentages for shared deals.
6. Feeding the approved budget into Mis metas / Tabla de bateo (today those monthly goals are separate, in USD).
7. Glossary entries for the new terms.
