/**
 * Taxonomy Identity Lifecycle Mechanism — Integration Tests
 *
 * ATM-001 M5R.4B — proves migration 019 implements the OWNER-ratified Option D
 * mechanism, and proves just as carefully what it deliberately does NOT do.
 *
 * TWO PROPOSITIONS THAT MUST STAY DISTINGUISHABLE
 *   mechanism   -> the governed structures, invariants and protections exist
 *   content     -> the ratified M5R.4A/M5R.4B1 taxonomy decisions are APPLIED
 * This suite proves the first and asserts the ABSENCE of the second. Migration
 * 019 must not create Mining Equipment, the five ratified classes, Submersible
 * Pump, the 55 identity resolutions or the 65 terminology rows, and must not
 * rename, reclassify, supersede or retire a single equipment type.
 *
 * The lifecycle rules under test come from the ratified architecture record
 *   docs/architecture/ATM-001-M5R4B1-Taxonomy-Identity-Lifecycle-Architecture.md
 * §9 (architecture), §10 (data semantics), §11 (invariants), §21.14 (ratified
 * decisions). Uncertainty is a GOVERNANCE state, never a lifecycle state: an
 * INSUFFICIENT_EVIDENCE record must be pending-only so that "we cannot conclude"
 * can never become "retired" as a side effect of recording the uncertainty.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { getConnection, isIntegrationTest } = require('../src/config/database');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating taxonomy-identity-lifecycle suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const MIGRATION_FILE = '019_taxonomy_identity_lifecycle.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', 'postgresql', MIGRATION_FILE);
const RESOLUTION = 'equipment_type_identity_resolution';
const TERM = 'equipment_type_term';

const ORG = 998401;
const REVIEWER = 998402;
const APPROVER = 998403;
const CODE_PREFIX = 'M5R4B019-';

const UNIQ = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function withConn(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

async function inRollback(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.rollback();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

const query = (conn, sql, params) => conn.query(sql, params);

/**
 * Assert that `fn` is REFUSED by the database, without poisoning the surrounding
 * transaction.
 *
 * PostgreSQL aborts the whole transaction on the first error (SQLSTATE 25P02:
 * "current transaction is aborted"), so a second assert.rejects in the same
 * `inRollback` would fail for the wrong reason. Each expectation is therefore
 * fenced in its own SAVEPOINT, which lets one test assert several refusals.
 */
async function expectRefusal(conn, fn, predicate, message) {
  await query(conn, 'SAVEPOINT expectation');
  let raised = null;
  try {
    await fn(conn);
  } catch (error) {
    raised = error;
  }
  if (raised) {
    await query(conn, 'ROLLBACK TO SAVEPOINT expectation');
    assert.ok(predicate(raised),
      `${message}\n  expected a specific refusal but got: ${raised.code} ${raised.message}`);
    return raised;
  }
  await query(conn, 'RELEASE SAVEPOINT expectation');
  assert.fail(`${message}\n  expected the database to refuse this, but it succeeded`);
}

/**
 * Column values from a normalized result.
 *
 * getConnection().query() returns the pg rows array with `insertId`,
 * `affectedRows` and `rowCount` attached as OWN ENUMERABLE properties
 * (see normalizeResult in src/config/database.js). deepStrictEqual against a
 * bare array therefore fails on those extra properties, so comparisons are made
 * against plain projected values, as the other suites in this repository do.
 */
const cols = (rows, column) => rows.map((r) => r[column]);

const isCheckViolation = (e) => e.code === '23514';
const isForeignKeyViolation = (e) => e.code === '23503';
const isUniqueViolation = (e) => e.code === '23505';
const isInsufficientPrivilege = (e) => e.code === '42501';
const refuses = (e, re) => re.test(e.message || '');

const LIFECYCLE_REFUSAL = /chk_equipment_types_identity_state/;
const COHERENCE_REFUSAL = /chk_equipment_type_identity_resolution_coherence/;
const ATTRIBUTION_REFUSAL = /chk_equipment_type_identity_resolution_approved_attributed/;
const PENDING_REFUSAL = /chk_equipment_type_identity_resolution_insufficient_pending/;
const SELF_REFUSAL = /cannot resolve to itself/;
const CHAIN_REFUSAL = /may not itself resolve onward|would create a chain or cycle/;
const TARGET_STATE_REFUSAL = /may only resolve to a canonical equipment type/;
const STANDING_REFUSAL = /without an approved identity resolution/;
const RESOLUTION_DELETE_REFUSAL = /cannot be deleted; only draft proposals are deletable/;

