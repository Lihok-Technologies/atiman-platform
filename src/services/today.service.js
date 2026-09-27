/**
 * Today data (ATM-002-I1).
 *
 * Today answers "what needs my attention now?" and may only be composed from real
 * product state (mission §9). This service therefore reads exactly one kind of
 * attention item that exists truthfully today — findings that have been REPORTED
 * against the tenant — in a single tenant-scoped query.
 *
 * Deliberately absent, and why:
 *   * assessment / monitoring / escalation attention — the Finding experience
 *     (ATM-002-R5) is not implemented, and PR #27 is unadjudicated, so Today must
 *     not assert those semantics (mission §10);
 *   * schedule, calendar and maintenance-plan attention — EAM-owned planning
 *     surfaces (ATM-002-R2 §4) and explicitly excluded from Today (mission §9);
 *   * work-order backlog, technician productivity, schedule compliance,
 *     inventory, procurement and cost KPIs — EAM-owned or out of product scope.
 *
 * The returned items carry only what is recorded: description, severity as
 * recorded, the asset, when it was reported and by whom. No outcome, status
 * interpretation or recommendation is derived, because none is approved.
 */

const { getConnection } = require('../config/database');

const DEFAULT_LIMIT = 5;

const formatReportedAt = (value) => {
  if (!value) return 'at an unrecorded time';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'at an unrecorded time';
  return date.toISOString().slice(0, 10);
};

/**
 * Reported findings for a tenant — one query, no N+1, tenant-scoped.
 *
 * @param {number} organizationId
 * @param {{limit?: number}} [options]
 * @returns {Promise<{count: number, items: Array<Object>}>}
 */
async function reportedFindings(organizationId, options = {}) {
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
  const tenantId = Number(organizationId);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    // Fail closed: no tenant context means no tenant data.
    return { count: 0, items: [] };
  }

  const conn = await getConnection();
  try {
    const rows = await conn.query(
      `SELECT f.id,
              f.finding_description,
              f.severity,
              f.reported_at,
              u.full_name AS reported_by,
              COALESCE(e.name, e.code) AS asset_label
         FROM findings f
         LEFT JOIN users u ON u.id = f.reported_by_user_id
         LEFT JOIN equipment e ON e.id = f.asset_id
        WHERE f.organization_id = $1
        ORDER BY f.reported_at DESC NULLS LAST, f.id DESC
        LIMIT $2`,
      [tenantId, limit]
    );

    const [totals] = await conn.query(
      `SELECT count(*)::int AS count FROM findings WHERE organization_id = $1`,
      [tenantId]
    );

    return {
      count: totals ? totals.count : 0,
      items: rows.map((row) => ({
        id: row.id,
        description: row.finding_description || 'Finding recorded without a description',
        severity: row.severity || null,
        reported_at_label: formatReportedAt(row.reported_at),
        reported_by: row.reported_by || null,
        asset_label: row.asset_label || null
      }))
    };
  } finally {
    await conn.rollback();
    conn.release();
  }
}

/**
 * Truthful next actions for a principal, derived from capabilities and from
 * surfaces that actually exist. No dead links and no roadmap promises.
 *
 * @param {Set<string>} capabilities
 * @returns {Array<{id: string, label: string, hint: string, href: string}>}
 */
function availableActions(capabilities = new Set()) {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  const actions = [];

  // Reading governed knowledge requires an authenticated principal only, and the
  // transitional template list is a truthful surface today (ATM-002-R6 §10).
  actions.push({
    id: 'knowledge',
    label: 'Browse knowledge',
    hint: 'Governed maintenance knowledge, in its current transitional form',
    href: '/mobile/templates'
  });

  // Accountability a principal holds but cannot yet execute is stated, never
  // turned into a link that leads nowhere.
  if (held.has('knowledge.author')) {
    actions.push({
      id: 'knowledge-authoring-unavailable',
      label: 'Knowledge authoring',
      hint: 'Your account may author knowledge; the authoring surface is not implemented yet',
      href: null
    });
  }
  // Report is implemented (ATM-002-I2E): it records an observation against an
  // asset and creates no Finding, no outcome and no work order. The hint says
  // exactly that, because a "report" that turned out to raise maintenance work
  // would misrepresent the product.
  if (held.has('finding.report')) {
    actions.push({
      id: 'report',
      label: 'Report an observation',
      hint: 'Record what you observed about an asset. No Finding is created.',
      href: '/atiman/report'
    });
  }
  if (held.has('inspection.execute')) {
    actions.push({
      id: 'inspection-unavailable',
      label: 'Perform an inspection',
      hint: 'Inspection execution is approved but not implemented yet',
      href: null
    });
  }

  return actions;
}

module.exports = { reportedFindings, availableActions, DEFAULT_LIMIT };
