# ATM-002-R7 — Field, Accessibility and Connectivity Contract

**Document ID:** ATM-002-R7
**Status:** **APPROVED V1** — experience architecture only. No UI, CSS or service-worker change is made
by this document.
**Baseline:** `origin/main` = `d8bd2b1bee38af00df55c8b59ca4f295cfed27aa`
**Depends on:** `ATM-002-R1` §2 C/H, `ATM-002-R2` (navigation), `ATM-002-R4` (tokens, states, targets),
`ATM-003-R2` (PWA and offline-experience ownership).

---

## 1. Field context the contract is written for

The field constraint is not "small screen". It is:

**one-handed use · gloved touch · direct sunlight · outdoors in weather · moving between assets ·
intermittent connectivity · PPE that limits hearing and peripheral vision · a device that may be shared,
dropped, wet or out of battery.**

Everything below follows from that list. Measured starting points at this baseline: `user-scalable=no`
present in 4 views (**prohibited**, §4); `odm-mobile.css` contains **0** media queries; **1** `aria-*`
attribute exists across all views; no field photo capture exists in inspection views.

---

## 2. One-handed use

1. **Primary actions sit within thumb reach** — anchored at the bottom of the working area, not in a top
   bar.
2. **No interaction requires two hands, precision, or a second gesture**: no drag-only actions, no
   long-press-only actions, no hover dependence, no pinch requirement.
3. **Destructive or irreversible actions are never adjacent to a frequent primary action**, and never
   placed where a thumb rests during scrolling.
4. **Scrolling is the only gesture that is ever required.** Where swipe gestures exist they are
   accelerators with a visible alternative.

---

## 3. Field readability

1. A **field-legible body size floor** with generous line-height (R4 §3); critical values and step
   instructions are not set in secondary-size text.
2. **Sunlight contrast:** critical field text and controls target a contrast ratio **above** the WCAG
   2.1 AA minimum (7:1 where the palette allows). This is an **Atiman field standard, stated as such** —
   WCAG 2.1 AA requires 4.5:1 for body text; sunlight is the reason for the stricter internal target.
3. **Readings and units use tabular figures** so values do not shift as digits change.
4. **No information is carried by low-contrast placeholder text, by colour alone, or by an icon alone**
   (R4 §4/§5).
5. Field surfaces avoid dense paragraphs; step content is short, imperative and scannable.

---

## 4. Zoom, text scaling and reflow

1. **Pinch-zoom must not be disabled.** `maximum-scale` / `user-scalable=no` are **prohibited** in all
   views (R1 §2 H). Current usage in 4 views is architectural debt to be removed with those surfaces.
2. Content must remain usable and non-clipped at **200% zoom** and with system text scaling increased.
3. Layouts use relative units; no fixed-height container may clip scaled text.
4. Reflow must not require horizontal scrolling for reading content at 320 CSS px width.

---

## 5. Touch targets

1. **44 × 44 CSS px is the minimum for any interactive target** on field surfaces, with adequate spacing
   so that adjacent targets are not mis-hit.
2. **This is an Atiman field-use standard.** *WCAG 2.1 AA does not itself mandate a target size* — the
   floor is adopted because one-handed, gloved use fails with smaller targets. (Recorded explicitly so
   that no later record attributes a target-size requirement to WCAG 2.1 AA.)
3. Primary actions may exceed the floor; nothing may fall below it, including secondary and inline
   actions and close/dismiss affordances.

---

## 6. Keyboard and focus

Required for `expanded` (desktop) surfaces and any keyboard-attached use; honoured on compact where a
keyboard exists.

1. **Every work destination and queue is operable without a pointer**, with a focus order that follows
   the task order, not the DOM's convenience.
2. **Focus is always visible** (R4 §5) and focus is never lost when content changes.
3. **Step transitions move focus deliberately and announce the change** — a step runner that leaves focus
   on a previous step's control is a defect.
4. A **skip-to-content** affordance exists wherever the shell precedes content.

---

## 7. Screen-reader semantics

1. Every input has an associated label; group labels describe the *decision*, not the data.
2. Every icon has an accessible name; **status badges expose text**, not only colour or glyph.
3. **Announcements are required for**: step change and completion, validation errors, asynchronous
   results, connectivity transitions, and any state that changes without user action.
4. **Progress is announced as position and count** ("step 3 of 7"), never as a bare percentage.
5. **Photographic evidence:** a photo is user-generated content and cannot be described automatically.
   The experience therefore offers an optional short description, and where none is given it states
   plainly that the evidence has no description — the record is honest about what it contains, and the
   absence is visible to the assessor rather than silently inferred.

---

## 8. Error and recovery states

1. **No input is ever lost.** Validation failure, navigation, interruption and session expiry must all
   preserve what the user entered (ATM-003-R2 §3.5).
2. **Errors distinguish their cause in user language:** *your device has no connection* is not the same
   message as *the server rejected this* — and neither is a generic failure.
3. **Every error offers a recovery path** to a safe, defined state (retry, return to the step, keep
   working offline-as-read-only, or escalate to an administrator) — never a dead end (R2 §3.3).
4. Validation messages are adjacent to the field **and** announced (§7).
5. **Failure of a capture is never silent**: if a photo or reading cannot be retained, the user is told
   before they move on.

---

## 9. Camera and photographic evidence

1. Camera capture uses the device camera directly (`getUserMedia` with the environment-facing camera is
   the existing mechanism and is retained); **no external library and no network round-trip is required
   to capture**.
2. The flow is **capture → preview → retain/retake**. A photo is never attached without the user seeing
   it.
3. **Capture context is shown** (asset, step, time) so the evidence is self-describing when reviewed
   later.
