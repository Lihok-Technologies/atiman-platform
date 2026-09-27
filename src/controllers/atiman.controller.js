/**
 * Atiman shell controller (ATM-002-I1).
 *
 * Composes the canonical Today view. Everything it passes to the template is
 * resolved on the server: capabilities come from the ATM-003 resolver (the same
 * authority the API enforces with), navigation is composed from those
 * capabilities, and attention items come from real product state only.
 *
 * The browser receives no authority here. It receives a rendered page and, for
 * client-side gating of future controls, the presentation descriptor — which is
 * never trusted by the server (ATM-003-R2 §2).
 */

const { resolveCapabilities } = require('../services/capability.service');
const { composeWorkNavigation } = require('../config/destinations');
const { reportedFindings, availableActions } = require('../services/today.service');

/** GET /today — the canonical authenticated work entry. */
const getToday = async (req, res, next) => {
  try {
    const resolved = await resolveCapabilities(req.user);

    // Fail closed: if authority cannot be resolved, the shell presents no
    // capability-gated destination and no capability-derived action.
    const capabilities = resolved.capabilities;
    const workNavigation = composeWorkNavigation(capabilities);

    const findings = await reportedFindings(req.user.organization_id);

    return res.render('atiman/today', {
      layout: 'atiman/layout',
      title: 'Today',
      activeDestination: 'today',
      workNavigation,
      organizationName: req.organization?.organization_name
        || req.user.organization_name
        || null,
      accountHref: '/mobile/profile',
      findings,
      actions: availableActions(capabilities).filter((action) => action.href)
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = { getToday };
