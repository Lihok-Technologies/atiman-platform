#!/usr/bin/env node
'use strict';

/**
 * Atiman PostgreSQL deployment gate
 *
 * Read-only. Asserts that the database is reachable AND that the schema is at
 * the level the running application requires.
 *
 * Why this exists: a bare connectivity check plus a table count cannot tell a
 * migration-008 database from a migration-013 one, so a stale schema would pass
 * the gate and the application would then fail at runtime on M1 code paths.
 * These assertions name the objects M1 actually needs.
 *
 * Guarantees:
 *  - READ ONLY: the session runs with default_transaction_read_only = on, so no
 *    statement here can mutate the database even by mistake.
 *  - Never a migration mechanism: it asserts, it does not apply. Schema changes
 *    belong to `npm run db:migrate:postgres`.
 *  - Exits non-zero when the schema is not compatible, which is what makes a
 *    deployment fail closed before application startup.
 */

const { Pool } = require('pg');

const sslModes = new Set(['require', 'verify-ca', 'verify-full']);
const sslEnabled = process.env.DB_SSL === 'true' || sslModes.has(process.env.PGSSLMODE);

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.PGPORT || process.env.DB_PORT, 10) || 5432,
  database: process.env.PGDATABASE || process.env.DB_NAME || 'odm_cmms',
  user: process.env.PGUSER || process.env.DB_USER || 'postgres',
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
  ssl: sslEnabled
    ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false,
  connectionTimeoutMillis: 5000
});

/**
 * The minimum schema state the current application requires.
 *
 * Deliberately semantic object assertions rather than table counts, and
 * deliberately not exhaustive: this is the smallest set that proves M1
 * compatibility. Extend it as later migrations add required objects.
 */
const REQUIRED_TABLES = [
  'users',
  'knowledge_packs',
  'knowledge_pack_versions',
  'task_template_versions',
  'task_template_step_versions',
  'knowledge_sources',
  'knowledge_source_versions',
  'knowledge_template_version_evidence'
];

const REQUIRED_COLUMNS = [
  // migration 013 — working-template governance lifecycle
  ['task_templates', 'review_state'],
  ['task_templates', 'safety_review_state'],
  ['task_templates', 'approved_content_sha'],
  // migration 013 — frozen governance attribution on published versions
  ['task_template_versions', 'reviewer_user_id'],
  ['task_template_versions', 'approver_user_id'],
  ['task_template_versions', 'approved_content_sha'],
  ['task_template_versions', 'safety_review_state']
];

/**
 * Required constraints, asserted by DEFINITION and not merely by name.
 *
 * Name-only checks are a false-positive vector: a database carrying an earlier
 * or weakened revision of a constraint still satisfies "the constraint exists"
 * while the protected invariant is not actually enforced. Each entry therefore
 * requires a semantic fragment of the constraint definition.
 */
const REQUIRED_CONSTRAINTS = [
  {
    name: 'chk_task_template_versions_requires_governance',
    description: 'a governed version cannot exist ungoverned',
    // migration 013 closure: publisher attribution is mandatory, not optional.
    mustInclude: 'published_by_user_id IS NOT NULL'
  },
  {
    name: 'chk_task_template_versions_approver_not_publisher',
    description: 'the approver must not be the publisher',
    mustInclude: 'approver_user_id <> published_by_user_id'
  }
];

// migration 013 convergence: the publisher of governed knowledge must not be
// deletable in a way that erases that attribution.
const PUBLISHER_FK = {
  name: 'fk_task_template_versions_published_by',
  confdeltype: 'r', // RESTRICT
  description: 'ON DELETE RESTRICT'
};

const DELETE_ACTIONS = { a: 'NO ACTION', r: 'RESTRICT', n: 'SET NULL', c: 'CASCADE', d: 'SET DEFAULT' };

