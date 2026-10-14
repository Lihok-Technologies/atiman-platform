/**
 * ATM-001-SEC-LEGACY-01-R1 - router-level sensitive-response backstop.
 *
 * Every JSON response a router that installs this guard produces passes through
 * `redactSensitiveFields` before serialisation, so credential material cannot
 * leave through a handler that forgets to sanitise explicitly - including the
 * JSON error paths, because the wrapper is installed on the response object
 * before any handler runs.
 *
 * This is DEFENCE IN DEPTH, not the primary control. The explicit, reviewable
 * projection belongs to the handler (`projectUserProfile` / `sanitizeUser` in
 * `src/utils/helpers.js`). The guard is deliberately a separate, named module so
 * it can be exercised directly by a test instead of being trusted because it is
 * present; see tests/user-credential-disclosure.test.js section F.
 *
 * It was previously an anonymous inline `router.use(...)` closure inside
 * `src/routes/user.routes.js`. It was extracted unchanged by
 * ATM-001-SEC-107-R1-CORRECTION so that (a) its behaviour is independently
 * testable and (b) a test can prove it is still WIRED INTO the users router.
 */

const { redactSensitiveFields } = require('../utils/helpers');

/**
 * Wrap `res.json` so every body this router emits is deep-redacted by name.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
const sensitiveResponseGuard = (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => sendJson(redactSensitiveFields(body));
  next();
};

module.exports = { sensitiveResponseGuard };
