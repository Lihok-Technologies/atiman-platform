/**
 * ATM-002-I2C — authoritative tenant-safe asset-context resolution.
 *
 * ONE primitive. Every path that turns an identifier into asset context goes
 * through `resolveAsset`, so there is no second, subtly different implementation
 * that could drift from this one.
 *
 *   IDENTIFIER  ->  TENANT-SAFE RESOLUTION  ->  TRUSTWORTHY ASSET CONTEXT
 *
 * WHAT THIS SERVICE IS
 *   * the only resolver of an asset from an operator-supplied identifier;
 *   * tenant-authoritative: the tenant comes from the trusted call context and a
 *     caller-supplied organization, tenant, role or capability never influences
 *     the decision (nothing in this file reads one);
 *   * fail-closed: an asset that belongs to no organization, an ambiguous
 *     identifier, a malformed identifier and a missing tenant all refuse;
 *   * read-only. It performs no INSERT, UPDATE or DELETE, and it knows nothing
 *     about Observation, Finding, work orders, plans, schedules or assignments.
 *
 * WHAT THIS SERVICE IS NOT
 *   * it is not an asset registry: there is no listing, no search, no browse, no
 *     partial or wildcard matching, and no identifier may be used to enumerate a
 *     tenant's assets;
 *   * it is not asset administration: it creates, imports, renames, re-tags and
 *     regenerates nothing;
 *   * it exposes no EAM surface: no SAP reference, no work order, no plan, no
 *     schedule, no assignment, no cost, no procurement, no inventory.
 *
 * TENANT RULE (ATM-002-I2C §5)
 *   asset exists  AND  a tenant is resolved from the trusted context  AND
 *   the asset belongs to that tenant.
 * `equipment.organization_id` is nullable in this schema, so an asset with no
 * organization can never be resolved for operational use — it fails closed.
 *
 * DISCLOSURE RULE (ATM-002-I2C §6, ATM-002-R7 §10.2)
 * Only `RESOLVED` carries a payload. Every other outcome carries no asset field
 * whatsoever — not a name, code, facility, type, taxonomy value, status or
 * identifier fragment. The distinction between an absent identifier and another
 * tenant's identifier is expressed as a bare outcome so the field experience can
 * state it without the boundary ever returning the foreign asset row.
 *
 * The distinction is a bounded, deliberate property: an authenticated principal
 * can learn that a given human-readable code exists in another organization. That
 * is what ATM-002-R7 §10.2 requires the scan experience to say, and it discloses
 * nothing about the asset itself. Opaque `qr_token` values are 16 random bytes,
 * so no inference is possible from them at all.
 */

const { getConnection } = require('../config/database');

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

/**
 * The only identifiers this service accepts.
 *
 * There is deliberately no id-based lookup: an internal surrogate key is not an
 * operator-supplied identifier, and accepting one would turn the resolver into an
 * enumeration surface.
 */
const IDENTIFIER_TYPES = Object.freeze({
  QR_TOKEN: 'qr_token',
  CODE: 'code'
});

const RESOLUTION_OUTCOMES = Object.freeze({
  /** Exactly one asset in the trusted tenant matched. Carries the projection. */
  RESOLVED: 'RESOLVED',
  /** No asset anywhere matches this identifier. */
  NOT_FOUND: 'NOT_FOUND',
  /** An asset matches, but it belongs to a different organization. */
  FOREIGN_TENANT: 'FOREIGN_TENANT',
  /** An asset matches, but it belongs to no organization at all. */
  UNOWNED_ASSET: 'UNOWNED_ASSET',
  /** More than one asset matches, or the identifier itself is incoherent. */
  AMBIGUOUS_IDENTIFIER: 'AMBIGUOUS_IDENTIFIER',
  /** Blank, malformed or oversized input. Refused before any query runs. */
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  /** The trusted context carries no resolved tenant. */
  ORGANIZATION_REQUIRED: 'ORGANIZATION_REQUIRED'
});

/**
 * The complete set of outcomes an outcome can carry asset data in. Every other
 * outcome must project `null`; the resolver asserts this rather than trusting it.
 */
const DISCLOSING_OUTCOMES = Object.freeze([RESOLUTION_OUTCOMES.RESOLVED]);

/**
 * `equipment.qr_code` is VARCHAR(100) and is the widest identifier column, so this
 * is the schema's own bound rather than an invented one.
 */
