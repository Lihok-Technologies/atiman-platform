'use strict';

/**
 * Shared PostgreSQL TLS policy (SEC-107 DB-TLS).
 *
 * Every `pg` connection path must apply this SAME policy so no path can
 * silently fall back to unverified or disabled TLS.
 *
 * TLS is enabled by `DB_SSL=true` or by any libpq SSL mode that implies
 * encryption (`prefer`, `require`, `verify-ca`, `verify-full`). The stricter
 * modes must never silently downgrade to plaintext:
 *   - `verify-ca` / `verify-full` explicitly request certificate verification,
 *     so they force `rejectUnauthorized: true`.
 *   - `require` / `prefer` encrypt without forcing verification; verification is
 *     then controlled by `DB_SSL_REJECT_UNAUTHORIZED` (default true).
 *
 * Returns:
 *   - `{ rejectUnauthorized: <bool> }` when TLS is enabled, or
 *   - `false` when TLS is disabled.
 */
const resolvePgSsl = () => {
  const mode = process.env.PGSSLMODE;

  if (process.env.DB_SSL === 'true') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  if (mode === 'verify-ca' || mode === 'verify-full') {
    return { rejectUnauthorized: true };
  }
  if (mode === 'require' || mode === 'prefer') {
    return { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' };
  }
  return false;
};

module.exports = { resolvePgSsl };
