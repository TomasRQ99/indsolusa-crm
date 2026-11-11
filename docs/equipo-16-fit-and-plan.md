# Módulo 16 · Equipo & Desarrollo (v1.1) — fit and plan

Source: `Downloads\16_Equipo_Desarrollo_CLAUDE_CODE_OFICIAL_v1.1.md` (cut 2026-11-09, built 2026-11-11).
Mandate: know, develop and place people better. It does not classify to limit; it knows in order to accompany.
One `Person` (the SOLU `User`), different views and permissions. Labour data stays in Administración.

## 1. What already existed (built in modules 10, 13, 14 and 15)

| Spec | In SOLU before this module | Gap closed here |
|---|---|---|
| §1 Frontier with Administración | Contract, pay, absences, assets, lent authority (Módulo 14) | Nothing of that is copied; Equipo keeps character, talents, development, feedback, career, succession |
| §8 Coverage | `CoverageAssignment`, handover snapshot, emergency scan, return brief, `RelationshipBackup` (Comercial C8b); `DelegatedAuthority` that expires (Módulo 14) | Handover by class, what a cover is for, hand-back on return, backups per role with suitability, unplanned absence raised to the leader |
| §18–19 Identity, function charters | `CompanyIdentity`, `FunctionCharter`, versioned, frozen function purposes (Módulo 15) | Read by Mi Rol and stamped on every role agreement and assignment |
| §22 Assignment | `PersonRoleAssignment` (title, unit, leader, dates) | Linked to the role agreement, charter and identity versions; level; temporary role; expectations reviewed |
| §25 role clarity | `roleClarity` rule, a panel that said "no role is clear" | Role agreements exist; the panel and a full clarity screen read them |
| AC v1.1 #7 | `SupportGap` (what the company owes a person) | Carries the role expectation it blocks; a leader can raise it; kind "authority" added |
| §13 leaders | Teams with a leader (Módulo 13) | A leader is the formal leader of the assignment, or the leader of a team |

## 2. Decisions

Defaults I took to keep building. None was put to the user before building; all are open to change.

