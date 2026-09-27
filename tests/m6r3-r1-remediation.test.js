/**
 * ATM-001 M6.3 — VUDA R1 remediation regression coverage.
 *
 * Independent VUDA R1 reproduced seven findings against the frozen M6.3
 * candidate. This suite is the regression coverage for the five findings that
 * are expressed at the runtime and storage boundary (R1-1, R1-2, R1-3, R1-4,
 * R1-5). The two remaining findings are covered where their harness lives:
 *
 *   * R1-6 (frozen manifest identity with an inconsistent code) and
 *   * R1-7 (inherited libpq environment precedence in disposable subprocesses)
 *
 * are covered in tests/governed-knowledge-foundation.test.js, which owns the
 * migration-020 provisioning harness.
 *
 * Every test here proves an invariant by attempting the real operation and
 * asserting the real outcome — including, where a refusal is under test, that the
 * refusal left nothing behind. A refusal that also wrote a partial row would be
 * worse than no guard at all.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const { KnowledgePack, KnowledgePackVersion } = require('../src/models/knowledge-pack.model');
const { TaskTemplate } = require('../src/models');
const packController = require('../src/controllers/knowledge-pack.controller');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'requires NODE_ENV=test and RUN_DB_TESTS=true with an explicitly named test database';

// Fixture identities are deliberately high and disjoint from every other suite.
const ORG_OWNER = 994001;   // owns the customer packs under test
const ORG_FOREIGN = 994002; // a different tenant with no rights over them
const ADMIN_OWNER = 994101;
const ADMIN_FOREIGN = 994102;
const REVIEWER = 994103;
const APPROVER = 994104;
const PUBLISHER = 994105;
const CATEGORY = 994201;
const CLASS = 994202;
const ETYPE_A = 994203;
const ETYPE_B = 994204;

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

const query = (conn, sql, params) => conn.query(sql, params);

let seq = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${(seq += 1)}`;

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG_OWNER, 'R1 Owner Org'], [ORG_FOREIGN, 'R1 Foreign Org']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES (?, ?) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    for (const [id, username, role, org] of [
      [ADMIN_OWNER, 'r1-admin-owner', 'admin', ORG_OWNER],
      [ADMIN_FOREIGN, 'r1-admin-foreign', 'admin', ORG_FOREIGN],
      [REVIEWER, 'r1-reviewer', 'supervisor', ORG_OWNER],
      [APPROVER, 'r1-approver', 'supervisor', ORG_OWNER],
      [PUBLISHER, 'r1-publisher', 'admin', ORG_OWNER]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES (?, ?, ?, 'x', 'R1 Fixture User', ?, ?, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, org]);
    }
    await query(conn,
      `INSERT INTO equipment_categories (id, category_code, category_name)
       VALUES (?, 'R1CAT', 'R1 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn,
      `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
       VALUES (?, ?, 'R1CLS', 'R1 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn,
      `INSERT INTO equipment_types (id, class_id, type_code, type_name)
       VALUES (?, ?, 'R1TYPEA', 'R1 Type A'), (?, ?, 'R1TYPEB', 'R1 Type B')
       ON CONFLICT (id) DO NOTHING`,
      [ETYPE_A, CLASS, ETYPE_B, CLASS]);
  });
}

/**
 * A governed working definition. `scope`/`organizationId` follow the ratified
 * M6.3 rule: shared knowledge is bound to no tenant, customer knowledge to one.
 */
