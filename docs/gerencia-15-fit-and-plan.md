# Módulo 15 · Gerencia (v1.2) — fit and plan

Source: `Downloads\15_Gerencia_CLAUDE_CODE_OFICIAL_v1.2.md` (cut 2026-11-09, built 2026-11-11).
Mandate: Gerencia coordinates the present and takes the company towards the direction it chose. It reads through the
same records every other module uses and never keeps a second copy of a figure.

## 1. What already existed (built in modules 9–14)

| Spec | In SOLU before this module | Gap closed here |
|---|---|---|
| §2A Business Pulse | Informes → Pulso del negocio (by function, month, snapshot at close) | One Home with six separate blocks: result, cash, promise, exceptions, resources, people |
| §2B Future Pulse, §16–17 | Informes → Pulso del futuro (four futures by horizon) | The eight-stage bridge from opportunity to collection, each stage with its own truth; future Eságara by bucket with its basis |
| §2C Decisions Needed | Approvals spread over their modules; a queue of material exceptions (Informes I2); a short list on Insights | One line of everything that waits for Gerencia's authority, with question, why now, impact, options, facts vs assumptions, window, owner afterwards |
| §2D, AC14 Exposure | Administración → Exposición de recursos (seven blocks) | Shown on the Home with people capacity as the seventh line; still never one score |
| §3 Strategic priorities | Nothing | Built |
| §4 Decision record | Nothing (each approval keeps its own record) | Built: versions, authority, expected and actual consequence |
| §5 Functional reviews | Informes → Función Comercial | Five reviews with the same three questions: what changed, why, what to decide |
| §6 Strategic accounts | Customer 360, Mercado company page | Gerencia's view over chosen customers; nothing copied |
| §7 Scenarios | Nothing | Built |
| §8 Policy oversight | Administración → Políticas (register) | Pending exceptions, highest-level approvals, exceptions that repeat |
| §9, §21 People & capacity | Absences, coverage, relationship backup, support gaps, teams | One continuity view: uncovered absences, coverage overload, key relationships and roles with nobody behind |
| §10, §19 Rhythm and closes | Comercial → Cierres (day / week / month, per person or company) | Executive close: future first, then result, value, risks, cash, capacity |
| §11 Insights | Insights tab, Informes insights (fact / inference with evidence) | Used inside the functional reviews; moved to `/gerencia/insights` |
| §14 Events | Events derived from the audit trail (Módulo 14) | Eleven new events; a daily picture for the three that depend on time |
| §18 High-value focus | Comercial → Foco, Operaciones → Alto valor | Seven sets on one screen, each item saying why it is there; concentration |
| §20 System performance | Mi mejora (one person against their own past) | The company against its own past, six dimensions, no person compared |
| §22–23 Identity, charters | Nothing | Built, versioned; seeded with the official texts |
| §24–25 Role governance | Formal assignment (Módulo 14) | Panel with what can be answered today; role profiles wait for Módulo 16 |

## 2. Decisions

Defaults I took to keep building. None was put to the user before building; all are open to change.

