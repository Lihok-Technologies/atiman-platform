# ATM-002-R4 — Design System Architecture

**Document ID:** ATM-002-R4
**Status:** **APPROVED V1** — architecture record. **No CSS is written, migrated or deleted by this
document**, and no component library is created.
**Baseline:** `origin/main` = `0df3a390979e2763d750cb8e87519928aa131838`
**Depends on:** `ATM-002-R1` §2 (principles), `ATM-002-R2` (destinations, dispositions),
`ATM-002-R3` (composition rules).

---

## 1. Measured starting point this architecture must survive

| Asset | Lines | Tokens | Notes |
|---|---|---|---|
| `public/css/style.css` | 3,574 | 48 | legacy ODM desktop system, 11 media queries |
| `public/css/odm-mobile.css` | 1,194 | 28 | legacy-branded mobile system, **0** media queries |
| `public/css/odm-responsive.css` | 792 | 0 | ad-hoc responsive patching |
| `public/css/iso-ui.css` | 562 | 0 | legacy taxonomy styling |
| `views/mobile/**` inline `style=` attributes | — | — | **1,942 occurrences** |
| `views/index.ejs` | — | amber scale | a **third** independent palette; pulls Inter from a font CDN |

**Rule for this record:** the smallest reusable foundation that later bounded slices can build on — not
a component library, and not a big-bang restyle.

---

## 2. Token architecture (three tiers)

| Tier | Contains | Rule |
|---|---|---|
| **T1 — Scales** | space, type ramp, radius, elevation, motion, z-index, border width | brand-independent, numeric, never referenced directly by product code |
| **T2 — Semantic tokens** | role-based names (surface, text, border, action, status, severity, outcome, focus, connectivity, governance) | **the only tier product code may reference** |
| **T3 — Component tokens** | a component's stable contract (e.g. `card.padding`, `work-bar.height`) | only where a component needs one; kept deliberately few |

**Branding is OPEN, and the architecture does not depend on it.** `ATM-002` §17 Q5 (branding and visual
identity constraints) is unanswered, so T2 tokens are **named semantically with values supplied by a
theme**. Consequences:

- The legacy **amber** palette is **legacy ODM brand residue** and is **not** adopted as the Atiman
  brand. It is replaced when each surface is touched; the final values come from branding, not from this
  record.
- No typeface is fixed by this record. **Field use must not depend on a third-party font CDN** (the root
  page currently does), because the field constraint (R7) tolerates degraded connectivity: the system
  stack is the safe default until branding decides otherwise.

---

## 3. Foundations

| Foundation | Decision |
|---|---|
| **Typography** | A single ramp with a **field-legible body size floor** and generous line-height; no display-only scale on field surfaces; numeric/reading legibility (tabular figures for values and units) |
| **Spacing** | One 4-step-derived scale; no arbitrary values in product code |
| **Layout primitives** | Shell regions (header · content · work bar), `stack`, `cluster`, `grid`, and a scroll region; everything else composes from these |
| **Responsive principles** | Mobile-first. **Two** primary breakpoints: **compact** (field/one-handed) and **expanded** (desktop density work). No breakpoint exists only to change density; desktop is not a separate product (R2 §3.5) |
| **Density** | A density variant is permitted **only** in `expanded` and only for queue/assessment/administration work — never to shrink field targets |
| **Motion** | Minimal, purposeful, and suppressed when the user requests reduced motion |

---

## 4. State semantics

**Interaction states:** default · hover (expanded only) · focus-visible · active · selected · disabled ·
loading · empty · error · read-only.

**Domain state semantics** — the product's own state vocabulary, which is what makes the system Atiman's
rather than generic:

| Family | Values | Presentation rule |
|---|---|---|
| **Governance state** (knowledge) | draft · in review · approved · published · retired | Expressed in **user language**; never exposes fingerprints, hashes or internal identifiers (R1 §2 D) |
| **Finding outcome** | Operator Correction · Monitoring · Escalation | Each is distinguishable **without colour alone** (icon + label); Monitoring carries a temporal affordance; Escalation reads as leaving Atiman's boundary (R1 §2 F) |
| **Finding lifecycle** | reported · assessed · actioned · closed | Progress is explicit; no state exists that cannot be explained to an operator |
| **Severity / condition** | as defined by governed taxonomy | Never free-text-only; never colour-only |
| **Connectivity** | online · degraded · offline (read-only) | Always visible when not online; never a silent state (R7) |
| **Confidence / provenance cue** | source-derived statement of how well the knowledge is established | Plain-language cue with deeper disclosure available (R1 §2 G) |

**Colour is never the sole carrier of meaning** — required both for accessibility and because field
conditions (sunlight, gloves, colour vision) make it unsafe.

---

## 5. Accessibility states (WCAG 2.1 AA is the V1 target)

