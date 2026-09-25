/**
 * Crosswalk Evidence Foundation — Integration Tests
 *
 * ATM-001 M5R.3D — proves migration 018 implements the approved M5R.3 evidence
 * model, and proves just as carefully what it deliberately does NOT do.
 *
 * TWO PROPOSITIONS THAT MUST STAY DISTINGUISHABLE (M5R.3 §P)
 *   external_classification_id -> "This external concept exists and denotes X."
 *   crosswalk_id               -> "Atiman's relationship to it is defensible."
 * Exactly one subject per row: never both, never neither.
 *
 * It also proves a deliberate NON-claim: the ADR states (§O) that an approved
 * NO_DIRECT_MAPPING must carry relationship evidence, and §AG records that
 * enforcing ">=1 evidence row" "remains a service/domain rule — consistent with
 * migration 013's documented boundary". This suite therefore asserts that the
 * database does NOT enforce that requirement, so its absence cannot later be
 * mistaken for an oversight.
 *
 * Copyright boundary: every fixture is SYNTHETIC — synthetic authorities,
 * editions, classification codes and evidence locators such as "SYNTH-1.1".
 * No ISO/IEC/API/ASME/DIN classification, clause, annex or excerpt is
 * reproduced, imported or asserted, and no standards content is populated.
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
  : 'database-mutating crosswalk-evidence suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

const MIGRATION_FILE = '018_external_classification_crosswalk_evidence.sql';
const MIGRATION_PATH = path.join(__dirname, '..', 'database', 'postgresql', MIGRATION_FILE);
const TABLE = 'equipment_type_external_classification_evidence';
const CROSSWALK = 'equipment_type_external_classification';

const ORG = 997201;
const USER = 997202;
const OTHER_USER = 997203;
const CODE_PREFIX = 'M5R3D-';
const CATEGORY_PREFIX = 'M5R3DCAT-';

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

const isNotNullViolation = (e) => e.code === '23502' || /not-null/i.test(e.message || '');
const isForeignKeyViolation = (e) => e.code === '23503' || /violates foreign key/i.test(e.message || '');
const isSubjectRefusal = (e) => /chk_equipment_type_external_classification_evidence_subject/.test(e.message || '');
const isConfidenceRefusal = (e) => /chk_equipment_type_external_classification_evidence_confidence/.test(e.message || '');
const isRoleRefusal = (e) => /chk_equipment_type_external_classification_evidence_role/.test(e.message || '');
const isEvidenceScopeRefusal = (e) => /crosswalk evidence .* may not cite tenant-scoped knowledge_source/.test(e.message || '');
const isCrosswalkDeleteRefusal = (e) => /cannot be deleted; only draft proposals are deletable/.test(e.message || '');

async function ensureFixture() {
  await withConn(async (conn) => {
    await query(conn,
      `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
      [ORG, 'M5R3D Org']);
    for (const [id, name] of [[USER, 'm5r3d-user'], [OTHER_USER, 'm5r3d-approver']]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', ?, 'admin', ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, name, `${name}@test.local`, name, ORG]);
    }
  });
}

async function createEquipmentType() {
  const tag = UNIQ();
  return withConn(async (conn) => {
    const cat = await query(conn,
      `INSERT INTO equipment_categories (category_code, category_name) VALUES (?, ?) RETURNING id`,
      [`${CATEGORY_PREFIX}${tag}`, `M5R3D Category ${tag}`]);
    const cls = await query(conn,
      `INSERT INTO equipment_classes (category_id, class_code, class_name) VALUES (?, ?, ?) RETURNING id`,
      [cat[0].id, `${CODE_PREFIX}CLS-${tag}`, `M5R3D Class ${tag}`]);
    const typ = await query(conn,
      `INSERT INTO equipment_types (class_id, type_code, type_name) VALUES (?, ?, ?) RETURNING id`,
      [cls[0].id, `${CODE_PREFIX}TYP-${tag}`, `M5R3D Type ${tag}`]);
    return typ[0].id;
  });
}

/** organizationId NULL = global authority; non-null = tenant-scoped authority. */
async function createAuthority({ organizationId = null } = {}) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
       VALUES (?, 'engineering_standard', 'M5R3D Synthetic Authority', 'Synthetic Authority', ?)
       RETURNING id`, [`${CODE_PREFIX}AUTH-${UNIQ()}`, organizationId]);
    return rows[0].id;
  });
}

async function addEdition(sourceId, designation) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
       VALUES (?, ?, 'M5R3D Synthetic Edition', 'SYNTH-REF', 'Synthetic Authority')
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

async function addCrosswalk({
  equipmentTypeId, versionId, classificationId = null,
  outcome = 'DIRECT_EQUIVALENT', reviewState = 'draft'
}) {
  return withConn(async (conn) => {
    const relationship = outcome === 'NO_DIRECT_MAPPING' ? null : outcome;
    const rows = await query(conn,
      `INSERT INTO ${CROSSWALK}
         (equipment_type_id, knowledge_source_version_id, external_classification_id,
          relationship, mapping_outcome, review_state)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      [equipmentTypeId, versionId, classificationId, relationship, outcome, reviewState]);
    return rows[0].id;
  });
}