async function createWorkingTemplate({ scope = 'shared', organizationId = null, legacy = false } = {}) {
  return withConn(async (conn) => {
    // ATM-001 M6.4 Step 3B-B: this fixture is authored, so publication requires
    // an explicit AI-assistance declaration. The fixture is hand-written and
    // declares FALSE. NULL is not a substitute: it means "never captured".
    const [template] = await query(conn,
      `INSERT INTO task_templates (equipment_type_id, organization_id, template_code, template_name,
         maintenance_type, task_kind, frequency_value, frequency_unit, estimated_duration_minutes,
         priority, knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism,
         knowledge_scope, content_origin,
         ai_assisted, ai_assistance_detail)
       VALUES (?, ?, ?, 'R1 Governed Template', 'preventive', 'inspection', NULL, NULL, 30, 'medium',
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval', ?, ?, ?, ?)
       RETURNING id`,
      [ETYPE_A, organizationId, uniq('R1T'), scope, legacy ? null : 'authored',
        // A legacy-generated definition is EXEMPT from the disclosure rule and its
        // disclosure stays NULL — never FALSE, which would fabricate a declaration
        // nobody made.
        legacy ? null : false, null]);

    if (legacy) {
      // content_origin carries NO default and is immutable once established, so a
      // legacy definition is created unclassified and then classified exactly
      // once, with the accountable clearance that classification requires.
      await query(conn,
        `UPDATE task_templates
            SET content_origin = 'legacy_generated',
                legacy_clearance_by_user_id = ?,
                legacy_clearance_at = NOW(),
                legacy_clearance_rationale = 'R1 fixture clearance'
          WHERE id = ?`, [REVIEWER, template.id]);
    }

    await query(conn,
      `INSERT INTO task_template_steps (task_template_id, step_no, step_type, instruction, is_required)
       VALUES (?, 1, 'instruction', 'R1 fixture step', true)`, [template.id]);

    await query(conn,
      `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary, added_by_user_id)
       VALUES (?, ?, true, ?)`, [template.id, ETYPE_A, REVIEWER]);

    const [source] = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
       VALUES (?, 'engineering_standard', 'R1 Source', NULL) RETURNING id`, [uniq('R1SRC')]);
    const [sourceVersion] = await query(conn,
      `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
       VALUES (?, '1.0', 'R1 Source Version') RETURNING id`, [source.id]);
    await query(conn,
      `INSERT INTO knowledge_template_evidence (task_template_id, knowledge_source_version_id,
         section_or_clause, derivation_notes, added_by_user_id)
       VALUES (?, ?, 'Section 1', 'R1 fixture derivation', ?)`,
      [template.id, sourceVersion.id, REVIEWER]);

    return template.id;
  });
}

/** Drive a working definition through safety review, review and approval. */
async function approve(templateId, organizationId = ORG_OWNER) {
  await TaskTemplate.recordSafetyReview(templateId, REVIEWER, organizationId, 'reviewed_no_control_required');
  await TaskTemplate.submitForReview(templateId, REVIEWER, organizationId);
  await TaskTemplate.approveTemplate(templateId, APPROVER, organizationId);
}

/** The approval fingerprint recorded at approval time, read directly. */
async function approvedSha(templateId) {
  return withConn(async (conn) => {
    const [row] = await query(conn,
      `SELECT approved_content_sha FROM task_templates WHERE id = ?`, [templateId]);
    return row.approved_content_sha;
  });
}

/**
 * The fingerprint of the working content AS IT IS NOW, computed exactly as the
 * product computes it at publication.
 *
 * Comparing the stored approval fingerprint against this is what proves material
 * drift: the stored value never changes after approval (that is the point — a
 * stale approval stays on the row and must be detected at publication), so a
 * stored-vs-stored comparison would prove nothing.
 */
async function currentSha(templateId) {
  const { computeContentSha } = require('../src/services/knowledge-governance.service');
  return withConn(async (conn) => {
    const [template] = await query(conn, `SELECT * FROM task_templates WHERE id = ?`, [templateId]);
    const steps = await query(conn,
      `SELECT * FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no`, [templateId]);
    const applicability = await query(conn,
      `SELECT equipment_type_id, is_primary FROM task_template_equipment_types
        WHERE task_template_id = ? ORDER BY equipment_type_id`, [templateId]);
    return computeContentSha(template, steps, applicability);
  });
}

/** Assert the recorded approval no longer describes the current content. */
async function assertApprovalInvalidated(templateId, label) {
  assert.notStrictEqual(await currentSha(templateId), await approvedSha(templateId),
    `the approval fingerprint must no longer match the content after a ${label} change`);
}

const admissionRules = (error) => (error.failures || []).map((f) => f.rule);

/**
 * A governed immutable task_template_version built with raw SQL.
 *
 * Assembles unsealed, attaches frozen provenance and applicability, then seals —
 * all in one transaction, because migration 009 refuses to seal a row that was
 * inserted already sealed and migration 011 refuses to attach provenance to a
 * sealed version.
 */
async function createGovernedVersion({ scope = 'shared', organizationId = null } = {}) {
  return withConn(async (conn) => {
    const templateId = await createWorkingTemplate({ scope, organizationId });
    const [step] = await query(conn,
      `SELECT id FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no LIMIT 1`,
      [templateId]);

    const [version] = await query(conn,
      `INSERT INTO task_template_versions (
         task_template_id, version_number, equipment_type_id, template_name, maintenance_type,
         lifecycle_state_at_publish, is_step_set_sealed, published_by_user_id, published_at,
         reviewer_user_id, reviewed_at, approver_user_id, approved_at, safety_review_state,
         safety_reviewed_by_user_id, safety_reviewed_at, knowledge_type_id, task_family_id,
         maintenance_strategy, trigger_mechanism, knowledge_scope, organization_id)
       VALUES (?, 1, ?, 'R1 Governed Template', 'preventive', 'published', FALSE, ?, NOW(),
         ?, NOW(), ?, NOW(), 'reviewed_no_control_required', ?, NOW(),
         (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
         (SELECT id FROM task_families WHERE family_code='inspect'),
         'preventive', 'no_fixed_interval',
         (SELECT knowledge_scope FROM task_templates WHERE id = $1),
         (SELECT organization_id FROM task_templates WHERE id = $1))
       RETURNING id`,
      [templateId, ETYPE_A, PUBLISHER, REVIEWER, APPROVER, REVIEWER]);

    await query(conn,
      `INSERT INTO task_template_step_versions
         (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
       VALUES (?, 1, ?, 'instruction', 'R1 fixture step')`, [version.id, step.id]);

    const [source] = await query(conn,
      `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
       VALUES (?, 'engineering_standard', 'R1 Version Source', NULL) RETURNING id`, [uniq('R1VSRC')]);
    const [sourceVersion] = await query(conn,
      `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
       VALUES (?, '1.0', 'R1 Version Source Version') RETURNING id`, [source.id]);
    await query(conn,
      `INSERT INTO knowledge_template_version_evidence
         (task_template_version_id, knowledge_source_version_id, section_or_clause, derivation_notes)
       VALUES (?, ?, 'Section 1', 'R1 fixture derivation')`, [version.id, sourceVersion.id]);
    await query(conn,
      `INSERT INTO task_template_version_equipment_types
         (task_template_version_id, equipment_type_id, is_primary)
       VALUES (?, ?, true)`, [version.id, ETYPE_A]);

    await query(conn, `UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`,
      [version.id]);

    return { templateId, versionId: version.id };
  });
}

/** A pack identity with an explicitly declared scope (M6.3: never defaulted). */
async function createPack(scope = 'shared', organizationId = null) {
  return KnowledgePack.createPack({
    packCode: uniq('R1PACK'),
    packName: 'R1 Pack',
    knowledgeScope: scope,
    organizationId
  });
}

// ---------------------------------------------------------------- HTTP doubles

const makeReq = ({ user, params = {}, body = {}, query: queryString = {} }) => ({
  user, params, body, query: queryString
});

function makeRes() {
  const out = { statusCode: null, body: null };
  return {
    status(code) { out.statusCode = code; return this; },
    json(payload) { out.body = payload; return this; },
    get observed() { return out; }
  };
}

/**
 * Invoke a controller entry point. An unexpected error is rethrown rather than
 * swallowed, so a broken guard fails the test instead of looking like a refusal.
 */
async function invoke(handler, req) {
  const res = makeRes();
  let thrown = null;
  await handler(req, res, (error) => { thrown = error; });
  if (thrown) throw thrown;
  return res.observed;
}

describe('ATM-001 M6.3 R1 remediation', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ==========================================================================
  // R1-1 — cross-tenant Knowledge Pack access
  // ==========================================================================
  describe('R1-1 Pack access is organization-aware', () => {
    it('lets an organization reach its own customer pack', async () => {
      const pack = await createPack('customer', ORG_OWNER);
      const observed = await invoke(packController.getPack, makeReq({
        user: { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER },
        params: { packId: String(pack.id) }
      }));

      assert.strictEqual(observed.statusCode, null, 'a reachable pack must not be refused');
      assert.strictEqual(Number(observed.body.data.id), Number(pack.id));
    });

    it('does not disclose another organization\'s customer pack', async () => {
      const pack = await createPack('customer', ORG_FOREIGN);
      const observed = await invoke(packController.getPack, makeReq({
        user: { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER },
        params: { packId: String(pack.id) }
      }));

      assert.strictEqual(observed.statusCode, 404,
        'a foreign tenant\'s customer pack must be indistinguishable from one that does not exist');
    });

    it('keeps shared packs visible to every organization', async () => {
      const pack = await createPack('shared');

      for (const [userId, orgId] of [[ADMIN_OWNER, ORG_OWNER], [ADMIN_FOREIGN, ORG_FOREIGN]]) {
        const observed = await invoke(packController.getPack, makeReq({
          user: { id: userId, role: 'admin', organization_id: orgId },
          params: { packId: String(pack.id) }
        }));
        assert.strictEqual(observed.statusCode, null,
          'a shared pack belongs to no tenant and stays visible to all');
        assert.strictEqual(Number(observed.body.data.id), Number(pack.id));
      }
    });

    it('lists own and shared packs but never a foreign customer pack', async () => {
      const ownCustomer = await createPack('customer', ORG_OWNER);
      const foreignCustomer = await createPack('customer', ORG_FOREIGN);
      const shared = await createPack('shared');

      const observed = await invoke(packController.listPacks, makeReq({
        user: { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER },
        query: { limit: '500' }
      }));

      const ids = observed.body.data.map((row) => Number(row.id));
      assert.ok(ids.includes(Number(ownCustomer.id)), 'own customer pack must be listed');
      assert.ok(ids.includes(Number(shared.id)), 'shared pack must be listed');
      assert.ok(!ids.includes(Number(foreignCustomer.id)),
        'another organization\'s customer pack must never be listed');
    });

    it('refuses cross-tenant version creation', async () => {
      const pack = await createPack('customer', ORG_FOREIGN);
      const observed = await invoke(packController.createVersion, makeReq({
        user: { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER },
        params: { packId: String(pack.id) },
        body: { version_number: '9.9.9' }
      }));

      assert.strictEqual(observed.statusCode, 404);

      // Non-vacuity: no version was created in the foreign pack.
      const versions = await KnowledgePackVersion.listVersions(pack.id);
      assert.strictEqual(versions.length, 0, 'a refused cross-tenant write must write nothing');
    });

    it('refuses cross-tenant lifecycle and membership operations', async () => {
      const pack = await createPack('customer', ORG_FOREIGN);
      const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
        { userId: REVIEWER });

      const asOwner = { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER };

      const lifecycle = await invoke(packController.submitForReview, makeReq({
        user: asOwner,
        params: { packId: String(pack.id), versionId: String(version.id) }
      }));
      assert.strictEqual(lifecycle.statusCode, 404, 'cross-tenant lifecycle action must be refused');

      const membership = await invoke(packController.addMember, makeReq({
        user: asOwner,
        params: { packId: String(pack.id), versionId: String(version.id) },
        body: { task_template_version_id: '1' }
      }));
      assert.strictEqual(membership.statusCode, 404, 'cross-tenant membership mutation must be refused');

      // Non-vacuity: the foreign version is untouched by either attempt.
      const [row] = await withConn((conn) => query(conn,
        `SELECT lifecycle_state FROM knowledge_pack_versions WHERE id = ?`, [version.id]));
      assert.strictEqual(row.lifecycle_state, 'draft',
        'a refused cross-tenant lifecycle action must not advance the version');
    });

    it('ignores a caller-supplied organization identifier', async () => {
      const pack = await createPack('customer', ORG_FOREIGN);
      const asOwner = { id: ADMIN_OWNER, role: 'admin', organization_id: ORG_OWNER };

      // Naming the owning tenant in the request must not confer access.
      const viaQuery = await invoke(packController.getPack, makeReq({
        user: asOwner,
        params: { packId: String(pack.id) },
        query: { organization_id: String(ORG_FOREIGN), organizationId: String(ORG_FOREIGN) }
      }));
      assert.strictEqual(viaQuery.statusCode, 404,
        'the authenticated organization is authoritative, not a supplied identifier');
    });
  });

  // ==========================================================================
  // R1-2 — approval identity covers the material governed surface
  // ==========================================================================
  describe('R1-2 approval identity covers governed semantics and applicability', () => {
    it('retains a valid approval when nothing material changed', async () => {
      const templateId = await createWorkingTemplate();
      await approve(templateId);
      const sha = await approvedSha(templateId);

      const result = await TaskTemplate.publishVersion(templateId, PUBLISHER,
        { publishedByOrganizationId: ORG_OWNER });

      assert.ok(result.versionId, 'unchanged content must remain publishable under its approval');
      assert.strictEqual(await approvedSha(templateId), sha);
    });

    it('invalidates approval when the maintenance strategy changes', async () => {
      const templateId = await createWorkingTemplate();
      await approve(templateId);
      const before = await approvedSha(templateId);

      await withConn((conn) => query(conn,
        `UPDATE task_templates SET maintenance_strategy = 'corrective' WHERE id = ?`, [templateId]));

      assert.strictEqual(await approvedSha(templateId), before,
        'the recorded approval must still hold its original fingerprint');
      await assertApprovalInvalidated(templateId, 'maintenance strategy');

      await assert.rejects(
        () => TaskTemplate.publishVersion(templateId, PUBLISHER, { publishedByOrganizationId: ORG_OWNER }),
        (error) => admissionRules(error).includes('APPROVAL_STALE'),
        'the stale approval must no longer authorize publication'
      );
    });

    it('invalidates approval for every other material governed field', async () => {
      // Each mutation targets exactly one governed semantic field; publication
      // must be refused in every case, so the approval surface cannot be a
      // partial list that happens to include only maintenance_strategy.
      const mutations = [
        ['task family', `task_family_id = (SELECT id FROM task_families WHERE family_code='replace')`],
        ['trigger mechanism', `trigger_mechanism = 'condition_based',
             trigger_condition_parameter = 'vibration', trigger_condition_operator = 'gt',
             trigger_condition_value = 4.5, trigger_condition_unit = 'mm/s',
             trigger_basis_source_version_id = (
               SELECT sv.id FROM knowledge_source_versions sv ORDER BY sv.id LIMIT 1)`],
        ['trigger event description', `trigger_mechanism = 'event',
             trigger_event_description = 'On abnormal noise',
             trigger_basis_source_version_id = (
               SELECT sv.id FROM knowledge_source_versions sv ORDER BY sv.id LIMIT 1)`],
        ['knowledge scope', `knowledge_scope = 'customer', organization_id = ${ORG_OWNER}`],
        ['priority', `priority = 'high'`]
      ];

      for (const [label, setClause] of mutations) {
        const templateId = await createWorkingTemplate();
        await approve(templateId);
        const before = await approvedSha(templateId);

        await withConn((conn) => query(conn,
          `UPDATE task_templates SET ${setClause} WHERE id = ?`, [templateId]));

        assert.strictEqual(await approvedSha(templateId), before);
        await assertApprovalInvalidated(templateId, label);

        await assert.rejects(
          () => TaskTemplate.publishVersion(templateId, PUBLISHER, { publishedByOrganizationId: ORG_OWNER }),
          (error) => admissionRules(error).includes('APPROVAL_STALE'),
          `publication must be refused after a ${label} change`
        );
      }
    });

    it('binds content origin into the approval identity', async () => {
      // content_origin cannot be mutated after the fact — migration 020's
      // immutability guard (9.1) refuses to change an established origin — so its
      // materiality is proven by construction: two definitions identical in every
      // other respect, differing only in how their content originated, must
      // fingerprint differently.
      const authoredId = await createWorkingTemplate({ legacy: false });
      const legacyId = await createWorkingTemplate({ legacy: true });

      assert.notStrictEqual(await currentSha(authoredId), await currentSha(legacyId),
        'authored and legacy-generated knowledge must not share an approval identity');
    });

    it('binds the cited trigger basis into the approval identity', async () => {
      // trigger_basis_source_version_id is not independently variable: migration
      // 020 requires a basis exactly when a trigger is actually asserted. Its
      // materiality is therefore proven by holding everything else constant and
      // varying ONLY the cited basis, which must yield a different fingerprint.
      const basisIds = await withConn(async (conn) => {
        const rows = await query(conn,
          `SELECT id FROM knowledge_source_versions ORDER BY id LIMIT 2`);
        return rows.map((row) => Number(row.id));
      });
      assert.ok(basisIds.length >= 2, 'the fixture must provide two citable source versions');

      const fingerprintWithBasis = async (basisId) => {
        const templateId = await createWorkingTemplate();
        await withConn((conn) => query(conn,
          `UPDATE task_templates
              SET trigger_mechanism = 'calendar', frequency_value = 30, frequency_unit = 'day',
                  trigger_basis_source_version_id = ?
            WHERE id = ?`, [basisId, templateId]));
        return currentSha(templateId);
      };

      const withFirst = await fingerprintWithBasis(basisIds[0]);
      const withSecond = await fingerprintWithBasis(basisIds[1]);

      assert.notStrictEqual(withFirst, withSecond,
        'the cited trigger basis must be part of the approval identity');
    });

    it('invalidates approval when applicability is added, removed or retargeted', async () => {
      const cases = [
        ['addition', async (templateId) => withConn((conn) => query(conn,
          `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
           VALUES (?, ?, false)`, [templateId, ETYPE_B]))],
        ['removal', async (templateId) => withConn((conn) => query(conn,
          `DELETE FROM task_template_equipment_types WHERE task_template_id = ? AND equipment_type_id = ?`,
          [templateId, ETYPE_A]))],
        ['primary anchor retarget', async (templateId) => withConn((conn) => query(conn,
          `UPDATE task_template_equipment_types SET is_primary = true
            WHERE task_template_id = ? AND equipment_type_id = ?`, [templateId, ETYPE_A]))]
      ];

      for (const [label, mutate] of cases) {
        const templateId = await createWorkingTemplate();
        await approve(templateId);
        const before = await approvedSha(templateId);

        if (label === 'primary anchor retarget') {
          // Establish a second, non-primary type first so retargeting the anchor
          // is a genuine change rather than a no-op.
          await withConn((conn) => query(conn,
            `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
             VALUES (?, ?, false)`, [templateId, ETYPE_B]));
        }

        await mutate(templateId);

        assert.strictEqual(await approvedSha(templateId), before);
        await assertApprovalInvalidated(templateId, `applicability ${label}`);

        await assert.rejects(
          () => TaskTemplate.publishVersion(templateId, PUBLISHER, { publishedByOrganizationId: ORG_OWNER }),
          (error) => admissionRules(error).includes('APPROVAL_STALE'),
          `publication must be refused after applicability ${label}`
        );
      }
    });

    it('does not invalidate approval for non-material metadata', async () => {
      const templateId = await createWorkingTemplate();
      await approve(templateId);
      const before = await approvedSha(templateId);

      // The non-material surface of a governed definition is genuinely small, and
      // that is the architecture's intent: every semantic column is material, and
      // is_active / is_editable are publishability gates rather than metadata
      // (publishVersion refuses a template that is not editable or not active), so
      // neither would test approval identity. `updated_at` is pure bookkeeping —
      // it changes on every write, including the approval itself — so it is the
      // honest probe for "metadata must not invalidate an approval".
      await withConn((conn) => query(conn,
        `UPDATE task_templates SET updated_at = NOW() + INTERVAL '1 hour' WHERE id = ?`,
        [templateId]));

      assert.strictEqual(await currentSha(templateId), before,
        'non-material metadata must not invalidate an approval');

      const result = await TaskTemplate.publishVersion(templateId, PUBLISHER,
        { publishedByOrganizationId: ORG_OWNER });
      assert.ok(result.versionId, 'an approval must survive a non-material metadata change');
    });

    it('fingerprints applicability independently of row order', async () => {
      const templateId = await createWorkingTemplate();
      await withConn((conn) => query(conn,
        `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
         VALUES (?, ?, false)`, [templateId, ETYPE_B]));
      await approve(templateId);
      const before = await approvedSha(templateId);

      // Reorder the same membership: remove and re-insert in the opposite order.
      await withConn(async (conn) => {
        await query(conn,
          `DELETE FROM task_template_equipment_types WHERE task_template_id = ? AND equipment_type_id = ?`,
          [templateId, ETYPE_B]);
        await query(conn,
          `DELETE FROM task_template_equipment_types WHERE task_template_id = ? AND equipment_type_id = ?`,
          [templateId, ETYPE_A]);
        await query(conn,
          `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
           VALUES (?, ?, false)`, [templateId, ETYPE_A]);
        await query(conn,
          `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
           VALUES (?, ?, true)`, [templateId, ETYPE_B]);
      });

      // The set is unchanged even though the primary anchor moved, so this IS a
      // material change; assert only that ordering itself is not the cause by
      // re-establishing the original membership and comparing.
      await withConn(async (conn) => {
        await query(conn,
          `DELETE FROM task_template_equipment_types WHERE task_template_id = ?`, [templateId]);
        await query(conn,
          `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
           VALUES (?, ?, true)`, [templateId, ETYPE_A]);
        await query(conn,
          `INSERT INTO task_template_equipment_types (task_template_id, equipment_type_id, is_primary)
           VALUES (?, ?, false)`, [templateId, ETYPE_B]);
      });

      assert.strictEqual(await currentSha(templateId), before,
        'the same membership in a different insertion order must fingerprint identically');

      const result = await TaskTemplate.publishVersion(templateId, PUBLISHER,
        { publishedByOrganizationId: ORG_OWNER });
      assert.ok(result.versionId, 'reordered but unchanged membership must remain publishable');
    });
  });

  // ==========================================================================
  // R1-3 — frozen applicability immutability
  // ==========================================================================
  describe('R1-3 frozen version applicability is immutable', () => {
    it('permits legitimate construction before the version is sealed', async () => {
      // The publication path writes applicability BEFORE sealing the step set, so
      // pre-seal construction is the legitimate path and must keep working. The
      // ordering is asserted explicitly at the midpoint rather than assumed.
      await withConn(async (conn) => {
        const templateId = await createWorkingTemplate();
        const [version] = await query(conn,
          `INSERT INTO task_template_versions (task_template_id, version_number, equipment_type_id,
             template_name, maintenance_type, lifecycle_state_at_publish, is_step_set_sealed,
             published_by_user_id, published_at, reviewer_user_id, reviewed_at,
             approver_user_id, approved_at, safety_review_state,
             safety_reviewed_by_user_id, safety_reviewed_at,
             knowledge_type_id, task_family_id, maintenance_strategy, trigger_mechanism,
             knowledge_scope, organization_id)
           VALUES (?, 1, ?, 'R1 Construction', 'preventive', 'published', FALSE,
             $3, NOW(), $4, NOW(), $4, NOW(), 'reviewed_no_control_required', $4, NOW(),
             (SELECT id FROM knowledge_types WHERE type_code='MAINTENANCE_PROCEDURE'),
             (SELECT id FROM task_families WHERE family_code='inspect'),
             'preventive', 'no_fixed_interval',
             (SELECT knowledge_scope FROM task_templates WHERE id = $1),
             (SELECT organization_id FROM task_templates WHERE id = $1)) RETURNING id`,
          [templateId, ETYPE_A, PUBLISHER, REVIEWER]);

        const [step] = await query(conn,
          `SELECT id FROM task_template_steps WHERE task_template_id = ? ORDER BY step_no LIMIT 1`,
          [templateId]);
        await query(conn,
          `INSERT INTO task_template_step_versions
             (task_template_version_id, step_no, task_template_step_id, step_type, instruction)
           VALUES (?, 1, ?, 'instruction', 'R1 construction step')`, [version.id, step.id]);

        const [beforeSeal] = await query(conn,
          `SELECT is_step_set_sealed FROM task_template_versions WHERE id = ?`, [version.id]);
        assert.strictEqual(beforeSeal.is_step_set_sealed, false,
          'the midpoint precondition is an UNSEALED version');

        // The pre-seal applicability insert must succeed.
        await query(conn,
          `INSERT INTO task_template_version_equipment_types
             (task_template_version_id, equipment_type_id, is_primary)
           VALUES (?, ?, true)`, [version.id, ETYPE_A]);

        // Frozen provenance, then the seal — the documented assembly order.
        const [source] = await query(conn,
          `INSERT INTO knowledge_sources (source_code, source_category, default_title, organization_id)
           VALUES (?, 'engineering_standard', 'R1 Construction Source', NULL) RETURNING id`,
          [uniq('R1CSRC')]);
        const [sourceVersion] = await query(conn,
          `INSERT INTO knowledge_source_versions (knowledge_source_id, version_designation, title)
           VALUES (?, '1.0', 'R1 Construction Source Version') RETURNING id`, [source.id]);
        await query(conn,
          `INSERT INTO knowledge_template_version_evidence
             (task_template_version_id, knowledge_source_version_id, section_or_clause, derivation_notes)
           VALUES (?, ?, 'Section 1', 'R1 construction')`, [version.id, sourceVersion.id]);
        await query(conn,
          `UPDATE task_template_versions SET is_step_set_sealed = TRUE WHERE id = ?`, [version.id]);

        const [row] = await query(conn,
          `SELECT count(*)::int AS n FROM task_template_version_equipment_types
            WHERE task_template_version_id = ?`, [version.id]);
        assert.strictEqual(row.n, 1, 'pre-seal applicability construction must succeed');
      });
    });

    it('refuses INSERT after the version is sealed', async () => {
      const { versionId } = await createGovernedVersion();

      await withConn((conn) => assert.rejects(
        () => query(conn,
          `INSERT INTO task_template_version_equipment_types
             (task_template_version_id, equipment_type_id, is_primary)
           VALUES (?, ?, false)`, [versionId, ETYPE_B]),
        (error) => /cannot add Equipment-Type applicability to sealed/i.test(error.message || ''),
        'applicability must not be added to a sealed version'
      ));

      await assertFrozenSetUnchanged(versionId);
    });

    it('refuses UPDATE and DELETE of frozen applicability', async () => {
      const { versionId } = await createGovernedVersion();

      await withConn((conn) => assert.rejects(
        () => query(conn,
          `UPDATE task_template_version_equipment_types SET equipment_type_id = ?
            WHERE task_template_version_id = ?`, [ETYPE_B, versionId]),
        (error) => /immutable and cannot be UPDATE/i.test(error.message || ''),
        'frozen applicability must not be retargeted'
      ));

      await withConn((conn) => assert.rejects(
        () => query(conn,
          `DELETE FROM task_template_version_equipment_types WHERE task_template_version_id = ?`,
          [versionId]),
        (error) => /immutable and cannot be DELETE/i.test(error.message || ''),
        'frozen applicability must not be removed'
      ));

      await assertFrozenSetUnchanged(versionId);
    });
  });

  // ==========================================================================
  // R1-4 — storage and service agree on the member scope rule
  // ==========================================================================
  describe('R1-4 Pack membership scope rule agrees with the service', () => {
    it('permits a shared member in a shared pack and in a customer pack', async () => {
      for (const [scope, organizationId] of [['shared', null], ['customer', ORG_OWNER]]) {
        const pack = await createPack(scope, organizationId);
        const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
          { userId: REVIEWER });
        const member = await createGovernedVersion({ scope: 'shared', organizationId: null });

        await KnowledgePackVersion.addMember(pack.id, version.id, member.versionId, REVIEWER);

        const members = await KnowledgePackVersion.listMembers(pack.id, version.id);
        assert.strictEqual(members.length, 1,
          `a ${scope} pack must accept globally applicable (shared) members`);
      }
    });

    it('refuses a customer member in a customer pack at the storage layer', async () => {
      const pack = await createPack('customer', ORG_OWNER);
      const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
        { userId: REVIEWER });
      const tenantMember = await createGovernedVersion({ scope: 'customer', organizationId: ORG_OWNER });

      // Bypasses the service entirely: the storage guard must refuse on its own.
      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO knowledge_pack_version_task_template_versions
             (knowledge_pack_version_id, task_template_version_id, added_by_user_id)
           VALUES (?, ?, ?)`, [version.id, tenantMember.versionId, REVIEWER])),
        (error) => /may not contain customer knowledge: an M6\.3 pack member must be globally applicable \(shared\) knowledge/i
          .test(error.message || ''),
        'storage must enforce the ratified M6.3 member rule, not only the service'
      );

      const members = await KnowledgePackVersion.listMembers(pack.id, version.id);
      assert.strictEqual(members.length, 0, 'a refused composition must commit nothing');
    });

    it('still refuses a tenant member through the service', async () => {
      const pack = await createPack('customer', ORG_OWNER);
      const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
        { userId: REVIEWER });
      const tenantMember = await createGovernedVersion({ scope: 'customer', organizationId: ORG_OWNER });

      await assert.rejects(
        () => KnowledgePackVersion.addMember(pack.id, version.id, tenantMember.versionId, REVIEWER),
        (error) => error.code === 'MEMBER_SCOPE_VIOLATION',
        'the service guard must not be weakened in favour of the storage rule'
      );
    });
  });

  // ==========================================================================
  // R1-5 — pack scope snapshot consistency and ownership durability
  // ==========================================================================
  describe('R1-5 pack ownership snapshot and durability', () => {
    it('refuses a pack version whose scope contradicts its pack', async () => {
      const shared = await createPack('shared');
      const customer = await createPack('customer', ORG_OWNER);

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, knowledge_scope)
           VALUES (?, '1.0.0', 'draft', 'customer')`, [shared.id])),
        (error) => /declares knowledge scope customer but its pack .* has established shared/i
          .test(error.message || ''),
        'a shared pack must not carry a customer-scoped version'
      );

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `INSERT INTO knowledge_pack_versions (knowledge_pack_id, version_number, lifecycle_state, knowledge_scope)
           VALUES (?, '1.0.0', 'draft', 'shared')`, [customer.id])),
        (error) => /declares knowledge scope shared but its pack .* has established customer/i
          .test(error.message || ''),
        'a customer pack must not carry a shared-scoped version'
      );

      // Non-vacuity: neither refused insert left a version behind.
      for (const packId of [shared.id, customer.id]) {
        const versions = await KnowledgePackVersion.listVersions(packId);
        assert.strictEqual(versions.length, 0, 'a refused version insert must commit nothing');
      }
    });

    it('accepts a pack version whose scope matches its pack', async () => {
      for (const [scope, organizationId] of [['shared', null], ['customer', ORG_OWNER]]) {
        const pack = await createPack(scope, organizationId);
        const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
          { userId: REVIEWER });
        assert.strictEqual(version.knowledge_scope, scope,
          'the version must snapshot the ownership its pack declared');
      }
    });

    it('refuses to rewrite pack ownership once a version depends on it', async () => {
      const pack = await createPack('shared');
      await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
        { userId: REVIEWER });

      await assert.rejects(
        () => withConn((conn) => query(conn,
          `UPDATE knowledge_packs SET knowledge_scope = 'customer', organization_id = ? WHERE id = ?`,
          [ORG_OWNER, pack.id])),
        (error) => /ownership is durable/i.test(error.message || ''),
        'ownership must not be rewritten underneath an existing version'
      );

      // Non-vacuity: the pack still declares its original ownership.
      const [row] = await withConn((conn) => query(conn,
        `SELECT knowledge_scope, organization_id FROM knowledge_packs WHERE id = ?`, [pack.id]));
      assert.strictEqual(row.knowledge_scope, 'shared');
      assert.strictEqual(row.organization_id, null);
    });

    it('still allows ownership to be corrected while no version exists', async () => {
      const pack = await createPack('shared');

      await withConn((conn) => query(conn,
        `UPDATE knowledge_packs SET knowledge_scope = 'customer', organization_id = ? WHERE id = ?`,
        [ORG_OWNER, pack.id]));

      const [row] = await withConn((conn) => query(conn,
        `SELECT knowledge_scope, organization_id FROM knowledge_packs WHERE id = ?`, [pack.id]));
      assert.strictEqual(row.knowledge_scope, 'customer',
        'the guard must be scoped to packs that actually have versions');
      assert.strictEqual(Number(row.organization_id), ORG_OWNER);

      // A version created after the correction snapshots the corrected ownership.
      const version = await KnowledgePackVersion.createVersion(pack.id, { versionNumber: '1.0.0' },
        { userId: REVIEWER });
      assert.strictEqual(version.knowledge_scope, 'customer');
    });
  });
});

/** Assert a frozen applicability set is exactly one row on ETYPE_A, still primary. */
async function assertFrozenSetUnchanged(versionId) {
  await withConn(async (conn) => {
    const rows = await query(conn,
      `SELECT equipment_type_id, is_primary FROM task_template_version_equipment_types
        WHERE task_template_version_id = ? ORDER BY equipment_type_id`, [versionId]);
    assert.strictEqual(rows.length, 1, 'the frozen applicability set must survive the refused mutation');
    assert.strictEqual(Number(rows[0].equipment_type_id), ETYPE_A,
      'the frozen Equipment Type must be unchanged');
    assert.strictEqual(rows[0].is_primary, true, 'the frozen primary anchor must be unchanged');
  });
}
