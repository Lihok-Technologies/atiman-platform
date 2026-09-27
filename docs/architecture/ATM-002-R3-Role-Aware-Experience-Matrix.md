# ATM-002-R3 — Role-Aware Experience Matrix

**Document ID:** ATM-002-R3
**Status:** **APPROVED V1** — architecture record. No UI is implemented by this document.
**Baseline:** `origin/main` = `94eed86dc72645231259bf34b86f5831df508460`
**Depends on:** `ATM-002-R1` (principles), `ATM-002-R2` (destinations and composition rules),
`ATM-003-R1` (capabilities and profiles), `ATM-003-R2` (authorization context contract).

---

## 1. The rule that governs this matrix

> **Navigation and controls are composed from granted *capabilities*, never from a profile name or a
> job title.**

Profiles (ATM-003-R1 §4) are provisioning conveniences — useful bundles for creating a person
efficiently. The experience must be composed from the capabilities actually granted, because:

- one person may hold several profiles (a supervisor who is also the safety reviewer);
- the same profile may be granted differently between organizations;
- a profile name is a *responsibility description*, not a security or presentation fact.

A second rule, from ATM-002-R1 §2 G and ATM-003-R1 §7:

> **A control is shown only when the capability is granted *and* the control is actionable in the
> current state.** Capability alone is not sufficient reason to expose a control, and exposure is never
> the authority.

---

## 2. Experience matrix

`→` marks the profile's *primary* work. Every cell is derived from ATM-003-R1 capabilities.

### 2.1 Field Operator / Inspector — `inspection.execute`, `finding.report`, `evidence.attach`

| Dimension | Definition |
|---|---|
| **Primary objective** | Complete the work at the asset safely and record what was observed |
| **Primary surfaces** | **Today** (what is mine now) · **Inspect** (execute) · **Report** (capture an observation and raise a Finding) · **Knowledge in context** (guidance during work) |
| **Actions** | Start/continue an inspection; capture photo, reading, note, condition; raise a Finding; attach evidence; scan an asset to enter context |
| **Accountable decisions** | The **claim** that an observation was made — its accuracy and its evidence are the operator's accountability (attributed report) |
| **Knowledge required** | Procedure steps for the current task; safety information for the current step; prior findings on this asset; what a Finding is versus an observation |
| **Field context** | Primary mobile, one-handed, gloved, intermittent connectivity. This profile defines the *field constraint* (R7) |
| **Escalation responsibility** | **None.** Operators report; assessment and escalation approval are not theirs (no `escalation.*` capability) |
| **Not shown** | Assessment queue, monitoring controls, escalation package, administration, governance internals (approval state, fingerprints, provenance tables) |

### 2.2 Assessor (supervisory) — `finding.assess`, `finding.monitor`, `escalation.prepare`, `escalation.approve`, `inspection.assign`, `finding.close`

| Dimension | Definition |
|---|---|
| **Primary objective** | Decide what each Finding means, keep the right ones observed, and hand the right ones to the EAM |
| **Primary surfaces** | **Today** (queue) · **Assess** · **Monitor** · **Escalate** · **Knowledge in context** · asset context from a Finding |
| **Actions** | Review evidence; record the outcome decision (**Operator Correction**, **Monitoring**, **Escalation**); set/complete monitoring; prepare and approve an escalation package; close a Finding; assign inspection work |
| **Accountable decisions** | The **outcome decision** and the **escalation approval** — attributed human decisions (ATM-003-R1 §5). Escalation to an enterprise EAM is the moment accountability leaves Atiman |
| **Knowledge required** | The Finding's claim and evidence; relevant procedure and safety knowledge; asset context and history; what the EAM handoff must contain |
| **Field context** | Mobile-first, but this is the profile where **desktop density genuinely helps** (queues, comparison, package review) — an approved desktop use under R1 §2 C |
| **Escalation responsibility** | **Total**: preparation and approval |
| **Not shown** | Governance internals beyond what disclosure requires; administration; other tenants' work |

### 2.3 Knowledge Steward — `knowledge.*`, `evidence.attach`

| Dimension | Definition |
|---|---|
| **Primary objective** | Keep the governed knowledge authoritative, evidenced and current |
| **Primary surfaces** | **Today** · **Knowledge** (browse and, where authorised and where surfaces exist, author/review) · knowledge in context to verify how it appears during work |
| **Actions** | Author/submit drafts; review; approve; attest safety; publish; clear legacy content; attach evidence — each as a **separate accountable act** |
| **Accountable decisions** | Approval, safety attestation, publication and legacy clearance. `knowledge.approve` and `knowledge.publish` are **not** held by one person for the same item (enforced) |
| **Knowledge required** | The governed content itself; its provenance and evidence; lifecycle state; the distinction between knowledge and operational evidence |
| **Field context** | Predominantly desktop (authoring and review are information-density work). Mobile is for verifying knowledge as an operator would see it |
| **Escalation responsibility** | None |
| **Constraint** | **Its authoring/review surfaces are evidence-gated and deferred (R6).** The capability exists; the V1 surface set does not yet include authoring |

### 2.4 Tenant Administrator — `org.user_admin`, `org.config_admin`

