/**
 * External Authority / Edition Groundwork — Integration Tests
 *
 * ATM-001 M5R.3A — proves that the EXISTING governed provenance model
 * (`knowledge_sources` + `knowledge_source_versions`, migration 011) already
 * represents a GLOBAL external authority and a specific authority/standard
 * EDITION correctly under the approved M5R.3 crosswalk architecture.
 *
 * Why this suite exists
 * ---------------------
 * The approved M5R.3 architecture reuses `knowledge_sources` /
 * `knowledge_source_versions` as the external authority/edition foundation and
 * deliberately does NOT create a second standards registry. M5R.3B depends on
 * that foundation, so the dependency must be PROVEN rather than assumed —
 * "Evidence Before Assumption".
 *
 * This suite creates NO crosswalk knowledge. It proves a provenance contract
 * only: registering an external authority and one of its editions identifies
 * WHAT was consulted. It does not, and must not, assert that any Atiman
 * equipment type maps to any external classification.
 *
 * Copyright boundary: only bibliographic metadata is recorded (authority,
 * reference number, edition designation, title, publication date, public URI).
 * No standard text, table or document is copied, uploaded or committed. The
 * representative authority's metadata below was verified from the public ISO
 * catalogue entry and the official 15-page ISO preview inspected during
 * ATM-001 M5R; nothing about the standard's contents is reproduced here.
 *
 * Database-mutating suite: gated on isIntegrationTest(), the same predicate
 * src/config/database.js uses to select test-database credentials, so it can
 * never run against runtime credentials.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { KnowledgeSource, KnowledgeSourceVersion } = require('../src/models/knowledge-provenance.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'database-mutating external-authority/edition suite requires the sanctioned '
    + 'database-test gate (NODE_ENV=test, RUN_DB_TESTS=true, TEST_DB_*) so that '
    + 'test-database credentials are used instead of runtime credentials; '
    + 'run it via `npm run test:integration`';

// Disposable fixtures, disjoint from every other suite's namespace.
const ORG = 998001;
const OTHER_ORG = 998002;
const USER = 998101;

const UNIQ = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * Bibliographic metadata for the representative external authority.
 *
 * VERIFIED (ATM-001 M5R, official public sources) — recorded as provenance
 * metadata only:
 *   authority            ISO
 *   reference number     ISO 14224
 *   title                "Petroleum, petrochemical and natural gas industries —
 *                         Collection and exchange of reliability and maintenance
 *                         data for equipment"
 *   edition              Third edition, 2016-09-15 (corrected version 2016-10-01)
 *   technical committee  ISO/TC 67
 *   public catalogue     https://www.iso.org/standard/64076.html
 *   access limitation    only the official 15-page preview was inspected;
 *                        Annex A (equipment classes) is not publicly accessible
 *
 * No standard content is stored. `uploaded_file_id` and `content_sha256` are
 * deliberately NULL: Atiman holds no copy of the standard, and recording the
 * preview's hash as if it were the standard's would be false provenance.
 */
const REPRESENTATIVE = Object.freeze({
  sourceCode: 'ISO-14224',
  sourceCategory: 'engineering_standard',
  issuingOrganization: 'ISO',
  title: 'Petroleum, petrochemical and natural gas industries — Collection and exchange '
    + 'of reliability and maintenance data for equipment',
  referenceNumber: 'ISO 14224',
  edition: '2016',
  publicationDate: '2016-09-15',
  externalUri: 'https://www.iso.org/standard/64076.html'
});

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
const isUniqueViolation = (e) => /duplicate key|unique constraint/i.test(e.message || '');
// The migration-011 guards reject via RAISE, so the emitted message — not the
// SQLSTATE name — is what an assertion can match. Accept either.
const isForbidden = (e) => /insufficient_privilege|check_violation/i.test(e.code || '')
  || /immutable|cannot be updated|cannot change after source versions exist/i.test(e.message || '');

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG, 'M5R3A Org'], [OTHER_ORG, 'M5R3A Other Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    await query(conn,
      `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
       VALUES (?, 'm5r3a-user', 'm5r3a@test.local', 'x', 'M5R3A User', 'admin', ?, true)
       ON CONFLICT (id) DO NOTHING`,
      [USER, ORG]);
  });
}

/** A GLOBAL authority source (organization_id IS NULL) with a unique code. */
async function createGlobalAuthority(code = `M5R3A-AUTH-${UNIQ()}`) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
       VALUES (?, 'engineering_standard', 'M5R3A Global Authority', 'Test Authority', NULL)
       RETURNING id`, [code]);
    return rows[0].id;
  });
}

async function addEdition(sourceId, designation) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number,
          issuing_organization, publication_date, external_uri)
       VALUES (?, ?, 'M5R3A Edition', 'TEST-REF', 'Test Authority', DATE '2016-09-15', 'https://example.invalid/ref')
       RETURNING id`, [sourceId, designation]);
    return rows[0].id;
  });
}

