#!/usr/bin/env node
/**
 * Atiman canonical PostgreSQL migration runner
 *
 * THE single authoritative production PostgreSQL migration mechanism.
 *
 * Design rules (ATM-001 M1 production migration safety):
 *
 *  - PostgreSQL only, through the existing `pg` production dependency.
 *  - Discovers migrations dynamically from database/postgresql/ using the
 *    intended naming pattern ^\d{3}_.*\.sql$, in ascending filename order.
 *    Nothing is hardcoded, so 014+ participate automatically.
 *  - Requires EXPLICIT connection configuration. There is no fallback to
 *    localhost / postgres / odm_cmms / an empty password. Missing configuration
 *    fails before any connection is opened.
 *  - Refuses to run in the repository's integration-test database mode, so it
 *    can never be redirected onto a disposable test database by mistake.
 *  - Serializes concurrent runs with a transaction-scoped advisory lock held by
 *    a dedicated connection for the whole run. A transaction-scoped lock is
 *    used deliberately: unlike a session-level advisory lock it is safe under
 *    both session and transaction connection pooling.
 *  - Applies EACH migration file atomically: BEGIN -> whole file -> COMMIT, or
 *    ROLLBACK and stop. A migration can therefore never be left half-applied,
 *    which matters for migration 013's convergence DROP/ADD pair.
 *  - Never touches database/migrations/ (legacy MySQL artifacts), never invokes
 *    the legacy MySQL runners or init-db scripts.
 *  - Forward-only. There is no down-migration and no reset path.
 *  - Never logs passwords, connection strings, URLs, or tokens.
 *
 * Exit codes:
 *   0  all discovered migrations applied successfully
 *   1  a migration failed (transaction rolled back, run stopped) or the lock
 *      could not be acquired
 *   2  configuration refused (nothing was connected, nothing was applied)
 *   3  the migration directory is missing or contains no migrations
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database', 'postgresql');

// The intended migration naming pattern, anchored so stray files (reference
// docs, backups, unnumbered SQL) can never be applied.
const MIGRATION_PATTERN = /^\d{3}_.*\.sql$/;

// Stable application-wide key, held for the whole run so two concurrent
// runners cannot apply migrations at the same time.
const MIGRATION_LOCK_KEY = 4711001001;

const EXIT_OK = 0;
const EXIT_MIGRATION_FAILED = 1;
const EXIT_CONFIG_REFUSED = 2;
const EXIT_NO_MIGRATIONS = 3;

// ------------------------------------------------------------------ configuration

/**
 * Resolve the PostgreSQL connection from explicit environment configuration.
 *
 * Intentionally does NOT reuse the application's config helper: that helper
 * supplies development defaults (localhost / postgres / odm_cmms), which is
 * exactly the silent fallback this runner must never perform.
 *
 * @returns {{config: Object|null, exitCode: number}}
 */
function resolveConfig() {
  const host = process.env.PGHOST || process.env.DB_HOST;
  const rawPort = process.env.PGPORT || process.env.DB_PORT;
  const port = parseInt(rawPort, 10) || 5432;
  const database = process.env.PGDATABASE || process.env.DB_NAME;
  const user = process.env.PGUSER || process.env.DB_USER;
  const password = process.env.PGPASSWORD || process.env.DB_PASSWORD;

  // --- test-database contamination guards, evaluated BEFORE connecting ------
  const testDbVars = Object.keys(process.env).filter((name) => name.startsWith('TEST_DB_'));
  if (testDbVars.length) {
    console.error('REFUSED: TEST_DB_* configuration is present '
      + `(${testDbVars.sort().join(', ')}).`);
    console.error('This runner is for real databases only and must never be pointed at a');
    console.error('disposable test database. Unset TEST_DB_* before running it.');
    return { config: null, exitCode: EXIT_CONFIG_REFUSED };
  }

  if (process.env.NODE_ENV === 'test') {
    console.error('REFUSED: NODE_ENV=test. This runner refuses to migrate while the process');
    console.error('declares itself a test run.');
    return { config: null, exitCode: EXIT_CONFIG_REFUSED };
  }

  if (process.env.RUN_DB_TESTS === 'true') {
    console.error('REFUSED: RUN_DB_TESTS=true. This runner refuses to migrate under the');
    console.error('integration-test opt-in.');
    return { config: null, exitCode: EXIT_CONFIG_REFUSED };
  }

  // --- explicit configuration, no defaults ---------------------------------
  const missing = [];
  if (!host) missing.push('DB_HOST (or PGHOST)');
  if (!database) missing.push('DB_NAME (or PGDATABASE)');
  if (!user) missing.push('DB_USER (or PGUSER)');
  if (!password) missing.push('DB_PASSWORD (or PGPASSWORD)');
  if (missing.length) {
    console.error(`REFUSED: missing required PostgreSQL configuration: ${missing.join(', ')}.`);
    console.error('No default host, database, user, or password is assumed.');
    return { config: null, exitCode: EXIT_CONFIG_REFUSED };
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`REFUSED: invalid PostgreSQL port: ${rawPort}`);
    return { config: null, exitCode: EXIT_CONFIG_REFUSED };
  }

  const sslEnabled = process.env.DB_SSL === 'true' || process.env.PGSSLMODE === 'require';

  return {
    exitCode: EXIT_OK,
    config: {
      host,
      port,
      database,
      user,
      password,
      ssl: sslEnabled
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
        : false,
      application_name: 'atiman-migrate-postgres'
    }
  };
}

