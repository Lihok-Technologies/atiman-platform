/**
 * External Classification Foundation — Integration Tests
 *
 * ATM-001 M5R.3B — proves that migration 016 adds the smallest architecture-
 * correct persistence foundation for `external_classification`: the identity of
 * an external concept as defined by ONE exact external authority edition.
 *
 * Why this suite exists
 * ---------------------
 * The approved M5R.3 architecture (Option C) requires the external CONCEPT to
 * exist as a governed entity before a relationship can point at it. This suite
 * proves the foundation and, just as importantly, proves what M5R.3B is NOT:
 * it creates no crosswalk, no mapping, no mapping outcome, and it does not
 * claim the crosswalk-layer global-source invariant that M5R.3 §R.1 assigns to
 * M5R.3C.
 *
 * "The existence of external_classification MUST NOT imply that any Atiman
 * equipment Type maps to it."
 *
 * Copyright boundary: every fixture here is SYNTHETIC (`EXT-PUMP-001`,
 * "Synthetic Pump Classification"). No ISO classification, code, table, annex
 * or other licensed content is reproduced, imported or asserted. Synthetic
 * placeholder codes must never be read as real external classifications.
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
  : 'database-mutating external-classification suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const MIGRATION_FILE = '016_external_classification_foundation.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', 'postgresql', MIGRATION_FILE);

// Disposable fixtures, disjoint from every other suite's namespace.
const ORG = 998003;
const USER = 998102;
const CODE_PREFIX = 'M5R3B-';

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

/** Run `fn` in a transaction that is always rolled back (for refusal probes). */
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
 * Run `fn` inside a REPEATABLE READ transaction.
 *
 * The sanctioned PostgreSQL runner executes its suites in parallel processes
 * against one database, so a before/after comparison of a database-global count
 * is racy unless both reads come from one stable snapshot. Inside this
 * transaction concurrent suites' committed inserts are invisible, while the
 * writes made by `fn` itself remain visible.
 */
async function withStableSnapshot(fn) {
  const conn = await getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
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

const isUniqueViolation = (e) => e.code === '23505' || /duplicate key|unique constraint/i.test(e.message || '');
const isNotNullViolation = (e) => e.code === '23502' || /not-null|violates not-null/i.test(e.message || '');
const isForeignKeyViolation = (e) => e.code === '23503' || /foreign key|violates foreign key/i.test(e.message || '');
// Migration 016's guard rejects via RAISE ... USING ERRCODE = 'check_violation'.
const isCoherenceRefusal = (e) => e.code === '23514' || /check_violation/i.test(e.code || '')
  || /cannot change/i.test(e.message || '');

async function ensureFixture() {
  await withConn(async (conn) => {
    await query(conn,
      `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'M5R3B Org']);
    await query(conn,
      `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
       VALUES (?, 'm5r3b-user', 'm5r3b@test.local', 'x', 'M5R3B User', 'admin', ?, true)
       ON CONFLICT (id) DO NOTHING`,
      [USER, ORG]);
  });
}

/** A GLOBAL authority source (organization_id IS NULL). */
async function createAuthority({ code = `${CODE_PREFIX}AUTH-${UNIQ()}`, organizationId = null } = {}) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
       VALUES (?, 'engineering_standard', 'M5R3B Synthetic Authority', 'Synthetic Authority', ?)
       RETURNING id`, [code, organizationId]);
    return rows[0].id;
  });
}

async function addEdition(sourceId, designation) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
       VALUES (?, ?, 'M5R3B Synthetic Edition', 'SYNTH-REF', 'Synthetic Authority')
       RETURNING id`, [sourceId, designation]);
    return rows[0].id;
  });
}

/** An external classification owned by one exact edition. */
async function addClassification(versionId, code, label = 'Synthetic Pump Classification') {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO external_classification
         (knowledge_source_version_id, classification_code, classification_label)
       VALUES (?, ?, ?) RETURNING id`, [versionId, code, label]);
    return rows[0].id;
  });
}