describe('External Authority / Edition Groundwork (ATM-001 M5R.3A)', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ==========================================================
  // A. GLOBAL AUTHORITY SEMANTICS
  // ==========================================================
  describe('A. a global external authority is representable', () => {
    it('1. a GLOBAL knowledge source exists with organization_id NULL', async () => {
      const id = await createGlobalAuthority();
      const rows = await withConn((conn) => query(conn,
        'SELECT organization_id, source_category FROM knowledge_sources WHERE id = ?', [id]));
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].organization_id, null,
        'organization_id IS NULL is the representation of a global/system source');
    });

    it('2. source_category = engineering_standard is valid', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
        WHERE conname = 'chk_knowledge_sources_source_category'
      `));
      assert.strictEqual(rows.length, 1, 'the source_category constraint must exist');
      assert.ok(rows[0].d.includes('engineering_standard'),
        'engineering_standard must be a permitted authority category');
    });

    it('3. source identity is stable once an edition exists', async () => {
      const id = await createGlobalAuthority();
      await addEdition(id, '2016');
      // A rejected statement aborts the transaction, so each probe runs inside
      // its own savepoint; otherwise the second probe reports only
      // "current transaction is aborted" and proves nothing.
      const probe = async (conn, sql, params, message) => {
        await conn.query('SAVEPOINT probe');
        try {
          await assert.rejects(() => query(conn, sql, params), (e) => isForbidden(e), message);
        } finally {
          await conn.query('ROLLBACK TO SAVEPOINT probe');
        }
      };
      await inRollback(async (conn) => {
        await probe(conn, 'UPDATE knowledge_sources SET source_code = ? WHERE id = ?',
          [`CHANGED-${UNIQ()}`, id], 'source_code must not change once versions exist');
        await probe(conn, 'UPDATE knowledge_sources SET source_category = ? WHERE id = ?',
          ['internal_standard', id], 'source_category must not change once versions exist');
        await probe(conn, 'UPDATE knowledge_sources SET organization_id = ? WHERE id = ?',
          [ORG, id], 'a global source must not silently become tenant-scoped once versions exist');
      });
    });

    it('4. duplicate GLOBAL source identity is rejected', async () => {
      const code = `M5R3A-DUP-${UNIQ()}`;
      await createGlobalAuthority(code);
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
             VALUES (?, 'engineering_standard', 'Duplicate Global', NULL)`, [code]),
          (e) => isUniqueViolation(e),
          'UNIQUE NULLS NOT DISTINCT must reject a second GLOBAL source with the same code');
      });
    });

    it('5. a tenant may reuse the same code in its own scope, distinguishable from global', async () => {
      const code = `M5R3A-SCOPE-${UNIQ()}`;
      const globalId = await createGlobalAuthority(code);
      const tenantId = await withConn(async (conn) => {
        const rows = await query(conn,
          `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
           VALUES (?, 'engineering_standard', 'Tenant-scoped twin', ?) RETURNING id`, [code, ORG]);
        return rows[0].id;
      });
      assert.notStrictEqual(globalId, tenantId);
      const rows = await withConn((conn) => query(conn,
        `SELECT id, organization_id FROM knowledge_sources WHERE id IN (?, ?) ORDER BY id`, [globalId, tenantId]));
      assert.strictEqual(rows[0].organization_id, null, 'one row is global');
      assert.strictEqual(Number(rows[1].organization_id), ORG, 'the other is tenant-scoped');
      assert.notStrictEqual(rows[0].organization_id, rows[1].organization_id,
        'global and tenant provenance remain distinguishable');
    });

    it('reads include global sources, but the authoring path refuses to create one', async () => {
      const id = await createGlobalAuthority();
      const visible = await KnowledgeSource.findSourceById(id, ORG);
      assert.ok(visible, 'a tenant read must include global sources');

      await assert.rejects(
        () => KnowledgeSource.createSource(
          { sourceCode: `M5R3A-APP-${UNIQ()}`, sourceCategory: 'engineering_standard', defaultTitle: 'No org' },
          { organizationId: null, userId: USER }
        ),
        (e) => e.code === 'SOURCE_ORGANIZATION_REQUIRED',
        'M3 deliberately refuses application-level global source creation'
      );
    });
  });

  // ==========================================================
  // B. EDITION / VERSION MODEL
  // ==========================================================
  describe('B. an authority edition is representable', () => {
    it('6. one source may carry a specific edition row', async () => {
      const id = await createGlobalAuthority();
      const versionId = await addEdition(id, '2016');
      const rows = await withConn((conn) => query(conn,
        `SELECT knowledge_source_id, version_designation, reference_number, publication_date
           FROM knowledge_source_versions WHERE id = ?`, [versionId]));
      assert.strictEqual(Number(rows[0].knowledge_source_id), id);
      assert.strictEqual(rows[0].version_designation, '2016');
      assert.strictEqual(rows[0].reference_number, 'TEST-REF');
      assert.ok(rows[0].publication_date, 'publication metadata is representable');
    });

    it('7. a second edition coexists as another version row', async () => {
      const id = await createGlobalAuthority();
      await addEdition(id, '2016');
      await addEdition(id, '2024');
      const rows = await withConn((conn) => query(conn,
        `SELECT version_designation FROM knowledge_source_versions
          WHERE knowledge_source_id = ? ORDER BY version_designation`, [id]));
      assert.deepStrictEqual(rows.map((r) => r.version_designation), ['2016', '2024'],
        'editions coexist; a new edition is a NEW row, never a rewrite');
    });

    it('8. a duplicate edition designation on the same source is rejected', async () => {
      const id = await createGlobalAuthority();
      await addEdition(id, '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn,
            `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
             VALUES (?, '2016', 'Duplicate edition')`, [id]),
          (e) => isUniqueViolation(e));
      });
    });

    it('9. edition history is not silently rewritten', async () => {
      const id = await createGlobalAuthority();
      const versionId = await addEdition(id, '2016');
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'UPDATE knowledge_source_versions SET title = ? WHERE id = ?', ['Tampered', versionId]),
          (e) => isForbidden(e),
          'knowledge_source_versions are immutable');
      });
    });

    it('10. an edition referenced by evidence cannot be deleted', async () => {
      const id = await createGlobalAuthority();
      const versionId = await addEdition(id, '2016');
      // A template + step are needed to attach evidence (M3 evidence subject).
      const fixture = await withConn(async (conn) => {
        const [cat] = await query(conn,
          `INSERT INTO equipment_categories (category_code, category_name)
           VALUES (?, 'M5R3A Cat') RETURNING id`, [`M5R3A-C-${UNIQ()}`]);
        const [cls] = await query(conn,
          `INSERT INTO equipment_classes (category_id, class_code, class_name)
           VALUES (?, ?, 'M5R3A Cls') RETURNING id`, [cat.id, `M5R3A-K-${UNIQ()}`]);
        const [typ] = await query(conn,
          `INSERT INTO equipment_types (class_id, type_code, type_name)
           VALUES (?, ?, 'M5R3A Type') RETURNING id`, [cls.id, `M5R3A-T-${UNIQ()}`]);
        const [tpl] = await query(conn,
          `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name, maintenance_type)
           VALUES (?, ?, ?, 'M5R3A Template', 'preventive') RETURNING id`,
          [typ.id, ORG, `M5R3A-TPL-${UNIQ()}`]);
        await query(conn,
          `INSERT INTO knowledge_template_evidence
             (task_template_id, knowledge_source_version_id, added_by_user_id)
           VALUES (?, ?, ?)`, [tpl.id, versionId, USER]);
        return { templateId: tpl.id };
      });
      assert.ok(fixture.templateId);
      await inRollback(async (conn) => {
        await assert.rejects(
          () => query(conn, 'DELETE FROM knowledge_source_versions WHERE id = ?', [versionId]),
          (e) => /referenced by evidence|foreign key/i.test(e.message || ''),
          'an edition referenced by evidence must not be deletable');
      });
    });

    it('11. no document upload is required to record legitimate provenance metadata', async () => {
      const id = await createGlobalAuthority();
      const versionId = await addEdition(id, '2016');
      const rows = await withConn((conn) => query(conn,
        `SELECT uploaded_file_id, content_sha256, external_uri
           FROM knowledge_source_versions WHERE id = ?`, [versionId]));
      assert.strictEqual(rows[0].uploaded_file_id, null,
        'no copy of the standard is required or stored');
      assert.strictEqual(rows[0].content_sha256, null);
      assert.ok(rows[0].external_uri, 'a public reference can identify the source without copying it');
    });
  });

  // ==========================================================
  // C. THE REPRESENTATIVE AUTHORITY (metadata only)
  // ==========================================================
  describe('C. representative external authority recorded as metadata only', () => {
    it('15/16. records verified ISO 14224 bibliographic metadata as a global edition', async () => {
      const code = `M5R3A-${REPRESENTATIVE.sourceCode}-${UNIQ()}`;
      const recorded = await withConn(async (conn) => {
        const [src] = await query(conn,
          `INSERT INTO knowledge_sources
             (source_code, source_category, default_title, issuing_organization, organization_id)
           VALUES (?, ?, ?, ?, NULL) RETURNING id`,
          [code, REPRESENTATIVE.sourceCategory, REPRESENTATIVE.title, REPRESENTATIVE.issuingOrganization]);
        const [ver] = await query(conn,
          `INSERT INTO knowledge_source_versions
             (knowledge_source_id, version_designation, title, reference_number,
              issuing_organization, publication_date, external_uri)
           VALUES (?, ?, ?, ?, ?, CAST(? AS date), ?) RETURNING id`,
          [src.id, REPRESENTATIVE.edition, REPRESENTATIVE.title, REPRESENTATIVE.referenceNumber,
            REPRESENTATIVE.issuingOrganization, REPRESENTATIVE.publicationDate, REPRESENTATIVE.externalUri]);
        return { sourceId: src.id, versionId: ver.id };
      });

      const rows = await withConn((conn) => query(conn,
        `SELECT s.source_category, s.issuing_organization, s.organization_id,
                v.version_designation, v.reference_number, v.publication_date, v.external_uri,
                v.uploaded_file_id, v.content_sha256
           FROM knowledge_sources s
           JOIN knowledge_source_versions v ON v.knowledge_source_id = s.id
          WHERE v.id = ?`, [recorded.versionId]));

      assert.strictEqual(rows[0].organization_id, null, 'the authority is GLOBAL');
      assert.strictEqual(rows[0].source_category, 'engineering_standard');
      assert.strictEqual(rows[0].issuing_organization, 'ISO');
      assert.strictEqual(rows[0].version_designation, '2016');
      assert.strictEqual(rows[0].reference_number, 'ISO 14224');
      assert.strictEqual(rows[0].external_uri, REPRESENTATIVE.externalUri);
      assert.strictEqual(rows[0].uploaded_file_id, null, 'no standard content is stored');
      assert.strictEqual(rows[0].content_sha256, null,
        'the preview hash is NOT recorded as if it were the standard');
    });
  });

  // ==========================================================
  // D. PROVENANCE IS NOT A MAPPING
  // ==========================================================
  describe('D. registering an authority creates NO crosswalk knowledge', () => {
    it('13. no crosswalk relation exists in the schema', async () => {
      const rows = await withConn((conn) => query(conn, `
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('external_classification',
                             'equipment_type_external_classification',
                             'equipment_type_external_classification_evidence')
      `));
      assert.strictEqual(rows.length, 0,
        'M5R.3A implements no crosswalk relation; the approved architecture is not yet built');
    });

    it('13b. registering an authority edition mutates no equipment taxonomy', async () => {
      const before = await withConn((conn) => query(conn,
        'SELECT COUNT(*)::int AS n FROM equipment_types'));
      const id = await createGlobalAuthority();
      await addEdition(id, '2016');
      const after = await withConn((conn) => query(conn,
        'SELECT COUNT(*)::int AS n FROM equipment_types'));
      assert.strictEqual(after[0].n, before[0].n,
        'provenance registration must not create or alter any equipment identity');
    });

    it('13c. the legacy iso_* reference columns are not consulted', async () => {
      // FALSE_PROVENANCE_REMEDIATION_REQUIRED: activity_codes.iso_maintenance_reference
      // and cause_codes.iso_failure_cause_reference carry unverifiable ISO14224-*
      // lineage and MUST NOT be treated as trusted authority/edition data.
      const rows = await withConn((conn) => query(conn, `
        SELECT COUNT(*)::int AS n FROM knowledge_sources
        WHERE source_code LIKE 'ISO14224-%'
      `));
      assert.strictEqual(rows[0].n, 0,
        'no authority source may be derived from the unverified legacy labels');
    });

    it('14. one authority edition can serve many independent subjects', async () => {
      const id = await createGlobalAuthority();
      const versionId = await addEdition(id, '2016');
      const second = await withConn((conn) => query(conn,
        `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
         VALUES (?, '2017', 'M5R3A Edition two') RETURNING id`, [id]));
      assert.ok(second[0].id);
      const rows = await withConn((conn) => query(conn,
        `SELECT COUNT(*)::int AS n FROM knowledge_source_versions WHERE knowledge_source_id = ?`, [id]));
      assert.strictEqual(rows[0].n, 2, 'the same authority carries multiple editions');
      assert.ok(versionId);
    });
  });
});