| # | Decision |
|---|---|
| G-01 | **Gerencia Home is the first screen of the module** (`/gerencia`). The earlier Insights screen keeps everything and moves to `/gerencia/insights`. |
| G-02 | **Who sees what (§13).** Gerencia: everything. Director Comercial: Home, bridge, priorities, strategic accounts, scenarios, reviews, system performance and policy oversight, all read-only except that they may write scenarios and ask for decisions; no people block. Everyone: ask Gerencia for a decision and follow their own, read the identity and the function charters. A "board / assembly" read-only role is not built (no such role exists in SOLU). |
| G-03 | **People & capacity and the Equipo review are for Gerencia only.** They hold no private reflection, test or development note, and never the kind or note of an absence (AC13). |
| G-04 | **Gerencia policy starting values** (versioned, changed at Gerencia → Políticas y autoridad): automatic matters enter Decisions Needed from USD 0 (all); at most 9 shown at once; concentration from 30 %; an exception "repeats" at 3 times in 90 days; a charter asks for review after 365 days; a change between two daily pictures is material from 20 %; only Gerencia publishes identity and charters. |
| G-05 | **Only Gerencia decides** a management decision. Anyone may ask; the requester or Gerencia may withdraw; Gerencia or the person left in charge writes what really happened. |
| G-06 | **An approval stays in its own module.** Decisions Needed gives it a place in line and opens it where it lives; it is not copied into a decision record. What enters the line by itself: second-level purchases and internal purchases, low-Eságara exceptions, credit requests, customers over their limit with an accepted order, a pending change of profitability numbers, supplier payments above the first level's amount. |
| G-07 | **Function purposes are frozen**: the five texts of the official documents are copied, never typed. A charter publishes everything else. |
| G-08 | **Role profiles are not created here.** Módulo 16 owns `RoleProfile`. The rule "a role is clear only with purpose, outcomes, responsibilities, decision rights and boundaries" exists (`roleClarity`) and today answers "not clear" for every role, said openly on screen. |
| G-09 | **Strategic accounts and priorities are chosen by Gerencia.** The executive in charge of an account may update its next movement; a priority's owner may write its review. |
| G-10 | **Identity version 1** is the text of §22 of the official document, with the approver recorded as the document itself. Principles carry no "expected conduct" text yet and the methodologies list is empty: the Module 15 document names neither, so nothing was invented. |

## 3. Built — 2026-11-11 (one wave)

Schema: migration `20270105120000_m15_gerencia` (additive only): `StrategicPriority`, `StrategicPriorityLink`,
`StrategicPriorityReview`, `ManagementDecision`, `ManagementDecisionReview`, `Scenario`, `StrategicAccount`,
`CompanyIdentity`, `FunctionCharter`, `ManagementSnapshot`. It inserts identity version 1 and the five function
charters with their frozen purpose.

Pure rules: `src/lib/gerencia-rules.ts` (policy, decision request and outcome, decision stage, the line of Decisions
Needed, scenarios, priorities, identity, function gaps, role clarity, concentration, repeated exceptions, material
change, bridge split, trend).
Reads: `gerencia-store.ts` (policy, identity, charters, `neededItems`, `decisionsNeeded`), `gerencia-home.ts`
(`gerenciaHome`, `futureBridge`), `gerencia-people.ts`, `gerencia-views.ts` (strategic accounts, functional review,
policy oversight, system performance), `gerencia-daily.ts` (job `GERENCIA_DAILY`), `policy-register.ts` (the register,
now shared with Administración → Políticas).
Four heavy reads (`profitSummary`, `opsHome`, `highValueCommitments`, `treasuryView`) are now computed once per page.

Screens (menu Gerencia, grouped Hoy / Dirección / Revisión / Gobierno / Dinero):

- **Inicio** `/gerencia` (§2, AC1–6, AC14, AC17): decisions first, material exceptions, what changed since the last
  daily picture, six business blocks, six future blocks, seven exposure lines.
- **Decisiones** `/gerencia/decisiones`, `/gerencia/decisiones/[id]` (§4, AC7, AC16, AC20): ask, decide, withdraw,
  review against what happened, new version; the record.
- **Cierre ejecutivo** `/gerencia/cierre` (§19): day, week, month.
- **Puente al futuro** `/gerencia/futuro` (§16–18, AC5): eight stages, Eságara buckets, focus sets, concentration.
- **Prioridades estratégicas** `/gerencia/prioridades` (§3, AC9).
- **Cuentas estratégicas** `/gerencia/cuentas` (§6, AC11).
- **Escenarios** `/gerencia/escenarios` (§7, AC8): a scenario can be taken to a decision, which then freezes it.
- **Revisión por función** `/gerencia/revisiones` (§5, AC10).
- **Insights** `/gerencia/insights` (existing screen, new address).
- **Desempeño del sistema** `/gerencia/sistema` (§20).
- **Personas y capacidad** `/gerencia/personas` (§9, §21, AC13).
- **Identidad** `/gerencia/identidad` (§22, §26).
- **Funciones y roles** `/gerencia/funciones` (§23–25, §26).
- **Políticas y autoridad** `/gerencia/politicas` (§8, AC12).

