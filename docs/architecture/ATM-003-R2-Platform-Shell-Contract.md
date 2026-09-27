# ATM-003-R2 — Platform Shell Ownership Contract (bounded intervention)

**Document ID:** ATM-003-R2
**Status:** **APPROVED V1** — bounded ATM-003 intervention. It fixes ownership boundaries only; it
implements nothing and does not complete ATM-003.
**Baseline:** `origin/main` = `d2202ce19c5cf8b5e1132c79edf5d0e0d267f8b7`
**Unblocks:** the ATM-002 records that must know what the platform owns — R2 (entry point and shell
surroundings), R3 (authorization context), R4 (shell presentation), R7 (connectivity/PWA).
**Scope:** architecture only. No code, no configuration, no deployment change.

---

## 1. The rule

> **ATM-003 owns platform *semantics*. ATM-002 owns experience *presentation*.**

A platform concern is one whose correctness is a security, isolation, session or delivery property:
it must hold identically no matter which application or screen consumes it. An experience concern is
one whose correctness is a human-factors property: it may change with the work being done, the role, the
device and the field context.

Neither may silently absorb the other:

- **ATM-003 must not design screens.** A platform that decides layout, wording or navigation has
  invented an experience architecture.
- **ATM-002 must not define platform semantics.** An experience record that decides session lifetime,
  tenant resolution or authorization evaluation has invented a platform.

---

## 2. Ownership contract

| Concern | Owner of semantics | Owner of presentation | Boundary in one line |
|---|---|---|---|
| **Login** | ATM-003 | ATM-002 | Platform decides credential verification, failure taxonomy and lockout; experience decides layout, field experience, copy and error presentation using the platform's failure taxonomy |
| **Signup / account creation** | ATM-003 | ATM-002 | Platform decides what an account and a tenant are, validation rules and provisioning order; experience decides the flow's presentation. **Product onboarding** (helping a new user reach first useful work) is ATM-002 |
| **Onboarding (product)** | ATM-002 | ATM-002 | What a new user is shown before first work belongs to the experience, gated by what the platform has actually provisioned |
| **Session** | ATM-003 | ATM-002 | Platform decides lifetime, refresh, revocation, concurrency and expiry; experience decides how expiry and re-authentication are **presented** and how in-flight work is protected |
| **Session expiry / logout** | ATM-003 | ATM-002 | Platform enforces; experience must never silently lose user input — it presents an explicit interruption and safe recovery path |
| **Organization / tenant context** | ATM-003 | ATM-002 | Platform decides resolution, membership and any switching semantics; experience decides where context is shown and what visibly changes when it changes |
| **Profile** | ATM-003 (identity data) | ATM-002 (surface) | Platform owns the fields that constitute identity; experience owns the surface. Profile is **not** a work destination (R2 §2.3) |
| **Authorization evaluation** | ATM-003 | — | Platform evaluates capabilities at the API/service layer. The UI **never** makes an authoritative decision |
| **Authorization context supplied to UI** | ATM-003 | ATM-002 | Platform supplies a scoped, presentation-only capability descriptor; experience consumes it for visibility and ordering, and must **fail closed** on anything it does not understand |
| **Platform-level shell** (chrome) | ATM-003 | ATM-002 | Platform owns auth state, tenant context and security affordances; experience owns how the frame looks. **The platform shell must never introduce a module menu** |
| **Product / work navigation** | ATM-002 | ATM-002 | Destinations, composition rules, entry point and back semantics are ATM-002's (R2 §3). The platform must not define, rank or re-implement work navigation |
| **PWA / service worker (technical)** | ATM-003 | — | Platform owns the manifest, service-worker lifecycle, caching and update policy, and installability |
| **Offline / connectivity experience** | ATM-002 | ATM-002 | Experience owns connectivity states, degraded-read principles and copy, within the caching policy the platform provides. **Offline mutation remains unratified** (R7) |
| **Global error / degradation surfaces** | ATM-003 (mechanism) | ATM-002 (presentation) | Platform owns failure detection and taxonomy; experience owns the surface |
| **Multi-application shell** | ATM-003 | ATM-002 | The platform shell must admit **future Atiman applications** without each building its own shell (ATM-000 §14 permanent architecture); work navigation inside each application remains that application's concern |

---

## 3. Consequences resolved for ATM-002

1. **The canonical entry point is Today** (R2 §3.1). The platform's shell must route an authenticated
   work user there; a platform shell that lands users on an administrative or module index contradicts
   ATM-002.
2. **PWA entry alignment is a platform obligation.** The manifest currently declares
   `start_url=/mobile/home` while the task-first entry is `/mobile/today`; aligning them is platform
   work, not an experience improvisation.
3. **Administration is platform-owned and never a work destination.** Its surfaces are reached
   deliberately and never occupy a work slot (R2 §2.3, §3.4).
4. **The UI capability descriptor is presentation-only.** This is the mechanism by which R3's rule —
   *do not expose controls merely because permission exists* — becomes implementable without letting the
   client become an authority. The existing client-side `permissions.js` map is presentation-only and
   may not be treated as enforcement (ATM-003-R1 §7).
5. **Session expiry must not destroy field work.** Any experience decision that holds unsaved operator
   input must define its recovery path with the platform, because the platform owns expiry timing.
6. **One shell, several applications.** Today the same mobile UI is reachable under `/mobile` *and*
   `/api/mobile`, and two service-worker registrations exist. Ownership is single-owner per concern
   above; duplicated delivery paths are platform debt, recorded here, not solved by ATM-002.

---

## 4. What this contract does not decide

- Session technology, token model, SSO/OIDC specifics, MFA — **ATM-003 broader scope**.
- Tenant isolation mechanics, role/permission storage and grant representation — **ATM-003**
  (capabilities are named in ATM-003-R1; their representation needs its own bounded mission).
- Event, storage, observability and integration foundations — **ATM-003 broader scope**.
- Offline **mutation/synchronisation** — **unresolved** cross-ATM-002/ATM-003 decision (R7 records the
  evidence required before it can be taken).
- The platform shell's visual design — **ATM-002-R4**.

---

## 5. LCQE evidence

- Every row is a boundary statement, not a design: no screen, layout, route, token or schema is specified.
- Each boundary cites the record that consumes it, so the contract is checkable against R2/R3/R4/R7.
- The measured debts referenced (PWA entry drift, duplicate delivery paths, two service-worker
  registrations, client-side permission map as presentation-only) are previously measured facts.
- The contract does not complete ATM-003 and says so explicitly.

---

**ATM-003-R2 — platform shell ownership contract approved. No implementation.**
