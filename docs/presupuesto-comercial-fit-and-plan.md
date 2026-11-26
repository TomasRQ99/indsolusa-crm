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

## Wave 2 (2026-11-26): history from before SOLU and the Siigo comparison

Asked by the owner the same day ("proceder con lo que puedas hacer de la lista de lo que falta"). Fifth screen **Historial** (`/comercial/presupuesto/historial`):

- A person pastes rows copied from Excel (or uploads a CSV): one row per company and month, with any of requests, quotes (number and value), purchase orders (number and value), Eságara and invoicing. Templates: `/historial/plantilla?s=ANTERIOR|SIIGO`. Origin = earlier system (every figure) or Siigo (invoicing only); currency COP or USD; values in units, thousands or millions.
- Two steps: "Revisar antes de guardar" keeps the text as a `SalesHistoryBatch` (CHECKED) and shows what was understood (rows read, rows to save, each unreadable row with its Excel line and what to fix, totals by year, what an earlier load loses, what will not count). "Guardar historial" writes `SalesHistoryMonth` rows. A load is removed whole.
- Nothing is guessed: the company must match by tax ID (with or without the check digit) or by exact name without its legal ending; the negotiator by full name or email; an unreadable row is left out and listed.
- `loadFacts` now takes a scope (`{ accountIds, ownerIds }`) and joins the loaded figures as facts, so the history table, projected close, seasonality, suggestion and rates use them without any other change.
- "FACTURACIÓN: SOLU FRENTE A SIIGO": for each month with Siigo figures, SOLU's invoices against Siigo's, the difference and the companies that differ (AT-11, by month and company, from a loaded file — not a live reading).

Code: `src/lib/sales-history-rules.ts` (pure: parsing), `src/lib/sales-history.ts` (reads, check, month-average TRM), `historial/page.tsx`, `historial/actions.ts`, `historial/plantilla/route.ts`. Migration `20270129120000_sales_history` (additive). Guide `presupuesto-historial` (ES + EN).

| # | Default taken in wave 2 (NOT confirmed) |
|---|---|
| PC-12 | A loaded figure counts as real only in the months **before the company's first Need in SOLU**; from that month SOLU's own records rule. A company's sale made outside SOLU in or after that month is therefore not counted. |
| PC-13 | For invoicing, Siigo's loaded figure replaces the earlier system's for the same company and month. SOLU's own invoices stay the real figure once the company is in SOLU; Siigo is shown beside them, not instead of them. |
| PC-14 | A loaded figure without a negotiator belongs to the company's owner (today's owner). A new load of the same origin replaces the earlier figure for the same company, month and indicator; removing the new load does not bring the old figure back. |
| PC-15 | Rates of loaded months come from the month's totals (so many requests, of them so many quoted, of them so many won), every one treated as a finished case; the average order uses the loaded number of orders, and a month without that number does not feed it. |
| PC-16 | Dollars are turned into pesos with the month's average official TRM (every calendar day). |
| PC-17 | Gerencia, Dirección Comercial, Finanzas and Administración load and remove; everyone reads. Invoicing figures are expected before VAT and net of credit notes. A difference under 1,000 pesos is rounding. |

Checked on 2026-11-26: 32 parsing checks, 36 data checks on the local database, browser checks on a production build (negotiator and Gerencia; phone width). Not checked: a real file from the earlier system or from Siigo; a large load (thousands of rows); the live site.

## Wave 3 (2026-11-26): reforecast, priorities of the day, deliveries, Excel upload, and the owner's real sales

Asked by the owner: "completa lo que está pendiente por construir"; then, seeing the live screen empty: "necesitamos análisis pasado para poder programar para el futuro… la info no está en el sistema".

- **The owner's 2025–2026 sales load themselves.** `prisma/data/industry-sales-2025-2026.json` (65 company-months built from their two invoice lists: 357 invoices, USD 504,183.15) is loaded once by `src/lib/sales-history-boot.ts`, called from `prisma/seed.ts` at deploy and retried by the daily HOUSEKEEPING job. It creates the missing customers (owner: the first Gerencia user) and two ordinary loads: invoicing, and purchase orders **as an approximation** (the same invoices read as their orders: value and number). `SalesBudgetSetting.historyBootAt` marks it done, so a load a person removes never comes back.
- **Reforecast** (`/comercial/presupuesto/reforecast`, `…/reforecast/[slot]`): estimate = real so far + what the negotiator types for the months still open (probable POs, scheduled invoices), with required assumptions; each save is a cut (`SalesForecast`, `SalesForecastLine`). The official budget is never touched.
- **Priorities of the day** (on Cumplimiento y radar) and **evening email** (`src/lib/sales-insight.ts`, table `SalesInsight`, job `BUDGET_EVENING`): at most three, each a radar detection with its figures and link; with the AI key the model only orders and words them (`aiPriorities` drops anything that names no existing detection). Email off by default (`SalesBudgetSetting.eveningMail`).
- **Deliveries**: indicator `ENT_N` (confirmed deliveries by real date) in the history; optional row "# Entregas objetivo" in the proposal.
- **Historial** reads .xlsx directly (first sheet) and Excel date cells.
- Real against budget and the radar now come from one reader, `src/lib/sales-budget-track.ts`, used by Cumplimiento, Reforecast and the priorities.