async function approve(crosswalkId) {
  return withConn((conn) => query(conn, `
    UPDATE ${CROSSWALK}
    SET review_state = 'approved', reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
        approved_by_user_id = ?, approved_at = CURRENT_TIMESTAMP
    WHERE id = ?`, [USER, OTHER_USER, crosswalkId]));
}

/** An evidence row substantiating EITHER a concept OR a relationship. */
async function addEvidence({
  versionId,
  classificationId = null,
  crosswalkId = null,
  confidence = 'provisional',
  role = 'supporting',
  section = 'SYNTH-1.1',
  page = 'p. 1',
  notes = 'Synthetic derivation note'
}) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO ${TABLE}
         (knowledge_source_version_id, external_classification_id, crosswalk_id,
          section_or_clause, page_or_paragraph, derivation_notes,
          confidence_level, supporting_role, added_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [versionId, classificationId, crosswalkId, section, page, notes, confidence, role, USER]);
    return rows[0].id;
  });
}

/** A global authority edition owning one classification, ready to crosswalk. */
async function globalEditionWithClassification() {
  const versionId = await addEdition(await createAuthority(), '2016');
  const classificationId = await addClassification(versionId);
  return { versionId, classificationId };
}

/** An approved crosswalk of the given outcome, with its own concept. */
async function approvedCrosswalk(outcome = 'DIRECT_EQUIVALENT') {
  const typeId = await createEquipmentType();
  const { versionId, classificationId } = await globalEditionWithClassification();
  const id = await addCrosswalk({
    equipmentTypeId: typeId, versionId,
    classificationId: outcome === 'NO_DIRECT_MAPPING' ? null : classificationId,
    outcome
  });
  await approve(id);
  return { crosswalkId: id, typeId, versionId, classificationId };
}

