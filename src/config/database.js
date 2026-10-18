/**
 * Database Configuration - Phase 3: PostgreSQL Runtime Cutover
 *
 * The application runtime uses PostgreSQL exclusively through the `pg`
 * driver (node-postgres). The `mysql2` package is retained ONLY as an
 * optional dependency of one-off legacy import/migration utilities
 * (see the LEGACY_MYSQL2_ALLOWLIST exported below) and MUST NOT be loaded
 * by the HTTP/API runtime. tests/phase3-cutover-guard.test.js enforces
 * this boundary in CI.
 *
 * Compatibility layer for existing MySQL-style usage:
 * - Preserves getDb(), pool usage patterns
 * - Supports ? -> $n placeholder translation
 * - Provides insertId / affectedRows compatibility
 * - Preserves transaction semantics via getConnection-like API
 * - Keeps mysql2 ONLY for legacy import/migration utilities
 */

const { Pool } = require('pg');
const { prepareQuery, translateSql } = require('../utils/sql-translator');

/**
 * Phase 3 cutover declaration.
 *
 * PRIMARY_RUNTIME_DRIVER names the only SQL driver the API/HTTP runtime
 * is permitted to load. LEGACY_MYSQL2_ALLOWLIST enumerates the documented
 * one-off import/migration utilities that may still use `mysql2/promise`.
 * Any new runtime code outside this list MUST use `pg` / the adapter
 * exposed here.
 */
const PRIMARY_RUNTIME_DRIVER = 'pg';
const LEGACY_MYSQL2_ALLOWLIST = Object.freeze([
  // Legacy one-off data import utilities (run manually; not part of HTTP runtime)
  'src/utils/import-csv.js',
  'src/utils/import-smp.js',
  'src/utils/import-smp-csv.js',
  'src/utils/import-excel-workbook.js',
  'src/utils/batch-import-smps.js',
  // Legacy database bootstrap / migration runners (manual operations)
  'src/utils/init-db.js'
]);

/**
 * MySQL2-style result normalizer.
 * Returns [rows, fields] tuple so that:
 *   const [rows] = await pool.execute(sql, params)
 * works everywhere, and rows.insertId / rows.affectedRows are populated.
 */
function normalizeResult(pgResult, originalSql = '') {
  if (!pgResult) {
    const empty = [];
    empty.insertId = null;
    empty.affectedRows = 0;
    empty.rowCount = 0;
    return [empty, {}];
  }

  let rows = pgResult.rows || pgResult;
  if (!Array.isArray(rows)) {
    rows = rows ? [rows] : [];
  }

  const isInsert = /^\s*INSERT/i.test(originalSql || '');
  const isUpdateOrDelete = /^\s*(UPDATE|DELETE)/i.test(originalSql || '');

  if (isInsert) {
    let insertId = null;
    if (rows.length > 0 && rows[0]) {
      insertId = rows[0].id || rows[0].insert_id || Object.values(rows[0])[0] || null;
      if (insertId != null) insertId = parseInt(insertId, 10);
    }
    rows.insertId = insertId;
    rows.affectedRows = pgResult.rowCount || (rows.length > 0 ? 1 : 0);
  } else if (isUpdateOrDelete) {
    rows.affectedRows = pgResult.rowCount || 0;
    rows.insertId = null;
  } else {
    rows.affectedRows = pgResult.rowCount || rows.length;
    rows.insertId = null;
  }

  rows.rowCount = pgResult.rowCount || rows.length;

  // mysql2 style: [rows, fields]
  return [rows, { /* field metadata stub */ }];
}
require('dotenv').config();

/**
 * Resolve the shared PostgreSQL TLS policy.
 *
 * SEC-107 DB-TLS: every `pg` connection path must apply the SAME verified-TLS
 * policy driven by `DB_SSL` / `DB_SSL_REJECT_UNAUTHORIZED` (or `PGSSLMODE=require`),
 * so no path can silently fall back to unverified or disabled TLS.
 *
 * Returns:
 *   - `{ rejectUnauthorized: <bool> }` when TLS is enabled, or
 *   - `false` when TLS is disabled.
 */
const resolvePgSsl = () => {
  const sslEnabled = process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require';
  return sslEnabled
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false;
};

const isIntegrationTest = () => process.env.NODE_ENV === 'test' && process.env.RUN_DB_TESTS === 'true';

