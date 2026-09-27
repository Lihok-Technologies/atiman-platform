/**
 * Atiman application shell routes (ATM-002-I1).
 *
 * A separate router for the Atiman-native experience, so the slice does not have
 * to be threaded through the legacy mobile router and no legacy screen is
 * touched. The shell owns WORK navigation only; platform concerns (identity,
 * session, tenant context, sign-out) remain where ATM-003-R2 places them.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability.middleware');
const { getToday } = require('../controllers/atiman.controller');
const { getAssetContext } = require('../controllers/asset-context.controller');
const {
  getReport,
  postReport,
  renderReportDenied,
  REPORT_CAPABILITY
} = require('../controllers/report-capture.controller');

const router = express.Router();

/**
 * Require an authenticated session for a PAGE.
 *
 * `authenticate` answers JSON 401, which is right for the API and wrong for a
 * page. This wrapper reuses it verbatim for verification and user loading, and
 * converts an unauthenticated result into a redirect to the existing login
 * surface instead of a JSON error. Unauthenticated behaviour is unchanged: no
 * tenant data is read before the principal is established.
 */
const requireWebSession = (req, res, next) => {
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let intercepted = false;

  res.status = (code) => { if (code === 401) { intercepted = true; return res; } return originalStatus(code); };
  res.json = (body) => {
    if (intercepted) {
      const next = encodeURIComponent(req.originalUrl || '/today');
      return res.redirect(`/mobile/login?next=${next}`);
    }
    return originalJson(body);
  };

  return authenticate(req, res, () => {
    res.status = originalStatus;
    res.json = originalJson;
    next();
  });
};

/**
 * Require a capability for a PAGE.
 *
 * The DECISION is made by the canonical ATM-003 capability middleware, so there
 * is exactly one authority for what a principal may attempt and this wrapper
 * cannot drift from the API. Only the RESPONSE SHAPE is adapted: the middleware
 * answers JSON 403, which is right for the API and wrong for a page a field worker
 * may bookmark or deep-link to, so a denial is rendered as a page instead. The
 * status stays 403.
 */
const requireCapabilityPage = (capability) => (req, res, next) => {
  const guard = requireCapability(capability);
  const originalStatus = res.status.bind(res);
  const originalJson = res.json.bind(res);
  let denied = false;

  res.status = (code) => { if (code === 403) { denied = true; return res; } return originalStatus(code); };
  res.json = (body) => {
    res.status = originalStatus;
    res.json = originalJson;
    return denied ? renderReportDenied(req, res) : originalJson(body);
  };

  return guard(req, res, () => {
    res.status = originalStatus;
    res.json = originalJson;
    next();
  });
};

// Canonical authenticated work entry.
router.get('/', requireWebSession, (req, res) => res.redirect('/today'));
router.get('/today', requireWebSession, getToday);

// Asset context (ATM-002-I2C). Reached by scanning a printed label or by manual
// entry, never from navigation: asset context is not a work destination
// (ATM-002-R7 §10.1). Reading asset context is not an accountable capability act,
// so an authenticated principal with a resolved tenant is the whole requirement —
// no capability and no role is consulted here, and the trusted tenant comes from
// the session alone.
router.get('/asset', requireWebSession, getAssetContext);

// Report / observation capture (ATM-002-I2E). Recording an observation IS an
// accountable act, so both the form and the submission are gated on
// `finding.report` server-side — the presentation hiding the control is never the
// enforcement. There is no generic Observation API: this is a task-specific route
// that resolves asset context and writes through the Observation service.
router.get('/report', requireWebSession, requireCapabilityPage(REPORT_CAPABILITY), getReport);
router.post('/report', requireWebSession, requireCapabilityPage(REPORT_CAPABILITY), postReport);

module.exports = router;