Wired into existing work: the bell and the Gerencia counter show decisions asked of Gerencia and decisions whose
follow-up date arrived; Historial de cambios names the new records; the events screen lists the new events.

## 4. Verification status

- Type check: clean. Production build: passes.
- Pure rules: 148 checks passed (policy cleaning and limits, request and outcome completeness, every decision stage
  and boundary day, queue order, cap and materiality, scenario refusals, priority health, identity in force, changed
  fields, every function gap, role clarity, concentration, repeated exceptions with the boundary day, material change,
  bridge split, trend, and the events derived from audit rows).
- Database (local): 93 checks passed (seeded identity and charters, a decision through request → line → decided →
  review → new version with both versions kept, who may read it, audit rows and events, the bell, Home structure, Home
  and bridge figures equal to Informes, strategic account states, people and capacity with coverage and backup, absence
  kind and note never leaving, the five reviews, a repeated exception found as a pattern, system performance, the daily
  job run twice writing once).
- Browser (headless Edge on the production build): 141 checks passed, no browser errors: every new screen as
  Gerencia, as Director Comercial and as a negotiator; every form with its refusals; phone width on seven screens;
  English on four; the existing screens touched (Insights, Administración policies, history, events, Informes future
  pulse, Administración and Operaciones homes).
- Not checked in a browser: Decisions Needed fed by a real second-level purchase, internal purchase, Eságara exception
  or supplier payment (the line was checked with requests made by people and, in the database, with credit requests);
  the "what changed" note on the Home (it needs two daily pictures on different days); the review-due block on the Home.
  The production deploy itself is not verified from the session.

## 5. Acceptance criteria (§15, §26)

| AC | Where | Status |
|---|---|---|
| 1 Home understood in under a minute | Decisions first, then 6 + 6 blocks of two or three figures, 7 exposure lines | Built (to be judged by Gerencia in use) |
| 2 Normal operations do not flood Decisions Needed | `rankQueue`: materiality, cap, only matters above the lower levels | Built |
| 3 Each exception explains impact and resolution path | Decision card; material exceptions table | Built |
| 4 Pulse separates result, cash, fulfilment, people, risk | Six blocks | Built |
| 5 No fictitious probabilities | Counts and amounts in real states, each with its basis | Built |
| 6 Critical metric drills to cause and evidence | Every figure is a link; reviews link to causes | Built (see limits) |
| 7 Decisions keep options, rationale, authority, follow-up | `ManagementDecision` | Built |
| 8 Scenario separates assumptions from facts | `Scenario`, `scenarioIssues` | Built |
| 9 Priorities connect to real objects | `StrategicPriorityLink`, health flag when none | Built |
| 10 Review shows what changed / why / what to decide | Revisión por función | Built |
| 11 Strategic accounts do not duplicate Company 360 | Only reason, growth note and next movement stored | Built |
| 12 Recurrent exceptions identified as a pattern | `recurring`, Políticas y autoridad | Built |
| 13 People view respects privacy | `peopleCapacity` reads no kind, note, pay or private data | Built |
| 14 Exposure without an opaque score | Seven lines | Built |
| 15 AI insights show evidence and uncertainty | No AI is used: insights are counted facts, an inference is labelled | Built without AI |
| 16 Historical decisions not overwritten | A decided row is never edited; revision = new version | Built |
| 17 Mobile prioritises decisions | Decisions are the first block; one column | Built |
| 18 No second source of truth | Figures read from Informes, Administración, Operaciones, Comercial | Built |
| 19 Access scoped by entity / function / authority | By role and authority | Partly: no scoping by legal entity (see limits) |
| 20 Decision reviewed against its real consequence | `ManagementDecisionReview`, review-due list and bell | Built |
| v1.2 Only configured authority publishes | `canPublish` with the Gerencia policy | Built |
| v1.2 Compare current structure with history | Changed fields per version, earlier versions readable | Built |
| v1.2 A role is not "clear" without its five parts | `roleClarity` | Built; no profile exists until Módulo 16 |
| v1.2 Values shown as conduct per role, no culture score | Identity keeps conduct text per principle; no score anywhere | Partly: per-role conduct waits for Módulo 16 |