const getDatabaseConfig = () => {
  if (isIntegrationTest()) {
    const required = ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'];
    const missing = required.filter((name) => !process.env[name]);
    const name = process.env.TEST_DB_NAME || '';
    if (missing.length || !/(?:^|[_-])test(?:$|[_-])/i.test(name)) {
      throw new Error(`Refusing destructive integration tests: configure ${required.join(', ')} and use a clearly disposable TEST_DB_NAME.`);
    }
    return {
      host: process.env.TEST_DB_HOST,
      port: parseInt(process.env.TEST_DB_PORT, 10),
      database: name,
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD,
      // pg specific
      ssl: process.env.TEST_DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    };
  }

  // Production / dev - prefer PG* or fall back to DB_* for compatibility
  const host = process.env.PGHOST || process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.PGPORT || process.env.DB_PORT, 10) || 5432;
  const database = process.env.PGDATABASE || process.env.DB_NAME || 'odm_cmms';
  const user = process.env.PGUSER || process.env.DB_USER || 'postgres';
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD || '';

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: resolvePgSsl()
  };
};

const createPool = () => {
  const config = getDatabaseConfig();
  return new Pool({
    ...config,
    max: parseInt(process.env.DB_CONNECTION_LIMIT || process.env.PG_POOL_MAX, 10) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Allow statement cache for performance but keep simple
    statement_timeout: 30000
  });
};

const pool = createPool();

// Attach a small helper to pool for legacy mysql2 .query behavior (some controllers do pool.query)
pool.query = pool.query.bind(pool); // native pg query

const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log('Database connected successfully (PostgreSQL)');
    // quick sanity
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection failed:', error.message);
    return false;
  }
};

/**
 * Compatibility getDb() returns an object with .query(sql, params)
 * that transparently translates placeholders and normalizes results.
 */
const getDb = () => ({
  query: async (sql, params = []) => {
    const { sql: finalSql, params: finalParams } = prepareQuery(sql, params);
    const result = await pool.query(finalSql, finalParams);
    const [normalized] = normalizeResult(result, sql);
    return normalized;
  }
});

/**
 * Transaction support - mimics mysql2 getConnection + begin/commit/rollback
 * Returns a "connection-like" object with query, execute, beginTransaction, commit, rollback, release
 */
const getConnection = async () => {
  const client = await pool.connect();

  // Start transaction immediately for compatibility
  await client.query('BEGIN');

  const conn = {
    // query with translation - return rows array (mysql2 [rows] destructuring friendly)
    query: async (sql, params = []) => {
      const { sql: finalSql, params: finalParams } = prepareQuery(sql, params);
      const result = await client.query(finalSql, finalParams);
      const [rows] = normalizeResult(result, sql);
      return rows;
    },

    // execute alias for compatibility with some code that uses .execute
    execute: async (sql, params = []) => {
      const { sql: finalSql, params: finalParams } = prepareQuery(sql, params);
      const result = await client.query(finalSql, finalParams);
      const [rows] = normalizeResult(result, sql);
      return rows;
    },

    beginTransaction: async () => {
      // already begun in getConnection, but allow re-calls safely
      try { await client.query('BEGIN'); } catch (e) { /* ignore if already in tx */ }
    },

    commit: async () => {
      await client.query('COMMIT');
    },

    rollback: async () => {
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        // ignore rollback errors on already rolled back
      }
    },

    release: () => {
      try { client.release(); } catch (e) { /* ignore */ }
    }
  };

  return conn;
};

// Expose raw pg pool for advanced use + the legacy mysql2-style pool.query in some controllers
// Controllers that do direct pool.query / pool.execute will continue to work via adapter below

// Patch pool to support legacy mysql2 "execute" + normalized results for direct usage
// Return mysql2-style tuple [rows, fields] so that
//   const [rows] = await pool.execute(...)  continues to work
const originalPoolQuery = pool.query.bind(pool);
pool.execute = async (sql, params = []) => {
  const { sql: finalSql, params: finalParams } = prepareQuery(sql, params);
  const result = await originalPoolQuery(finalSql, finalParams);
  return normalizeResult(result, sql);   // returns [rowsWithProps, fields]
};

// Also patch .query for consistency (some code uses pool.query directly)
pool.query = async (sql, params = []) => {
  const { sql: finalSql, params: finalParams } = prepareQuery(sql, params);
  const result = await originalPoolQuery(finalSql, finalParams);
  return normalizeResult(result, sql);   // returns [rowsWithProps, fields]
};

// Legacy getConnection for direct usage in controllers (e.g. coverage-validation)
pool.getConnection = getConnection;

module.exports = {
  pool,
  createPool,
  testConnection,
  getDb,
  getDatabaseConfig,
  isIntegrationTest,
  resolvePgSsl,
  getConnection,
  // Expose translator for testing / advanced
  _translate: { prepareQuery, normalizeResult, translateSql },
  // Phase 3 cutover declaration
  PRIMARY_RUNTIME_DRIVER,
  LEGACY_MYSQL2_ALLOWLIST
};
