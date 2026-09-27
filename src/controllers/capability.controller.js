/**
 * ATM-003 capability presentation descriptor.
 *
 * Supplies the browser with the capabilities of the authenticated principal so
 * the UI can decide what to PRESENT. It is not an authorization boundary and it
 * is not consulted by any server decision: every protected operation is
 * authorized by the capability guard, from the same resolver, on the server.
 *
 * The descriptor deliberately contains no authorization internals:
 *   * no profile names;
 *   * no legacy role (a role is not authority in the capability model);
 *   * no grant rows, granter identities, timestamps or revocation history;
 *   * no audit or OWNER/governance concepts;
 *   * no resolution mode (how authority was derived is not the browser's business).
 *
 * It returns the capabilities, the tenant context the capabilities apply to, and
 * a version stamp so a client can detect that its descriptor is stale.
 */

const crypto = require('crypto');
const { resolveCapabilities } = require('../services/capability.service');

/**
 * Stable stamp over the descriptor's authority content.
 *
 * A change in the effective capability set or the tenant context changes the
 * version, which is what lets a client detect staleness. It is a content stamp,
 * not a secret and not a grant identifier.
 */
const versionFor = (organizationId, capabilities) => crypto
  .createHash('sha256')
  .update(`${organizationId}|${[...capabilities].sort().join(',')}`)
  .digest('hex')
  .slice(0, 16);

/** GET /api/users/me/capabilities — presentation-only capability descriptor. */
const getMyCapabilities = async (req, res, next) => {
  try {
    if (!req.user || req.user.id === undefined || req.user.id === null) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const resolved = await resolveCapabilities(req.user);

    // Fail closed: a resolution failure presents no capabilities rather than a
    // permissive default. The browser hides gated controls; the server would
    // still deny the operation.
    const capabilities = [...resolved.capabilities].sort();

    return res.json({
      success: true,
      data: {
        capabilities,
        organization: {
          id: req.user.organization_id === undefined ? null : req.user.organization_id
        },
        version: versionFor(req.user.organization_id, capabilities),
        presentationOnly: true
      }
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getMyCapabilities, versionFor };
