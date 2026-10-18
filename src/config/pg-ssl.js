'use strict';

/**
 * Shared PostgreSQL TLS policy (SEC-107 DB-TLS).
 *
 * Every `pg` connection path must apply this SAME policy so no path can
 * silently fall back to unverified or disabled TLS.
 *
 * Precedence (strictest first):
 *   - `verify-ca` / `verify-full` explicitly request certificate verification,
 *     so they force `rejectUnauthorized: true` and take precedence over a
 *     permissive `DB_SSL_REJECT_UNAUTHORIZED=false`.
 *   - `DB_SSL=true` enables TLS; verification is controlled by
 *     `DB_SSL_REJECT_UNAUTHORIZED` (default true).
 *   - `require` / `prefer` enable TLS (verification per `DB_SSL_REJECT_UNAUTHORIZED`).
 *   - otherwise TLS is disabled.
 *
 * Returns:
 *   - `{ rejectUnauthorized: <bool> }` when TLS is enabled, or
 *   - `false` when TLS is disabled.
 */
const resolvePgSsl = () => {
  const mode = process.env.PGSSLMODE;

  if (mode === 'verify-ca' || mode === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  if (process.env.DB_SSL === 'true') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  if (mode === 'require' || mode === 'prefer') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  return false;
};

module.exports = { resolvePgSsl };
