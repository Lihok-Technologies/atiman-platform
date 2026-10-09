# ATM-001-K3-G2 — Knowledge Provenance Authorization Mapping

**Document ID:** ATM-001-K3-G2
**Title:** Knowledge Provenance Authorization Mapping — OWNER-Approved Reconciliation
**Status:** **OWNER-APPROVED** — Option B of the ATM-001-K3-G1 reconciliation. Recorded by
mission ATM-001-K3-G2 and implemented on PR **#78**.
**Baseline:** `origin/main` = `54ee2094c7b7ddbfeb2e7d7f2bb5855014382bc2`
**Target:** PR #78, branch `atm-001-k3-knowledge-accession-authority`

**This record does not rewrite history.** `ATM-003-R1`, `ATM-003-R3`, `ATM-001-M3`, the K3
implementation commits and the K3-R1 remediation commit all stand as written. This record
*adds* the OWNER reconciliation and *clarifies* one reading of `ATM-003-R3 §2` that was
ambiguous. Where this record and an earlier record differ, the difference is stated
explicitly in §5 rather than silently edited into the earlier text.

---

## 1. Why this record exists

The independent ATM-001-K3-R1 VUDA raised finding **F1**: the two provenance **evidence**
routes were guarded by `knowledge.author`, while the approved capability architecture names
`evidence.attach` for that accountable act and deliberately withholds `evidence.attach` from
the supervisor and operator compatibility bundles.

The ATM-001-K3-G1 reconciliation mission examined the ratified records and classified the
question **OWNER_DECISION_REQUIRED**, because:

- `ATM-003-R1 §3.1` defines the act narrowly (attach provenance evidence; `added_by_user_id`),
  while `ATM-003-R3 §2` cites the whole knowledge-provenance route surface
  (`TASKS.CREATE` / `TASKS.UPDATE`) as the evidence for `evidence.attach`'s pre-change
  authority — a surface-wide reading that would place *all four* routes under `evidence.attach`;
- resolving the question changes authorization behaviour for a legacy role, and
  `ATM-003-R3 §4` itself frames that class of compatibility choice as *"an OWNER decision,
  not a silent expansion"*.

The OWNER approved **Option B** of the G1 report. This record documents that approval.

---

## 2. Previously approved capability architecture (unchanged — quoted, not restated)

| Source | Text |
|---|---|
| `ATM-003-R1 §3.1` | `knowledge.author` — *"Create and edit a draft definition"* — `created_by`; authoring primitive requires a real, active actor; draft-only |
| `ATM-003-R1 §3.1` | `evidence.attach` — *"Attach provenance evidence to a definition or step"* — `added_by_user_id` on evidence rows |
| `ATM-003-R1 §2` | Capabilities derive from **schema-enforced accountable acts** — attribution columns, admission rules, triggers, SoD — not from job titles or screens |
| `ATM-003-R3 §2` | `evidence.attach` — **admin only** — *"knowledge-provenance routes are guarded by `TASKS.CREATE` / `TASKS.UPDATE`: admin all, supervisor **none**, operator **none**"* |
| `ATM-003-R3 §3` | operator 2, **supervisor 14** (no `evidence.attach`), **admin 16** (includes `evidence.attach`) |
| `ATM-003-R3 §4` | **"`evidence.attach` removed from the operator and supervisor bundles"** — effect: *"Operator and supervisor cannot attach provenance evidence through the legacy bundle"*; recovery: *"**Explicit grant of `evidence.attach`**"* |
| `ATM-003-R3` (governing) | OWNER adjudication of 2026-09-27 **§7** — *"do not silently grant an existing role an action it could not previously perform"* — and **§12** — *"choose the LESS-PRIVILEGED mapping and record the compatibility difference"* |
| `ATM-002-R3 §2.3` | Knowledge Steward actions: *"Author/submit drafts; … attach evidence — each as a **separate accountable act**"* |
| `tests/capability-grants.test.js` | The approved milestone-4 parity oracle transcribes `'evidence.attach': { admin: true, supervisor: false, operator: false } // TASKS.CREATE/UPDATE: admin only` |

