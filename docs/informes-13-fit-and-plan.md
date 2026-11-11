# Módulo 13 · Informes & Insights (v1.2) — fit and plan

Source: `Downloads\13_Informes_Insights_CLAUDE_CODE_OFICIAL_v1.2.md` (shared 2026-11-11).
Frozen rule: reports create no information, they interpret operational facts. One truth, different views by responsibility.

## 1. What already exists (built in modules 9–12)

| Spec | In SOLU today | Gap |
|---|---|---|
| §4.1 Negotiator | Mis metas (pace, bottleneck), Mi mejora, Cierres, Foco, Dinero por mover, Comisiones | One "how am I doing" view with Result / Future / Money / Risks / Development together |
| §4.2 Pair, §4.3 Leader | Nothing (no teams or pairs existed) | Teams with a leader; team review without a single score |
| §4.5 Administración | Cuentas por cobrar, Banco, Cierre y comisiones, Eságara real, Cupos | AP calendar and cash positions as one view |
| §4.6 Gerencia, §5 Business Pulse | Gerencia → Insights (Mes, Forward, Causas, Recovery), Rentabilidad, Operations metrics | A monthly pulse by function with period, as-of and closed / provisional |
| §6 Future Pulse, v1.1 future buckets | Foco de alto valor, Futuro comercial, FutureOpportunity | The four futures side by side (market, commercial, contracted, financial), never merged |
| §9–10 Metric Dictionary | Definitions live in each module's rules file (`goal-rules`, `economics-rules`, `ops-metrics`) | One certified dictionary with definition, formula, source, owner, version; "¿Cómo se calcula?" on every figure |
| §13 Variance & Cause | Per-Journey bridge that adds up exactly; aggregated drivers on Rentabilidad | Cause decomposition for a goal gap (e.g. low-Eságara deals) |
| §14 Insight Engine | Bottleneck hints (goals), suggestions (improvement) | Insights as facts with evidence links, fact vs inference |
| §15–16 Report builder, briefs | Daily / weekly / monthly close (`closes.ts`) | Saved views, subscriptions, builder |
| §23 Intervention queue | Operations home attention list, high-value commitments | A small, material queue for Gerencia |
| §24 Integrity | Economics FINAL snapshot, settlement run snapshot, versioned policies | Monthly snapshot of the pulse; reopen with authority |
| v1.2 Role clarity (§31–35) | Nothing | Waits for Module 16 (RoleProfile does not exist) |

## 2. Decisions

| # | Decision |
|---|---|
| I-01 | **User 2026-11-11:** Informes & Insights is its **own menu entry** (the menu goes from 8 to 9), open to every role, each seeing their own scope. |
| I-02 | **User 2026-11-11:** build **simple teams now** (a team has a leader and members, set by Gerencia) and the leader's team review on top. Module 16 may redefine it. |
| I-03 | Commissions of other people are compensation-sensitive (§17): a leader sees the team's results, not its members' commission amounts. Only Gerencia, Dirección Comercial, Finanzas and Administración see them. |
| I-04 | No single score and no ranking: the team review lists people alphabetically with each dimension in words. |
| I-05 | A pair (dupla) view waits: today one negotiator does both functions (Module 12 R-08). The `CommissionAllocation` split is the only place two people share a sale. |

## 3. Waves

- **I0 Certified core, part 1.** Menu entry; metric dictionary with "how is it calculated"; Mi desempeño (Result, Future, Money to move, Risks; period, as-of, provisional / closed; vs goal and vs previous month); teams and the leader's team review.
- **I1 Business Pulse.** Monthly, by function (Mercado, Comercial, Operaciones, Administración), vs previous month, with a monthly snapshot at close.
- **I2 Future Pulse and intervention queue.** The four futures by horizon; Gerencia's small queue of material matters.
- **I3 Director and Administración views.** Functional performance plus team; cash, AR / AP calendar.
- **I4 Cause and insights.** Goal-gap decomposition; insights as facts with evidence.
- **I5 Saved views, briefs, builder.**
- **Later, with Module 16:** role clarity, alignment drill-down, development block.

## 4. I0 — DONE 2026-11-11

Menu entry INFORMES (ninth module; "GERENCIA/INSIGHTS" is now "GERENCIA"); `src/lib/metric-dictionary.ts` (13 certified
metrics, `periodStatus`), `HowCalc` component, `/informes/metricas`; `src/lib/reports.ts` (`reportScope`, `personReport`
built on `goalBoard`, `goalActuals`, `computeCommissions`, `focusItems` and invoices, so figures equal the operational
screens); `/informes` (Mi desempeño: result and future vs goal and vs previous month, money to move, risks and decisions
coming, own commission); `Team`, `TeamMember`; `/informes/equipo` (leader's review, alphabetical, no score; Gerencia sets up teams).
**Limits:** the dictionary is code (a definition change is a code change with a new version, not editable on screen);
Mi desempeño has no development block (Module 16) and no quality dimension yet; comparison is vs goal and vs previous month
only (no prior year, rolling average or trend line); a leader sees the current month only; a team gives report visibility,
not the right to see commissions; no pair (dupla) view; the Insights tab still lives under Gerencia.
## 5. I1 and I2 — DONE 2026-11-11

**Business Pulse (§5, §24).** `src/lib/pulse.ts` (`computePulse`: period figures from event dates for the month and the
previous one, plus `stateNow`; `pulseGroups`: Mercado, Comercial, Operaciones, Administración); `PulseSnapshot`;
`/informes/pulso` (+ actions `closePulse`, `reopenPulse`). PERIOD figures compare with the previous month; STATE figures are
labelled "foto de hoy" and have no comparison. Only an ended month can be closed (Gerencia); a closed month shows the saved
figures; reopening needs a reason and keeps the earlier close. Checked: the company's Eságara equals the sum of each
person's for the same month (AC55).
**Future Pulse and intervention queue (§6, §23, v1.1 §25).** `src/lib/future-pulse.ts` (`horizonOf`, `futurePulse`: market,
commercial, contracted and financial futures by horizon, never added together, no probabilities; `interventionQueue`: at
most nine items from promises at risk, high-value commitments with risk, biggest Eságara drops, overdue customers, a pending
policy change, open customer claims — each with impact, owner and where to decide); `/informes/futuro`.
Both visible to Gerencia, Dirección Comercial, Finanzas and Administración.
**Limits:** SOLU keeps no history of balances, so a state figure of a past month is only fixed if that month was closed;
the Team block of the pulse waits for Module 16; the queue has no capacity, succession, contractual-deadline or supplier-exposure
items yet; financial future has no bank balance; impact amounts in the queue are not localised; no trend lines.
**Remaining:** I3 (Director and Administración views), I4 (goal-gap causes, insights), I5 (saved views, briefs, builder).