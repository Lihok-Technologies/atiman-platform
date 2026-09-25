# ATM-001 M3 — Governed Provenance Authoring Decision

**Decision record for ATM-001 M3 (Governed Provenance Authoring).**

Implementation:
- `src/services/knowledge-provenance.service.js` (validation)
- `src/models/knowledge-provenance.model.js` (persistence)
- `src/controllers/knowledge-provenance.controller.js`
- `src/routes/knowledge-provenance.routes.js` (mounted at `/api/knowledge-provenance`)

No schema change: migration `011_knowledge_provenance.sql` already provides the
model.

## Purpose

M1 enforces an evidence contract at publication: governed knowledge must cite at
least one immutable source version, and each citation must say where in the
source it came from. Before M3 that contract had **no product-level way to be
satisfied** — `knowledge_sources` could only be created by direct SQL, and
production held zero sources. M3 exposes the minimum authoring capability needed
to satisfy it.

## Boundary

M3 is provenance **authoring** only. It is not a document-management product and
not a curation script. It provides no document upload, no file storage, no OCR,
no AI extraction, no ingestion pipeline, no knowledge search, and no user
interface.

M3 does not redefine provenance. Migration 011 remains the provenance model.

## Authorization

Writes reuse the repository's existing capability model rather than introducing a
second authorization framework or a new capability:

| Operation | Capability | Effective roles |
|---|---|---|
| Create a knowledge source | `TASKS.CREATE` | admin |
| Create a source version | `TASKS.UPDATE` | admin |
| Attach / detach working evidence | `TASKS.UPDATE` | admin |
| Read sources, versions, working evidence | `KNOWLEDGE.VIEW` | admin, supervisor, operator |

Rationale: provenance authoring is an act of authoring working maintenance
knowledge, which is what the TASKS authoring capabilities already govern.
`TASKS.CREATE`/`TASKS.UPDATE` are **admin-only** in `src/config/permissions.js`,
so this path is deliberately **narrower** than the existing task-template routes,
which use `requireAdmin` (admin + supervisor). Nothing is granted to generic
authenticated users.

Rejected alternative: adding a new `KNOWLEDGE.PROVENANCE` action. It would be
semantically tidy but broader than necessary, and M3's mandate is the smallest
correct capability, not a new governance vocabulary.

Known inconsistency, recorded rather than silently resolved: task-template
authoring routes use `requireAdmin` (admin + supervisor) while this path uses the
stricter admin-only capability. Aligning them is a separate decision.

## Source and source-version distinction

- A **source** (`knowledge_sources`) is a stable *identity* — a manual, standard,
  regulation, or engineering-authored body of knowledge. It is tenant-scoped:
  M3 always derives `organization_id` from the authenticated principal and never
  accepts it from the payload, so a tenant cannot create a global source.
  Shared reference provenance remains a system/OWNER act.
- A **source version** (`knowledge_source_versions`) is an *immutable exact
  revision or citation* of that source. There is no document-revision behaviour:
  a corrected citation is a new version designation.

Evidence must reference a **source version**, never a bare source. A mutable
source identity is not, and can never be, citable provenance.

## Evidence attachment semantics

Working evidence (`knowledge_template_evidence`) is attached to a working
subject, and exactly one of `task_template_id` / `task_template_step_id` must be
set, mirroring `chk_knowledge_template_evidence_exactly_one_subject`.

Authoring validates immediately what M1 would otherwise reject at publication:
a citation must state its location (`section_or_clause`, `page_or_paragraph`, or
`derivation_notes`), matching M1's `EVIDENCE_ATTRIBUTION_INCOMPLETE` rule. This
gives the author an actionable error at authoring time instead of a failure
hours later at publish time. M1's validation is unchanged and remains the
authority.

Evidence is **not** part of the M1 approved-content fingerprint, so attaching
evidence after approval does not invalidate the approval. Evidence added at any
point before publication is consumed by the M1 gate.

## Frozen evidence boundary

| Structure | Mutability | Reachable from M3? |
|---|---|---|
| `knowledge_template_evidence` (working) | mutable while working | **Yes** — attach, list, detach |
| `knowledge_template_version_evidence` (frozen) | INSERT only while the parent version is unsealed; UPDATE and DELETE always refused | **No** — no route, no controller action, and no executable reference in the model |

Detach addresses evidence through its owning template. All three must agree —
the evidence id, the template named by the route, and the caller's organization
scope. The evidence may be attached directly to that template or to one of its
steps. Evidence that exists elsewhere in the same organization is **not**
addressable through a different template's path, and a mismatch is reported as
not-found without disclosing where the evidence actually belongs. This binding
is enforced in the model, so it holds independently of the controller.

Detach is permitted **only while the working evidence has not been frozen**. The
database enforces this more strictly than "frozen rows are immutable":
`knowledge_template_version_evidence.copied_from_template_evidence_id` is
`ON DELETE RESTRICT`, so once M1 has copied working evidence into a published
version, the working row itself cannot be removed either. A published package can
therefore never lose the working row its frozen provenance came from. M3
translates that database refusal into a clean `409 EVIDENCE_FROZEN` rather than
leaking a raw foreign-key error.

## Model mutation surface

`BaseModel` supplies generic `update()`/`delete()` helpers. Inheriting them would
advertise mutations the database forbids, so each provenance model overrides
them to refuse explicitly:

- source update/delete → refused (source identity locks once versions exist)
- source-version update/delete → refused (immutable)
- working-evidence update/delete → refused, directing callers to detach-and-reattach
  or to the tenant-scoped detach operation

## Explicit non-goals

Document upload and file storage; OCR; AI extraction or suggestion; source
ingestion pipelines; bulk corpus import; knowledge search; provenance UI;
Knowledge Pack services or publication; taxonomy versioning; legacy table
cleanup; publication, approval, review, or modification of any existing
candidate template; fabrication of evidence, citations, or safety controls.