## 6. Limits

- **Role profiles (§24):** roles without a profile, expectations not reviewed, decision-right conflicts between roles
  and successors need `RoleProfile` (Módulo 16). Today the panel shows the SOLU access roles, people without a formal
  position, and duplicates / gaps between functions.
- **Readiness, succession, development gaps (§9):** wait for Módulo 16. "Roles with one holder" uses the SOLU role.
- **Legal entity (§13, AC19):** Gerencia sees both selling companies together; there is no filter or permission by
  entity, and no board / assembly role.
- **Drill-down (§12):** a figure opens the screen that holds its evidence; there is no single path
  aggregate → function → person → Journey on one screen.
- **Decisions Needed:** an approval is decided in its module and leaves no Management Decision Record unless someone
  opens one. Supplier payments enter the line by amount only.
- **Scenarios** are typed by a person: SOLU does not calculate ranges and does not pre-fill them from a Journey.
- **Priorities:** indicators tied to a metric show the current month or today's value, not a trend or a target.
- **Functional reviews:** the "why" is as rich as the records allow; Mercado and Equipo have few causes. Only the
  Commercial review has a goal-gap decomposition (Informes).
- **System performance:** fixed windows (90 days against the 270 before); the minimum of 5 cases is in code.
- **Events:** `risk.material_changed`, `future_pulse.material_change` and `strategic_account.attention` are written
  by the daily job, so they start the day after the first picture. `policy.exception_escalated` covers purchases only.
- **Rhythm (§10):** the daily, weekly and monthly closes exist; there is no quarterly review screen and nothing is
  sent by email.
- **Supplier / capacity constraints (§2B):** shown as supplier concentration and exposure, not as supplier capacity.
- **No sample data** was added for this module.

## 7. Second round — 2026-11-11

Deploy: the first push failed on Render with "JavaScript heap out of memory" in the type check of `next build`
(Render's default heap is about 2 GB). `npm run build` now runs `scripts/build.mjs`, which gives the build workers
4 GB. The database migration had already been applied by that failed deploy.

Built:

- **Sample data for Gerencia** (`seedGerenciaDemo` in `demo.ts`, added on load and as a top-up): one strategic
  account, one priority linked to a sample customer and exploration, one scenario, one decision waiting (DG-EJ-0001)
  and one decided whose follow-up date has arrived (DG-EJ-0002). `removeDemo` now also removes decisions, scenarios and
  priorities that are sample data or belong to a sample person; without that, a sample person who had asked for a
  decision or owned a priority could not be removed.
- **Quarterly review** in Cierre ejecutivo (§10): the same blocks over the calendar quarter, plus direction and
  resources (each priority and whether it was reviewed in the quarter, resource-allocation decisions, links to
  trends, capability and risk concentration).
- **From a Journey:** "Pedir a Gerencia" opens a decision request, or a scenario for management roles, already linked
  to the Journey.
- **From an approval in the decision line:** "Dejar también un registro de decisión" opens a decision record already
  filled in, so an approval decided in its module can also leave a Management Decision Record.
- **Event:** `policy.exception_escalated` is also written for a second-level internal purchase.

Checked: type check clean; production build passes, also with the heap limited to 2 GB; 7 database checks (sample
data top-up, removal with a sample person owning a priority and a request, fresh load, no duplicates on a second
load, the new event); 33 browser checks, no browser errors. These cover the three items left unchecked in the first
round: the decision line fed by a real second-level internal purchase, the "what changed" note against yesterday's
picture, and the review-due block on the Home.

Still not checked in a browser: the decision line fed by a second-level customer purchase, an Eságara exception or
a supplier payment above the first level's amount (same code path as the internal purchase and the credit requests,
which were checked).

Limits closed by this round: no sample data; no quarterly screen; `policy.exception_escalated` for purchases only
(now also internal purchases). The other limits of section 6 stand.