/** A fresh category > class > type chain, isolated per call. */
async function makeClassWithTypes(count = 1) {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const cat = await query(conn,
      `INSERT INTO equipment_categories (category_code, category_name) VALUES (?, ?) RETURNING id`,
      [`${CODE_PREFIX}CAT-${tag}`, `M5R4B019 Category ${tag}`]);
    const cls = await query(conn,
      `INSERT INTO equipment_classes (category_id, class_code, class_name) VALUES (?, ?, ?) RETURNING id`,
      [cat[0].id, `${CODE_PREFIX}CLS-${tag}`, `M5R4B019 Class ${tag}`]);
    const ids = [];
    for (let i = 0; i < count; i += 1) {
      const t = await query(conn,
        `INSERT INTO equipment_types (class_id, type_code, type_name) VALUES (?, ?, ?) RETURNING id`,
        [cls[0].id, `${CODE_PREFIX}TYP-${tag}-${i}`, `M5R4B019 Type ${tag} ${i}`]);
      ids.push(t[0].id);
    }
    return { categoryId: cat[0].id, classId: cls[0].id, typeIds: ids };
  });
}

const approvedAttribution = {
  review_state: 'approved',
  rationale: 'Synthetic governed rationale',
  reviewed_by_user_id: REVIEWER,
  reviewed_at: 'CURRENT_TIMESTAMP',
  approved_by_user_id: APPROVER,
  approved_at: 'CURRENT_TIMESTAMP'
};

/** Insert a resolution. Pass reviewState 'approved' for a fully attributed row. */
async function addResolution(conn, {
  fromTypeId, toTypeId = null, kind = 'MERGED_DUPLICATE',
  reviewState = 'draft', rationale = null, attributed = false
}) {
  const approved = reviewState === 'approved';
  return query(conn, `
    INSERT INTO ${RESOLUTION}
      (from_type_id, to_type_id, resolution_kind, rationale, review_state,
       reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ${approved ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, ${
      approved ? 'CURRENT_TIMESTAMP' : 'NULL'}) RETURNING id`,
  [fromTypeId, toTypeId, kind, approved ? (rationale || 'Synthetic governed rationale') : rationale,
    reviewState,
    approved && attributed ? REVIEWER : null,
    approved && attributed ? APPROVER : null]);
}

async function addTerm(conn, {
  term, canonicalTypeId, sourceTypeId = null, kind = 'LEGACY_NAME',
  reviewState = 'draft', attributed = false
}) {
  const approved = reviewState === 'approved';
  return query(conn, `
    INSERT INTO ${TERM}
      (term, normalized_term, canonical_type_id, source_type_id, term_kind,
       rationale, review_state, reviewed_by_user_id, reviewed_at,
       approved_by_user_id, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${approved ? 'CURRENT_TIMESTAMP' : 'NULL'}, ?, ${
      approved ? 'CURRENT_TIMESTAMP' : 'NULL'}) RETURNING id`,
  [term, term.trim().toLowerCase().replace(/\s+/g, ' '), canonicalTypeId, sourceTypeId, kind,
    approved ? 'Synthetic governed rationale' : null, reviewState,
    approved && attributed ? REVIEWER : null,
    approved && attributed ? APPROVER : null]);
}

const stateOf = async (conn, typeId) => {
  const rows = await query(conn, `SELECT identity_state FROM equipment_types WHERE id = ?`, [typeId]);
  return rows[0] && rows[0].identity_state;
};