const MAX_IDENTIFIER_LENGTH = 100;

/** The approved Atiman asset-context field set. Nothing outside it is projected. */
const ASSET_CONTEXT_FIELDS = Object.freeze([
  'id', 'code', 'name', 'status', 'criticality', 'facility', 'taxonomy'
]);

/** Field names that must never appear in an Atiman asset-context projection. */
const EXCLUDED_FIELDS = Object.freeze([
  'organization_id', 'organizationId',
  'sap_equipment_reference', 'sapEquipmentReference',
  'sap_floc_hint', 'sapFlocHint',
  'facility_sap_ref', 'facilitySapRef',
  'qr_token', 'qrToken', 'qr_code', 'qrCode',
  'created_by', 'createdBy', 'created_at', 'createdAt', 'updated_at', 'updatedAt',
  'maintainable_item_id', 'subunit_id', 'equipment_class_id', 'equipment_category_id'
]);

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

/**
 * Normalize an identifier to a trimmed string, or to a refusal reason.
 *
 * Refused before any query runs, so malformed input can never reach the database
 * and can never be partially matched.
 */
const normalizeIdentifier = (identifier) => {
  if (!identifier || typeof identifier !== 'object') return { reason: 'IDENTIFIER_REQUIRED' };

  const type = hasOwn(identifier, 'type') ? identifier.type : null;
  if (!Object.values(IDENTIFIER_TYPES).includes(type)) {
    return { reason: 'IDENTIFIER_TYPE_UNSUPPORTED' };
  }

  const raw = identifier.value;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return { reason: 'IDENTIFIER_REQUIRED' };
  }
  const value = String(raw).trim();
  if (value === '') return { reason: 'IDENTIFIER_BLANK' };
  if (value.length > MAX_IDENTIFIER_LENGTH) return { reason: 'IDENTIFIER_TOO_LONG' };
  if (CONTROL_CHARACTERS.test(value)) return { reason: 'IDENTIFIER_MALFORMED' };

  return { type, value };
};

/** Resolve the trusted tenant, or null when the context carries none. */
const resolveTrustedTenant = (context) => {
  const raw = context && context.organizationId;
  if (raw === undefined || raw === null || raw === '') return null;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * Build the owned Atiman asset-context projection.
 *
 * Nothing is copied from the database row wholesale: each field is named here, so
 * a future column cannot silently start being disclosed. The facility is included
 * only when it belongs to the same trusted tenant — an asset whose `facility_id`
 * points at another tenant's facility (possible, because the legacy foreign key
 * carries no tenant constraint) must not leak that facility.
 *
 * A null value means "not recorded", and is never replaced by an invented
 * default: an asset with no status has no status, and saying otherwise would be a
 * fabricated claim.
 */
const toAssetContext = (row, organizationId) => {
  const taxonomyParts = [row.category_name, row.class_name, row.type_name]
    .filter((part) => part !== null && part !== undefined && String(part).trim() !== '')
    .map((part) => String(part));

  const facility = row.facility_id === null || row.facility_id === undefined
    ? null
    : {
      id: Number(row.facility_id),
      name: row.facility_name === undefined ? null : row.facility_name,
      code: row.facility_code === undefined ? null : row.facility_code
    };

  // Defensive: the SQL projects the facility only for the trusted tenant, and
  // this re-checks the invariant so a future query edit cannot silently weaken it.
  const sameTenantFacility = facility && Number(row.facility_organization_id) === organizationId
    ? facility
    : null;

  return {
    id: Number(row.id),
    code: row.code === undefined ? null : row.code,
    name: row.name === undefined ? null : row.name,
    status: row.status === undefined ? null : row.status,
    criticality: row.criticality === undefined ? null : row.criticality,
    facility: sameTenantFacility,
    taxonomy: taxonomyParts.length > 0
      ? {
        category: row.category_name === undefined ? null : row.category_name,
        class: row.class_name === undefined ? null : row.class_name,
        type: row.type_name === undefined ? null : row.type_name,
        label: taxonomyParts.join(' > ')
      }
      : null
  };
};

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve asset context from an operator-supplied identifier.
 *
 * @param {{organizationId: number}} context trusted call context; derived from the
 *        authenticated principal, never from request data
 * @param {{type: string, value: string}} identifier untrusted input
 * @returns {Promise<{outcome: string, reason: string|null, asset: Object|null}>}
 */