/** Redacted target description. Never includes credentials or a DSN. */
const describeTarget = (config) => `***@${config.host}:${config.port}/${config.database}`;

// ---------------------------------------------------------------------- discovery

/**
 * Discover migration files deterministically. No migration number is hardcoded.
 * @returns {{migrations: Array|null, exitCode: number}}
 */
function discoverMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR) || !fs.statSync(MIGRATIONS_DIR).isDirectory()) {
    console.error(`ERROR: migration directory not found: database/postgresql`);
    return { migrations: null, exitCode: EXIT_NO_MIGRATIONS };
  }

  // Ascending filename order. Zero-padded three-digit prefixes sort correctly as
  // plain strings, which is why the naming pattern is enforced.
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort();

  if (files.length === 0) {
    console.error(`ERROR: no files matching ${MIGRATION_PATTERN} in database/postgresql`);
    return { migrations: null, exitCode: EXIT_NO_MIGRATIONS };
  }

  return {
    exitCode: EXIT_OK,
    migrations: files.map((name) => ({ name, fullPath: path.join(MIGRATIONS_DIR, name) }))
  };
}

// --------------------------------------------------------------------------- main

async function run() {
  const { config, exitCode: configExit } = resolveConfig();
  if (!config) return configExit;

  const { migrations, exitCode: discoveryExit } = discoverMigrations();
  if (!migrations) return discoveryExit;

  const total = migrations.length;

  console.log('Atiman PostgreSQL migration');
  console.log(`  target     : ${describeTarget(config)}`);
  console.log(`  directory  : database/postgresql`);
  console.log(`  discovered : ${total} migration(s) matching ^\\d{3}_.*\\.sql$`);
  console.log(`  order      : ${migrations.map((m) => m.name.slice(0, 3)).join(' -> ')}`);
  console.log(`  policy     : forward-only; no down-migration, no reset`);
  console.log('');

  // Connection A holds the advisory lock for the whole run. Keeping one
  // transaction open is what makes a transaction-scoped lock span the run.
  const lockClient = new Client(config);
  const applyClient = new Client(config);

  let locked = false;
  const applied = [];

  try {
    try {
      await lockClient.connect();
      // A non-zero server-side idle-in-transaction timeout could kill the lock
      // transaction mid-run, so disable it for this connection.
      try {
        await lockClient.query('SET idle_in_transaction_session_timeout = 0');
      } catch (error) {
        console.warn(`  WARNING: could not disable idle_in_transaction_session_timeout: ${error.message}`);
      }
      await lockClient.query('BEGIN');
      await lockClient.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
      locked = true;

      await applyClient.connect();
      try {
        await applyClient.query("SET statement_timeout = '15min'");
      } catch (error) {
        console.warn(`  WARNING: could not raise statement_timeout: ${error.message}`);
      }
    } catch (error) {
      console.error(`ERROR: could not acquire the migration lock: ${error.message}`);
      console.error('Nothing was applied.');
      return EXIT_MIGRATION_FAILED;
    }

    for (let index = 0; index < migrations.length; index += 1) {
      const migration = migrations[index];
      const label = `${String(index + 1).padStart(2, '0')}/${total}`;

      let sql;
      try {
        sql = fs.readFileSync(migration.fullPath, 'utf8');
      } catch (error) {
        console.error(`[${label}] FAIL reading ${migration.name}: ${error.message}`);
        return EXIT_MIGRATION_FAILED;
      }

      process.stdout.write(`[${label}] applying ${migration.name} ... `);

      try {
        // One explicit transaction per file. The whole file is sent as a single
        // simple-query message (no parameters) so PostgreSQL executes every
        // statement inside this transaction; any failure aborts all of them.
        await applyClient.query('BEGIN');
        await applyClient.query(sql);
        await applyClient.query('COMMIT');
      } catch (error) {
        console.log('FAIL');
        console.error('');
        console.error(`MIGRATION FAILED: ${migration.name}`);
        console.error(`  ${String(error.message).split('\n')[0]}`);
        try {
          await applyClient.query('ROLLBACK');
          console.error('  transaction rolled back; this file left no partial effect');
        } catch (rollbackError) {
          console.error(`  WARNING: rollback reported: ${rollbackError.message}`);
        }
        console.error('');
        console.error(`Stopped at ${label}. Later migrations were NOT attempted.`);
        console.error(`Applied before this failure: ${applied.length ? applied.join(', ') : 'none'}`);
        return EXIT_MIGRATION_FAILED;
      }

      console.log('ok');
      applied.push(migration.name);
    }

    console.log('');
    console.log(`SUCCESS: ${applied.length}/${total} migration(s) applied.`);
    console.log('Schema is up to date.');
    return EXIT_OK;
  } finally {
    // Released in the finally so the lock transaction always ends, including on
    // every early-return path above.
    try {
      if (locked) await lockClient.query('ROLLBACK');
    } catch { /* the connection may already be gone; the lock ends with it */ }
    await lockClient.end().catch(() => {});
    await applyClient.end().catch(() => {});
  }
}

run()
  .then((code) => process.exit(code))
  .catch((error) => {
    // Only the message is surfaced: never a connection string or credential.
    console.error(`ERROR: ${error.message}`);
    process.exit(EXIT_MIGRATION_FAILED);
  });