## 3. Existing K3 implementation (historical record)

- Commit `3aa5bbd` (ATM-001-K3) placed **all four** provenance mutation routes under
  `requireCapability('knowledge.author')`. Its message records both consequences in its own
  words: *"the supervisor gains these four routes"* and *"`evidence.attach` guards no route
  and is unchanged."*
- Commit `3aa5bbd` also inverted two `tests/knowledge-provenance-authoring.test.js`
  assertions that had recorded the pre-K3 admin-only reach, and its suite asserted
  `4 × requireCapability('knowledge.author')`.
- Commit `43fc2d64` (ATM-001-K3-R1) repaired MAJOR-1 — the global/shared provenance
  **write-scope** defect — by splitting the read predicate from the write predicate. It did
  **not** touch capability mapping.
- ATM-003-R3 §4's recorded exclusion of `evidence.attach` from the supervisor bundle therefore
  became inoperative at the route layer while remaining true at the bundle layer, and the
  documented recovery path (an explicit `evidence.attach` grant) conferred nothing.

## 4. OWNER-approved reconciliation (Option B)

| Route | Capability | Accountable act | Enforcement evidence |
|---|---|---|---|
| `POST /sources` | `knowledge.author` | Author a tenant-scoped provenance **source identity** | `knowledge_sources.created_by_user_id` |
| `POST /sources/:id/versions` | `knowledge.author` | Author an **immutable edition** of that source | `knowledge_source_versions.created_by_user_id` |
| `POST /templates/:templateId/evidence` | `evidence.attach` | Attach provenance **evidence** (a citation of an immutable source version) to a working definition or step | `knowledge_template_evidence.added_by_user_id` |
| `DELETE /templates/:templateId/evidence/:evidenceId` | `evidence.attach` | Detach that working evidence (M3 models correction as detach-then-attach; the pre-change guard for both was `TASKS.UPDATE`) | `knowledge_template_evidence` row removed; `added_by_user_id` governs the act |
| 3 × `GET` | `KNOWLEDGE.VIEW` (unchanged) | Read sources, versions, working evidence | — |

**No new capability. No bundle change. No migration. No schema change.**

## 5. Determinations (the reasoning the OWNER approved)

**5.1 Why authoring and evidence attachment are separate accountable actions.**
`ATM-003-R1 §2` derives capabilities from schema-enforced accountable acts. Creating a source
or an edition is attributed by `created_by_user_id` and is authoring. Attaching a citation to a
working definition is attributed by a *different* column, `added_by_user_id` on a different
table, and is a separate act with its own admission rules. `ATM-003-R1 §3.1` lists them as two
rows; `ATM-003-R2`-aligned experience architecture (§2.3) calls evidence attachment *"a separate
accountable act"*. Collapsing them would make one attribution column stand for two acts.

**5.2 Why `evidence.attach` covers attachment *and* detachment.**
The capability's name is `evidence.attach`, but its accountable act is the citation of
provenance on a working definition. Detachment is the inverse of that act, not a different one:
it removes the citation, and `ATM-001-M3` models correction as *detach-then-attach*, so the two
operations form one authoring boundary. Both routes were guarded by the same pre-change
permission (`TASKS.UPDATE`), and `ATM-003-R3 §2` cites that guard for `evidence.attach` as a
route surface, not for attachment alone. This record therefore states explicitly what the earlier
records left implicit: **`evidence.attach` governs the working-evidence citation lifecycle,
including detachment.**

**5.3 Why source/version creation uses `knowledge.author`.**
By the `ATM-003-R1 §2` derivation rule, the capability is determined by the accountable act and
its attribution column. Source and edition creation are attributed by `created_by_user_id` —
`knowledge.author`'s enforcement evidence — and are acts of authoring provenance knowledge, which
is exactly `ATM-001-M3`'s rationale: *"provenance authoring is an act of authoring working
maintenance knowledge."* `knowledge.author` is already the guard on the task-template authoring
routes, so this is the alignment M3 recorded as *"a separate decision"*, not a new vocabulary.

