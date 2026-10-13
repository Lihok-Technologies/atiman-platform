/**
 * ATM-003 capability resolution.
 *
 * Answers exactly one question: *which capabilities does this authenticated
 * principal hold, in this tenant, right now?*
 *
 * It is not an authorization decision and it does not know about routes. It
 * resolves; the authorization primitive decides; the business services decide
 * whether the operation is valid.
 *
 * ── The authorization-mode rule (OWNER adjudication, 2026-09-27) ─────────────
 *
 * Every human principal resolves in exactly ONE mode:
 *
 *   EXPLICIT_GRANTS       the principal has one or more active explicit grants.
 *                         ONLY those grants are used; capabilities derived from
 *                         users.role are added in NO case — except the single
 *                         tenant-administrator profile recorded below, which is
 *                         the legacy bundle's own organization-administration
 *                         entries and never a new capability.
 *
 *   LEGACY_COMPATIBILITY  the principal has no active explicit grant. The
 *                         deterministic legacy-role bundle applies.
 *
 * There is no union, no per-capability fallback, no "admin gets everything" and
 * no third state. A principal with any explicit grant therefore loses every
 * legacy-derived capability they did not explicitly hold — that is the intended
 * behaviour, and it is what makes explicit grants authoritative.
 *
 * ── The single exception: the tenant administrator (ATM-001-SEC-104-R2 F3) ───
 *
 * A principal the database records as role `admin` AND
 * `is_organization_admin = true` additionally keeps the ATM-003-R1 §4 Tenant
 * Administrator profile in BOTH modes. This is compatibility preservation of a
 * profile the `admin` legacy bundle already confers on every un-granted
 * administrator (VUDA finding F3: an unrelated grant silently stripped the
 * tenant administrator's ability to administer its own tenant). It is not a
 * union and not role-derived authority: it is exactly the one profile, one
 * principal shape, tenant-scoped, and it grants nothing to a principal that is
 * not the tenant administrator. See src/config/capabilities.js for the full
 * rationale and the properties that keep it bounded.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────
 *
 * Any refusal returns an EMPTY capability set with a reason. An unknown role, an
 * unknown capability identifier, a missing organization, an inactive user, a
 * tenant mismatch and an unexpected error all yield no capabilities. Unknown
 * identifiers are ignored rather than trusted, so a malformed or future row can
 * never widen authority.
 */

const { getConnection } = require('../config/database');
const {
  RESOLUTION_MODES,
  LEGACY_COMPATIBILITY_BUNDLES,
  NON_HUMAN_GRANTABLE,
  TENANT_ADMINISTRATOR_ROLE,
  TENANT_ADMINISTRATOR_PROFILE,
  isGrantable
} = require('../config/capabilities');

const REFUSAL_REASONS = Object.freeze({
  PRINCIPAL_REQUIRED: 'PRINCIPAL_REQUIRED',
  PRINCIPAL_NOT_FOUND: 'PRINCIPAL_NOT_FOUND',
  PRINCIPAL_INACTIVE: 'PRINCIPAL_INACTIVE',
  ORGANIZATION_REQUIRED: 'ORGANIZATION_REQUIRED',
  ORGANIZATION_MISMATCH: 'ORGANIZATION_MISMATCH',
  RESOLVER_ERROR: 'RESOLVER_ERROR'
});

const refusal = (reason) => ({ mode: null, capabilities: new Set(), reason });

/**
 * Apply the single documented exception to the mode rule.
 *
 * A tenant administrator — `users.role = 'admin'` AND
 * `users.is_organization_admin = true` — keeps the ATM-003-R1 §4 Tenant
 * Administrator profile (`org.user_admin`, `org.config_admin`) in BOTH modes.
 * See the rationale, and the reason this is a compatibility key rather than an
 * authority of its own, in src/config/capabilities.js.
 *
 * Nothing else is preserved: the returns above are the only two resolution
 * outcomes, and both pass through here, so the exception cannot be reached
 * without a database row that says this principal is the tenant administrator.
 */