async function resolveAsset(context, identifier) {
  const outcome = (name, reason = null, asset = null) => {
    // Invariant: only a RESOLVED outcome may carry asset data. Enforced at the
    // boundary rather than left to each caller.
    const payload = DISCLOSING_OUTCOMES.includes(name) ? asset : null;
    return { outcome: name, reason, asset: payload };
  };

  const organizationId = resolveTrustedTenant(context);
  if (organizationId === null) return outcome(RESOLUTION_OUTCOMES.ORGANIZATION_REQUIRED);

  const normalized = normalizeIdentifier(identifier);
  if (normalized.reason) {
    return outcome(
      normalized.reason === 'IDENTIFIER_TYPE_UNSUPPORTED'
        ? RESOLUTION_OUTCOMES.AMBIGUOUS_IDENTIFIER
        : RESOLUTION_OUTCOMES.INVALID_IDENTIFIER,
      normalized.reason
    );
  }

  // Two explicit predicates rather than a string substitution: the aliased form
  // is used by the projection query and the bare form by the classification
  // query, and neither is derived from the other.
  const match = normalized.type === IDENTIFIER_TYPES.QR_TOKEN
    ? { aliased: 'e.qr_token = $2', bare: 'qr_token = $2' }
    : { aliased: '(e.qr_code = $2 OR e.code = $2)', bare: '(qr_code = $2 OR code = $2)' };

  const conn = await getConnection();
  try {
    // One tenant-scoped query on the success path. `LIMIT 2` is how ambiguity is
    // detected rather than guessed at: two matches refuse instead of picking one.
    const rows = await conn.query(
      `SELECT e.id,
              e.code,
              e.name,
              e.status,
              e.criticality,
              CASE WHEN f.organization_id = $1 THEN f.id END   AS facility_id,
              CASE WHEN f.organization_id = $1 THEN f.name END AS facility_name,
              CASE WHEN f.organization_id = $1 THEN f.code END AS facility_code,
              CASE WHEN f.organization_id = $1 THEN f.organization_id END AS facility_organization_id,
              et.type_name,
              cl.class_name,
              cat.category_name
         FROM equipment e
         LEFT JOIN facilities f          ON f.id = e.facility_id
         LEFT JOIN equipment_types et    ON et.id = e.equipment_type_id
         LEFT JOIN equipment_classes cl  ON cl.id = et.class_id
         LEFT JOIN equipment_categories cat ON cat.id = cl.category_id
        WHERE e.organization_id = $1 AND ${match.aliased}
        LIMIT 2`,
      [organizationId, normalized.value]
    );

    if (rows.length === 1) {
      return outcome(RESOLUTION_OUTCOMES.RESOLVED, null, toAssetContext(rows[0], organizationId));
    }
    if (rows.length > 1) {
      return outcome(RESOLUTION_OUTCOMES.AMBIGUOUS_IDENTIFIER, 'IDENTIFIER_MATCHES_MULTIPLE_ASSETS');
    }

    // Nothing is visible in this tenant. Classify without projecting anything: the
    // shapes of the rows are never read, only counted.
    const classification = await conn.query(
      `SELECT count(*) FILTER (WHERE organization_id IS NOT NULL)::int AS foreign_matches,
              count(*) FILTER (WHERE organization_id IS NULL)::int     AS unowned_matches
         FROM equipment
        WHERE organization_id IS DISTINCT FROM $1 AND ${match.bare}`,
      [organizationId, normalized.value]
    );
    const foreign = classification[0] ? classification[0].foreign_matches : 0;
    const unowned = classification[0] ? classification[0].unowned_matches : 0;

    if (foreign > 0) return outcome(RESOLUTION_OUTCOMES.FOREIGN_TENANT);
    if (unowned > 0) return outcome(RESOLUTION_OUTCOMES.UNOWNED_ASSET);
    return outcome(RESOLUTION_OUTCOMES.NOT_FOUND);
  } finally {
    // Read-only: nothing is committed, and `release()` on its own would leave the
    // transaction open, so it is rolled back explicitly.
    await conn.rollback();
    conn.release();
  }
}

module.exports = {
  resolveAsset,
  toAssetContext,
  IDENTIFIER_TYPES,
  RESOLUTION_OUTCOMES,
  DISCLOSING_OUTCOMES,
  ASSET_CONTEXT_FIELDS,
  EXCLUDED_FIELDS,
  MAX_IDENTIFIER_LENGTH
};