4. **Permission denial is a supported path, not a failure**: the experience explains what the camera is
   for and offers recording the observation without a photo, or attaching an existing image where the
   platform permits.
5. Photographs are not cropped, compressed against the user's intent, or silently re-encoded in ways
   that would compromise evidentiary value; any transformation is visible.
6. The photo remains **evidence, not authority**: it supports an observation (R5 §2) and does not by
   itself create a Finding.

---

## 10. QR and asset-context experience

1. **Scanning is a field affordance in the shell** (the existing header scan action), available from
   Today and from work — not a destination (R2 §3.4).
2. **Every scan outcome has a defined resolution** — no dead ends:
   | Outcome | Experience |
   |---|---|
   | Readable, known asset, in tenant | Enter asset context |
   | Readable, unknown code | Explain that the code is not registered, offer manual lookup, allow the observation to proceed attached to the current work context |
   | Readable, known asset, **different tenant** | State clearly that the asset belongs to another organization; do not disclose its details |
   | Readable asset with a governed lifecycle state that makes it non-inspectable | Explain the state in user language and what to do instead |
   | Unreadable / camera unavailable | Offer manual asset lookup; never block the user's work |
3. **Manual lookup is always available** as the fallback path for every scan failure.
4. Asset context shows identity, applicable guidance and open findings — **what to do here**, never a
   register (R2 §2.2).

---

## 11. Connectivity state presentation

1. **Three states, always distinguishable: online · degraded · offline (read-only).** When not online,
   the state is **visible at all times** in the shell — never a hidden or transient indicator.
2. **Transitions are announced** (visually and to assistive technology) because they change what the user
   may safely do.
3. **The user must always be able to tell whether their input is durable.** While offline, the experience
   states that a report is not yet recorded — it never shows a success state it cannot honour.
4. **Degraded** means partial function (e.g. slow or unreliable), presented honestly rather than as
   failure or success.

---

## 12. Safe degraded/offline **reading**

1. Reading already-loaded content — the current step's guidance, the asset's recent findings, applicable
   knowledge already retrieved — is a **supported degraded mode** and should not fail merely because the
   connection dropped.
2. **Reading never mutates.** Offline read-only is exactly that: the experience must not accept a change
   it cannot commit.
3. **No promise of background synchronisation.** The experience must never imply that pending work will
   sync later, because that behaviour is not architecturally ratified (§13).
4. Connectivity handling must not degrade the **online** path: field resilience must not be achieved by
   making the connected experience slower or more ambiguous.

---

## 13. Offline **mutation / synchronisation** — recorded as UNRESOLVED

**No offline write or synchronisation architecture is ratified.** Mobile-first does not itself prove a
requirement for distributed offline mutation (ATM-002-R1 §5).

**Operational evidence required before this decision can be taken** (each item is a question the OWNER /
Chief Architect must be able to answer from evidence, not assumption):

1. **Measured connectivity profile** — for which sites, roles and tasks is connectivity actually lost; for
   how long; how often. (Anecdote is not evidence.)
2. **Operational impact** — whether work is genuinely *blocked* without offline capture, or merely
   inconvenienced; and what field practice currently substitutes for the missing capability.
3. **Accountability semantics under conflict** — when two records describe the same observation
   differently, which is authoritative, and who is accountable for the resolution. Offline capture makes
   this a first-class question, and ATM-001's accountability model requires an attributed answer.
4. **Evidence integrity** — how an offline-captured observation retains attribution, capture time and
   non-repudiation when it is committed later.
5. **Platform analysis** — storage, security of data at rest on the device, tenant isolation on a shared
   device, and the sync mechanism's failure modes (owned by ATM-003; see ATM-003-R2).
6. **Regulatory or audit obligations** that would mandate a particular approach.

**Until this decision is taken:** the experience must present connectivity honestly (§11), must never
promise durability, and must not be designed in a way that assumes offline writes exist. Any future
decision is a cross-ATM-002/ATM-003 record, not an implementation detail.

---

## 14. Accessibility conformance

1. **WCAG 2.1 AA is the V1 target**, and it is a **per-surface acceptance criterion, verified as each
   surface is built** — not a retrofit and not a project-wide audit at the end.
2. Known debt is carried explicitly: `user-scalable=no` in 4 views (removed with those surfaces), absence
   of `aria-*` semantics (added with each migrated surface), and colour-only signalling in legacy screens.
3. Exceptions, if any, are recorded with their reason and an owner — an undocumented exception is a
   defect, not a decision.
4. Field-specific standards above AA (§3.2 contrast, §5 target size) are identified as **Atiman
   standards**, so that conformance claims remain exact.

---

## 15. What this record does not do

- No CSS, markup, JavaScript or service-worker change; no offline implementation.
- No PWA caching policy (**platform-owned**, ATM-003-R2) and no offline mutation (**unresolved**, §13).
- No visual specification beyond R4's tokens and primitives.
- No claim that the current interface already meets any part of this contract.

---

## 16. LCQE evidence

- Each section traces to an approved principle (R1 §2 C/H) or to a measured baseline defect, and the
  measured defects are cited where they motivate a rule.
- The WCAG distinction is explicit in two places (§3.2, §5.2) so that no Atiman standard is misattributed
  to WCAG 2.1 AA — the failure mode this record is most exposed to.
- Offline mutation is left genuinely unresolved with six enumerated evidence requirements, rather than
  being quietly implied by "mobile-first".
- Field standards are stated as Atiman standards wherever they exceed WCAG, so conformance claims stay
  exact.

---

**ATM-002-R7 — field, accessibility and connectivity contract approved. Offline mutation unresolved by design.**