const withTenantAdministratorProfile = (capabilities, user) => {
  if (user.role === TENANT_ADMINISTRATOR_ROLE && user.is_organization_admin === true) {
    for (const capability of TENANT_ADMINISTRATOR_PROFILE) capabilities.add(capability);
  }
  return capabilities;
};

/**
 * Resolve the capabilities of an authenticated principal.
 *
 * @param {Object|null} principal - the authenticated DB principal (req.user)
 * @param {Object} [options]
 * @param {number} [options.organizationId] - resolved tenant context; when
 *        supplied it must equal the principal's own organization
 * @param {Object} [options.connection] - an open connection (transaction reuse)
 * @returns {Promise<{mode: string|null, capabilities: Set<string>, reason: string|null}>}
 */
async function resolveCapabilities(principal, options = {}) {
  const { organizationId, connection = null } = options;

  if (!principal || principal.id === undefined || principal.id === null) {
    return refusal(REFUSAL_REASONS.PRINCIPAL_REQUIRED);
  }

  const ownsConnection = connection === null;
  let conn = connection;
  try {
    if (ownsConnection) conn = await getConnection();

    // The principal is re-read from the database: authorization never trusts a
    // token payload, a header or a client-supplied identity.
    const rows = await conn.query(
      `SELECT id, organization_id, role, is_active, is_organization_admin FROM users WHERE id = $1`,
      [Number(principal.id)]
    );
    const user = rows[0];
    if (!user) return refusal(REFUSAL_REASONS.PRINCIPAL_NOT_FOUND);
    if (user.is_active !== true) return refusal(REFUSAL_REASONS.PRINCIPAL_INACTIVE);
    if (user.organization_id === null || user.organization_id === undefined) {
      return refusal(REFUSAL_REASONS.ORGANIZATION_REQUIRED);
    }

    // Tenant context: an explicit context must be the principal's own tenant.
    // A mismatch is a refusal, never a cross-tenant read.
    if (organizationId !== undefined && organizationId !== null
        && Number(organizationId) !== Number(user.organization_id)) {
      return refusal(REFUSAL_REASONS.ORGANIZATION_MISMATCH);
    }

    const tenantId = Number(user.organization_id);

    const granted = await conn.query(
      `SELECT capability FROM user_capabilities
        WHERE user_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
      [Number(user.id), tenantId]
    );

    // Only recognised, human-grantable identifiers count. Anything else — a
    // non-grantable architectural capability, an unknown identifier, a wildcard —
    // is ignored, so no row can widen authority beyond the V1 grantable set.
    const explicit = new Set(
      granted
        .map((r) => r.capability)
        .filter((c) => typeof c === 'string'
          && isGrantable(c)
          && !NON_HUMAN_GRANTABLE.includes(c))
    );

    if (explicit.size > 0) {
      return {
        mode: RESOLUTION_MODES.EXPLICIT_GRANTS,
        capabilities: withTenantAdministratorProfile(explicit, user),
        reason: null
      };
    }

    const bundle = LEGACY_COMPATIBILITY_BUNDLES[user.role];
    return {
      mode: RESOLUTION_MODES.LEGACY_COMPATIBILITY,
      // An unrecognised role resolves to nothing rather than to a default.
      capabilities: withTenantAdministratorProfile(new Set(bundle ? [...bundle] : []), user),
      reason: null
    };
  } catch (error) {
    // Fail closed: an error resolving authority is never permissive.
    if (process.env.NODE_ENV !== 'test') {
      console.error('[CAPABILITY] resolution failed; denying all capabilities:', error.message);
    }
    return refusal(REFUSAL_REASONS.RESOLVER_ERROR);
  } finally {
    if (ownsConnection && conn) {
      try { await conn.rollback(); } catch { /* read-only resolution */ }
      conn.release();
    }
  }
}

/** Boolean helper for callers that only need a yes/no answer. */
async function hasCapability(principal, capability, options = {}) {
  const resolved = await resolveCapabilities(principal, options);
  return resolved.capabilities.has(capability);
}

module.exports = {
  resolveCapabilities,
  hasCapability,
  REFUSAL_REASONS,
  RESOLUTION_MODES
};
