/**
 * Governed Equipment-Type / External-Classification Crosswalk — Integration Tests
 *
 * ATM-001 M5R.3C — proves migration 017 implements the approved M5R.3 crosswalk
 * persistence model, and just as importantly proves what M5R.3C does NOT do.
 *
 * The three states this suite keeps apart (M5R.3 §H.0, NORMATIVE):
 *   1. NEVER INVESTIGATED  -> NO ROW.
 *   2. MAPPED OUTCOME      -> classification present, from the SAME edition.
 *   3. NO_DIRECT_MAPPING   -> classification absent, edition still recorded;
 *                             a positive conclusion, not a null.
 * and `review_state` governs all three independently of `mapping_outcome`.
 *
 * Copyright boundary: every fixture is SYNTHETIC — synthetic authorities,
 * editions, and codes such as `EXT-PUMP-<uniq>` / "Synthetic Pump
 * Classification". No ISO/IEC/API/ASME/DIN classification, code, table or annex
 * is reproduced, imported or asserted, and no real standards classification is
 * populated by this mission. Synthetic placeholders must never be read as real
 * external classifications.
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
  : 'database-mutating crosswalk suite requires the sanctioned database-test gate '
    + '(NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that test-database '
    + 'credentials are used instead of runtime credentials; run it via '
    + '`npm run integration`';

const MIGRATION_FILE = '017_equipment_type_external_classification_crosswalk.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', 'postgresql', MIGRATION_FILE);
const TABLE = 'equipment_type_external_classification';

const ORG = 997101;
const USER = 997102;
const OTHER_USER = 997103;
const CODE_PREFIX = 'M5R3C-';
const CATEGORY_PREFIX = 'M5R3CCAT-';

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

// Message-specific matchers: each names WHICH guard refused, so a test cannot
// pass because some unrelated constraint happened to fire first.
const isNotNullViolation = (e) => e.code === '23502' || /not-null/i.test(e.message || '');
const isUniqueViolation = (e) => e.code === '23505' || /duplicate key|unique constraint/i.test(e.message || '');
const isForeignKeyViolation = (e) => e.code === '23503' || /violates foreign key/i.test(e.message || '');
const isCoherenceRefusal = (e) => /chk_equipment_type_external_classification_outcome_coherent/.test(e.message || '');
const isAttributionRefusal = (e) => /chk_equipment_type_external_classification_approved_attributed/.test(e.message || '');
const isDomainRefusal = (e) => /chk_equipment_type_external_classification_(relationship|review_state|mapping_outcome|confidence|role)/.test(e.message || '');
const isScopeRefusal = (e) => /may not derive authority from tenant-scoped knowledge_source/.test(e.message || '');
const isEditionMismatch = (e) => /belongs to edition/.test(e.message || '');
const isImmutableRefusal = (e) => /is immutable except its supersession pointer/.test(e.message || '');
const isDeleteRefusal = (e) => /cannot be deleted; only draft proposals are deletable/.test(e.message || '');
const isCycleRefusal = (e) => /would create a cycle/.test(e.message || '');
const isSelfSupersessionRefusal = (e) => /cannot supersede itself/.test(e.message || '');

async function ensureFixture() {
  await withConn(async (conn) => {
    await query(conn,
      `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'M5R3C Org']);
    for (const [id, name] of [[USER, 'm5r3c-user'], [OTHER_USER, 'm5r3c-approver']]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', ?, 'admin', ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@test.local`, name, ORG]);
    }
  });
}

/**
 * A complete synthetic taxonomy chain plus an industry. equipment_types has no
 * organization_id: Atiman canonical identity is global.
 */
async function createEquipmentType() {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const cat = await query(conn,
      `INSERT INTO equipment_categories (category_code, category_name) VALUES (?, ?) RETURNING id`,
      [`${CATEGORY_PREFIX}${tag}`, `M5R3C Category ${tag}`]);
    const cls = await query(conn,
      `INSERT INTO equipment_classes (category_id, class_code, class_name) VALUES (?, ?, ?) RETURNING id`,
      [cat[0].id, `${CODE_PREFIX}CLS-${tag}`, `M5R3C Class ${tag}`]);
    const typ = await query(conn,
      `INSERT INTO equipment_types (class_id, type_code, type_name) VALUES (?, ?, ?) RETURNING id`,
      [cls[0].id, `${CODE_PREFIX}TYP-${tag}`, `M5R3C Type ${tag}`]);
    return typ[0].id;
  });
}

async function createIndustry() {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO industries (code, name) VALUES (?, ?) RETURNING id`,
      [`${CODE_PREFIX}IND-${tag}`, `M5R3C Industry ${tag}`]);
    return rows[0].id;
  });
}

/** organizationId NULL = global authority; non-null = tenant-scoped authority. */
async function createAuthority({ organizationId = null } = {}) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
       VALUES (?, 'engineering_standard', 'M5R3C Synthetic Authority', 'Synthetic Authority', ?)
       RETURNING id`, [`${CODE_PREFIX}AUTH-${UNIQ()}`, organizationId]);
    return rows[0].id;
  });
}