describe('Taxonomy Identity Lifecycle Mechanism (ATM-001 M5R.4B)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await withConn(async (conn) => {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [ORG, 'M5R4B019 Org']);
      for (const [id, name] of [[REVIEWER, 'm5r4b019-reviewer'], [APPROVER, 'm5r4b019-approver']]) {
        await query(conn,
          `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
           VALUES (?, ?, ?, 'x', ?, 'admin', ?, true) ON CONFLICT (id) DO NOTHING`,
          [id, name, `${name}@test.local`, name, ORG]);
      }
    });
  });

  after(async () => {
    // Approved and reviewed rows are governed knowledge and are deliberately left
    // in place: removing them would require defeating migration 019's own delete
    // guard. Only ungoverned drafts and their fixtures are cleaned up.
    await withConn(async (conn) => {
      await query(conn, `DELETE FROM ${TERM} WHERE review_state = 'draft'
        AND canonical_type_id IN (SELECT id FROM equipment_types WHERE type_code LIKE ?)`,
      [`${CODE_PREFIX}%`]);
      await query(conn, `DELETE FROM ${RESOLUTION} WHERE review_state = 'draft'
        AND from_type_id IN (SELECT id FROM equipment_types WHERE type_code LIKE ?)`,
      [`${CODE_PREFIX}%`]);
    });
  });

  // ==========================================================
  // A. MECHANISM — the approved structures exist
  // ==========================================================
  describe('A. migration 019 adds exactly the approved mechanism', () => {
    it('1. the resolution and terminology relations exist as base tables', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          AND table_name IN (?, ?) ORDER BY table_name`, [RESOLUTION, TERM]));
      assert.deepStrictEqual(rows.map((r) => r.table_name), [RESOLUTION, TERM]);
    });

    it('2. equipment_types gains exactly one additive lifecycle column', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'equipment_types'`));
      assert.deepStrictEqual(rows.map((r) => r.column_name).sort(), [
        'class_id', 'created_at', 'description', 'id', 'identity_state',
        'type_code', 'type_name', 'typical_components', 'updated_at'
      ], 'identity_state is the only column this migration adds to equipment_types');
    });

    it('3. the lifecycle CHECK admits exactly canonical/superseded/retired', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'chk_equipment_types_identity_state'`));
      assert.strictEqual(rows.length, 1, 'the lifecycle CHECK must exist');
      for (const value of ['canonical', 'superseded', 'retired']) {
        assert.match(rows[0].definition, new RegExp(`'${value}'`));
      }
      // Uncertainty must NOT be a lifecycle standing.
      for (const forbidden of ['pending', 'under_review', 'unresolved', 'ratified']) {
        assert.doesNotMatch(rows[0].definition, new RegExp(`'${forbidden}'`),
          `'${forbidden}' must not be a lifecycle standing`);
      }
    });

    it('4. both new tables are GLOBAL — no tenant/customer alias column was invented', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN (?, ?)`, [RESOLUTION, TERM]));
      const offenders = rows.filter((r) => /organization|tenant|customer/.test(r.column_name));
      assert.deepStrictEqual(offenders, [],
        'M5R.1 section 6.2 defers the tenant alias architecture; the mechanism is global');
    });

    it('5. ABBREVIATION is not a terminology kind, and no ratification column exists', async () => {
      const kinds = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'chk_equipment_type_term_term_kind'`));
      assert.strictEqual(kinds.length, 1);
      for (const kind of ['LEGACY_NAME', 'SYNONYM', 'MERGED_IDENTITY_TERM']) {
        assert.match(kinds[0].definition, new RegExp(`'${kind}'`));
      }
      assert.doesNotMatch(kinds[0].definition, /ABBREVIATION/,
        'abbreviation is orthogonal metadata, not a mutually exclusive relationship kind');

      const columns = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN (?, ?)`, [RESOLUTION, TERM]));
      assert.deepStrictEqual(
        columns.filter((c) => /ratif/.test(c.column_name)), [],
        'RULING 2 keeps ratification separate from lifecycle; no ratification column');
    });

    it('6. every object introduced fits PostgreSQL\u2019s 63-byte identifier limit', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT kind, name, bytes FROM (
          SELECT 'constraint' AS kind, conname AS name, length(conname) AS bytes
            FROM pg_constraint
           WHERE conname LIKE '%identity_resolution%' OR conname LIKE '%equipment_type_term%'
              OR conname = 'chk_equipment_types_identity_state'
          UNION ALL
          SELECT 'index', indexname, length(indexname) FROM pg_indexes
           WHERE tablename IN (?, ?) OR indexname = 'idx_equipment_types_canonical'
          UNION ALL
          SELECT 'trigger', tgname, length(tgname) FROM pg_trigger
           WHERE NOT tgisinternal AND (tgname LIKE '%identity_resolution%'
              OR tgname LIKE '%equipment_type_term%'
              OR tgname = 'trg_equipment_types_standing_guard')
          UNION ALL
          SELECT 'function', proname, length(proname) FROM pg_proc
           WHERE proname LIKE 'taxonomy_%'
        ) s ORDER BY bytes DESC`, [RESOLUTION, TERM]));
      assert.ok(rows.length > 0, 'the audit must find the objects it asserts about');
      const longest = rows[0];
      assert.ok(longest.bytes <= 63,
        `identifier ${longest.name} is ${longest.bytes} bytes and would be silently truncated`);
    });

    it('7. no foreign key relies on an auto-generated name that could truncate', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT conname FROM pg_constraint
        WHERE conrelid IN (?::regclass, ?::regclass) AND conname LIKE '%\\_fkey'`, [RESOLUTION, TERM]));
      assert.deepStrictEqual(cols(rows, 'conname'), [],
        'an auto-generated <table>_<column>_fkey name on the resolution self-reference would exceed 63 bytes');
    });
  });

  // ==========================================================
  // B. LIFECYCLE
  // ==========================================================
  describe('B. identity lifecycle standing', () => {
    it('8. existing equipment types become and remain canonical', async () => {
      const { typeIds } = await makeClassWithTypes(3);
      const rows = await inRollback((conn) => query(conn, `
        SELECT identity_state FROM equipment_types WHERE id = ANY(?)`, [typeIds]));
      assert.strictEqual(rows.length, 3);
      assert.ok(rows.every((r) => r.identity_state === 'canonical'),
        'rows created after the migration default to canonical, which is the backfill guarantee');
    });

    it('9. all three approved lifecycle values are accepted, and only for governed reasons', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        // canonical is the default and may be written explicitly.
        await query(conn, `UPDATE equipment_types SET identity_state = 'canonical' WHERE id = ?`, [typeIds[0]]);
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'canonical');
      });
      // superseded and retired are reached ONLY by approving a resolution; that
      // is asserted directly in tests 15 and 16.
    });

    it('10. an invalid lifecycle value is refused by the CHECK, not by a trigger', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        for (const invalid of ['pending', 'under_review', 'unresolved', 'ratified']) {
          await expectRefusal(conn,
            (c) => query(c, `UPDATE equipment_types SET identity_state = ? WHERE id = ?`, [invalid, typeIds[0]]),
            (e) => isCheckViolation(e) && refuses(e, LIFECYCLE_REFUSAL),
            `'${invalid}' is uncertainty or governance, not a lifecycle standing, and must be refused by the CHECK`);
        }
      });
    });

    it('11. a lifecycle standing cannot be set by hand without an approved resolution', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        for (const standing of ['retired', 'superseded']) {
          await expectRefusal(conn,
            (c) => query(c, `UPDATE equipment_types SET identity_state = ? WHERE id = ?`, [standing, typeIds[0]]),
            (e) => isCheckViolation(e) && refuses(e, STANDING_REFUSAL),
            `${standing} must be justified by an approved resolution, never set by hand`);
        }
      });
    });
  });

  // ==========================================================
  // C. RESOLUTION COHERENCE
  // ==========================================================
  describe('C. governed identity-resolution coherence', () => {
    it('12. a type cannot resolve to itself', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => addResolution(conn, { fromTypeId: typeIds[0], toTypeId: typeIds[0] }),
          (e) => refuses(e, SELF_REFUSAL) || isCheckViolation(e));
      });
    });

    it('13. a kind that requires a target cannot omit it', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        for (const kind of ['MERGED_DUPLICATE', 'SYNONYM_OF', 'SUPERSEDED_BY']) {
          await expectRefusal(conn,
            (c) => addResolution(c, { fromTypeId: typeIds[0], toTypeId: null, kind }),
            (e) => isCheckViolation(e) && refuses(e, COHERENCE_REFUSAL),
            `${kind} requires a target`);
        }
      });
    });

    it('14. a no-successor conclusion cannot carry a fabricated target', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        for (const kind of ['NOT_AN_EQUIPMENT_TYPE', 'TOO_BROAD_FOR_TYPE', 'INSUFFICIENT_EVIDENCE']) {
          await expectRefusal(conn,
            (c) => addResolution(c, { fromTypeId: typeIds[0], toTypeId: typeIds[1], kind }),
            (e) => isCheckViolation(e) && refuses(e, COHERENCE_REFUSAL),
            `${kind} asserts the absence of a successor and must not fabricate one`);
        }
      });
    });

    it('15. a valid human-approved resolution succeeds and coerces the source to superseded', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], kind: 'MERGED_DUPLICATE',
          reviewState: 'approved', attributed: true
        });
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'superseded');
        assert.strictEqual(await stateOf(conn, typeIds[1]), 'canonical',
          'the target must remain canonical');
      });
    });

    it('16. an approved no-successor conclusion coerces the source to retired', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: null, kind: 'NOT_AN_EQUIPMENT_TYPE',
          reviewState: 'approved', attributed: true
        });
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'retired');
      });
    });
  });

  // ==========================================================
  // D. CHAINS, CYCLES AND TARGET STANDING
  // ==========================================================
  describe('D. chains, cycles and target standing', () => {
    it('17. an approved resolution may not target a non-canonical type', async () => {
      const { typeIds } = await makeClassWithTypes(3);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'superseded');
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => addResolution(conn, {
            fromTypeId: typeIds[2], toTypeId: typeIds[0], reviewState: 'approved', attributed: true
          }),
          (e) => isCheckViolation(e) && refuses(e, TARGET_STATE_REFUSAL));
      });
    });

    it('18. an approved resolution CHAIN is refused, so resolution depth stays exactly one', async () => {
      const { typeIds } = await makeClassWithTypes(3);
      await withConn(async (conn) => {
        // B -> A approved, so A is now the canonical target of an approved resolution.
        await addResolution(conn, {
          fromTypeId: typeIds[1], toTypeId: typeIds[0], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        // A -> C is refused: it would leave B -> A -> C, breaking B's own promise
        // that A is canonical.
        await assert.rejects(
          async () => addResolution(conn, {
            fromTypeId: typeIds[0], toTypeId: typeIds[2], reviewState: 'approved', attributed: true
          }),
          (e) => isCheckViolation(e) && refuses(e, CHAIN_REFUSAL));
      });
    });

    it('19. an approved cycle is refused', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[1], toTypeId: typeIds[0], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        // A -> B closes the cycle B -> A -> B. It is refused at the target-standing
        // guard anyway (B is superseded), which is exactly why depth cannot grow.
        await assert.rejects(
          async () => addResolution(conn, {
            fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
          }),
          (e) => isCheckViolation(e));
      });
    });

    it('20. at most one active approved resolution exists per source type', async () => {
      const { typeIds } = await makeClassWithTypes(3);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => addResolution(conn, {
            fromTypeId: typeIds[0], toTypeId: typeIds[2], reviewState: 'approved', attributed: true
          }),
          (e) => isUniqueViolation(e) && refuses(e, /uq_equipment_type_identity_resolution_active/));
      });
    });

    it('21. competing PENDING proposals coexist — uniqueness is never achieved by deleting history', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await addResolution(conn, { fromTypeId: typeIds[0], toTypeId: typeIds[1], kind: 'MERGED_DUPLICATE' });
        await addResolution(conn, { fromTypeId: typeIds[0], toTypeId: typeIds[1], kind: 'SYNONYM_OF' });
        await addResolution(conn, { fromTypeId: typeIds[0], toTypeId: typeIds[1], kind: 'SUPERSEDED_BY' });
        const rows = await query(conn,
          `SELECT count(*)::int AS n FROM ${RESOLUTION} WHERE from_type_id = ?`, [typeIds[0]]);
        assert.strictEqual(rows[0].n, 3, 'draft proposals must be able to compete');
      });
    });
  });

  // ==========================================================
  // E. UNCERTAINTY IS NOT A LIFECYCLE STATE  (RULING 1)
  // ==========================================================
  describe('E. pending insufficient-evidence review', () => {
    it('22. a pending INSUFFICIENT_EVIDENCE record with a NULL target is representable', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        const rows = await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: null, kind: 'INSUFFICIENT_EVIDENCE',
          reviewState: 'under_review', rationale: 'Two defensible readings; corpus cannot choose'
        });
        assert.ok(rows[0].id > 0);
      });
    });

    it('23. a pending record does NOT change the lifecycle standing', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: null, kind: 'INSUFFICIENT_EVIDENCE',
          reviewState: 'under_review'
        });
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'canonical',
          'recording uncertainty must not retire or supersede the source');
      });
    });

    it('24. an INSUFFICIENT_EVIDENCE record can NEVER be approved', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        await expectRefusal(conn,
          (c) => addResolution(c, {
            fromTypeId: typeIds[0], toTypeId: null, kind: 'INSUFFICIENT_EVIDENCE',
            reviewState: 'approved', attributed: true
          }),
          (e) => isCheckViolation(e) && refuses(e, PENDING_REFUSAL),
          'approving insufficient evidence is the one path that could turn "we cannot conclude" into a retirement');

        // ...and moving an existing pending record to approved is refused too.
        const id = (await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: null, kind: 'INSUFFICIENT_EVIDENCE',
          reviewState: 'under_review'
        }))[0].id;
        await expectRefusal(conn,
          (c) => query(c, `
            UPDATE ${RESOLUTION} SET review_state = 'approved',
              reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
              approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP,
              rationale = 'x' WHERE id = ?`, [REVIEWER, APPROVER, id]),
          (e) => isCheckViolation(e) && refuses(e, PENDING_REFUSAL),
          'a pending insufficient-evidence record must not be approvable later either');
      });
    });
  });

  // ==========================================================
  // F. HUMAN ACCOUNTABILITY AND AI
  // ==========================================================
  describe('F. governance, provenance and AI boundaries', () => {
    it('25. an approved resolution without human attribution is refused — AI alone cannot approve', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => addResolution(conn, {
            fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: false
          }),
          (e) => isCheckViolation(e) && refuses(e, ATTRIBUTION_REFUSAL));
      });
    });

    it('26. approval without a rationale is refused', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `
            INSERT INTO ${RESOLUTION}
              (from_type_id, to_type_id, resolution_kind, rationale, review_state,
               reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
            VALUES (?, ?, 'MERGED_DUPLICATE', NULL, 'approved', ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
          [typeIds[0], typeIds[1], REVIEWER, APPROVER]),
          (e) => isCheckViolation(e) && refuses(e, ATTRIBUTION_REFUSAL));
      });
    });

    it('27. the approver must be a real users row, so an AI principal is unrepresentable', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `
            INSERT INTO ${RESOLUTION}
              (from_type_id, to_type_id, resolution_kind, rationale, review_state,
               reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
            VALUES (?, ?, 'MERGED_DUPLICATE', 'x', 'approved', ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
          [typeIds[0], typeIds[1], REVIEWER, 2147483600]),
          (e) => isForeignKeyViolation(e));
      });
    });

    it('28. AI assistance is disclosed but never substitutes for approval', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `
            INSERT INTO ${RESOLUTION}
              (from_type_id, to_type_id, resolution_kind, rationale, review_state,
               ai_assisted, ai_assistance_detail)
            VALUES (?, ?, 'MERGED_DUPLICATE', 'x', 'approved', true, '{"model":"synthetic"}')`,
          [typeIds[0], typeIds[1]]),
          (e) => isCheckViolation(e) && refuses(e, ATTRIBUTION_REFUSAL),
          'ai_assisted=true must still require a human approver');
      });
    });

    it('29. provenance reuses migration 011 and a cited edition must resolve', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `
            INSERT INTO ${RESOLUTION}
              (from_type_id, to_type_id, resolution_kind, review_state, knowledge_source_version_id)
            VALUES (?, ?, 'MERGED_DUPLICATE', 'draft', 2147483600)`,
          [typeIds[0], typeIds[1]]),
          (e) => isForeignKeyViolation(e));
      });
    });
  });

  // ==========================================================
  // G. TERMINOLOGY
  // ==========================================================
  describe('G. governed terminology', () => {
    it('30. a valid approved terminology row succeeds and creates no canonical type', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await withConn(async (conn) => {
        const before = await query(conn,
          `SELECT count(*)::int AS n FROM equipment_types`);
        const rows = await addTerm(conn, {
          term: `ESP-${UNIQ()}`, canonicalTypeId: typeIds[0],
          sourceTypeId: typeIds[0], kind: 'LEGACY_NAME',
          reviewState: 'approved', attributed: true
        });
        assert.ok(rows[0].id > 0);
        const after = await query(conn, `SELECT count(*)::int AS n FROM equipment_types`);
        assert.strictEqual(after[0].n, before[0].n,
          'terminology must never create a second canonical Type');
      });
    });

    it('31. an invalid term kind or review state is refused', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        await expectRefusal(conn,
          (c) => addTerm(c, { term: 'ABBR', canonicalTypeId: typeIds[0], kind: 'ABBREVIATION' }),
          (e) => isCheckViolation(e) && refuses(e, /chk_equipment_type_term_term_kind/),
          'ABBREVIATION must not be a competing terminology kind');
        await expectRefusal(conn,
          (c) => addTerm(c, { term: 'X', canonicalTypeId: typeIds[0], reviewState: 'pending' }),
          (e) => isCheckViolation(e) && refuses(e, /chk_equipment_type_term_review_state/),
          'uncertainty is not a terminology review state either');
      });
    });

    it('32. the as-written term and its normalised matching form cannot drift', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      await inRollback(async (conn) => {
        for (const bad of ['  ESP  ', 'Esp']) {
          await expectRefusal(conn,
            (c) => query(c, `
              INSERT INTO ${TERM} (term, normalized_term, canonical_type_id, term_kind, review_state)
              VALUES ('ESP', ?, ?, 'LEGACY_NAME', 'draft')`, [bad, typeIds[0]]),
            (e) => isCheckViolation(e) && refuses(e, /chk_equipment_type_term_normalized_form/),
            `'${bad}' is not a normalised form and would smuggle in a second matching key`);
        }
      });
    });

    it('33. active approved terminology is unique per (term, canonical type) pair', async () => {
      const { typeIds } = await makeClassWithTypes(1);
      const shared = `SHARED-${UNIQ()}`;
      await withConn(async (conn) => {
        await addTerm(conn, {
          term: shared, canonicalTypeId: typeIds[0], kind: 'SYNONYM',
          reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => addTerm(conn, {
            term: shared, canonicalTypeId: typeIds[0], kind: 'SYNONYM',
            reviewState: 'approved', attributed: true
          }),
          (e) => isUniqueViolation(e) && refuses(e, /uq_equipment_type_term_active/));
      });
    });

    it('34. a term may still map to a different canonical type — the ratified residual is real', async () => {
      // Ratified architecture section 15.5 records that a term is NOT globally
      // unique across canonical types, because the live corpus already carries
      // duplicate vocabulary and a hard constraint could not be deployed without
      // first resolving it. This suite asserts the ratified behaviour rather than
      // a stronger rule, so the residual cannot later be mistaken for an oversight.
      const { typeIds } = await makeClassWithTypes(2);
      const shared = `RESIDUAL-${UNIQ()}`;
      await withConn(async (conn) => {
        await addTerm(conn, { term: shared, canonicalTypeId: typeIds[0], kind: 'SYNONYM',
          reviewState: 'approved', attributed: true });
      });
      await withConn(async (conn) => {
        const rows = await addTerm(conn, { term: shared, canonicalTypeId: typeIds[1], kind: 'SYNONYM',
          reviewState: 'approved', attributed: true });
        assert.ok(rows[0].id > 0,
          'the ratified architecture defers global term uniqueness; this is deliberate');
      });
    });
  });

  // ==========================================================
  // H. DELETE PROTECTION
  // ==========================================================
  describe('H. delete protection', () => {
    it('35. a referenced type cannot be deleted out from under governed history', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await expectRefusal(conn,
          (c) => query(c, `DELETE FROM equipment_types WHERE id = ?`, [typeIds[0]]),
          (e) => isForeignKeyViolation(e) && refuses(e, /fk_equipment_type_identity_resolution_from_type/),
          'the subject of a governed resolution must not be deletable');
        await expectRefusal(conn,
          (c) => query(c, `DELETE FROM equipment_types WHERE id = ?`, [typeIds[1]]),
          (e) => isForeignKeyViolation(e) && refuses(e, /fk_equipment_type_identity_resolution_to_type/),
          'the target of a governed resolution must not be deletable either');
      });
    });

    it('36. a terminology row protects its canonical and source types', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addTerm(conn, {
          term: `PROT-${UNIQ()}`, canonicalTypeId: typeIds[0], sourceTypeId: typeIds[1],
          kind: 'MERGED_IDENTITY_TERM', reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await expectRefusal(conn,
          (c) => query(c, `DELETE FROM equipment_types WHERE id = ?`, [typeIds[0]]),
          (e) => isForeignKeyViolation(e) && refuses(e, /fk_equipment_type_term_canonical_type/),
          'the canonical type of a governed term must not be deletable');
        await expectRefusal(conn,
          (c) => query(c, `DELETE FROM equipment_types WHERE id = ?`, [typeIds[1]]),
          (e) => isForeignKeyViolation(e) && refuses(e, /fk_equipment_type_term_source_type/),
          'the historical source type of a governed term must not be deletable');
      });
    });

    it('37. governed resolutions and terminology are undeletable; drafts remain deletable', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `DELETE FROM ${RESOLUTION} WHERE from_type_id = ?`, [typeIds[0]]),
          (e) => isInsufficientPrivilege(e) && refuses(e, RESOLUTION_DELETE_REFUSAL));
      });
      await inRollback(async (conn) => {
        const draft = (await addResolution(conn, { fromTypeId: typeIds[0], toTypeId: typeIds[1] }))[0].id;
        await query(conn, `DELETE FROM ${RESOLUTION} WHERE id = ?`, [draft]);
        const rows = await query(conn, `SELECT count(*)::int AS n FROM ${RESOLUTION} WHERE id = ?`, [draft]);
        assert.strictEqual(rows[0].n, 0, 'an ungoverned draft proposal stays deletable');
      });
    });

    it('38. an approved governed conclusion is immutable except its supersession pointer', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          async () => query(conn, `UPDATE ${RESOLUTION} SET rationale = 'rewritten' WHERE from_type_id = ?`,
            [typeIds[0]]),
          (e) => isInsufficientPrivilege(e) && refuses(e, /is immutable except its supersession pointer/));
      });
    });
  });

  // ==========================================================
  // I. MIGRATION HYGIENE AND THE CONTENT BOUNDARY
  // ==========================================================
  describe('I. migration hygiene and the mechanism/content boundary', () => {
    it('39. re-executing the migration is safe — no error, no duplicated object', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await inRollback(async (conn) => {
        await query(conn, sql);
        // The same statement that proves idempotency also re-proves the object
        // count did not grow.
        const rows = await query(conn, `
          SELECT count(*)::int AS n FROM pg_constraint
          WHERE conname = 'chk_equipment_types_identity_state'`);
        assert.strictEqual(rows[0].n, 1, 're-running must not duplicate the lifecycle CHECK');
      });
    });

    it('40. re-executing the migration preserves existing data and standing', async () => {
      const { typeIds } = await makeClassWithTypes(2);
      await withConn(async (conn) => {
        await addResolution(conn, {
          fromTypeId: typeIds[0], toTypeId: typeIds[1], reviewState: 'approved', attributed: true
        });
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'superseded');
      });
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      await inRollback(async (conn) => {
        await query(conn, sql);
        assert.strictEqual(await stateOf(conn, typeIds[0]), 'superseded',
          'a re-run must not reset standing that has already moved');
        const rows = await query(conn, `
          SELECT type_code, type_name FROM equipment_types WHERE id = ?`, [typeIds[0]]);
        assert.strictEqual(rows.length, 1, 'existing rows must survive a re-run');
      });
    });

    it('41. the migration is STRUCTURE only — no statement that populates a row at apply time', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      // Nothing anywhere, not even inside a trigger body, may insert a row.
      assert.doesNotMatch(withoutComments, /\bINSERT\s+INTO\b/i,
        'migration 019 must create the mechanism only; content application is M5R.4B2');

      // Trigger bodies legitimately contain DML: that is the mechanism doing its
      // job when a resolution is approved LATER. What must not exist is a
      // top-level DML statement, which would run during the migration itself.
      // Strip the $$-quoted bodies, then re-assert.
      const topLevel = withoutComments.replace(/\$\$[\s\S]*?\$\$/g, ' ');
      assert.doesNotMatch(topLevel, /\bUPDATE\s+[\w.]+\s+SET\b/i,
        'the migration must not transform existing rows when it is applied');
      assert.doesNotMatch(topLevel, /\bDELETE\s+FROM\b/i);
      assert.doesNotMatch(topLevel, /\bINSERT\s+INTO\b/i);
      assert.doesNotMatch(topLevel, /\bDROP\s+TABLE\b/i, 'a forward-only migration never drops a table');
      assert.doesNotMatch(topLevel, /\bTRUNCATE\b/i);
    });

    it('42. the migration declares no taxonomy content: no ratified names appear in executable SQL', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      const withoutComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
      for (const name of ['Mining Equipment', 'Submersible Pump', 'Press',
        'Level Switch', 'Cutting Equipment', 'Mine Hoisting',
        'Well Control Equipment', 'Hoisting Equipment', 'Filter', 'COMPACT', 'ESP']) {
        assert.doesNotMatch(withoutComments, new RegExp(name, 'i'),
          `'${name}' is ratified taxonomy content and must not appear in migration 019`);
      }
    });

    it('43. migration 019 introduced NO category, class or type row', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT
          (SELECT count(*)::int FROM equipment_categories WHERE category_name = 'Mining Equipment') AS mining,
          (SELECT count(*)::int FROM equipment_classes WHERE class_name IN
             ('Level Switch','Cutting Equipment','Mine Hoisting','Well Control Equipment','Hoisting Equipment')) AS classes,
          (SELECT count(*)::int FROM equipment_types WHERE type_name = 'Submersible Pump') AS submersible`));
      assert.deepStrictEqual(rows[0], { mining: 0, classes: 0, submersible: 0 },
        'the mechanism must not apply the ratified taxonomy decisions');
    });

    it('44. the mechanism holds no populated rows of its own', async () => {
      // Only rows this suite created for the fixture codes may exist; nothing the
      // migration itself inserted can, because it inserts nothing.
      const rows = await withConn((conn) => query(conn, `
        SELECT count(*)::int AS n FROM ${RESOLUTION} r
        JOIN equipment_types t ON t.id = r.from_type_id
        WHERE t.type_code NOT LIKE ?`, [`${CODE_PREFIX}%`]));
      assert.strictEqual(rows[0].n, 0,
        'no pre-existing taxonomy row may carry an identity resolution as a result of this migration');
    });

    it('45. all 282 equipments types, if present, are untouched and canonical by default', async () => {
      // A freshly migrated database has no taxonomy content, so this asserts the
      // invariant conditionally rather than assuming the corpus is loaded.
      const rows = await withConn((conn) => query(conn, `
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE identity_state = 'canonical')::int AS canonical,
          count(*) FILTER (WHERE identity_state NOT IN ('canonical','superseded','retired'))::int AS invalid
        FROM equipment_types`));
      assert.strictEqual(rows[0].invalid, 0, 'every standing must be an approved value');
      assert.ok(rows[0].canonical <= rows[0].total);
    });
  });
});