| Requirement | Decision |
|---|---|
| Focus visibility | A focus-visible token is mandatory on every interactive element; focus is never removed without replacement |
| Contrast | Text and essential UI meet WCAG 2.1 AA minimums via semantic tokens, not per-screen overrides |
| Touch target / target size | **44 × 44 px is the Atiman field-use floor.** *WCAG 2.1 AA itself does not mandate a target size; this floor is adopted because field work is one-handed and gloved* (R7 fixes the detail) |
| Zoom / reflow | Content must reflow and remain usable at 200% zoom; **`user-scalable=no` is prohibited** (R1 §2 H) |
| Non-colour encoding | Mandatory for every state family (§4) |
| Keyboard & focus order | Every work destination and queue must be operable without a pointer on `expanded` |
| Announcement | Errors, state changes and async results are announced; a visible error is also a programmatic one |
| Reduced motion | Honoured globally |

---

## 6. Component foundation (the smallest reusable set)

Twelve primitives, chosen because R2's destinations and R5/R6's subject matter require them — not
because a design system conventionally has them:

| Primitive | Serves |
|---|---|
| `shell regions` | R2 destinations and navigation principles |
| `stack` / `cluster` / `grid` / `scroll-region` | all surfaces |
| `card` (single primitive, slot-based) | Finding, knowledge item, task summary, queue item |
| `task-item` | Today, queues |
| `action` (primary · secondary · destructive · inline) | every surface; one primary action per screen (ATM-002 draft §16) |
| `field` (label, help, error, unit, governed-selection variants) | Report, Assess, administration |
| `selection` (governed choice, taxonomy-backed) | classification without free text |
| `evidence-capture` (photo, reading, note) | Report, Inspect |
| `disclosure` (progressive) | evidence/provenance/confidence — one pattern reused everywhere |
| `state-badge` | governance, outcome, severity, connectivity |
| `step-runner` | knowledge-driven execution |
| `empty / error / offline` states | every surface; consistent degradation |

**Explicitly not in V1:** a component framework, a third-party UI kit, a theme editor, a documentation
site, icon-font packaging, animation library, or a full-page template library.

---

## 7. Icons

A **single inline-SVG icon set** with semantic names, referenced by meaning not by picture, with no icon
font and no external CDN dependency (field connectivity). Icons **never** carry meaning alone — every
icon is accompanied by text or an accessible name.

---

## 8. Domain presentation patterns

| Pattern | Decision |
|---|---|
| **Evidence / provenance disclosure** | One `disclosure` pattern: a short plain-language cue, expandable to evidence, source authority and edition. Used identically for knowledge, findings and assessments. No governance table, hash or internal identifier is ever shown |
| **Finding outcome presentation** | The three outcomes are visually and textually distinct; choosing one is an accountable act with an explicit confirmation; Monitoring shows its temporal nature; Escalation shows that accountability leaves Atiman |
| **Knowledge presentation** | Knowledge card (what this is, when it applies, safety first) + step runner (one step at a time, evidence per step) + safety block that cannot be collapsed away (R6 details) |
| **Forms** | Governed selection over free text wherever the domain has a vocabulary; labels always visible; units explicit; errors adjacent and announced; no loss of entered data on navigation |
| **Cards** | One card primitive; the difference between a Finding card and a knowledge card is content and state, not a new component |

---

## 9. Migration strategy (strangler, surface-driven — not big-bang)

1. **Freeze the legacy layer.** No new rule may be added to `style.css`, `odm-mobile.css`,
   `odm-responsive.css` or `iso-ui.css`, and no new inline style may be introduced in a view.
2. **New surfaces use only T2 tokens and the §6 primitives.** A new surface never imports legacy CSS.
3. **Surface-driven replacement.** When R2's disposition is executed for a surface, that surface migrates
   to tokens/primitives and its legacy rules and inline styles are removed **in the same bounded change**.
4. **Legacy deletion is earned, not scheduled.** Each legacy CSS file is deleted when the surfaces it
   serves are retired, folded or migrated — no dead-code sweep, and no rewrite of surfaces still in
   transition.
5. **Branding lands once.** The amber/legacy brand residue (manifest, titles, theme colour, third
   palette) is removed with the shell work, when branding values are approved, not before.
6. **The PWA/field dependency is treated as design debt**: a font CDN on a field surface is a
   connectivity defect, not a typographic preference.

---

## 10. What this record does not do

- No CSS, no markup, no token file, no component implementation, no migration executed.
- It does not decide **branding values** (OPEN), the Finding experience detail (**R5**), knowledge
  disclosure specifics (**R6**), or field/connectivity behaviour (**R7**).
- It does not authorise a redesign of any live surface; surfaces change only when their R2 disposition is
  executed by a bounded mission.

---

## 11. LCQE evidence

- The measured starting point (§1) was read from the repository at this baseline, including the
  1,942 inline-style count and the four CSS files with their line counts and token counts.
- The touch-target decision is stated with the WCAG distinction made explicitly, so no record claims
  WCAG 2.1 AA mandates a 44 px target.
- The branding decision separates *token architecture* (approved) from *brand values* (open), which is
  what allows implementation to proceed without inventing brand.
- The component list is justified by R2 destinations and R5/R6 subject matter, and is explicitly capped.

---

**ATM-002-R4 — design system architecture approved. No CSS written or migrated.**