| # | Decision |
|---|---|
| E-01 | **Who sees what (§12).** Three levels chosen line by line by the person: *Privado* (only the person), *Compartido* (their leader and their mentor), *Organización* (leader, mentor and Gerencia; counts in the talent map). Gerencia by role sees only the third. The role Administración sees nothing of Equipo by role. Anything with an unknown level is treated as private. |
| E-02 | **Who is "leader".** The formal leader of the person's assignment, the leader of a team the person belongs to, or the leader named in the person's active development cycle. The mentor is whoever the active cycle names. |
| E-03 | **What someone else writes about a person is always visible to that person.** A leader's note, character evidence, a gap review, a readiness assessment and feedback cannot be hidden from whom they are about. |
| E-04 | **Feedback carries the name of whoever gives it.** It is read by the person it is about and by their leader. Not by the mentor, not by Gerencia by role. |
| E-05 | **Assessments** (CliftonStrengths, DISC, Enneagram, other; zodiac marked as playful) belong to the person: only they add or remove one; it can be private or shared with leader and mentor, never organisational. Nothing in SOLU reads them for anything else. |
| E-06 | **Publishing a role agreement** follows the Gerencia policy (who publishes identity and charters). It requires the five parts that make a role clear (purpose, outcomes, responsibilities, decision rights, boundaries), a date and a reason. The other fields of the eighteen may be completed in a later version and are flagged meanwhile. |
| E-07 | **Assigning a role agreement** to a person: Gerencia only. The contract title, unit and formal leader can still be recorded in Administración → Personas, which now keeps the role agreement when it changes them. |
| E-08 | **Decision rights and the engines (AC v1.1 #4).** A role agreement names the authority the role needs from a fixed list of what SOLU's own rules can grant. SOLU compares it with what the policies in force give the access role and says where they differ. The engines keep deciding from their own policies; a role agreement never grants authority by itself. |
| E-09 | **Gap analysis and readiness** are written by the leader or Gerencia, never by the person about themselves; the person always sees them. No score. |
| E-10 | **Succession** is arranged by Gerencia, Dirección, or the leader of whoever holds the role. A backup is "qualified" when four facts hold today (capability, authority, access, availability), each shown with its reason. |
| E-11 | **Development policy** starts with the document's values (90 days; checkpoints 0/30/60/90; 2–3 SER, 2–3 HACER, 1–2 TENER; seven character dimensions) and is changed by Gerencia at Equipo → Desarrollo organizacional. |
| E-12 | **Development Intelligence (§14).** Patterns from "Mi mejora" are shown only to the person; nothing is recorded unless they take one as an opportunity. A work record becomes evidence only when the person attaches it. No AI is used. |
| E-13 | **Change history.** For personal records the history keeps who changed what kind of thing and when, never the text. |
| E-14 | **Menu.** Equipo opens on "Mi rol". Four groups: Mi desarrollo, Mi equipo, Organización, Configuración. |

## 3. Built — 2026-11-11 (one wave)

Schema: migration `20270107120000_m16_equipo` (additive only). New: `RoleProfile`, `ProfileEntry`,
`PersonAssessment`, `CharacterEvidence`, `DevelopmentPlan`, `DevelopmentObjective`, `DevelopmentEvidence`,
`DevelopmentCommitment`, `DevelopmentMeeting`, `Feedback`, `DevelopmentOpportunity`, `ReadinessAssessment`,
`RoleBackup`, `RoleGapReview`. New columns: `PersonRoleAssignment` (role agreement, charter and identity versions,
level, acting, expectations reviewed), `CoverageAssignment` (what it covers, return), `SupportGap` (expectation).

Pure rules: `src/lib/team-rules.ts` (policy, privacy, 360, character evidence, cycle and objectives, feedback, role
agreement and its eighteen fields, authority against the engines, structure issues, gap analysis, readiness,
suitability, handover classes, talent map).
Reads: `team-store.ts` (policy, who leads whom, relation and privacy filter, role agreements in force, authority
granted by the engines, backups with suitability), `team-views.ts` (one function per screen), `team-attention.ts`.

Screens (menu Equipo):

- **Mi rol** `/equipo/mi-rol` (§17, §23): the six blocks in order and "Mi línea de contribución".
- **Mi desarrollo** `/equipo/desarrollo` (§4–6, §13–14): cycle, objectives, evidence, commitments, opportunities.
- **Mi 360** `/equipo/perfil` (§2–3, §12): SER, talents, HACER, TENER, story, reflections, assessments, character.
- **Conversaciones** `/equipo/reuniones`, `/equipo/reuniones/[id]` (§6): agenda built from the records.
- **Feedback 360** `/equipo/feedback` (§10).
- **Desarrollo de mi equipo** `/equipo/mi-equipo` (§13).
- **Claridad de roles** `/equipo/claridad` (§25): the eight columns, structure holes, assignment.
- **Continuidad y sucesión** `/equipo/continuidad` (§7–8).
- **Mapa de talentos** `/equipo/talentos` (§9).
- **Acuerdos de rol** `/equipo/roles`, `/equipo/roles/[key]` (§20–21): versions, history, publishing.
- **Desarrollo organizacional** `/equipo/organizacion` (§13) with the development policy.

Wired into existing work: Comercial → Cobertura (handover by class, what the cover is for, hand-back on return);
the bell and a counter on Equipo; Gerencia → Funciones y roles and Personas y capacidad; Informes → Mi desempeño;
Administración → Personas; the policy register; the events catalogue; sample data.

Also fixed: a dropdown inside a labelled field of a form row was drawn too tall on every module's forms.

## 4. Verification status

- Type check: clean. Production build: passes with 2.4 GB of heap and no longer with 2 GB (Render builds with 4 GB).
- Pure rules: 241 checks passed.
- Database (local): 105 checks passed (privacy for the person, leader, mentor, Gerencia, Administración and a peer;
  role agreement versions; identity change; temporary role; development cycle and flags; agenda; talent map;
  organisational view; bell; continuity and suitability; coverage expiry, hand-back; account deactivation; the change
  history holding no personal text; events; sample data top-up, removal and fresh load).
- Browser (headless Edge on the production build): 177 checks passed, no browser errors, as Gerencia, Administración,
  a leader, the person, a mentor, a peer and a board member; every form with its refusals; English on five screens;
  phone width on twelve.
- Not checked: the production deploy; a leader who is leader only through a team (checked in the database, not in the
  browser); the "patterns in your work" block with real work history (the sample person has too little); a coverage
  whose hand-back actually moves to-dos, in the browser (checked in the database).

## 5. Acceptance criteria

| AC | Where | Status |
|---|---|---|
| §16.1 Deactivating the account keeps the person and their history | Users are deactivated, never deleted; every Equipo record stays | Built |
| §16.2 Character evidence never from DISC / Enneagram / zodiac | `characterIssues`: no such source exists; text leaning on a test is refused; no path from an assessment | Built |
| §16.3 Private reflection inaccessible outside the person's scope | Privacy filter inside the query (`privacyWhere`) | Built |
| §16.4 Coverage permissions expire by themselves | `coveringNow` on every request (existing), re-checked | Built |
| §16.5 Return brief lists changes and hands action ownership back | Return brief + `handBack` / "recibir mi trabajo de vuelta" | Built |
| §16.6 A role reports no qualified backup as a continuity risk | `continuityView`, Claridad de roles, Desarrollo organizacional | Built |
| §16.7 Objectives close only with evidence or an explicit reason | `closeIssues` | Built |
| §16.8 Leader dashboard never shows private reflections | `teamDevView` reads no 360 data | Built |
| §26.1 Every active person has an agreement or is a Role Clarity Gap | Claridad de roles, Mi rol, Gerencia → Funciones y roles | Built |
| §26.2 Role profile shows version and date | Mi rol, role page | Built |
| §26.3 Changing the identity does not rewrite earlier profiles | Each version and assignment keeps the identity version it was made under | Built |
| §26.4 Decision rights and boundaries readable and used by the engines | Readable; compared with the engines; used by the suitability check; and, when Gerencia requires it, every approval also needs the role agreement to name that authority (section 7) | Built; the rule starts in "inform only" |
| §26.5 Principles as observable examples, no automatic rating | `behaviors` as conduct; ratings and test references refused | Built |
| §26.6 What the company expects and what the person can expect | Mi rol blocks 3–6, company commitments, support gaps | Built |
| §26.7 Leader can acknowledge an unsupported expectation | Support gap with its expectation, from Mi rol | Built |
| §26.8 Gap analysis needs evidence or says "not enough evidence" | `gapResult` | Built |
| §26.9 Mi rol connects goals and the plan without duplicating | Read from Comercial → Mis metas and from the cycle | Built |
| §26.10 Frozen function texts used exactly | Copied from `FUNCTIONS` | Built |

## 6. Limits

- **Role agreements are empty until Gerencia writes them.** Only a sample one exists (sample data). Until then every
  person shows as a role clarity gap, said openly.
- **Authority (AC §26.4):** closed in section 7. What remains: the agreement narrows, it never grants; boundaries are free text and are not enforced.
- **Coverage by function, customer or process (§8):** a coverage still gives the cover permission over all of the
  owner's Journeys; what it is for is written and shown, not enforced.
- **Handover classes** are assigned by rule from dates and kinds; a person cannot move an item to another class.
- **Person and user account** are one record in SOLU. "Deactivate" switches the account off and keeps the person;
  there is no person without an account.
- **Company identity:** version 1 names no methodologies; the Module 16 document names ECSA and VIDA. Not added
  (identity is published by Gerencia): Gerencia → Identidad → publish a new version.
- **Career route** is the levels of one role; there is no path from one role to another.
- **Talent map** groups what people wrote in the same words; similar wording is not merged.
- **Conversations** are not placed in the Outlook calendar or in Mi Plan.
- **Development Intelligence** uses the commercial improvement path only; nothing for operations or administration.
- **Feedback** has no anonymous option and no rounds or deadlines.
- **Succession** has no "what if this person leaves" simulation; readiness has no history view beyond the list.
- **A form that is refused comes back empty** (same as other modules); the role agreement form is long.
- **Informes:** "pair view" and development figures in reports are not built.

## 7. Second round — 2026-11-11

The user confirmed decisions E-01 to E-14 as built, and asked to close one gap; the open acceptance criterion
(§26.4) was chosen. The production deploy of commit 68c91e9 was verified from outside: the site answers and serves
the Module 16 styles.

Decision E-15 (mine): **the role agreement can narrow an approval, never grant one.** A switch in the development
policy (Equipo → Desarrollo organizacional), changed by Gerencia with a reason:

- *Solo informar* (starting value): an approval follows the policy alone; Mi rol and Claridad de roles show where
  the agreement differs. Nothing changes for anyone.
- *Exigir las dos*: to approve a purchase, a supplier payment, a payable, an internal purchase, a credit request or
  limit, or a low-Eságara exception, the policy must authorise the access role AND the person's role agreement in
  force must name that authority.

Never narrowed: Gerencia (someone must always be able to decide), a person with no role agreement yet, and an
authority someone lent (it is the lender's). Before switching, the screen lists who would lose which approval.

Built: `src/lib/role-authority.ts`; `agreementVerdict` and `APPROVAL_DOMAINS` in `team-rules.ts`; `actWith`
(`admin-store.ts`) asks it, so every approval that already went through it is covered, and the screens that ask
`actWith` whether to show the approve buttons hide them for a narrowed person; the credit actions and the Eságara
decision call it directly and explain on Mi rol.

Checked: type check clean; build passes; 25 rule and database checks (both modes, each kind of approval, Gerencia,
no agreement, lent authority, a new agreement version opening the authority without reassigning, the policy left as
it was); the changed screens open on the local production build. Not checked in a browser: switching the rule on
and attempting an approval by clicking.

Limits: with the rule on, a narrowed approver still sees the matter in the bell and in Gerencia's line of
decisions, and still sees the buttons on the Eságara and credit screens (the save is refused with the explanation).
Changing the Eságara policy numbers and the cash policy are not approvals and are not narrowed.