**5.4 Why the existing capability bundles remain unchanged.**
`ATM-003-R3 §3`/§4 are the OWNER-ratified compatibility mapping and they are *correct* under
this reconciliation: `evidence.attach` was admin-only before the capability model, so it must not
enter the supervisor or operator bundles. Adding it would be an authority expansion of exactly
the kind OWNER adjudication §7 forbids. The bundles therefore stay byte-identical, and the
route layer now agrees with them instead of contradicting them.

**5.5 Why explicit `evidence.attach` grants are required.**
`ATM-003-R3 §4` records the recovery for the less-privileged mapping: *"Explicit grant of
`evidence.attach`."* `evidence.attach` is in the V1 human-grantable set (migration `022`;
`V1_HUMAN_GRANTABLE`), and a principal holding an active explicit grant resolves in
`EXPLICIT_GRANTS` mode with the legacy bundle discarded. A Knowledge Steward who must both author
provenance and cite it therefore receives **both** capabilities by explicit grant. This is the
capability model working as designed: one grant per accountable act.

**5.6 Why this does not authorize global provenance writes.**
The capability mapping answers *who may attempt the act*; it never answers *whether the act is
valid*. `knowledge.author` on the authoring routes does not make a global source writable: the
model's strict tenant write predicate (`findTenantWritableSourceById`, ATM-001-K3-R1) refuses a
new version under an `organization_id IS NULL` source with `409 SOURCE_NOT_TENANT_WRITABLE`, and
`createSource` derives the organization from the authenticated principal and refuses a global
source outright. Global/shared reference provenance remains a system/OWNER act
(`ATM-001-M3`; `ATM-001-M5R3A §3.2`–§3.4), and its executable mechanism (item **D**) remains
unimplemented. No route guard in this record creates, widens or bypasses that boundary.

## 6. Resulting authorization behaviour

| Principal | `POST /sources`, `…/versions` | `POST`/`DELETE …/evidence` |
|---|---|---|
| legacy **admin** (bundle: both capabilities) | allowed | allowed |
| legacy **supervisor** (bundle: `knowledge.author` only) | allowed | **denied** — needs an explicit `evidence.attach` grant |
| legacy **operator** (bundle: neither) | denied | denied |
| explicit `knowledge.author` only | allowed | **denied** |
| explicit `evidence.attach` only | denied | allowed |
| explicit `knowledge.author` **+** `evidence.attach` | allowed | allowed |
| any principal, other tenant's subject or version | — | denied (404, non-disclosing) |
| any principal, **global** source version write | denied (`409 SOURCE_NOT_TENANT_WRITABLE`) | — (citation of a global edition remains allowed) |

Tenant isolation, global immutability, working/frozen evidence immutability, and the
approver≠publisher separation of duties are unchanged by this record. `knowledge.author` and
`evidence.attach` confer neither `knowledge.review`, `knowledge.approve`,
`knowledge.safety_review` nor `knowledge.publish`.

## 7. Non-goals

No new capability; no change to `ATM-003-R1`, `ATM-003-R3` or `ATM-001-M3` text; no change to the
capability bundles, the grantable set, migration `022`, the database schema, the provenance
model, the controller or the services; no change to global-source protection, review, approval,
safety-review or publication authority; no OWNER global-registration mechanism.

## 8. References

- `docs/architecture/ATM-000-Atiman-Product-Vision.md` (§7 principles 4 and 7)
- `docs/architecture/ATM-003-R1-Role-Capability-Architecture.md` (§2, §3.1, §4, §5, §6)
- `docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md` (§2, §3, §4)
- `docs/architecture/ATM-002-R3-Role-Aware-Experience-Matrix.md` (§2.1, §2.3)
- `docs/architecture/ATM-001-M3-Governed-Provenance-Authoring-Decision.md`
- `docs/architecture/ATM-001-M5R3A-Authority-Edition-Groundwork.md` (§3.2–§3.4)
- `src/config/capabilities.js`, `database/postgresql/022_capability_grant_foundation.sql`
- `tests/capability-grants.test.js`, `tests/knowledge-accession-authority.test.js`,
  `tests/provenance-write-scope.test.js`, `tests/knowledge-provenance-authoring.test.js`
