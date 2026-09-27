/**
 * ATM-003 capability authorization primitive.
 *
 * Capability authorization answers **may this principal attempt this action**.
 * It never answers whether the action is valid: approval state machines,
 * publication admission, attribution, immutability and separation of duties
 * remain in the business services (ATM-001 governance) and are not duplicated
 * here.
 *
 * The capability set is resolved by services/capability.service.js, from the
 * database, per request. Nothing in this file reads authority from the request
 * body, query string, headers, cookies or any client-supplied value, and nothing
 * here trusts the client's presentation descriptor.
 *
 * Adoption is incremental by design: existing routes keep their current guards.
 * A route adopts `requireCapability` (or the adapter) deliberately, in a bounded
 * change, only where the capability mapping has been verified.
 */

const { resolveCapabilities } = require('../services/capability.service');

/**
 * Resolve capabilities for the request principal and attach them.
 *
 * Attached once per request. A resolution failure attaches an empty set and a
 * reason rather than throwing, so downstream guards fail closed.
 */
/**
 * Private resolution marker.
 *
 * A capability set is trusted ONLY when this module resolved it for this request.
 * `req.capabilities` is exposed for read-only consumers (the descriptor, view
 * rendering), but a guard never trusts that public property: a Set that merely
 * exists on the request — set by a stale middleware, a test double, or any future
 * code path — must not become authority. The marker is a module-private Symbol,
 * which a request body, query, header or client-supplied value cannot produce.
 */
const RESOLVED = Symbol('atiman.capabilities.resolved');

const storeResolution = (req, resolved) => {
  Object.defineProperty(req, RESOLVED, {
    value: resolved,
    enumerable: false,
    configurable: true,
    writable: true
  });
  // Public SNAPSHOT for presentation consumers. It is a separate Set, so mutating
  // it — by a view helper, a stale middleware or any future code — cannot change
  // what the guards authorize. Guards read the private resolution above and never
  // this property.
  req.capabilities = new Set(resolved.capabilities);
  req.capabilityMode = resolved.mode;
  req.capabilityReason = resolved.reason;
  return resolved.capabilities;
};

const attachCapabilities = async (req, res, next) => {
  try {
    storeResolution(req, await resolveCapabilities(req.user));
  } catch {
    storeResolution(req, { mode: null, capabilities: new Set(), reason: 'RESOLVER_ERROR' });
  }
  next();
};

/**
 * The capabilities a guard may rely on: the server-resolved set for this request,
 * or a fresh resolution. A pre-existing `req.capabilities` is ignored.
 */
const capabilitiesFor = async (req) => {
  const already = req[RESOLVED];
  if (already) return already.capabilities;

  try {
    return storeResolution(req, await resolveCapabilities(req.user));
  } catch {
    return storeResolution(req, { mode: null, capabilities: new Set(), reason: 'RESOLVER_ERROR' });
  }
};

/**
 * Require a capability to attempt an action.
 *
 * Fail-closed contract:
 *   no authenticated principal   -> 401
 *   capability not granted       -> 403
 *   resolution failed / empty    -> 403
 * A capability the vocabulary does not recognise can never be satisfied.
 */
const requireCapability = (capability) => {
  if (typeof capability !== 'string' || capability.length === 0) {
    throw new Error('requireCapability requires a capability identifier');
  }

  return async (req, res, next) => {
    if (!req.user || req.user.id === undefined || req.user.id === null) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const held = await capabilitiesFor(req);
    if (held.has(capability)) return next();

    return res.status(403).json({
      success: false,
      message: `Access denied: ${capability} is required for this action`
    });
  };
};

/** Require every capability in a list (all-or-nothing). */
const requireAllCapabilities = (...capabilities) => async (req, res, next) => {
  if (!req.user || req.user.id === undefined || req.user.id === null) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const held = await capabilitiesFor(req);
  const missing = capabilities.filter((c) => !held.has(c));
  if (missing.length === 0) return next();
  return res.status(403).json({
    success: false,
    message: `Access denied: ${missing.join(', ')} required for this action`
  });
};

/**
 * Mapping from the legacy resource/action authorization matrix to capabilities.
 *
 * Used only by routes that deliberately adopt the adapter. A pair absent from
 * this map is NOT mapped, and the adapter refuses it — an unmapped pair must
 * never be silently allowed, and must not be guessed.
 *
 * `READ_AUTHENTICATED` means the resource/action has no accountable act in the
 * ATM-003-R1 capability architecture: reading governed knowledge is not an
 * accountable act, so it requires an authenticated principal and nothing more.
 */
const READ_AUTHENTICATED = Symbol('READ_AUTHENTICATED');

const CAPABILITY_FOR_PERMISSION = Object.freeze({
  'KNOWLEDGE.REVIEW': 'knowledge.review',
  'KNOWLEDGE.APPROVE': 'knowledge.approve',
  'KNOWLEDGE.SAFETY_REVIEW': 'knowledge.safety_review',
  'KNOWLEDGE.VIEW': READ_AUTHENTICATED,
  'INSPECTIONS.SUBMIT': 'inspection.execute',
  'INSPECTIONS.VIEW': READ_AUTHENTICATED,
  'FINDINGS.CREATE': 'finding.report',
  'FINDINGS.VIEW': READ_AUTHENTICATED,
  'USERS.VIEW': 'org.user_admin',
  'USERS.CREATE': 'org.user_admin',
  'USERS.DELETE': 'org.user_admin',
  'FACILITIES.CREATE': 'org.config_admin',
  'FACILITIES.UPDATE': 'org.config_admin',
  'FACILITIES.DELETE': 'org.config_admin'
});

/**
 * Adapter: authorize a legacy resource/action pair through capabilities.
 *
 * Deliberately incomplete. `TASKS.CREATE`/`TASKS.UPDATE` — the seam through
 * which knowledge provenance and pack authoring are currently reached — are NOT
 * mapped, because mapping them requires the milestone 4 parity analysis and
 * guessing would either widen or break authority. Unmapped pairs are refused.
 */
const requirePermissionViaCapability = (resource, action) => {
  const key = `${resource}.${action}`;
  const mapped = CAPABILITY_FOR_PERMISSION[key];

  if (mapped === undefined) {
    return (req, res) => res.status(403).json({
      success: false,
      message: 'Access denied: this authorization seam is not capability-mapped'
    });
  }

  if (mapped === READ_AUTHENTICATED) {
    return (req, res, next) => {
      if (!req.user || req.user.id === undefined || req.user.id === null) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }
      return next();
    };
  }

  return requireCapability(mapped);
};

module.exports = {
  attachCapabilities,
  requireCapability,
  requireAllCapabilities,
  requirePermissionViaCapability,
  CAPABILITY_FOR_PERMISSION,
  READ_AUTHENTICATED
};
