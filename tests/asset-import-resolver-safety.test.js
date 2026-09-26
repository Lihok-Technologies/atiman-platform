/**
 * Asset Import — Equipment Type Resolver Safety
 *
 * ATM-001 M5R.4B2 PREREQUISITE — canonical-only resolution with explicit
 * ambiguity refusal.
 *
 * WHY THIS SUITE EXISTS
 *
 * The asset-import resolver accepted an `equipment_type_code` and selected the
 * FIRST row matching LOWER(type_code), with no taxonomy scope at all. Two
 * defects followed:
 *
 *   1. AMBIGUITY. `UNIQUE (class_id, type_code)` is per-class, so one code can
 *      legitimately match several Equipment Types. The live corpus already
 *      contains exactly one such code, COMPACT, carried by two rows. The
 *      resolver silently took whichever row the database returned first.
 *
 *   2. NON-CANONICAL RESOLUTION. migration 019 introduced lifecycle standing
 *      (canonical / superseded / retired). The resolver did not filter on it, so
 *      once M5R.4B2 marks 19 Types superseded and 33 retired, an import could
 *      bind an asset to a retired or superseded Type. That state is impossible
 *      only while every Type happens to be canonical.
 *
 * THE CONTRACT THIS SUITE PINS
 *
 *   exactly one canonical match  -> resolve to that Type's immutable
 *                                   equipment_types.id and continue
 *   0 canonical matches          -> reject
 *   >1 canonical matches         -> reject as AMBIGUOUS
 *
 * A code is never chosen by first row, arbitrary row, lowest or highest id,
 * alphabetically first, or database return order. Evidence Before Assumption.
 *
 * NOT in scope, deliberately: equipment_type_identity_resolution redirects,
 * terminology lookup, aliases, class/category scoping and any CSV redesign.
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
const assetImportService = require('../src/services/asset-import.service');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating asset-import resolver suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const CORPUS = path.join(__dirname, '..', 'scripts', 'bootstrap-knowledge', 'equipment_types.jsonl');

const ORG = 998601;
const REVIEWER = 998602;
const APPROVER = 998603;
const CODE_PREFIX = 'M5R4B2IR-';

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

/** A fresh category > class, isolated per call. */
async function makeClass() {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const cat = await query(conn,
      `INSERT INTO equipment_categories (category_code, category_name) VALUES (?, ?) RETURNING id`,
      [`${CODE_PREFIX}CAT-${tag}`, `M5R4B2IR Category ${tag}`]);
    const cls = await query(conn,
      `INSERT INTO equipment_classes (category_id, class_code, class_name) VALUES (?, ?, ?) RETURNING id`,
      [cat[0].id, `${CODE_PREFIX}CLS-${tag}`, `M5R4B2IR Class ${tag}`]);
    return cls[0].id;
  });
}