| # | Default taken in wave 3 (NOT confirmed) |
|---|---|
| PC-18 | **Confirmed by the owner 2026-11-26.** An invoice of the owner's files is read as its purchase order too (same month, same value), in a separate removable load named as an approximation. |
| PC-19 | Customers created by the automatic load belong to the first Gerencia user; a seller who is not a SOLU user leaves the figure to the company's owner. |
| PC-20 | Reforecast uses no probabilities: real + typed. Only during the year in course. Sums include only companies with a reforecast. |
| PC-21 | Evening email: working days from 17:00 Bogotá, once a day, to each person with a budget of the year, with customer names and figures (unlike the Gerencia close email, which carries only counts). Off until Gerencia or Dirección Comercial turn it on. |
| PC-22 | Priorities: the screen's are worded in the language of whoever prepares them; the email rebuilds them in the recipient's. Without detections SOLU recommends nothing (AT-15). |
| PC-23 | Deliveries are counted, not valued; the delivery goal is typed, never derived. |

Checked on 2026-11-26: 37 rule/data checks, 10 checks of the automatic load (run, rerun, undo) on the local database, browser checks on a production build. Not checked: the AI path with a real key (no key on this PC), a real email, the live site.

Not built: sites / plants, split attribution, feeding Mis metas, delivery value, glossary terms, Siigo read live.

## Wave 4 (2026-11-26): sites, shared sales, budget → Mis metas, Siigo read live

Asked by the owner, who also **confirmed PC-18** ("dejamos la factura como aproximación de la orden de compra").

