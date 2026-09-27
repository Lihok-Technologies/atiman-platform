/**
 * Atiman asset-context controller (ATM-002-I2C).
 *
 * Serves the trustworthy asset-context page from a scanned or typed identifier.
 *
 * WHY THIS IS NOT IN atiman.controller.js
 * That file is the shell composition controller accepted in ATM-002-I1, and it
 * carries a deliberate, tested invariant: the shell takes NO authority from the
 * request — it must not read `req.body`, `req.query` or `req.headers`. Identifier
 * handling is exactly the opposite kind of concern, because an identifier is
 * untrusted request input by definition. Keeping it here preserves that invariant
 * as a property of the shell rather than diluting it, and keeps the I1 file
 * unchanged.
 *
 * Nothing in this file reads a browser-supplied organization, tenant, role or
 * capability: the trusted tenant is `req.user.organization_id` and nothing else.
 * The only request input read is the identifier itself, which the resolver treats
 * as untrusted and validates before any query runs.
 */

const { resolveCapabilities } = require('../services/capability.service');
const { composeWorkNavigation } = require('../config/destinations');
const {
  resolveAsset,
  IDENTIFIER_TYPES,
  RESOLUTION_OUTCOMES
} = require('../services/asset-context.service');

/**
 * Recording an observation is an accountable act, so the Report action appears
 * here only when the principal actually holds `finding.report`. Client visibility
 * is presentation only: the Report route enforces the same capability server-side,
 * so hiding the control is never the enforcement.
 */
const REPORT_CAPABILITY = 'finding.report';

/**
 * Read exactly one identifier out of the query string.
 *
 * `token` and `code` are the only two identifier kinds the resolver accepts, and
 * supplying both is refused rather than guessed at. Exported so the "exactly one"
 * rule can be proved directly rather than only through a rendered page.
 */
function readIdentifier(query = {}) {
  const token = typeof query.token === 'string' ? query.token : null;
  const code = typeof query.code === 'string' ? query.code : null;
  if (token && code) return { supplied: false, bothSupplied: true };
  if (token) {
    return { supplied: true, bothSupplied: false, identifier: { type: IDENTIFIER_TYPES.QR_TOKEN, value: token } };
  }
  if (code) {
    return { supplied: true, bothSupplied: false, identifier: { type: IDENTIFIER_TYPES.CODE, value: code } };
  }
  return { supplied: false, bothSupplied: false };
}

/**
 * GET /atiman/asset — trustworthy asset context from a scanned or typed identifier.
 *
 * Reached by scanning a printed label or by manual entry, never from navigation:
 * asset context is not a destination (ATM-002-R7 §10.1). The page offers no
 * work-order, inspection or reporting action, and renders no inspection history, no
 * pass/fail verdict and no EAM identifier — none of which Atiman can currently
 * substantiate, so presenting any of them would be a fabricated claim.
 */
const getAssetContext = async (req, res, next) => {
  try {
    // Navigation is composed on the server from the authoritative capability set,
    // exactly as the shell does it, so no role and no route list can enter it.
    const resolved = await resolveCapabilities(req.user);
    const shell = {
      workNavigation: composeWorkNavigation(resolved.capabilities),
      canReport: resolved.capabilities.has(REPORT_CAPABILITY),
      organizationName: req.organization?.organization_name
        || req.user.organization_name
        || null,
      accountHref: '/mobile/profile'
    };

    const read = readIdentifier(req.query);

    // No identifier at all: the manual-entry recovery path, which ATM-002-R7 §10.3
    // requires to exist for every scan failure.
    if (!read.supplied) {
      return res.render('atiman/asset-context', {
        layout: 'atiman/layout',
        title: 'Asset',
        activeDestination: null,
        ...shell,
        state: read.bothSupplied ? 'AMBIGUOUS_INPUT' : 'ENTRY',
        outcome: null,
        asset: null
      });
    }

    const resolution = await resolveAsset(
      { organizationId: req.user.organization_id },
      read.identifier
    );
    const asset = resolution.asset;

    // The Report hand-off carries the identifier the operator arrived with, never
    // an asset id: the Report route re-resolves it against the trusted tenant, so a
    // browser-supplied asset identifier is never authority.
    const reportHref = asset
      ? `/atiman/report?${read.identifier.type === IDENTIFIER_TYPES.QR_TOKEN ? 'token' : 'code'}=${encodeURIComponent(read.identifier.value)}`
      : null;

    return res.render('atiman/asset-context', {
      layout: 'atiman/layout',
      title: asset && asset.name ? asset.name : 'Asset',
      activeDestination: null,
      ...shell,
      state: resolution.outcome === RESOLUTION_OUTCOMES.RESOLVED ? 'RESOLVED' : 'UNRESOLVED',
      outcome: resolution.outcome,
      asset,
      reportHref
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getAssetContext, readIdentifier };