const SYNTHETIC_CODE = () => `EXT-PUMP-${UNIQ()}`;

describe('External Classification Foundation (ATM-001 M5R.3B)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  after(async () => {
    // Bounded cleanup. Classifications first: the FK to knowledge_source_versions
    // is ON DELETE RESTRICT by design, so an edition cannot be removed while a
    // classification depends on it.
    await withConn(async (conn) => {
      await query(conn, `
        DELETE FROM external_classification
        WHERE knowledge_source_version_id IN (
          SELECT v.id FROM knowledge_source_versions v
          JOIN knowledge_sources s ON s.id = v.knowledge_source_id
          WHERE s.source_code LIKE ?)`, [`${CODE_PREFIX}%`]);
      await query(conn, `
        DELETE FROM knowledge_source_versions
        WHERE knowledge_source_id IN (
          SELECT id FROM knowledge_sources WHERE source_code LIKE ?)`, [`${CODE_PREFIX}%`]);
      await query(conn,
        `DELETE FROM knowledge_sources WHERE source_code LIKE ?`, [`${CODE_PREFIX}%`]);
    });
  });

  // ==========================================================
  // A. THE FOUNDATION EXISTS AND IS ADDITIVE
  // ==========================================================
  describe('A. the migration adds exactly the approved foundation', () => {
    it('1. external_classification exists as a base table', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'external_classification'
          AND table_type = 'BASE TABLE'
      `));
      assert.strictEqual(rows.length, 1, 'migration 016 must create external_classification');
    });

    it('2. the edition foreign key is enforced and is ON DELETE RESTRICT', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'fk_external_classification_source_version'
      `));
      assert.strictEqual(rows.length, 1, 'the edition FK must exist by its exact name');
      assert.ok(rows[0].d.includes('knowledge_source_versions(id)'),
        'the FK must target knowledge_source_versions(id) — the edition, not the authority');
      assert.ok(rows[0].d.includes('ON DELETE RESTRICT'),
        'edition history is delete-protected: deleting an edition must not destroy classifications');
      assert.ok(!rows[0].d.includes('CASCADE'),
        'CASCADE would silently destroy governed reference knowledge');
    });

    it('3. uniqueness is scoped to the EDITION, not the authority', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'uq_external_classification_version_code'
      `));
      assert.strictEqual(rows.length, 1, 'the edition-scoped uniqueness constraint must exist');
      assert.ok(/UNIQUE \(knowledge_source_version_id, classification_code\)/.test(rows[0].d),
        'identity must be (edition, code); scoping to knowledge_source_id would lose edition specificity');
    });

    it('4. the edition-coherence trigger is installed as BEFORE UPDATE', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT t.tgname, t.tgenabled, p.proname,
               pg_get_triggerdef(t.oid) AS d
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = 'external_classification' AND NOT t.tgisinternal
      `));
      assert.strictEqual(rows.length, 1, 'exactly one trigger belongs to external_classification');
      assert.strictEqual(rows[0].tgname, 'trg_external_classification_edition_coherence');
      assert.strictEqual(rows[0].proname, 'external_classification_edition_coherence_check');
      assert.ok(/BEFORE UPDATE/.test(rows[0].d), 'the coherence guard must run BEFORE UPDATE');
    });

    it('5. creating an external classification creates no crosswalk knowledge', async () => {
      // Baseline note (ATM-001 M5R.3C -> M5R.3D): this assertion was originally a
      // SCHEMA-EXISTENCE proxy — "the crosswalk relation does not exist yet" —
      // which later slices legitimately invalidated by building the governed
      // crosswalk (017) and crosswalk evidence (018). A schema snapshot cannot
      // express this suite's claim, which is behavioural: an external concept is
      // NOT a mapping. That claim is now asserted directly, scoped to the concept
      // created here, alongside the structural claim this test always made.
      const versionId = await addEdition(await createAuthority(), '2016');
      const classificationId = await addClassification(versionId, SYNTHETIC_CODE());

      const crosswalkRows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM equipment_type_external_classification
        WHERE external_classification_id = ?`, [classificationId]));
      assert.strictEqual(crosswalkRows[0].n, 0,
        'creating an external concept is not a mapping and implies none');

      const mappingColumns = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'external_classification'
          AND column_name IN ('mapping_outcome', 'review_state', 'relationship',
                              'equipment_type_id', 'superseded_by_crosswalk_id',
                              'proposed_by_user_id', 'approved_by_user_id')
      `));
      assert.strictEqual(mappingColumns.length, 0,
        'external classification carries no mapping or crosswalk governance column');
    });

    it('6. existing 001-015 objects remain intact', async () => {
      const tables = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('knowledge_sources', 'knowledge_source_versions',
                             'knowledge_template_evidence', 'knowledge_template_version_evidence',
                             'equipment_types', 'equipment_classes', 'equipment_categories',
                             'activity_codes', 'cause_codes')
      `));
      assert.strictEqual(tables.length, 9, 'every pre-existing provenance/taxonomy table survives');

      const guards = await withConn((conn) => query(conn, `
        SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND proname IN (
          'knowledge_sources_identity_lock_check', 'immutable_source_version_check',
          'provenance_tenant_scope_check', 'knowledge_source_version_uploaded_file_scope_check')
      `));
      assert.strictEqual(guards.length, 4, 'migration 011 guard functions remain installed');
    });

    it('7. the migration file contains STRUCTURE only — no data population', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      assert.ok(/CREATE TABLE IF NOT EXISTS external_classification/.test(sql));
      assert.ok(/DROP TRIGGER IF EXISTS[\s\S]*CREATE TRIGGER/.test(sql),
        'idempotency convention: drop-if-exists before create');
      assert.ok(!/INSERT\s+INTO/i.test(sql),
        'migration 016 must not populate any row — it creates structure, not a standards database');
      assert.ok(!/14224/.test(sql),
        'no standard-specific content may appear in the schema definition');
      assert.ok(!/ALTER\s+TABLE/i.test(sql),
        'migration 016 is purely additive for existing objects: it alters no existing table');
      assert.ok(!/\bDROP\s+TABLE\b|\bRENAME\b|\bDROP\s+COLUMN\b|\bDROP\s+CONSTRAINT\b/i.test(sql),
        'no destructive or renaming DDL may appear');
    });
  });

  // ==========================================================
  // B. EDITION IDENTITY IS MANDATORY AND MEANINGFUL
  // ==========================================================
  describe('B. every classification belongs to one exact edition', () => {
    it('8. a classification with no source version is rejected', async () => {
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `INSERT INTO external_classification (knowledge_source_version_id, classification_code, classification_label)
             VALUES (NULL, ?, 'Orphaned')`, [SYNTHETIC_CODE()]),
          (e) => isNotNullViolation(e),
          'knowledge_source_version_id is mandatory: "which edition defines this" can never be absent');
      });
    });

    it('9. an unknown source version is rejected by the foreign key', async () => {
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `INSERT INTO external_classification (knowledge_source_version_id, classification_code, classification_label)
             VALUES (?, ?, 'Unknown edition')`, [2147483000, SYNTHETIC_CODE()]),
          (e) => isForeignKeyViolation(e),
          'a classification cannot reference an edition that does not exist');
      });
    });

    it('10. a global synthetic authority edition can own a classification', async () => {
      const sourceId = await createAuthority();
      const versionId = await addEdition(sourceId, '2016');
      const code = SYNTHETIC_CODE();
      const classificationId = await addClassification(versionId, code, 'Synthetic Pump Classification');

      const rows = await withConn((conn) => query(conn, `
        SELECT ec.id, ec.classification_code, ec.classification_label,
               ec.knowledge_source_version_id, v.version_designation,
               s.organization_id, s.source_category
        FROM external_classification ec
        JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
        JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE ec.id = ?
      `, [classificationId]));

      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].classification_code, code);
      assert.strictEqual(rows[0].organization_id, null, 'the defining authority is global');
      assert.strictEqual(Number(rows[0].knowledge_source_version_id), versionId);
      assert.strictEqual(rows[0].version_designation, '2016');
    });
  });

  // ==========================================================
  // C. UNIQUENESS WITHIN AN EDITION — AND ONLY WITHIN IT
  // ==========================================================
  describe('C. duplicate identity within an edition is prevented; across editions it is legitimate', () => {
    it('11. the same code twice in the same edition is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const code = SYNTHETIC_CODE();
      await addClassification(versionId, code);

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `INSERT INTO external_classification (knowledge_source_version_id, classification_code, classification_label)
             VALUES (?, ?, 'Duplicate concept in the same edition')`, [versionId, code]),
          (e) => isUniqueViolation(e),
          'a concept is defined once per edition — otherwise the crosswalk has two answers');
      });
    });

    it('12. the same code in a DIFFERENT edition is allowed and is a distinct concept', async () => {
      const sourceId = await createAuthority();
      const v2016 = await addEdition(sourceId, '2016');
      const v2024 = await addEdition(sourceId, '2024');
      const code = SYNTHETIC_CODE();

      const first = await addClassification(v2016, code, 'Synthetic concept (2016 wording)');
      const second = await addClassification(v2024, code, 'Synthetic concept (2024 wording)');

      assert.notStrictEqual(first, second, 'edition-specific identities must be separately representable');
      const rows = await withConn((conn) => query(conn, `
        SELECT ec.id, ec.classification_label, v.version_designation
        FROM external_classification ec
        JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
        WHERE ec.classification_code = ? AND v.knowledge_source_id = ?
        ORDER BY v.version_designation
      `, [code, sourceId]));
      assert.strictEqual(rows.length, 2, 'the same code exists independently in two editions');
      assert.deepStrictEqual(rows.map((r) => r.version_designation), ['2016', '2024']);
      assert.notStrictEqual(rows[0].classification_label, rows[1].classification_label,
        'an edition may legitimately re-word a concept; each edition keeps its own truth');
    });

    it('13. the same code may exist under a different authority', async () => {
      const code = SYNTHETIC_CODE();
      const v1 = await addEdition(await createAuthority(), '1.0');
      const v2 = await addEdition(await createAuthority(), '1.0');
      const a = await addClassification(v1, code, 'Synthetic concept (authority A)');
      const b = await addClassification(v2, code, 'Synthetic concept (authority B)');
      assert.notStrictEqual(a, b, 'two authorities may legitimately share a code with different meanings');
    });
  });

  // ==========================================================
  // D. IDENTITY IS NOT SILENTLY REWRITABLE
  // ==========================================================
  describe('D. the defining edition and identity code are fixed for the life of the row', () => {
    it('14. neither the defining edition nor the code can be rewritten', async () => {
      const sourceId = await createAuthority();
      const v2016 = await addEdition(sourceId, '2016');
      const v2024 = await addEdition(sourceId, '2024');
      const classificationId = await addClassification(v2016, SYNTHETIC_CODE());

      const probe = async (conn, sql, params, message) => {
        await conn.query('SAVEPOINT probe');
        try {
          await assert.rejects(() => query(conn, sql, params), (e) => isCoherenceRefusal(e), message);
        } finally {
          await conn.query('ROLLBACK TO SAVEPOINT probe');
        }
      };

      await inRollback(async (conn) => {
        await probe(conn,
          'UPDATE external_classification SET knowledge_source_version_id = ? WHERE id = ?',
          [v2024, classificationId],
          'the defining edition cannot change: that would retroactively rewrite what the row means');
        await probe(conn,
          'UPDATE external_classification SET classification_code = ? WHERE id = ?',
          [`REWRITTEN-${UNIQ()}`, classificationId],
          'the identity code cannot change; a re-scoped concept is a NEW row for the NEW edition');
      });

      // The row is still exactly what it was.
      const rows = await withConn((conn) => query(conn,
        'SELECT knowledge_source_version_id FROM external_classification WHERE id = ?', [classificationId]));
      assert.strictEqual(Number(rows[0].knowledge_source_version_id), v2016);
    });

    it('15. display and availability fields remain updatable', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      const classificationId = await addClassification(versionId, SYNTHETIC_CODE());

      await withConn((conn) => query(conn, `
        UPDATE external_classification
        SET classification_label = ?, classification_path = ?, description = ?, is_active = FALSE
        WHERE id = ?`, ['Corrected label', 'A/B/C', 'Synthetic description', classificationId]));

      const rows = await withConn((conn) => query(conn,
        'SELECT classification_label, classification_path, description, is_active FROM external_classification WHERE id = ?',
        [classificationId]));
      assert.strictEqual(rows[0].classification_label, 'Corrected label');
      assert.strictEqual(rows[0].classification_path, 'A/B/C');
      assert.strictEqual(rows[0].is_active, false,
        'is_active is reference availability, not crosswalk governance');
    });
  });

  // ==========================================================
  // E. DELETION PROTECTS GOVERNED REFERENCE KNOWLEDGE
  // ==========================================================
  describe('E. an edition that defines a classification cannot be silently destroyed', () => {
    it('16. deleting a referenced edition is refused; deleting the classification first succeeds', async () => {
      const sourceId = await createAuthority();
      const versionId = await addEdition(sourceId, '2016');
      const classificationId = await addClassification(versionId, SYNTHETIC_CODE());

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'DELETE FROM knowledge_source_versions WHERE id = ?', [versionId]),
          (e) => isForeignKeyViolation(e) || isCoherenceRefusal(e),
          'edition history is not deletable while it defines a classification');
      });

      // The same deletion is permitted once nothing depends on the edition —
      // RESTRICT is a dependency guard, not an unreachable tombstone.
      await withConn(async (conn) => {
        await query(conn, 'DELETE FROM external_classification WHERE id = ?', [classificationId]);
        await query(conn, 'DELETE FROM knowledge_source_versions WHERE id = ?', [versionId]);
      });
      const rows = await withConn((conn) => query(conn,
        'SELECT id FROM knowledge_source_versions WHERE id = ?', [versionId]));
      assert.strictEqual(rows.length, 0, 'once unreferenced, the edition is removable');
      assert.ok(sourceId);
    });

    it('17. deleting the parent authority cannot silently destroy classifications', async () => {
      const sourceId = await createAuthority();
      const versionId = await addEdition(sourceId, '2016');
      await addClassification(versionId, SYNTHETIC_CODE());

      await inRollback(async (conn) => {
        // knowledge_source_versions cascades from knowledge_sources, but the
        // cascade cannot pass through the RESTRICT guard on external_classification.
        await assert.rejects(
          () => query(conn, 'DELETE FROM knowledge_sources WHERE id = ?', [sourceId]),
          (e) => isForeignKeyViolation(e) || isCoherenceRefusal(e),
          'removing an authority must not cascade away governed reference knowledge');
      });

      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM external_classification WHERE knowledge_source_version_id = ?`,
        [versionId]));
      assert.strictEqual(rows[0].n, 1, 'the classification survived the refused delete');
    });
  });

  // ==========================================================
  // F. WHAT M5R.3B DOES *NOT* DO
  // ==========================================================
  describe('F. M5R.3B claims nothing beyond external concept identity', () => {
    it('18. creating a classification mutates no equipment taxonomy', async () => {
      // REPEATABLE READ is deliberate: the sanctioned runner executes its suites
      // in parallel processes against ONE database, so a plain before/after
      // global COUNT(*) would race with other suites creating their own taxonomy
      // fixtures. Both reads therefore come from a single stable snapshot, while
      // the classification creation below is still made by this transaction.
      const counts = (conn) => query(conn, `
        SELECT (SELECT COUNT(*)::int FROM equipment_types) AS types,
               (SELECT COUNT(*)::int FROM equipment_classes) AS classes,
               (SELECT COUNT(*)::int FROM equipment_categories) AS categories`);

      const { before, after } = await withStableSnapshot(async (conn) => {
        const beforeRows = await counts(conn);
        const source = await query(conn,
          `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
           VALUES (?, 'engineering_standard', 'M5R3B Synthetic Authority', NULL) RETURNING id`,
          [`M5R3B-AUTH-${UNIQ()}`]);
        const version = await query(conn,
          `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
           VALUES (?, '2016', 'M5R3B Synthetic Edition') RETURNING id`, [source[0].id]);
        await query(conn,
          `INSERT INTO external_classification
             (knowledge_source_version_id, classification_code, classification_label)
           VALUES (?, ?, 'Synthetic Pump Classification')`, [version[0].id, SYNTHETIC_CODE()]);
        const afterRows = await counts(conn);
        return { before: beforeRows, after: afterRows };
      });

      assert.deepStrictEqual(after[0], before[0],
        'Atiman canonical identity (Category -> Class -> Type) is unchanged by external concept identity');
    });

    it('19. no mapping is implied — no crosswalk, and no Atiman type is referenced', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      await addClassification(versionId, SYNTHETIC_CODE());

      const crosswalk = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE '%crosswalk%'
      `));
      assert.strictEqual(crosswalk.length, 0, 'no crosswalk relation of any name exists');

      const columns = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'external_classification'
      `));
      const names = columns.map((c) => c.column_name).sort();
      assert.deepStrictEqual(names, [
        'classification_code', 'classification_label', 'classification_path',
        'created_at', 'description', 'id', 'is_active',
        'knowledge_source_version_id', 'updated_at'
      ], 'external_classification carries NO equipment_type reference of any kind');
    });

    it('20. the legacy iso_* reference columns are not consulted', async () => {
      // FALSE_PROVENANCE_REMEDIATION_REQUIRED stays separate: no classification
      // may be synthesised from unverifiable legacy labels.
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM external_classification
        WHERE classification_code LIKE 'ISO14224-%'
      `));
      assert.strictEqual(rows[0].n, 0,
        'no external classification may be derived from the unverified legacy labels');
    });

    it('21. M5R.3B does NOT claim the crosswalk-layer global-source invariant', async () => {
      // M5R.3 §R.1 assigns the mandatory global-source guard to crosswalk and
      // evidence ROWS, and §AJ assigns its trigger to M5R.3C. M5R.3B deliberately
      // does not move that guard down to external_classification, so a
      // tenant-scoped edition CAN own a classification here.
      //
      // This is recorded as an intentional, bounded non-claim — NOT as a
      // guarantee. The invariant that a GLOBAL crosswalk may never reference a
      // tenant-scoped source or evidence remains OWED TO M5R.3C, where
      // §W.3 trigger 3 (crosswalk edition equality) plus §R.1 together make a
      // tenant-scoped classification unreachable from a global crosswalk.
      const tenantSourceId = await createAuthority({ organizationId: ORG });
      const tenantVersionId = await addEdition(tenantSourceId, '2016');

      const classificationId = await addClassification(tenantVersionId, SYNTHETIC_CODE(),
        'Synthetic tenant-scoped concept');
      const rows = await withConn((conn) => query(conn, `
        SELECT s.organization_id FROM external_classification ec
        JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
        JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE ec.id = ?`, [classificationId]));
      assert.strictEqual(Number(rows[0].organization_id), ORG,
        'M5R.3B adds no global-scope guard: it is M5R.3C that must reject a global crosswalk referencing this');

      const guard = await withConn((conn) => query(conn, `
        SELECT p.proname, pg_get_functiondef(p.oid) AS d
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE c.relname = 'external_classification' AND NOT t.tgisinternal
      `));
      assert.strictEqual(guard.length, 1, 'exactly one guard function is attached');
      assert.ok(!/organization_id/.test(guard[0].d),
        'no global-source guard may be attached to external_classification in M5R.3B');
    });
  });
});