- **Sites or plants** (`Sitios.tsx`, `sitios-actions.ts`, table `SalesBudgetSite`): inside a company's budget, its plants (Mercado's `Plant`, addable here), the share of the annual PO goal each carries, and real figures by plant (a fact carries its Need's `plantId`). Each Need can name its plant. The company stays the unit: approval and roll-up do not change.
- **Shared sale** (table `SalesShare`, spec §3 "Asignación", AT-13): Gerencia / Dirección Comercial give a percent of a Need to another person. `loadFacts` splits the Need's money facts (owner keeps the remainder to the peso) and loads a person's part of Needs led by others. Counts stay whole with the owner.
- **Approved budget → Mis metas** (`src/lib/sales-budget-goals.ts`): the month's official budget becomes the batting table's goals when none were typed (PO value and number, quotes, requests).
- **Siigo read live** (`src/lib/siigo.ts`, action `pullFromSiigo`): invoices and credit notes of up to 12 months, per tax ID and month, before VAT, into the same review as a pasted load. Off until `SIIGO_USERNAME` / `SIIGO_ACCESS_KEY` are set. **Never run against a real Siigo account**; token request and list parameters follow Siigo's commonly published usage (their docs pages for those could not be read), so every document is re-checked against the span by its own date.

| # | Default taken in wave 4 (NOT confirmed) |
|---|---|
| PC-24 | Sites split only the PO goal, in percent of the annual figure; "Avance del año" compares with the whole year's goal. Loaded history has no site. |
| PC-25 | A shared sale splits money, not counts; the owner keeps at least 1 %; it applies to the commercial budget screens only (not commissions, batting table, customer statistics). Only Gerencia / Dirección Comercial share. |
| PC-26 | Mis metas: typed goal > approved budget > goals per company > recipe. Pesos → dollars at today's official TRM (so the dollar goal moves a little each day). Drafts and waiting proposals are not goals. |
| PC-27 | Siigo: value before VAT = lines' quantity × price − discount (the document total only when it has no lines); foreign currency × its exchange rate; annulled documents skipped; credit notes subtracted in their own month. |

Checked on 2026-11-26: 21 data checks (split to the peso, goals feed, Siigo against a stand-in server: token, both header forms, paging, rate limit, annulled, credit notes, dollars), browser checks on a production build.

Not built: delivery value, invoice-by-invoice Siigo match, glossary terms.

## The budget works in dollars (2026-11-26, owner's decision)

The owner asked for the commercial budget in dollars instead of millions of pesos ("values are also in Million COP,
please convert these to USD"). **This replaces the spec's pesos and every "millions of pesos" above.**

- A fact's value is `usd`: a SOLU document's own dollar value (quotes, purchase orders and invoices are priced in
  dollars; one made in pesos keeps its peso figure and fixed rate beside it for the sources table). No TRM is needed
  for SOLU documents any more.
- Loaded history: a load in dollars is stored as it came (the owner's 2025–2026 sales are exact again: 504,183.15);
  a load in pesos (Siigo) is turned into dollars with the month's average official TRM.
- Goals, reforecasts, company objectives and the average ticket are typed and stored in dollars. Screens show whole
  dollars ("US$ 149.852"); inputs take "12500", "12.500" or "12500,5".
- The indicator keys keep their names (OC_COP, FACT_COP, ESA_COP, COT_COP): stored identifiers, not a currency.
- Migration `20270202120000_budget_in_dollars` (data only): history in dollars back to its original value; anything
  typed in pesos divided once by the latest official TRM stored; the day's saved priorities deleted (prepared again).
- Also: a company without orders in a finished base year says "sin ventas en <año>" instead of "sin base
  suficiente"; Eságara shows "—" when the loaded sales carry none.

| # | Default taken (NOT confirmed) |
|---|---|
| PC-28 | Figures already typed in pesos were converted once at the latest official TRM stored (not month by month). |
| PC-29 | SOLU's suggestions are rounded to US$ 10 (was 0,1 million pesos). |
| PC-30 | Mis metas takes the approved budget's dollar goal as it is (PC-26's TRM conversion is gone). |
| PC-31 | In Spanish notation a lone point followed by one or two digits is read as cents ("1250.5"); otherwise a point marks thousands. |

Checked on 2026-11-26: migration run on the local database (which held the owner's loads in pesos): totals per
company equal the owner's file; parsing and rounding checks; browser check on a production build.

## The owner uploads the invoice Excel; SOLU's own loads removed (2026-11-26)

The owner did not trust the figures SOLU had loaded by itself (they were shown in pesos) and asked to delete them
and to upload the Excel files instead ("that way the info is more accurate").

- Migration `20270202130000_remove_boot_history` deletes the two loads made by `bootIndustryHistory` (rows cascade;
  customers stay). The automatic load is off (`SALES_HISTORY_BOOT=1` would turn it on; nobody should).
- Historial reads the earlier system's invoice sheet as exported: «Fecha, Factura, Cliente, Vendedor, Estado, Envío,
  Impuesto, Importe», one invoice per row, "$1,698.12". `invoiceSheet()` (sales-history-rules.ts) adds it up per
  customer, seller and month into the rows the usual review reads; the load is forced to dollars and its name says
  how many invoices were read and whether their sum equals the sheet's «Total» row.

| # | Default taken (NOT confirmed) |
|---|---|
| PC-32 | «Importe» is used as it is (tax and shipping are zero in the owner's files). |
| PC-33 | A row whose «Estado» says anulado / cancelado / void is not added. |
| PC-34 | A seller who is not exactly one SOLU user: the figure goes to the company's owner. |
| PC-35 | The customers the automatic load had created were not deleted. |

Checked on 2026-11-26 with the owner's two files: 192 and 165 invoices, sums 251,880.77 and 252,302.38, equal to
each file's own total; uploaded through the browser on a production build.

Also: "Mis empresas" has a column with the selected year's real purchase orders, and its header says which year the
budget is built on (the owner read the 2026 tab as "2026 analysis" and found only 2025 figures).

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
| 11 Siigo reconciliation | partly | wave 2: by month and company from a loaded Siigo file; no live reading, no invoice-by-invoice match, no separate credit notes |
| 12 current month by working days | met | rules test + browser |
| 13 attribution 100 % | met | wave 4: shared Needs split to the peso (data test) |
| 14 prospects not a company's history | met | browser + data test |
| 15 AI mail only with figures and links | met by construction, AI path untested | wave 3: priorities are radar detections; the AI cannot add one |

Checked on 2026-11-26: 62 rule/data checks on the local database; 68 browser checks on a production build (negotiator, leader, another negotiator in English, Gerencia; phone width). The official TRM was really fetched and stored (449 days). Not checked: the live site after deploy; real company data (the sample history is small); a leader assigned through a role agreement instead of a team.

## Not built (next waves)

1. Built in wave 2 (see above). Still owed: somebody has to load the real 2024–2026 figures; reading .xlsx files directly.
2. Siigo Nube read live, credit notes as their own figure, reconciliation invoice by invoice.
3. Reforecast (confirmed / probable POs, scheduled invoices) compared with the frozen official budget.
4. AI daily insight and evening email (phase 5), alerts table with owner and due date beyond the to-do.
5. Deliveries budget, sites / plants per company, attribution percentages for shared deals.
6. Feeding the approved budget into Mis metas / Tabla de bateo (today those monthly goals are separate, in USD).
7. Glossary entries for the new terms.