async function addEdition(sourceId, designation) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
       VALUES (?, ?, 'M5R3C Synthetic Edition', 'SYNTH-REF', 'Synthetic Authority')
       RETURNING id`, [sourceId, designation]);
    return rows[0].id;
  });
}

async function addClassification(versionId, label = 'Synthetic Pump Classification') {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO external_classification
         (knowledge_source_version_id, classification_code, classification_label)
       VALUES (?, ?, ?) RETURNING id`, [versionId, `EXT-PUMP-${UNIQ()}`, label]);
    return rows[0].id;
  });
}

/** Insert a crosswalk row. `outcome` drives whether a classification is passed. */
async function addCrosswalk({
  equipmentTypeId,
  versionId,
  classificationId = null,
  outcome = 'DIRECT_EQUIVALENT',
  reviewState = 'draft',
  extra = {}
}) {
  return withConn(async (conn) => {
    const relationship = outcome === 'NO_DIRECT_MAPPING' ? null : outcome;
    const rows = await query(conn,
      `INSERT INTO equipment_type_external_classification
         (equipment_type_id, knowledge_source_version_id, external_classification_id,
          relationship, mapping_outcome, review_state, applicability_industry_id,
          confidence_level, supporting_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [equipmentTypeId, versionId, classificationId, relationship, outcome, reviewState,
       extra.applicabilityIndustryId ?? null,
       extra.confidenceLevel ?? 'provisional',
       extra.supportingRole ?? 'supporting']);
    return rows[0].id;
  });
}

/** Approve a row with full accountable attribution, as the CHECK requires. */
async function approve(id, { reviewer = USER, approver = OTHER_USER } = {}) {
  return withConn((conn) => query(conn, `
    UPDATE equipment_type_external_classification
    SET review_state = 'approved', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
        approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [reviewer, approver, id]));
}

/** A global authority edition owning one classification, ready to crosswalk. */
async function globalEditionWithClassification() {
  const versionId = await addEdition(await createAuthority(), '2016');
  const classificationId = await addClassification(versionId);
  return { versionId, classificationId };
}

describe('Governed External Classification Crosswalk (ATM-001 M5R.3C)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  after(async () => {
    // Best-effort cleanup of what the approved lifecycle actually permits.
    //
    // Only DRAFT proposals are deletable (§Q). Rows this suite drove to
    // under_review / approved / rejected are governed knowledge and are
    // deliberately left in place: removing them would require disabling the very
    // guard this suite exists to prove, and RESTRICT correctly prevents their
    // referenced taxonomy/edition/concept fixtures from being removed either.
    // All fixture codes carry a unique suffix, so nothing here can collide with
    // another suite or a later run. This database is disposable.
    await withConn(async (conn) => {
      await query(conn, `
        DELETE FROM ${TABLE}
        WHERE review_state = 'draft'
          AND knowledge_source_version_id IN (
            SELECT v.id FROM knowledge_source_versions v
            JOIN knowledge_sources s ON s.id = v.knowledge_source_id
            WHERE s.source_code LIKE ?)`, [`${CODE_PREFIX}%`]);
    });
  });

  // ==========================================================
  // A. THE FOUNDATION EXISTS, IS ADDITIVE, AND IS BOUNDED
  // ==========================================================
  describe('A. migration 017 adds exactly the approved crosswalk foundation', () => {
    it('1. the crosswalk table exists', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ?
          AND table_type = 'BASE TABLE'`, [TABLE]));
      assert.strictEqual(rows.length, 1, 'migration 017 must create the crosswalk table');
    });

    it('2. exactly the five approved guards are installed', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT t.tgname, p.proname, pg_get_triggerdef(t.oid) AS d
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = ? AND NOT t.tgisinternal
        ORDER BY t.tgname`, [TABLE]));
      const byName = Object.fromEntries(rows.map((r) => [r.tgname, r]));
      assert.deepStrictEqual(Object.keys(byName).sort(), [
        'trg_equipment_type_external_classification_delete_guard',
        'trg_equipment_type_external_classification_edition_coherence',
        'trg_equipment_type_external_classification_global_scope',
        'trg_equipment_type_external_classification_immutable',
        'trg_equipment_type_external_classification_supersession'
      ], 'exactly the five ADR guards — no more, no fewer');
      assert.ok(/BEFORE UPDATE/.test(byName.trg_equipment_type_external_classification_immutable.d));
      assert.ok(/BEFORE DELETE/.test(byName.trg_equipment_type_external_classification_delete_guard.d));
      assert.ok(/BEFORE INSERT OR UPDATE/.test(byName.trg_equipment_type_external_classification_edition_coherence.d));
      assert.ok(/BEFORE INSERT OR UPDATE/.test(byName.trg_equipment_type_external_classification_global_scope.d));
      assert.ok(/BEFORE INSERT OR UPDATE/.test(byName.trg_equipment_type_external_classification_supersession.d));
    });

    it('3. exactly the approved indexes exist — nothing unrelated', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT indexname FROM pg_indexes WHERE tablename = ? ORDER BY indexname`, [TABLE]));
      assert.deepStrictEqual(rows.map((r) => r.indexname).sort(), [
        'equipment_type_external_classification_pkey',
        'idx_equipment_type_external_classification_external_class',
        'idx_equipment_type_external_classification_source_version',
        'idx_equipment_type_external_classification_superseded_by',
        'idx_equipment_type_external_classification_type_review',
        'uq_equipment_type_external_classification_active_mapping',
        'uq_equipment_type_external_classification_active_ndm'
      ], 'six approved indexes plus the primary key');
    });

    it('4. the approved partial-uniqueness predicates are exact', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = ? AND indexname IN (
          'uq_equipment_type_external_classification_active_mapping',
          'uq_equipment_type_external_classification_active_ndm')`, [TABLE]));
      const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
      // PostgreSQL renders predicates with casts and parentheses, e.g.
      // "((review_state)::text = 'approved'::text)". Normalise before matching so
      // the assertion tests the PREDICATE rather than the renderer's formatting.
      const norm = (s) => s.replace(/::text/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ');

      const mapped = norm(defs.uq_equipment_type_external_classification_active_mapping);
      assert.ok(/^CREATE UNIQUE INDEX/.test(mapped), 'the active-mapping rule is a UNIQUE index');
      assert.ok(mapped.includes('equipment_type_id, external_classification_id, relationship'),
        'active-mapping uniqueness keys on (type, classification, relationship)');
      assert.ok(mapped.includes("review_state = 'approved'"), 'only governed rows are constrained');
      assert.ok(mapped.includes('superseded_by_crosswalk_id IS NULL'),
        'only ACTIVE rows are constrained — superseded history may coexist');
      assert.ok(mapped.includes('external_classification_id IS NOT NULL'),
        'the mapped rule never applies to NO_DIRECT_MAPPING rows');

      const ndm = norm(defs.uq_equipment_type_external_classification_active_ndm);
      assert.ok(ndm.includes('equipment_type_id, knowledge_source_version_id'),
        'NDM uniqueness keys on (type, edition)');
      assert.ok(ndm.includes("mapping_outcome = 'NO_DIRECT_MAPPING'"));
      assert.ok(ndm.includes('superseded_by_crosswalk_id IS NULL'));
    });

    it('5. all five FK delete rules are the approved ones', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = ?::regclass AND contype = 'f'`, [TABLE]));
      const defs = Object.fromEntries(rows.map((r) => [r.conname, r.d]));
      assert.strictEqual(rows.length, 5, 'exactly five foreign keys');
      for (const [name, target] of [
        ['fk_equipment_type_external_classification_equipment_type', 'equipment_types(id)'],
        ['fk_equipment_type_external_classification_source_version', 'knowledge_source_versions(id)'],
        ['fk_equipment_type_external_classification_external_class', 'external_classification(id)']
      ]) {
        assert.ok(defs[name] && defs[name].includes(target.trim()), `${name} targets ${target}`);
        assert.ok(defs[name].includes('ON DELETE RESTRICT'),
          `${name} must RESTRICT: governed mapping history may not be cascaded away`);
        assert.ok(!defs[name].includes('CASCADE'), `${name} must not CASCADE`);
      }
      assert.ok(defs.fk_equipment_type_external_classification_industry.includes('ON DELETE SET NULL'),
        'industry is a reference dimension, not governed history');
      assert.ok(defs.fk_equipment_type_external_classification_superseded_by.includes('ON DELETE SET NULL'),
        'mirrors the migration-009 supersession pointer idiom');
    });

    it('6. no crosswalk evidence table exists (that is M5R.3D)', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND (table_name LIKE '%crosswalk%evidence%' OR table_name LIKE '%evidence%crosswalk%')`));
      assert.strictEqual(rows.length, 0, 'relationship evidence belongs to M5R.3D, not M5R.3C');
    });

    it('7. the migration file is STRUCTURE only', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      assert.ok(/CREATE TABLE IF NOT EXISTS equipment_type_external_classification/.test(sql));
      assert.ok(!/INSERT\s+INTO/i.test(sql), 'migration 017 must populate nothing');
      assert.ok(!/ALTER\s+TABLE/i.test(sql),
        'purely additive: no existing table is altered, so 001-016 semantics cannot shift');
      assert.ok(!/\bDROP\s+TABLE\b|\bRENAME\b|\bDROP\s+COLUMN\b|\bDROP\s+CONSTRAINT\b/i.test(sql),
        'no destructive or renaming DDL');
      assert.ok(!/iso_maintenance_reference|iso_failure_cause_reference/i.test(sql),
        'false-provenance legacy columns must not be consulted');
      assert.ok(!/\b(ISO|IEC|ASME|DIN|API)\s?\d/i.test(sql),
        'no standards content or real classification codes may appear');
    });
  });

  // ==========================================================
  // B. THE THREE STATES STAY DISTINCT
  // ==========================================================
  describe('B. never-investigated, mapped, and NO_DIRECT_MAPPING remain distinct', () => {
    it('8. a valid mapped outcome against a matching classification succeeds', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      const rows = await withConn((conn) => query(conn, `
        SELECT ec.mapping_outcome, ec.relationship, ec.review_state, ec.external_classification_id,
               ec.knowledge_source_version_id, x.knowledge_source_version_id AS classification_edition
        FROM ${TABLE} ec
        JOIN external_classification x ON x.id = ec.external_classification_id
        WHERE ec.id = ?`, [id]));
      assert.strictEqual(rows[0].mapping_outcome, 'DIRECT_EQUIVALENT');
      assert.strictEqual(rows[0].relationship, 'DIRECT_EQUIVALENT');
      assert.strictEqual(rows[0].review_state, 'draft', 'a new row is a proposal, not governed truth');
      assert.strictEqual(Number(rows[0].knowledge_source_version_id),
        Number(rows[0].classification_edition), 'the row and its concept share one edition');
    });

    it('9. every mapped outcome without a classification is rejected', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        for (const outcome of ['DIRECT_EQUIVALENT', 'RELATED_TO', 'BROADER_THAN', 'NARROWER_THAN']) {
          await conn.query('SAVEPOINT p');
          try {
            await assert.rejects(
              () => query(conn, `
                INSERT INTO ${TABLE}
                  (equipment_type_id, knowledge_source_version_id, relationship, mapping_outcome)
                VALUES (?, ?, ?, ?)`, [typeId, versionId, outcome, outcome]),
              (e) => isCoherenceRefusal(e),
              `${outcome} with NULL classification must be unrepresentable`);
          } finally {
            await conn.query('ROLLBACK TO SAVEPOINT p');
          }
        }
      });
    });

    it('10. NO_DIRECT_MAPPING with a classification is rejected', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (equipment_type_id, knowledge_source_version_id, external_classification_id, mapping_outcome)
            VALUES (?, ?, ?, 'NO_DIRECT_MAPPING')`, [typeId, versionId, classificationId]),
          (e) => isCoherenceRefusal(e),
          'NDM must never carry a fabricated classification');
      });
    });

    it('11. NO_DIRECT_MAPPING with NULL classification succeeds and records the edition', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority(), '2016');
      const id = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      const rows = await withConn((conn) => query(conn, `
        SELECT mapping_outcome, external_classification_id, relationship, knowledge_source_version_id
        FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows[0].mapping_outcome, 'NO_DIRECT_MAPPING');
      assert.strictEqual(rows[0].external_classification_id, null);
      assert.strictEqual(rows[0].relationship, null);
      assert.strictEqual(Number(rows[0].knowledge_source_version_id), versionId,
        'the exact investigated edition is recorded even without a concept');
    });

    it('12. an approved NO_DIRECT_MAPPING stays distinguishable from NEVER INVESTIGATED', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority(), '2016');
      const neverInvestigated = await createEquipmentType();

      // State 1: no row at all for this (type, edition).
      const noRow = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE equipment_type_id = ? AND knowledge_source_version_id = ?`,
        [neverInvestigated, versionId]));
      assert.strictEqual(noRow[0].n, 0, 'never investigated is represented by the ABSENCE of a row');

      // State 3: an approved positive conclusion of "no defensible direct mapping".
      const id = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      await approve(id);
      const approved = await withConn((conn) => query(conn,
        `SELECT review_state, mapping_outcome, external_classification_id FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(approved[0].review_state, 'approved');
      assert.strictEqual(approved[0].mapping_outcome, 'NO_DIRECT_MAPPING');
      assert.strictEqual(approved[0].external_classification_id, null);

      // The two states are told apart by row existence plus review_state — never
      // by a NULL mapping_outcome, which the NOT NULL column makes impossible.
      const nullOutcome = await withConn((conn) => query(conn, `
        SELECT is_nullable FROM information_schema.columns
        WHERE table_name = ? AND column_name = 'mapping_outcome'`, [TABLE]));
      assert.strictEqual(nullOutcome[0].is_nullable, 'NO',
        'mapping_outcome is NOT NULL, so "unknown" cannot masquerade as a finding');
    });
  });

  // ==========================================================
  // C. REVIEW STATE IS AN INDEPENDENT DIMENSION
  // ==========================================================
  describe('C. governance status and mapping outcome are separate dimensions', () => {
    it('13. all four approved review states are accepted, independently of outcome', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      // A row cannot be INSERTed directly as approved: the attribution CHECK
      // requires accountable humans first, so approval is reached through the
      // lifecycle — which is itself part of the guarantee being tested.
      const cases = [
        ['draft', 'RELATED_TO', classificationId, false],
        ['under_review', 'DIRECT_EQUIVALENT', classificationId, false],
        ['rejected', 'BROADER_THAN', classificationId, false],
        ['approved', 'NO_DIRECT_MAPPING', null, true]
      ];
      for (const [reviewState, outcome, cls, needsApproval] of cases) {
        const typeId = await createEquipmentType();
        const id = await addCrosswalk({
          equipmentTypeId: typeId, versionId, classificationId: cls, outcome,
          reviewState: needsApproval ? 'draft' : reviewState
        });
        if (needsApproval) await approve(id);
        const rows = await withConn((conn) => query(conn,
          `SELECT review_state, mapping_outcome FROM ${TABLE} WHERE id = ?`, [id]));
        assert.strictEqual(rows[0].review_state, reviewState);
        assert.strictEqual(rows[0].mapping_outcome, outcome,
          `${reviewState} + ${outcome} must be independently representable`);
      }
    });

    it('14. an invalid review state is rejected', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (equipment_type_id, knowledge_source_version_id, external_classification_id,
               relationship, mapping_outcome, review_state)
            VALUES (?, ?, ?, 'RELATED_TO', 'RELATED_TO', 'published')`,
          [typeId, versionId, classificationId]),
          (e) => isDomainRefusal(e),
          'there is no crosswalk publication state (M5R.3 section U)');
      });
    });

    it('15. an invalid mapping outcome is rejected', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        for (const bad of ['SECTOR_SPECIFIC_EQUIVALENT', 'EQUIVALENT', 'UNKNOWN', 'no_direct_mapping']) {
          await conn.query('SAVEPOINT p');
          try {
            await assert.rejects(
              () => query(conn, `
                INSERT INTO ${TABLE} (equipment_type_id, knowledge_source_version_id, mapping_outcome)
                VALUES (?, ?, ?)`, [typeId, versionId, bad]),
              (e) => isDomainRefusal(e),
              `${bad} must not be an accepted outcome`);
          } finally {
            await conn.query('ROLLBACK TO SAVEPOINT p');
          }
        }
      });
    });

    it('16. an approved row without accountable attribution is rejected', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET review_state = 'approved' WHERE id = ?`, [id]),
          (e) => isAttributionRefusal(e),
          'an unattributed governed row must be unrepresentable');
      });
    });

    it('17. applicability and confidence vocabularies are bounded', async () => {
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const industryId = await createIndustry();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'RELATED_TO',
        extra: { applicabilityIndustryId: industryId, confidenceLevel: 'established', supportingRole: 'primary' }
      });
      const rows = await withConn((conn) => query(conn, `
        SELECT applicability_industry_id, confidence_level, supporting_role FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(Number(rows[0].applicability_industry_id), industryId,
        'industry-only structured applicability is supported');
      assert.strictEqual(rows[0].confidence_level, 'established');
      assert.strictEqual(rows[0].supporting_role, 'primary');

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET confidence_level = 'probably' WHERE id = ?`, [id]),
          (e) => isDomainRefusal(e), 'confidence vocabulary is closed');
      });
    });
  });

  // ==========================================================
  // D. REFERENTIAL INTEGRITY
  // ==========================================================
  describe('D. unknown references are refused', () => {
    it('18. an unknown equipment type is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (equipment_type_id, knowledge_source_version_id, mapping_outcome)
            VALUES (2147483000, ?, 'NO_DIRECT_MAPPING')`, [versionId]),
          (e) => isForeignKeyViolation(e));
      });
    });

    it('19. an unknown knowledge source version is rejected', async () => {
      const typeId = await createEquipmentType();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (equipment_type_id, knowledge_source_version_id, mapping_outcome)
            VALUES (?, 2147483000, 'NO_DIRECT_MAPPING')`, [typeId]),
          (e) => isForeignKeyViolation(e));
      });
    });

    it('20. an unknown external classification is rejected', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (equipment_type_id, knowledge_source_version_id, external_classification_id,
               relationship, mapping_outcome)
            VALUES (?, ?, 2147483000, 'RELATED_TO', 'RELATED_TO')`, [typeId, versionId]),
          (e) => isForeignKeyViolation(e) || /does not exist/.test(e.message || ''));
      });
    });

    it('21. equipment_type_id and knowledge_source_version_id are mandatory', async () => {
      await inRollback(async (conn) => {
        await conn.query('SAVEPOINT p');
        try {
          await assert.rejects(
            () => query(conn, `
              INSERT INTO ${TABLE} (knowledge_source_version_id, mapping_outcome)
              VALUES (2147483000, 'NO_DIRECT_MAPPING')`),
            (e) => isNotNullViolation(e),
            'a crosswalk row must identify the Atiman type');
        } finally {
          await conn.query('ROLLBACK TO SAVEPOINT p');
        }
        await conn.query('SAVEPOINT p');
        try {
          await assert.rejects(
            () => query(conn, `
              INSERT INTO ${TABLE} (equipment_type_id, mapping_outcome)
              VALUES (2147483000, 'NO_DIRECT_MAPPING')`),
            (e) => isNotNullViolation(e),
            'a crosswalk row must identify the edition that was investigated');
        } finally {
          await conn.query('ROLLBACK TO SAVEPOINT p');
        }
      });
    });
  });

  // ==========================================================
  // E. GLOBAL / TENANT BOUNDARY  (the M5R.3B non-claim, now closed)
  // ==========================================================
  describe('E. the global crosswalk cannot derive authority from a tenant', () => {
    it('22. a tenant-scoped source version is rejected even for NO_DIRECT_MAPPING', async () => {
      const typeId = await createEquipmentType();
      const tenantVersionId = await addEdition(
        await createAuthority({ organizationId: ORG }), '1.0');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (equipment_type_id, knowledge_source_version_id, mapping_outcome)
            VALUES (?, ?, 'NO_DIRECT_MAPPING')`, [typeId, tenantVersionId]),
          (e) => isScopeRefusal(e),
          'tenant terminology must not leak into global Atiman knowledge');
      });
    });

    it('23. a tenant-scoped classification cannot enter the global crosswalk', async () => {
      const typeId = await createEquipmentType();
      const tenantVersionId = await addEdition(
        await createAuthority({ organizationId: ORG }), '1.0');
      const tenantClassificationId = await addClassification(
        tenantVersionId, 'Synthetic tenant-scoped concept');

      // The classification exists under a tenant-scoped edition. M5R.3B allowed
      // that deliberately; M5R.3C makes it unreachable from the global crosswalk.
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (equipment_type_id, knowledge_source_version_id, external_classification_id,
               relationship, mapping_outcome)
            VALUES (?, ?, ?, 'DIRECT_EQUIVALENT', 'DIRECT_EQUIVALENT')`,
          [typeId, tenantVersionId, tenantClassificationId]),
          (e) => isScopeRefusal(e),
          'a coherent but tenant-scoped concept is still refused');
      });

      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE external_classification_id = ?`,
        [tenantClassificationId]));
      assert.strictEqual(rows[0].n, 0, 'no global crosswalk row cites a tenant-scoped concept');
    });

    it('24. a global source version is accepted', async () => {
      const typeId = await createEquipmentType();
      const versionId = await addEdition(await createAuthority({ organizationId: null }), '2016');
      const id = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      const rows = await withConn((conn) => query(conn, `
        SELECT s.organization_id FROM ${TABLE} ec
        JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
        JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE ec.id = ?`, [id]));
      assert.strictEqual(rows[0].organization_id, null,
        'a global crosswalk resolves to a global authority');
    });
  });

  // ==========================================================
  // F. EXACT EDITION COHERENCE
  // ==========================================================
  describe('F. a mapping may not cite a concept from another edition', () => {
    it('25. edition mismatch is rejected', async () => {
      const typeId = await createEquipmentType();
      const sourceId = await createAuthority();
      const edition2016 = await addEdition(sourceId, '2016');
      const edition2024 = await addEdition(sourceId, '2024');
      const concept2016 = await addClassification(edition2016);

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (equipment_type_id, knowledge_source_version_id, external_classification_id,
               relationship, mapping_outcome)
            VALUES (?, ?, ?, 'DIRECT_EQUIVALENT', 'DIRECT_EQUIVALENT')`,
          [typeId, edition2024, concept2016]),
          (e) => isEditionMismatch(e),
          'claiming edition 2024 while citing a 2016 concept must be unrepresentable');
      });
    });

    it('26. the matching edition is accepted', async () => {
      const typeId = await createEquipmentType();
      const sourceId = await createAuthority();
      const edition2016 = await addEdition(sourceId, '2016');
      const concept2016 = await addClassification(edition2016);
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId: edition2016, classificationId: concept2016,
        outcome: 'DIRECT_EQUIVALENT'
      });
      assert.ok(id);
    });

    it('27. repointing an existing row to another edition is refused', async () => {
      const typeId = await createEquipmentType();
      const sourceId = await createAuthority();
      const edition2016 = await addEdition(sourceId, '2016');
      const edition2024 = await addEdition(sourceId, '2024');
      const concept2016 = await addClassification(edition2016);
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId: edition2016, classificationId: concept2016,
        outcome: 'DIRECT_EQUIVALENT'
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET knowledge_source_version_id = ? WHERE id = ?`,
            [edition2024, id]),
          (e) => isEditionMismatch(e) || isCoherenceRefusal(e),
          'silently moving the investigated edition must be impossible');
      });
    });
  });

  // ==========================================================
  // G. UNIQUENESS, HISTORY AND SUPERSESSION
  // ==========================================================
  describe('G. only simultaneously active approved truth is unique', () => {
    it('28. a duplicate active approved mapping is rejected', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const first = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(first);
      const second = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET review_state='approved',
            reviewed_by_user_id=?, reviewed_at=CURRENT_TIMESTAMP,
            approved_by_user_id=?, approved_at=CURRENT_TIMESTAMP WHERE id=?`,
          [USER, OTHER_USER, second]),
          (e) => isUniqueViolation(e),
          'contradictory active governed truth for the same proposition is impossible');
      });
    });

    it('29. a duplicate active approved NO_DIRECT_MAPPING for one edition is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const typeId = await createEquipmentType();
      const first = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      await approve(first);
      const second = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET review_state='approved',
            reviewed_by_user_id=?, reviewed_at=CURRENT_TIMESTAMP,
            approved_by_user_id=?, approved_at=CURRENT_TIMESTAMP WHERE id=?`,
          [USER, OTHER_USER, second]),
          (e) => isUniqueViolation(e));
      });
    });

    it('30. competing proposals, differing outcomes and other types coexist freely', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const otherTypeId = await createEquipmentType();

      const a = await addCrosswalk({ equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT' });
      await approve(a);
      // A DIFFERENT relationship to the same concept is not the same proposition.
      const b = await addCrosswalk({ equipmentTypeId: typeId, versionId, classificationId, outcome: 'RELATED_TO' });
      await approve(b);
      // A different Atiman type is unaffected.
      const c = await addCrosswalk({ equipmentTypeId: otherTypeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT' });
      await approve(c);
      // Unapproved duplicates may coexist: they are proposals, not truth.
      await addCrosswalk({ equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT' });
      await addCrosswalk({ equipmentTypeId: typeId, versionId, classificationId, outcome: 'NARROWER_THAN' });

      const rows = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE equipment_type_id = ?`, [typeId]));
      assert.ok(rows[0].n >= 4, 'proposals and distinct propositions are all retained');
    });

    it('31. supersession preserves history and keeps exactly one active truth', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();

      // A is governed truth.
      const a = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(a);

      // A replacement of the SAME proposition cannot be approved while A is still
      // active (the partial unique index forbids two active approved truths), so
      // the back-link is set FIRST — which is the single change an approved row
      // permits — and only then is the successor approved.
      const b = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await withConn((conn) => query(conn,
        `UPDATE ${TABLE} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [b, a]));
      await approve(b);

      // The chain continues: B is itself superseded by C.
      const c = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await withConn((conn) => query(conn,
        `UPDATE ${TABLE} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [c, b]));
      await approve(c);

      const retained = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM ${TABLE}
        WHERE equipment_type_id = ? AND external_classification_id = ? AND review_state = 'approved'`,
      [typeId, classificationId]));
      assert.strictEqual(retained[0].n, 3,
        'every governed row is retained: supersession never deletes history');

      const active = await withConn((conn) => query(conn, `
        SELECT id FROM ${TABLE}
        WHERE equipment_type_id = ? AND external_classification_id = ?
          AND review_state = 'approved' AND superseded_by_crosswalk_id IS NULL`,
      [typeId, classificationId]));
      assert.strictEqual(active.length, 1, 'exactly one active governed proposition remains');
      assert.strictEqual(Number(active[0].id), c, 'the newest row is the current truth');

      const backLink = await withConn((conn) => query(conn,
        `SELECT superseded_by_crosswalk_id FROM ${TABLE} WHERE id = ?`, [a]));
      assert.strictEqual(Number(backLink[0].superseded_by_crosswalk_id), b,
        'the original row keeps its back-link: "what did we believe, and when"');
    });

    it('32. supersession validity: self-reference and cycles are refused', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const typeId = await createEquipmentType();
      const a = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });
      const b = await addCrosswalk({ equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING' });

      await inRollback(async (conn) => {
        await conn.query('SAVEPOINT p');
        try {
          await assert.rejects(
            () => query(conn, `UPDATE ${TABLE} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [a, a]),
            (e) => isSelfSupersessionRefusal(e) || isCycleRefusal(e) || isDomainRefusal(e),
            'a row may not supersede itself');
        } finally {
          await conn.query('ROLLBACK TO SAVEPOINT p');
        }
      });

      await withConn((conn) => query(conn,
        `UPDATE ${TABLE} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [b, a]));
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `UPDATE ${TABLE} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [a, b]),
          (e) => isCycleRefusal(e),
          'a supersession cycle must be impossible');
      });
    });
  });

  // ==========================================================
  // H. IMMUTABILITY AND DELETION
  // ==========================================================
  describe('H. governed conclusions cannot be silently rewritten or erased', () => {
    it('33. an approved row cannot be rewritten except its supersession pointer', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(id);

      const attempts = [
        ['mapping_outcome', `mapping_outcome = 'RELATED_TO', relationship = 'RELATED_TO'`],
        ['relationship', `relationship = 'BROADER_THAN'`],
        ['equipment_type_id', `equipment_type_id = ${await createEquipmentType()}`],
        ['external_classification_id', `external_classification_id = ${await addClassification(versionId)}`],
        ['review_state', `review_state = 'rejected'`],
        ['approved_by_user_id', `approved_by_user_id = ${USER}`],
        ['applicability_note', `applicability_note = 'quietly edited'`],
        ['confidence_level', `confidence_level = 'uncertain'`]
      ];

      await inRollback(async (conn) => {
        for (const [field, assignment] of attempts) {
          await conn.query('SAVEPOINT p');
          try {
            await assert.rejects(
              () => query(conn, `UPDATE ${TABLE} SET ${assignment} WHERE id = ?`, [id]),
              (e) => isImmutableRefusal(e),
              `an approved row's ${field} must not be silently rewritten`);
          } finally {
            await conn.query('ROLLBACK TO SAVEPOINT p');
          }
        }
      });
    });

    it('34. draft rows remain fully editable', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'RELATED_TO'
      });
      await withConn((conn) => query(conn, `
        UPDATE ${TABLE}
        SET mapping_outcome = 'BROADER_THAN', relationship = 'BROADER_THAN',
            confidence_level = 'established', applicability_note = 'under active review'
        WHERE id = ?`, [id]));
      const rows = await withConn((conn) => query(conn,
        `SELECT mapping_outcome, confidence_level FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows[0].mapping_outcome, 'BROADER_THAN',
        'a proposal is corrected freely before it becomes governed truth');
    });

    it('35. only draft proposals may be deleted; governed rows are retained', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const draftType = await createEquipmentType();
      const draft = await addCrosswalk({ equipmentTypeId: draftType, versionId, outcome: 'NO_DIRECT_MAPPING' });
      await withConn((conn) => query(conn, `DELETE FROM ${TABLE} WHERE id = ?`, [draft]));
      const gone = await withConn((conn) => query(conn, `SELECT id FROM ${TABLE} WHERE id = ?`, [draft]));
      assert.strictEqual(gone.length, 0, 'a withdrawn draft proposal may be removed');

      for (const state of ['under_review', 'approved', 'rejected']) {
        const typeId = await createEquipmentType();
        const id = await addCrosswalk({
          equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING',
          reviewState: state === 'approved' ? 'draft' : state
        });
        // `approved` is reached through the lifecycle, never by direct insertion.
        if (state === 'approved') await approve(id);
        await inRollback(async (conn) => {
          await assert.rejects(
            () => query(conn, `DELETE FROM ${TABLE} WHERE id = ?`, [id]),
            (e) => isDeleteRefusal(e),
            `a ${state} row is governed knowledge and must be retained`);
        });
      }
    });

    it('36. a rejected proposal is retained, not discarded', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const typeId = await createEquipmentType();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, outcome: 'NO_DIRECT_MAPPING', reviewState: 'rejected'
      });
      const rows = await withConn((conn) => query(conn,
        `SELECT review_state FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows[0].review_state, 'rejected',
        '"considered and refused" must remain visible, or the same proposal is re-litigated');
    });

    it('37. deleting a referenced type, edition or concept is refused', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      for (const [label, sql, param] of [
        ['equipment type', 'DELETE FROM equipment_types WHERE id = ?', typeId],
        ['authority edition', 'DELETE FROM knowledge_source_versions WHERE id = ?', versionId],
        ['external concept', 'DELETE FROM external_classification WHERE id = ?', classificationId]
      ]) {
        await inRollback(async (conn) => {
          await assert.rejects(
            () => query(conn, sql, [param]),
            (e) => isForeignKeyViolation(e),
            `deleting the ${label} must not cascade away governed mapping history`);
        });
      }
    });
  });

  // ==========================================================
  // I. ISOLATION
  // ==========================================================
  describe('I. isolation from taxonomy, false provenance and standards data', () => {
    it('38. creating a crosswalk mutates no canonical Atiman taxonomy row', async () => {
      // Counts are scoped to THIS suite's synthetic namespace on purpose: the
      // sanctioned runner executes suites in parallel processes against one
      // database, so a database-global COUNT(*) would race with other suites
      // creating their own taxonomy fixtures.
      const scoped = () => withConn((conn) => query(conn, `
        SELECT
          (SELECT COUNT(*)::int FROM equipment_categories
             WHERE category_code LIKE ?) AS categories,
          (SELECT COUNT(*)::int FROM equipment_classes c
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS classes,
          (SELECT COUNT(*)::int FROM equipment_types t
             JOIN equipment_classes c ON c.id = t.class_id
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS types,
          (SELECT COUNT(*)::int FROM equipment_type_industries ti
             JOIN equipment_types t ON t.id = ti.equipment_type_id
             JOIN equipment_classes c ON c.id = t.class_id
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS type_industries`,
      [`${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`]));

      // Build every fixture the crosswalk needs FIRST, so the comparison isolates
      // the one action under test: inserting the crosswalk row itself.
      const typeId = await createEquipmentType();
      const { versionId, classificationId } = await globalEditionWithClassification();
      const before = await scoped();
      const typeBefore = await withConn((conn) => query(conn,
        'SELECT class_id, type_code, type_name FROM equipment_types WHERE id = ?', [typeId]));

      await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });

      const after = await scoped();
      const typeAfter = await withConn((conn) => query(conn,
        'SELECT class_id, type_code, type_name FROM equipment_types WHERE id = ?', [typeId]));
      assert.deepStrictEqual(after[0], before[0],
        'no canonical taxonomy row is created, altered or removed');
      assert.deepStrictEqual(typeAfter[0], typeBefore[0],
        'the referenced type row itself is untouched by crosswalk creation');
    });

    it('39. no crosswalk row derives from the legacy iso_* columns', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM ${TABLE} ec
        JOIN external_classification x ON x.id = ec.external_classification_id
        WHERE x.classification_code LIKE 'ISO14224-%' OR x.classification_code LIKE 'ISO-%'`));
      assert.strictEqual(rows[0].n, 0,
        'FALSE_PROVENANCE_REMEDIATION_REQUIRED stays separate and untouched');
    });

    it('40. no AI approval path is introduced and no external service is called', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      assert.ok(/ai_assisted/.test(sql) && /ai_assistance_detail/.test(sql),
        'the ADR provenance fields exist so an AI proposal stays distinguishable');
      assert.ok(!/http|fetch|embedding|vector|openai|llm/i.test(sql),
        'no model call, embedding, vector search or autonomous mechanism is introduced');

      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const id = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      // Marking a row AI-assisted must not make it approved.
      await withConn((conn) => query(conn,
        `UPDATE ${TABLE} SET ai_assisted = TRUE, ai_assistance_detail = '{"note":"synthetic"}'::jsonb WHERE id = ?`,
        [id]));
      const rows = await withConn((conn) => query(conn,
        `SELECT ai_assisted, review_state, approved_by_user_id FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows[0].ai_assisted, true);
      assert.strictEqual(rows[0].review_state, 'draft',
        'an AI suggestion is a proposal, never governed truth by insertion');
      assert.strictEqual(rows[0].approved_by_user_id, null,
        'AI must never populate the approver');
    });
  });
});