/** A canonical Equipment Type. The column DEFAULT makes it canonical. */
async function makeType(classId, code, name) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO equipment_types (class_id, type_code, type_name) VALUES (?, ?, ?) RETURNING id`,
      [classId, code, name]);
    return rows[0].id;
  });
}

/**
 * Drive a Type to a governed non-canonical standing through the real mechanism.
 *
 * The standing CANNOT be written by hand: migration 019's standing guard refuses
 * a non-canonical value without an approved identity resolution. These helpers
 * therefore use the governed path, which also means the fixtures exercise the
 * same lifecycle M5R.4B2 will produce.
 */
async function retireType(typeId) {
  await withConn(async (conn) => {
    const rows = await query(conn, `
      INSERT INTO equipment_type_identity_resolution
        (from_type_id, to_type_id, resolution_kind, rationale, review_state,
         reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
      VALUES (?, NULL, 'NOT_AN_EQUIPMENT_TYPE', 'Synthetic resolver fixture', 'approved',
              ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP) RETURNING id`,
    [typeId, REVIEWER, APPROVER]);
    assert.ok(rows[0].id > 0);
  });
}

async function supersedeType(typeId, targetTypeId) {
  await withConn(async (conn) => {
    const rows = await query(conn, `
      INSERT INTO equipment_type_identity_resolution
        (from_type_id, to_type_id, resolution_kind, rationale, review_state,
         reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
      VALUES (?, ?, 'MERGED_DUPLICATE', 'Synthetic resolver fixture', 'approved',
              ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP) RETURNING id`,
    [typeId, targetTypeId, REVIEWER, APPROVER]);
    assert.ok(rows[0].id > 0);
  });
}

const stateOf = async (typeId) => withConn(async (conn) => {
  const rows = await query(conn, `SELECT identity_state FROM equipment_types WHERE id = ?`, [typeId]);
  return rows[0] && rows[0].identity_state;
});

/** The resolver must reject; capture the message rather than a rejection reason. */
async function expectResolverRejection(code) {
  let raised = null;
  try {
    await assetImportService.validateEquipmentType(code);
  } catch (error) {
    raised = error;
  }
  assert.ok(raised,
    `the resolver must REJECT '${code}', but it resolved it — an import would have bound an asset to a Type the operator did not uniquely identify`);
  assert.ok(typeof raised.message === 'string' && raised.message.length > 0,
    'a rejection must carry a message the operator can act on');
  return raised.message;
}

describe('Asset import — equipment type resolver safety', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await withConn(async (conn) => {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [ORG, 'M5R4B2IR Org']);
      for (const [id, name] of [[REVIEWER, 'm5r4b2ir-reviewer'], [APPROVER, 'm5r4b2ir-approver']]) {
        await query(conn,
          `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
           VALUES (?, ?, ?, 'x', ?, 'admin', ?, true) ON CONFLICT (id) DO NOTHING`,
          [id, name, `${name}@test.local`, name, ORG]);
      }
    });
  });

  after(async () => {
    // Approved resolutions and the Types they govern are governed knowledge and
    // are deliberately left in place: migration 019's delete guard and RESTRICT
    // foreign keys correctly prevent their removal.
    await withConn(async (conn) => {
      await query(conn, `
        DELETE FROM equipment_type_identity_resolution
        WHERE review_state = 'draft'
          AND from_type_id IN (SELECT id FROM equipment_types WHERE type_code LIKE ?)`,
      [`${CODE_PREFIX}%`]);
    });
  });

  describe('A. successful resolution', () => {
    it('1. a unique canonical code resolves to the expected immutable Type ID', async () => {
      const classId = await makeClass();
      const code = `${CODE_PREFIX}UNIQ-${UNIQ()}`;
      const typeId = await makeType(classId, code, 'M5R4B2IR Unique Type');

      const resolved = await assetImportService.validateEquipmentType(code);

      assert.strictEqual(resolved.id, typeId,
        'resolution must return the equipment_types.id, the immutable identity');
      assert.strictEqual(resolved.type_code, code);
    });

    it('8. case variation still resolves when exactly one canonical Type exists', async () => {
      const classId = await makeClass();
      const code = `${CODE_PREFIX}Case-${UNIQ()}`;
      const typeId = await makeType(classId, code, 'M5R4B2IR Case Type');

      for (const variant of [code.toUpperCase(), code.toLowerCase(), code]) {
        const resolved = await assetImportService.validateEquipmentType(variant);
        assert.strictEqual(resolved.id, typeId, `'${variant}' must resolve to the same Type`);
      }
    });

    it('10. resolution is by immutable ID, never by name', async () => {
      const classId = await makeClass();
      const tag = UNIQ();
      const codeA = `${CODE_PREFIX}ID-A-${tag}`;
      const codeB = `${CODE_PREFIX}ID-B-${tag}`;
      // Deliberately confusing: the NAME of B looks like the CODE of A.
      const a = await makeType(classId, codeA, 'M5R4B2IR Named Like Nothing');
      const b = await makeType(classId, codeB, codeA);

      const resolved = await assetImportService.validateEquipmentType(codeA);
      assert.strictEqual(resolved.id, a,
        'a name that happens to equal another row\'s code must not win; identity is the id');
      assert.notStrictEqual(resolved.id, b);
    });

    it('11. surrounding whitespace is tolerated', async () => {
      const classId = await makeClass();
      const code = `${CODE_PREFIX}WS-${UNIQ()}`;
      const typeId = await makeType(classId, code, 'M5R4B2IR Whitespace Type');

      const resolved = await assetImportService.validateEquipmentType(`  ${code}  `);
      assert.strictEqual(resolved.id, typeId);
    });
  });

  describe('B. rejection when nothing canonical matches', () => {
    it('2. a code with no match at all is rejected', async () => {
      const message = await expectResolverRejection(`${CODE_PREFIX}NOPE-${UNIQ()}`);
      assert.match(message, /not found|no canonical/i,
        'the operator must be told the code did not resolve');
    });

    it('3. a code matching ONLY a retired Type is rejected', async () => {
      const classId = await makeClass();
      const code = `${CODE_PREFIX}RET-${UNIQ()}`;
      const typeId = await makeType(classId, code, 'M5R4B2IR Retired Type');
      await retireType(typeId);
      assert.strictEqual(await stateOf(typeId), 'retired', 'fixture must really be retired');

      const message = await expectResolverRejection(code);
      assert.ok(!new RegExp(`\\b${typeId}\\b`).test(message),
        'the rejection must not present the retired row as a usable identity');
    });

    it('4. a code matching ONLY a superseded Type is rejected', async () => {
      const classId = await makeClass();
      const targetCode = `${CODE_PREFIX}SUP-TGT-${UNIQ()}`;
      const code = `${CODE_PREFIX}SUP-${UNIQ()}`;
      const targetId = await makeType(classId, targetCode, 'M5R4B2IR Supersede Target');
      const typeId = await makeType(classId, code, 'M5R4B2IR Superseded Type');
      await supersedeType(typeId, targetId);
      assert.strictEqual(await stateOf(typeId), 'superseded', 'fixture must really be superseded');

      const message = await expectResolverRejection(code);
      // A redirect through equipment_type_identity_resolution is a DIFFERENT
      // architectural concern and is deliberately NOT implemented here: the
      // operator is told, not silently redirected.
      assert.match(message, /not found|canonical/i);
    });
  });

  describe('C. non-canonical rows never create ambiguity', () => {
    it('5. canonical + retired sharing a code resolves to the canonical row', async () => {
      const classA = await makeClass();
      const classB = await makeClass();
      const code = `${CODE_PREFIX}CNR-${UNIQ()}`;
      const canonicalId = await makeType(classA, code, 'M5R4B2IR Canonical Winner');
      const retiredId = await makeType(classB, code, 'M5R4B2IR Retired Loser');
      await retireType(retiredId);

      const resolved = await assetImportService.validateEquipmentType(code);
      assert.strictEqual(resolved.id, canonicalId,
        'the retired duplicate must not make a uniquely canonical code ambiguous');
      assert.notStrictEqual(resolved.id, retiredId);
    });

    it('6. canonical + superseded sharing a code resolves to the canonical row', async () => {
      const classA = await makeClass();
      const classB = await makeClass();
      const code = `${CODE_PREFIX}CNS-${UNIQ()}`;
      const anchorId = await makeType(classA, `${CODE_PREFIX}ANCHOR-${UNIQ()}`, 'M5R4B2IR Anchor');
      const canonicalId = await makeType(classA, code, 'M5R4B2IR Canonical Winner');
      const supersededId = await makeType(classB, code, 'M5R4B2IR Superseded Loser');
      await supersedeType(supersededId, anchorId);

      const resolved = await assetImportService.validateEquipmentType(code);
      assert.strictEqual(resolved.id, canonicalId);
      assert.notStrictEqual(resolved.id, supersededId);
    });
  });

  describe('D. ambiguity is refused, never resolved by guessing', () => {
    it('7. two canonical Types sharing a case-insensitive code are rejected as ambiguous', async () => {
      const classA = await makeClass();
      const classB = await makeClass();
      const tag = UNIQ();
      const codeA = `${CODE_PREFIX}AMB-${tag}`;
      const codeB = `${CODE_PREFIX}amb-${tag}`;      // differs only by case
      const firstId = await makeType(classA, codeA, 'M5R4B2IR Ambiguous One');
      const secondId = await makeType(classB, codeB, 'M5R4B2IR Ambiguous Two');

      const message = await expectResolverRejection(codeA);
      assert.match(message, /ambigu/i,
        'the operator must be told the code is ambiguous, not that it was missing');
      assert.ok(message.includes(codeA) || message.includes(codeB),
        'the ambiguity message must name the submitted code so the source data can be corrected');
      assert.ok(!new RegExp(`\\b${firstId}\\b`).test(message),
        'no candidate row may be presented as the chosen identity');
      assert.ok(!new RegExp(`\\b${secondId}\\b`).test(message));
    });

    it('9. the live COMPACT condition is reproduced: both rows canonical => ambiguous', async () => {
      // Mirrors the real corpus shape: code COMPACT on two Types in two classes.
      // Both are canonical BEFORE M5R.4B2, which is exactly why the current
      // resolver picks one arbitrarily. The two codes differ ONLY by case, which
      // is what makes them collide under the resolver's LOWER() comparison —
      // exactly as the live `COMPACT` pair does.
      const classA = await makeClass();
      const classB = await makeClass();
      const tag = UNIQ();
      const codeA = `${CODE_PREFIX}COMPACT-${tag}`;
      const codeB = `${CODE_PREFIX}compact-${tag}`;
      await makeType(classA, codeA, 'M5R4B2IR Compact PLC analogue');
      await makeType(classB, codeB, 'M5R4B2IR Compact Screw analogue');

      const message = await expectResolverRejection(codeA);
      assert.match(message, /ambigu/i);
    });

    it('9b. the real corpus actually contains the COMPACT collision', () => {
      // Documentary evidence for the condition above, read from the accepted
      // bootstrap corpus. No production data is touched.
      const rows = fs.readFileSync(CORPUS, 'utf8').trim().split('\n')
        .map((line) => JSON.parse(line));
      const compact = rows.filter((r) => String(r[2]).toLowerCase() === 'compact');
      assert.strictEqual(compact.length, 2,
        'the accepted corpus carries exactly two COMPACT rows, so the code is ambiguous for this resolver');
      const distinctClasses = new Set(compact.map((r) => r[1]));
      assert.strictEqual(distinctClasses.size, 2,
        'the two COMPACT rows sit in different classes, which UNIQUE (class_id, type_code) permits');
    });
  });
});