describe('Crosswalk Evidence Foundation (ATM-001 M5R.3D)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  after(async () => {
    // Evidence rows are detachable by design (M5R.3 section AC provides an
    // attach/detach capability), so this suite CAN clean them up. Crosswalk rows
    // it drove to approved are governed knowledge and are deliberately left in
    // place: removing them would require defeating M5R.3C's delete guard, and
    // RESTRICT correctly prevents their referenced fixtures from going either.
    await withConn(async (conn) => {
      await query(conn, `
        DELETE FROM ${TABLE}
        WHERE knowledge_source_version_id IN (
          SELECT v.id FROM knowledge_source_versions v
          JOIN knowledge_sources s ON s.id = v.knowledge_source_id
          WHERE s.source_code LIKE ?)`, [`${CODE_PREFIX}%`]);
      await query(conn, `
        DELETE FROM ${CROSSWALK}
        WHERE review_state = 'draft'
          AND knowledge_source_version_id IN (
            SELECT v.id FROM knowledge_source_versions v
            JOIN knowledge_sources s ON s.id = v.knowledge_source_id
            WHERE s.source_code LIKE ?)`, [`${CODE_PREFIX}%`]);
    });
  });

  // ==========================================================
  // A. FOUNDATION
  // ==========================================================
  describe('A. migration 018 adds exactly the approved evidence foundation', () => {
    it('1. the evidence relation exists as a base table', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ? AND table_type = 'BASE TABLE'`, [TABLE]));
      assert.strictEqual(rows.length, 1, 'migration 018 must create the evidence relation');
    });

    it('2. the schema is exactly the approved one — no speculative fields', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?`, [TABLE]));
      assert.deepStrictEqual(rows.map((r) => r.column_name).sort(), [
        'added_at', 'added_by_user_id', 'confidence_level', 'crosswalk_id',
        'derivation_notes', 'external_classification_id', 'id',
        'knowledge_source_version_id', 'page_or_paragraph',
        'section_or_clause', 'supporting_role'
      ], 'no embeddings, vectors, extracted text, OCR content, chunks, model scores or metadata JSON');
    });

    it('3. exactly the approved indexes exist — nothing unrelated', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT indexname FROM pg_indexes WHERE tablename = ? ORDER BY indexname`, [TABLE]));
      assert.deepStrictEqual(rows.map((r) => r.indexname).sort(), [
        'equipment_type_external_classification_evidence_pkey',
        'idx_equipment_type_external_classification_evidence_crosswalk',
        'idx_equipment_type_external_classification_evidence_ext_class'
      ], 'the two approved read-path indexes plus the primary key');
    });

    it('4. the approved deletion behavior is installed', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT conname, pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conrelid = ?::regclass AND contype = 'f'`, [TABLE]));
      const defs = Object.fromEntries(rows.map((r) => [r.conname, r.d]));
      assert.strictEqual(rows.length, 3, 'exactly three foreign keys');

      assert.ok(defs.fk_equipment_type_external_classification_evidence_src_version
        .includes('knowledge_source_versions(id)'));
      assert.ok(defs.fk_equipment_type_external_classification_evidence_src_version
        .includes('ON DELETE RESTRICT'),
      'an edition that evidence depends on must not be deletable (section AG)');
      assert.ok(!defs.fk_equipment_type_external_classification_evidence_src_version.includes('CASCADE'));

      assert.ok(defs.fk_equipment_type_external_classification_evidence_ext_class
        .includes('external_classification(id)'));
      assert.ok(defs.fk_equipment_type_external_classification_evidence_ext_class
        .includes('ON DELETE CASCADE'), 'evidence dies with its subject, mirroring migration 011');
      assert.ok(defs.fk_equipment_type_external_classification_evidence_crosswalk
        .includes('equipment_type_external_classification(id)'));
      assert.ok(defs.fk_equipment_type_external_classification_evidence_crosswalk
        .includes('ON DELETE CASCADE'));
    });

    it('5. the migration file is STRUCTURE only', async () => {
      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      // Assert against CODE, not prose: this migration's header deliberately
      // NAMES the mechanisms it does not use ("no model call, embeddings,
      // vector search"), so scanning comments would flag its own disclaimer.
      const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

      assert.ok(/CREATE TABLE IF NOT EXISTS equipment_type_external_classification_evidence/.test(code));
      assert.ok(!/INSERT\s+INTO/i.test(code), 'migration 018 must populate nothing');
      assert.ok(!/ALTER\s+TABLE/i.test(code),
        'purely additive: no existing table is altered, so 001-017 semantics cannot shift');
      assert.ok(!/\bDROP\s+TABLE\b|\bRENAME\b|\bDROP\s+COLUMN\b|\bDROP\s+CONSTRAINT\b/i.test(code),
        'no destructive or renaming DDL');
      assert.ok(!/iso_maintenance_reference|iso_failure_cause_reference/i.test(code),
        'false-provenance legacy columns must not be consulted');
      assert.ok(!/\b(ISO|IEC|ASME|DIN|API)\s?\d/i.test(code), 'no standards content may appear');
      assert.ok(!/embedding|vector|openai|\bllm\b|http/i.test(code),
        'no AI or document-ingestion mechanism');
    });
  });

  // ==========================================================
  // B. EXACTLY ONE SUBJECT
  // ==========================================================
  describe('B. one evidence record substantiates exactly one subject', () => {
    it('6. external-classification-only evidence succeeds', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const id = await addEvidence({ versionId, classificationId, notes: 'concept exists' });
      const rows = await withConn((conn) => query(conn,
        `SELECT external_classification_id, crosswalk_id FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(Number(rows[0].external_classification_id), classificationId);
      assert.strictEqual(rows[0].crosswalk_id, null);
    });

    it('7. crosswalk-only evidence succeeds', async () => {
      const { crosswalkId, versionId } = await approvedCrosswalk();
      const id = await addEvidence({ versionId, crosswalkId, notes: 'review concluded' });
      const rows = await withConn((conn) => query(conn,
        `SELECT external_classification_id, crosswalk_id FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows[0].external_classification_id, null);
      assert.strictEqual(Number(rows[0].crosswalk_id), crosswalkId);
    });

    it('8. evidence with NO subject is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, section_or_clause)
            VALUES (?, 'SYNTH-1.1')`, [versionId]),
          (e) => isSubjectRefusal(e),
          'evidence that substantiates nothing is not evidence');
      });
    });

    it('9. evidence with BOTH subjects is rejected', async () => {
      const { crosswalkId, versionId, classificationId } = await approvedCrosswalk();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (knowledge_source_version_id, external_classification_id, crosswalk_id)
            VALUES (?, ?, ?)`, [versionId, classificationId, crosswalkId]),
          (e) => isSubjectRefusal(e),
          'conflating the two propositions is exactly what section P forbids');
      });
    });

    it('10. the subject CHECK is a real database constraint, not application logic', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'chk_equipment_type_external_classification_evidence_subject'`));
      assert.strictEqual(rows.length, 1, 'the constraint exists by its exact name');
      const d = rows[0].d.replace(/[()]/g, ' ');
      assert.ok(/external_classification_id IS NOT NULL/.test(d) && /crosswalk_id IS NULL/.test(d),
        'the XOR is expressed over both subject columns');
      assert.ok(/OR/.test(d), 'both valid branches are present');

      // Raw SQL, bypassing every model/route, is still refused — that is the point.
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `INSERT INTO ${TABLE} (knowledge_source_version_id) VALUES (2147483000)`),
          (e) => isSubjectRefusal(e) || isNotNullViolation(e) || isForeignKeyViolation(e));
      });
    });
  });

  // ==========================================================
  // C. PROVENANCE
  // ==========================================================
  describe('C. every evidence row names the exact governed source edition', () => {
    it('11. knowledge_source_version_id is mandatory', async () => {
      const { classificationId } = await globalEditionWithClassification();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (external_classification_id, section_or_clause)
            VALUES (?, 'SYNTH-1.1')`, [classificationId]),
          (e) => isNotNullViolation(e),
          'a source name is never sufficient: only a resolvable edition is auditable');
      });
    });

    it('12. an unknown source version is rejected', async () => {
      const { classificationId } = await globalEditionWithClassification();
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, external_classification_id)
            VALUES (2147483000, ?)`, [classificationId]),
          (e) => isForeignKeyViolation(e));
      });
    });

    it('13. evidence MAY cite a different governed edition than its subject (deliberate non-equality)', async () => {
      // The ADR requires edition equality only where it says so — for the
      // crosswalk and the classification it references (section W.3.3). It says
      // nothing of the kind for evidence, because a corroborating source is
      // legitimately a different edition: here a second synthetic authority
      // corroborates a relationship asserted against the first.
      const { crosswalkId } = await approvedCrosswalk();
      const corroboratingEdition = await addEdition(
        await createAuthority(), '2019');

      const id = await addEvidence({
        versionId: corroboratingEdition, crosswalkId,
        notes: 'independent corroboration from a separate synthetic authority'
      });
      const rows = await withConn((conn) => query(conn, `
        SELECT e.knowledge_source_version_id, ec.knowledge_source_version_id AS subject_edition
        FROM ${TABLE} e JOIN ${CROSSWALK} ec ON ec.id = e.crosswalk_id
        WHERE e.id = ?`, [id]));
      assert.notStrictEqual(
        Number(rows[0].knowledge_source_version_id),
        Number(rows[0].subject_edition),
        'requiring equality would silently narrow the approved architecture'
      );
    });

    it('14. provenance is reused, not duplicated onto the evidence relation', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ?
          AND column_name IN ('issuing_organization', 'reference_number',
                              'version_designation', 'source_code', 'source_category',
                              'organization_id', 'publisher', 'standard_name')`, [TABLE]));
      assert.strictEqual(rows.length, 0,
        'authority, edition and standard identity all resolve through knowledge_source_versions');
    });
  });

  // ==========================================================
  // D. REFERENTIAL INTEGRITY
  // ==========================================================
  describe('D. unknown subjects are refused', () => {
    it('15. an unknown external classification is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, external_classification_id)
            VALUES (?, 2147483000)`, [versionId]),
          (e) => isForeignKeyViolation(e));
      });
    });

    it('16. an unknown crosswalk is rejected', async () => {
      const versionId = await addEdition(await createAuthority(), '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, crosswalk_id)
            VALUES (?, 2147483000)`, [versionId]),
          (e) => isForeignKeyViolation(e));
      });
    });
  });

  // ==========================================================
  // E. VOCABULARIES
  // ==========================================================
  describe('E. confidence and supporting role reuse the existing vocabulary', () => {
    it('17. all four approved confidence values are accepted', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      for (const confidence of ['established', 'provisional', 'experimental', 'uncertain']) {
        const id = await addEvidence({ versionId, classificationId, confidence });
        const rows = await withConn((conn) => query(conn,
          `SELECT confidence_level FROM ${TABLE} WHERE id = ?`, [id]));
        assert.strictEqual(rows[0].confidence_level, confidence);
      }
    });

    it('18. an invalid confidence value is rejected', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      await inRollback(async (conn) => {
        for (const bad of ['high', 'low', 'CERTAIN', 'unverified']) {
          await conn.query('SAVEPOINT p');
          try {
            await assert.rejects(
              () => query(conn, `
                INSERT INTO ${TABLE}
                  (knowledge_source_version_id, external_classification_id, confidence_level)
                VALUES (?, ?, ?)`, [versionId, classificationId, bad]),
              (e) => isConfidenceRefusal(e),
              `${bad} must not be an accepted confidence value`);
          } finally {
            await conn.query('ROLLBACK TO SAVEPOINT p');
          }
        }
      });
    });

    it('19. both approved supporting roles are accepted, and an invalid one is rejected', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      for (const role of ['primary', 'supporting']) {
        const id = await addEvidence({ versionId, classificationId, role });
        const rows = await withConn((conn) => query(conn,
          `SELECT supporting_role FROM ${TABLE} WHERE id = ?`, [id]));
        assert.strictEqual(rows[0].supporting_role, role);
      }
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE}
              (knowledge_source_version_id, external_classification_id, supporting_role)
            VALUES (?, ?, 'secondary')`, [versionId, classificationId]),
          (e) => isRoleRefusal(e));
      });
    });
  });

  // ==========================================================
  // F. THE TWO PROPOSITIONS
  // ==========================================================
  describe('F. concept evidence and relationship evidence stay distinguishable', () => {
    it('20. evidence can substantiate a MAPPED relationship', async () => {
      const { crosswalkId, versionId } = await approvedCrosswalk('DIRECT_EQUIVALENT');
      const id = await addEvidence({
        versionId, crosswalkId, role: 'primary', confidence: 'established',
        notes: 'engineering review concluding equivalence'
      });
      const rows = await withConn((conn) => query(conn, `
        SELECT e.supporting_role, ec.mapping_outcome FROM ${TABLE} e
        JOIN ${CROSSWALK} ec ON ec.id = e.crosswalk_id WHERE e.id = ?`, [id]));
      assert.strictEqual(rows[0].supporting_role, 'primary');
      assert.strictEqual(rows[0].mapping_outcome, 'DIRECT_EQUIVALENT');
    });

    it('21. evidence can substantiate an approved NO_DIRECT_MAPPING without a fabricated classification', async () => {
      // "We investigated and found nothing" is positive engineering knowledge
      // (section H.0 state 3), so its evidence attaches to the RELATIONSHIP.
      const { versionId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const crosswalkId = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId: null, outcome: 'NO_DIRECT_MAPPING'
      });

      // Usable in the intended order: evidence while the proposal is still a
      // draft, then the governed conclusion is approved.
      const id = await addEvidence({
        versionId, crosswalkId, role: 'primary',
        notes: 'review of the edition found no defensible direct mapping'
      });
      await approve(crosswalkId);

      const rows = await withConn((conn) => query(conn, `
        SELECT ec.mapping_outcome, ec.external_classification_id, ec.review_state,
               COUNT(e.id)::int AS evidence_rows
        FROM ${CROSSWALK} ec JOIN ${TABLE} e ON e.crosswalk_id = ec.id
        WHERE ec.id = ? GROUP BY ec.id, ec.mapping_outcome, ec.external_classification_id, ec.review_state`,
      [crosswalkId]));
      assert.strictEqual(rows[0].review_state, 'approved');
      assert.strictEqual(rows[0].mapping_outcome, 'NO_DIRECT_MAPPING');
      assert.strictEqual(rows[0].external_classification_id, null,
        'no fake classification was invented to hold the evidence');
      assert.strictEqual(rows[0].evidence_rows, 1);
      assert.ok(id);
    });

    it('22. concept evidence and relationship evidence never substitute for one another', async () => {
      const { crosswalkId, versionId, classificationId } = await approvedCrosswalk();
      const conceptEvidence = await addEvidence({
        versionId, classificationId, notes: 'the concept exists'
      });
      const relationshipEvidence = await addEvidence({
        versionId, crosswalkId, notes: 'the relationship is defensible'
      });

      const forConcept = await withConn((conn) => query(conn,
        `SELECT id FROM ${TABLE} WHERE external_classification_id = ?`, [classificationId]));
      const forRelationship = await withConn((conn) => query(conn,
        `SELECT id FROM ${TABLE} WHERE crosswalk_id = ?`, [crosswalkId]));

      assert.ok(forConcept.some((r) => Number(r.id) === conceptEvidence));
      assert.ok(!forConcept.some((r) => Number(r.id) === relationshipEvidence),
        'relationship evidence is NOT concept evidence — the query that asks about the concept does not see it');
      assert.ok(forRelationship.some((r) => Number(r.id) === relationshipEvidence));
      assert.ok(!forRelationship.some((r) => Number(r.id) === conceptEvidence),
        'concept evidence is NOT relationship evidence');
    });
  });

  // ==========================================================
  // G. SUPERSESSION, HISTORY AND DELETION
  // ==========================================================
  describe('G. governed evidence survives supersession and cannot be cascaded away', () => {
    it('23. a superseded crosswalk retains its evidence', async () => {
      const sourceId = await createAuthority();
      const ed2016 = await addEdition(sourceId, '2016');
      const ed2024 = await addEdition(sourceId, '2024');
      const typeId = await createEquipmentType();

      const predecessor = await addCrosswalk({
        equipmentTypeId: typeId, versionId: ed2016,
        classificationId: await addClassification(ed2016), outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(predecessor);
      const predecessorEvidence = await addEvidence({
        versionId: ed2016, crosswalkId: predecessor, notes: '2016 review'
      });

      const successor = await addCrosswalk({
        equipmentTypeId: typeId, versionId: ed2024,
        classificationId: await addClassification(ed2024), outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(successor);
      await withConn((conn) => query(conn,
        `UPDATE ${CROSSWALK} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [successor, predecessor]));

      const rows = await withConn((conn) => query(conn, `
        SELECT e.id, e.crosswalk_id, e.derivation_notes
        FROM ${TABLE} e WHERE e.id = ?`, [predecessorEvidence]));
      assert.strictEqual(rows.length, 1, 'evidence attached to a superseded row is historical, not disposable');
      assert.strictEqual(Number(rows[0].crosswalk_id), predecessor);
      assert.strictEqual(rows[0].derivation_notes, '2016 review');
    });

    it('24. evidence does NOT automatically migrate to the successor', async () => {
      const sourceId = await createAuthority();
      const ed2016 = await addEdition(sourceId, '2016');
      const ed2024 = await addEdition(sourceId, '2024');
      const typeId = await createEquipmentType();

      const predecessor = await addCrosswalk({
        equipmentTypeId: typeId, versionId: ed2016,
        classificationId: await addClassification(ed2016), outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(predecessor);
      await addEvidence({ versionId: ed2016, crosswalkId: predecessor });

      const successor = await addCrosswalk({
        equipmentTypeId: typeId, versionId: ed2024,
        classificationId: await addClassification(ed2024), outcome: 'DIRECT_EQUIVALENT'
      });
      await approve(successor);
      await withConn((conn) => query(conn,
        `UPDATE ${CROSSWALK} SET superseded_by_crosswalk_id = ? WHERE id = ?`, [successor, predecessor]));

      const successorEvidence = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE crosswalk_id = ?`, [successor]));
      assert.strictEqual(successorEvidence[0].n, 0,
        'the successor must establish its own evidence; nothing is copied or rewritten');
    });

    it('25. a governed crosswalk cannot be deleted, so its evidence cannot be cascaded away', async () => {
      const { crosswalkId, versionId } = await approvedCrosswalk();
      await addEvidence({ versionId, crosswalkId });

      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `DELETE FROM ${CROSSWALK} WHERE id = ?`, [crosswalkId]),
          (e) => isCrosswalkDeleteRefusal(e),
          'M5R.3C permits deleting only drafts, which is what makes governed evidence permanent');
      });
      const rows = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE crosswalk_id = ?`, [crosswalkId]));
      assert.strictEqual(rows[0].n, 1, 'the evidence survived the refused delete');
    });

    it('26. an edition that evidence depends on cannot be deleted', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      await addEvidence({ versionId, classificationId, notes: 'concept support' });
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'DELETE FROM knowledge_source_versions WHERE id = ?', [versionId]),
          (e) => isForeignKeyViolation(e),
          'evidence is historical: its source edition is not deletable');
      });
    });

    it('27. deleting a DRAFT crosswalk removes only its own ungoverned evidence', async () => {
      const { versionId, classificationId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const draft = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId, outcome: 'DIRECT_EQUIVALENT'
      });
      const draftEvidence = await addEvidence({ versionId, crosswalkId: draft });
      const survivor = await addEvidence({ versionId, classificationId, notes: 'concept support' });

      // A withdrawn draft proposal may be deleted, and its justification goes with it.
      await withConn((conn) => query(conn, `DELETE FROM ${CROSSWALK} WHERE id = ?`, [draft]));
      const gone = await withConn((conn) => query(conn,
        `SELECT id FROM ${TABLE} WHERE id = ?`, [draftEvidence]));
      assert.strictEqual(gone.length, 0, 'draft evidence cascades with its withdrawn draft');

      const kept = await withConn((conn) => query(conn,
        `SELECT id FROM ${TABLE} WHERE id = ?`, [survivor]));
      assert.strictEqual(kept.length, 1, 'unrelated concept evidence is untouched');
    });

    it('28. evidence remains detachable — no immutability guard was invented', async () => {
      // M5R.3 section AC provides an approved "attach / detach evidence"
      // capability, so implementing a delete guard here would have invented
      // lifecycle semantics the ADR does not contain.
      const { crosswalkId, versionId } = await approvedCrosswalk();
      const id = await addEvidence({ versionId, crosswalkId });
      await withConn((conn) => query(conn, `DELETE FROM ${TABLE} WHERE id = ?`, [id]));
      const rows = await withConn((conn) => query(conn, `SELECT id FROM ${TABLE} WHERE id = ?`, [id]));
      assert.strictEqual(rows.length, 0, 'detach is permitted');
    });
  });

  // ==========================================================
  // H. GLOBAL / TENANT BOUNDARY
  // ==========================================================
  describe('H. evidence cannot carry customer terminology into global knowledge', () => {
    it('29. a tenant-scoped source edition is rejected for CONCEPT evidence', async () => {
      const tenantVersionId = await addEdition(
        await createAuthority({ organizationId: ORG }), '1.0');
      const classificationId = await addClassification(tenantVersionId, 'Tenant-scoped concept');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, external_classification_id)
            VALUES (?, ?)`, [tenantVersionId, classificationId]),
          (e) => isEvidenceScopeRefusal(e));
      });
    });

    it('30. a tenant-scoped source edition is rejected for RELATIONSHIP evidence', async () => {
      const { crosswalkId } = await approvedCrosswalk();
      const tenantVersionId = await addEdition(
        await createAuthority({ organizationId: ORG }), '1.0');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, `
            INSERT INTO ${TABLE} (knowledge_source_version_id, crosswalk_id)
            VALUES (?, ?)`, [tenantVersionId, crosswalkId]),
          (e) => isEvidenceScopeRefusal(e),
          'section R.1 names evidence rows explicitly, not only crosswalk rows');
      });
    });

    it('31. a global source edition is accepted, and the guard is a database trigger', async () => {
      const { crosswalkId } = await approvedCrosswalk();
      const globalVersionId = await addEdition(await createAuthority(), '2020');
      const id = await addEvidence({ versionId: globalVersionId, crosswalkId });
      const rows = await withConn((conn) => query(conn, `
        SELECT s.organization_id FROM ${TABLE} e
        JOIN knowledge_source_versions v ON v.id = e.knowledge_source_version_id
        JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE e.id = ?`, [id]));
      assert.strictEqual(rows[0].organization_id, null, 'evidence resolves to a global authority');

      const guard = await withConn((conn) => query(conn, `
        SELECT t.tgname, pg_get_triggerdef(t.oid) AS d
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = ? AND NOT t.tgisinternal`, [TABLE]));
      assert.strictEqual(guard.length, 1, 'exactly one guard is attached to the evidence relation');
      assert.strictEqual(guard[0].tgname, 'trg_equipment_type_external_classification_evidence_scope');
      assert.ok(/BEFORE INSERT OR UPDATE/.test(guard[0].d),
        'the scope rule cannot be bypassed by inserting first and repairing later');
    });
  });

  // ==========================================================
  // I. THE DELIBERATE NON-CLAIM AND ISOLATION
  // ==========================================================
  describe('I. the ADR service/domain boundary is respected, and nothing else changed', () => {
    it('32. "approved requires evidence" is NOT database-enforced — the ADR assigns it to the service layer', async () => {
      // ADR section AG, failure mode G: "Corrected: attribution CHECK; plus a
      // policy requirement that approval is evidence-backed (sections O, P).
      // Note: enforcing '>=1 evidence row' is cross-table and remains a
      // service/domain rule — consistent with migration 013's documented
      // boundary." This test pins that boundary so its absence is never later
      // mistaken for an omission.
      const { versionId } = await globalEditionWithClassification();
      const typeId = await createEquipmentType();
      const evidenceFree = await addCrosswalk({
        equipmentTypeId: typeId, versionId, classificationId: null, outcome: 'NO_DIRECT_MAPPING'
      });
      await approve(evidenceFree);

      const rows = await withConn((conn) => query(conn, `
        SELECT ec.review_state,
               (SELECT COUNT(*)::int FROM ${TABLE} e WHERE e.crosswalk_id = ec.id) AS evidence_rows
        FROM ${CROSSWALK} ec WHERE ec.id = ?`, [evidenceFree]));
      assert.strictEqual(rows[0].review_state, 'approved');
      assert.strictEqual(rows[0].evidence_rows, 0,
        'the database does NOT enforce it; M5R.3E owns that rule');

      const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
      const fnBodies = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$ LANGUAGE plpgsql;/g) || [];
      assert.strictEqual(fnBodies.length, 1,
        'the only trigger function is the global-scope guard — no evidence-required trigger was invented');
    });

    it('33. creating evidence mutates no canonical Atiman taxonomy row', async () => {
      const scoped = () => withConn((conn) => query(conn, `
        SELECT
          (SELECT COUNT(*)::int FROM equipment_categories WHERE category_code LIKE ?) AS categories,
          (SELECT COUNT(*)::int FROM equipment_classes c
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS classes,
          (SELECT COUNT(*)::int FROM equipment_types t
             JOIN equipment_classes c ON c.id = t.class_id
             JOIN equipment_categories cat ON cat.id = c.category_id
             WHERE cat.category_code LIKE ?) AS types`,
      [`${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`, `${CATEGORY_PREFIX}%`]));

      const { crosswalkId, versionId } = await approvedCrosswalk();
      const before = await scoped();
      await addEvidence({ versionId, crosswalkId });
      const after = await scoped();
      assert.deepStrictEqual(after[0], before[0],
        'evidence references canonical identity; it never changes it');
    });

    it('34. no crosswalk row derives from the legacy iso_* columns', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM external_classification
        WHERE classification_code LIKE 'ISO14224-%' OR classification_code LIKE 'ISO-%'`));
      assert.strictEqual(rows[0].n, 0,
        'FALSE_PROVENANCE_REMEDIATION_REQUIRED remains separate and untouched');
    });

    it('35. no standards content was populated by migration 018', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM ${TABLE}
        WHERE section_or_clause LIKE '%ISO%' OR derivation_notes LIKE '%ISO%'
           OR page_or_paragraph LIKE '%Annex%'`));
      assert.strictEqual(rows[0].n, 0, 'no licensed clause, annex reference or excerpt is stored');
    });

    it('36. no service, model, controller, route or UI was added by M5R.3D', async () => {
      const root = path.join(__dirname, '..');
      for (const dir of ['src/services', 'src/models', 'src/controllers', 'src/routes', 'views']) {
        const full = path.join(root, dir);
        if (!fs.existsSync(full)) continue;
        const hits = [];
        const walk = (d) => {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (/\.(js|ejs)$/.test(entry.name)
              && /external_classification_evidence|equipment_type_external_classification_evidence/.test(
                fs.readFileSync(p, 'utf8'))) hits.push(p);
          }
        };
        walk(full);
        assert.deepStrictEqual(hits, [],
          `${dir} must not reference the evidence relation in M5R.3D`);
      }
    });
  });
});