async function smokeTest() {
  let client;

  try {
    client = await pool.connect();

    // Enforce read-only at the session level. This is a hard guarantee that
    // this gate can never mutate the database it is inspecting.
    await client.query('SET default_transaction_read_only = on');
    await client.query("SET statement_timeout = '15s'");

    await client.query('SELECT 1');

    const failures = [];

    // --- connectivity-level fixture every Atiman database must have ----------
    const usersTable = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users' AND table_type = 'BASE TABLE'
      ) AS exists
    `);
    if (!usersTable.rows[0].exists) {
      throw new Error('Required public.users table was not found. '
        + 'Apply the PostgreSQL schema with: npm run db:migrate:postgres');
    }

    // --- required tables ----------------------------------------------------
    const tables = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const presentTables = new Set(tables.rows.map((row) => row.table_name));
    for (const table of REQUIRED_TABLES) {
      if (!presentTables.has(table)) {
        failures.push(`missing table: public.${table}`);
      }
    }

    // --- required columns ---------------------------------------------------
    const columns = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const presentColumns = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const [table, column] of REQUIRED_COLUMNS) {
      // Only assert a column when its table is expected to exist, so a single
      // missing table reports as one failure rather than many.
      if (presentTables.has(table) && !presentColumns.has(`${table}.${column}`)) {
        failures.push(`missing column: ${table}.${column}`);
      }
    }

    // --- required constraints, by definition --------------------------------
    const constraints = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
    `);
    const constraintDefs = new Map(constraints.rows.map((row) => [row.conname, row.definition || '']));
    for (const constraint of REQUIRED_CONSTRAINTS) {
      if (!constraintDefs.has(constraint.name)) {
        failures.push(`missing constraint: ${constraint.name}`);
      } else if (!constraintDefs.get(constraint.name).includes(constraint.mustInclude)) {
        failures.push(`${constraint.name} does not enforce ${constraint.description}`
          + ` (definition lacks: ${constraint.mustInclude})`);
      }
    }

    // --- publisher FK convergence (delete action) ---------------------------
    const fk = await client.query(`
      SELECT confdeltype::text AS del FROM pg_constraint
      WHERE conname = $1 AND connamespace = 'public'::regnamespace
    `, [PUBLISHER_FK.name]);
    if (fk.rows.length === 0) {
      failures.push(`missing constraint: ${PUBLISHER_FK.name}`);
    } else if (fk.rows[0].del !== PUBLISHER_FK.confdeltype) {
      failures.push(`${PUBLISHER_FK.name} delete action is `
        + `${DELETE_ACTIONS[fk.rows[0].del] || fk.rows[0].del}, expected ${PUBLISHER_FK.description}`);
    }

    // --- informational counts ----------------------------------------------
    const tableCount = await client.query(`
      SELECT COUNT(*)::integer AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    const viewCount = await client.query(`
      SELECT COUNT(*)::integer AS count FROM information_schema.views
      WHERE table_schema = 'public'
    `);

    console.log(`PostgreSQL schema: ${tableCount.rows[0].count} base tables, ${viewCount.rows[0].count} views in public.`);

    if (failures.length) {
      console.error('');
      console.error(`PostgreSQL schema readiness FAILED: ${failures.length} problem(s).`);
      for (const failure of failures) console.error(`  - ${failure}`);
      console.error('');
      console.error('The database schema is older or incomplete relative to the application.');
      console.error('Apply migrations with: npm run db:migrate:postgres');
      throw new Error('Schema readiness assertion failed.');
    }

    console.log(`Schema readiness: ${REQUIRED_TABLES.length} required tables, `
      + `${REQUIRED_COLUMNS.length} required columns, ${REQUIRED_CONSTRAINTS.length} required constraints, `
      + `publisher FK ${PUBLISHER_FK.description} — all present.`);

    client.release();
    client = null;
    await pool.end();
    console.log('PostgreSQL smoke test PASSED.');
  } catch (error) {
    if (client) {
      client.release();
    }
    await pool.end().catch(() => {});
    console.error(`PostgreSQL smoke test FAILED: ${error.message}`);
    process.exit(1);
  }
}

smokeTest();