| Dimension | Definition |
|---|---|
| **Primary objective** | Keep the organization operable: people, roles and tenant configuration |
| **Primary surfaces** | **Today** (if they also perform work) · **Administration** (platform destination; never a work slot) |
| **Actions** | Manage users and invitations; assign capabilities; tenant settings; facilities configuration (minimal) |
| **Accountable decisions** | Who may act in this tenant, and with which capabilities |
| **Knowledge required** | Not domain knowledge; requires understanding of what capabilities mean (must not be a raw technical screen) |
| **Field context** | Desktop |
| **Escalation responsibility** | None |
| **Not shown** | Tenant domain content beyond administration needs; no cross-tenant visibility |

### 2.5 Platform Operator — `platform.admin`

| Dimension | Definition |
|---|---|
| **Primary objective** | Keep the platform provisioned, healthy and correctly configured |
| **Primary surfaces** | Platform shell + **Administration** only. **No work destinations unless work capabilities are also granted** |
| **Actions** | Provision tenants; platform configuration; cross-tenant health |
| **Accountable decisions** | Platform-level changes |
| **Knowledge required** | Platform operation; **not** tenant domain content — this profile has no domain content access (ATM-003-R1 §6) |
| **Field context** | Desktop |
| **Escalation responsibility** | None |

### 2.6 Integration Identity — `integration.service`

| Dimension | Definition |
|---|---|
| **Primary objective** | Machine-to-machine exchange under an explicit narrow scope |
| **Primary surfaces** | **None.** A service identity has no experience, no navigation and no screens |
| **Actions** | Only what its scope permits, at the API layer |
| **Accountable decisions** | None — a service identity is never accountable; a human is accountable for the integration's design and operation |
| **Knowledge required** | Not applicable — no experience consumes knowledge on its behalf |
| **Field context** | Not applicable — no device, no session, no field use |
| **Escalation responsibility** | Not applicable — an integration may *transport* an escalation package only if its scope permits; it never decides one |
| **Not shown** | Everything. It must never be issued a human session or appear as a persona |

---

## 3. Navigation composition per profile

Composition is a pure function of granted capabilities (R2 §3.4: work destinations only, no duplicates,
asset context is a scan affordance, administration never in a work slot).

| Granted capabilities | Composed work destinations |
|---|---|
| `inspection.execute` + `finding.report` | Today, Inspect, Report, Knowledge |
| `finding.assess` (+ monitor/escalate/assign/close) | Today, Assess, Monitor, Escalate, Knowledge |
| Operational **and** assessment capabilities (small-org reality) | Today, Inspect, Report, Assess, Monitor, Escalate, Knowledge — with the composition rules deciding what fits the primary bar and what lives behind Today/overflow |
| Knowledge-only | Today, Knowledge |
| `org.*` only | Today (empty-state guidance toward work or administration), Administration |
| `platform.admin` only | Platform shell, Administration |
| `integration.service` | No experience |

**This table, not the current six-item bar, is the authority for navigation composition.** The present
bar (`Today · Inspect · Report · Know · Assess · Escalate`) remains transitional evidence (R1 §5) and is
consistent with the operational+assessment row above — but it must not be read as the ratified model for
every profile, and its duplicate destinations must be resolved (R2 §3.4).

---

## 4. Cross-profile experience rules

1. **Continuity of the object, not of the module.** The same Finding is the same object for the operator
   who reported it and the assessor who decides it — different actions, one object, one identity.
2. **Handover is explicit.** When a Finding moves from reporting to assessment, the operator can see
   *that* it was assessed and what the outcome was; they do not see the assessor's governance internals.
3. **Capability changes are explained, not silent.** If a capability is revoked (or a session context
   changes), the experience must explain the missing action rather than hide it and let the user infer
   breakage.
4. **Empty states are work-oriented.** A profile with no assigned work does not see a dashboard of zeros;
   it sees what can be done next, defined by its capabilities (e.g. inspect ad-hoc).
5. **No profile is shown administration as a work destination** (R2 §2.3).
6. **Nothing in this matrix exposes a governance internal** that R1 §2 D and G do not require.

---

## 5. What this record does not do

- It does not implement capability enforcement, navigation or screens.
- It does not decide the visual system (**R4**), the Finding experience detail (**R5**), knowledge
  disclosure rules (**R6**) or field/accessibility specifics (**R7**).
- It does not add, remove or rename a capability (ATM-003-R1 owns that).
- It does not resolve whether knowledge **authoring** surfaces exist in V1 (**R6**, evidence-gated).

---

## 6. LCQE evidence

- Every row derives from an ATM-003-R1 capability; no job title other than the six admitted profiles
  appears as an actor (Planner and Reliability Analyst remain deferred).
- The presentation rule (capability **and** actionability) is stated once and applied throughout.
- Navigation composition is expressed as a function of capabilities, which is what makes the profile
  names non-load-bearing — consistent with ATM-003-R1's capability decision.
- The current bar is explicitly labelled transitional, consistent with R1 §5 and R2 §3.4.

---

**ATM-002-R3 — role-aware experience matrix approved. Architecture only.**
