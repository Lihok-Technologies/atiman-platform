/**
 * ATM-001 M6.4 — governed draft authoring primitive.
 *
 * Proves the reusable authoring seam can create and edit a GOVERNED DRAFT
 * definition with durable accountable attribution, and — equally important —
 * that it cannot do anything else. Every negative test asserts a refusal AND
 * that the refusal left nothing behind, because a refusal that also wrote would
 * be worse than no guard at all.
 *
 * The suite also proves the seam does not weaken M6.3 governance: approval,
 * safety-review attestation, publication and version creation remain exclusively
 * with the existing governed methods, and publication admission is unchanged.
 */

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { getConnection, isIntegrationTest } = require('../src/config/database');
const authoring = require('../src/services/knowledge-authoring.service');
const { TaskTemplate } = require('../src/models');
const {
  KnowledgeSource,
  KnowledgeSourceVersion,
  KnowledgeTemplateEvidence
} = require('../src/models/knowledge-provenance.model');

const DB_TEST_SKIP_REASON = isIntegrationTest()
  ? false
  : 'requires NODE_ENV=test and RUN_DB_TESTS=true with an explicitly named test database';

// Fixture identities live in the 992xxx block, which is verified free across every
// sanctioned suite. The range must be verified, not merely "high": an earlier
// revision of this suite reused 996xxx, which is knowledge-provenance-authoring's
// range, and the collision silently gave that suite's two tenants the same
// organization under a parallel run, breaking its cross-tenant isolation
// assertions. Suites share one database, so fixture id blocks are a shared
// resource.
const ORG_A = 992001;
const ORG_B = 992002;
const ACTOR = 992101;          // belongs to ORG_A
const REVIEWER = 992102;       // belongs to ORG_A
const APPROVER = 992103;       // belongs to ORG_A
const PUBLISHER = 992104;      // belongs to ORG_A
const INACTIVE_ACTOR = 992105; // belongs to ORG_A but is deactivated
const CATEGORY = 992201;
const CLASS = 992202;
const ETYPE_MAIN = 992203;     // canonical
const ETYPE_ALT = 992204;      // canonical
const ETYPE_RETIRED = 992205;  // identity_state = 'retired'
const LEGACY_SYSTEM_ID = 992900;
const LEGACY_NON_SYSTEM_ID = 992901;

let seq = 0;
const uniq = (prefix) => `${prefix}-${Date.now()}-${(seq += 1)}`;

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

let knowledgeTypeId = null;
let taskFamilyId = null;

async function ensureFixture() {
  await withConn(async (conn) => {
    for (const [id, name] of [[ORG_A, 'M6.4 Authoring Org A'], [ORG_B, 'M6.4 Authoring Org B']]) {
      await query(conn,
        `INSERT INTO organizations (id, organization_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
        [id, name]);
    }
    // An existing but deactivated principal: authorship must not be attributable
    // to someone who cannot be held accountable for it.
    await query(conn,
      `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
       VALUES ($1, 'm64-inactive', 'm64-inactive@test.local', 'x', 'M6.4 Inactive User', 'admin', $2, false)
       ON CONFLICT (id) DO NOTHING`, [INACTIVE_ACTOR, ORG_A]);

    for (const [id, username, role, org] of [
      [ACTOR, 'm64-actor', 'admin', ORG_A],
      [REVIEWER, 'm64-reviewer', 'supervisor', ORG_A],
      [APPROVER, 'm64-approver', 'supervisor', ORG_A],
      [PUBLISHER, 'm64-publisher', 'admin', ORG_A]
    ]) {
      await query(conn,
        `INSERT INTO users (id, username, email, password_hash, full_name, role, organization_id, is_active)
         VALUES ($1, $2, $3, 'x', 'M6.4 Authoring User', $4, $5, true) ON CONFLICT (id) DO NOTHING`,
        [id, username, `${username}@test.local`, role, org]);
    }
    await query(conn,
      `INSERT INTO equipment_categories (id, category_code, category_name)
       VALUES ($1, 'M64CAT', 'M6.4 Category') ON CONFLICT (id) DO NOTHING`, [CATEGORY]);
    await query(conn,
      `INSERT INTO equipment_classes (id, category_id, class_code, class_name)
       VALUES ($1, $2, 'M64CLS', 'M6.4 Class') ON CONFLICT (id) DO NOTHING`, [CLASS, CATEGORY]);
    await query(conn,
      `INSERT INTO equipment_types (id, class_id, type_code, type_name, identity_state)
       VALUES ($1, $2, 'M64TYPE', 'M6.4 Type', 'canonical'),
              ($3, $2, 'M64ALT', 'M6.4 Alt Type', 'canonical'),
              ($4, $2, 'M64RET', 'M6.4 Retired Type', 'retired')
       ON CONFLICT (id) DO NOTHING`, [ETYPE_MAIN, CLASS, ETYPE_ALT, ETYPE_RETIRED]);

    // Declaring a Type non-canonical obliges the fixture to declare its governed
    // retirement. Migration 019's ratified invariant is that every non-canonical
    // Type carries exactly one active approved resolution, and it is asserted
    // globally by the taxonomy suite. Creating a retired Type without it would
    // leave the shared test database incoherent and break that suite's invariant.
    await query(conn,
      `INSERT INTO equipment_type_identity_resolution
         (from_type_id, to_type_id, resolution_kind, rationale, review_state,
          reviewed_by_user_id, reviewed_at, approved_by_user_id, approved_at)
       SELECT $1, NULL, 'NOT_AN_EQUIPMENT_TYPE', 'M6.4 synthetic fixture retirement',
              'approved', $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
          SELECT 1 FROM equipment_type_identity_resolution
           WHERE from_type_id = $1 AND superseded_by_resolution_id IS NULL)`,
      [ETYPE_RETIRED, REVIEWER, APPROVER]);

    // A legacy generated system template and a legacy generated non-system
    // template, standing in for the reconciled corpus the service must never
    // rewrite.
    for (const [id, code, isSystem] of [
      [LEGACY_SYSTEM_ID, 'M64-LEGACY-SYS', true],
      [LEGACY_NON_SYSTEM_ID, 'M64-LEGACY-PLAIN', false]
    ]) {
      await query(conn,
        `INSERT INTO task_templates (id, equipment_type_id, template_code, template_name,
           maintenance_type, task_kind, content_origin, is_system, is_editable, review_state)
         VALUES ($1, $2, $3, 'M6.4 Legacy Fixture', 'preventive', 'inspection',
           'legacy_generated', $4, true, 'draft')
         ON CONFLICT (id) DO NOTHING`,
        [id, ETYPE_MAIN, code, isSystem]);
    }

    const [type] = await query(conn,
      `SELECT id FROM knowledge_types WHERE type_code = 'MAINTENANCE_PROCEDURE'`);
    const [family] = await query(conn,
      `SELECT id FROM task_families WHERE family_code = 'inspect'`);
    knowledgeTypeId = type.id;
    taskFamilyId = family.id;
  });
}

/** A complete, explicitly-governed creation input. Nothing here is inferred. */
function governedInput(overrides = {}) {
  return {
    templateName: 'M6.4 Authored Definition',
    templateCode: uniq('M64AUTH'),
    description: 'Synthetic authored definition for the authoring-primitive suite',
    maintenanceType: 'preventive',
    priority: 'medium',
    equipmentTypeId: ETYPE_MAIN,
    knowledgeTypeId,
    taskFamilyId,
    maintenanceStrategy: 'preventive',
    triggerMechanism: 'no_fixed_interval',
    knowledgeScope: 'shared',
    organizationId: null,
    aiAssisted: false,
    steps: [
      {
        step_no: 1,
        step_type: 'instruction',
        instruction: 'Synthetic observation step',
        data_type: 'measurement',
        unit: 'mm',
        min_value: 0,
        max_value: 10
      },
      { step_no: 2, step_type: 'instruction', instruction: 'Synthetic verification step' }
    ],
    safetyControls: [
      { safety_type: 'PPE', description: 'Synthetic control placeholder', is_mandatory: true }
    ],
    applicability: [{ equipment_type_id: ETYPE_MAIN, is_primary: true }],
    ...overrides
  };
}

async function assertRejected(promise, predicate, label) {
  await assert.rejects(promise, (error) => {
    assert.ok(predicate(error), `${label}: unexpected error ${error.code || error.name}: ${error.message}`);
    return true;
  });
}

const ruleOf = (error) => (error.failures || []).map((f) => f.rule);
const hasRule = (name) => (error) => ruleOf(error).includes(name);

async function countAuthoredTemplates(code) {
  return withConn(async (conn) => {
    const rows = await query(conn,
      `SELECT count(*)::int AS n FROM task_templates WHERE template_code = $1`, [code]);
    return rows[0].n;
  });
}

describe('ATM-001 M6.4 governed draft authoring', { skip: DB_TEST_SKIP_REASON }, () => {
  before(async () => {
    await ensureFixture();
  });

  // ==========================================================================
  // Creation — explicit governed state persists
  // ==========================================================================
  describe('createAuthoredDefinition', () => {
    it('creates a new authored draft carrying the caller\u2019s explicit governed choices', async () => {
      const created = await authoring.createAuthoredDefinition(
        governedInput(), { actorUserId: ACTOR }
      );

      assert.ok(created.id, 'a new identity must be created');
      assert.strictEqual(created.content_origin, 'authored',
        'this primitive creates authored definitions');
      assert.strictEqual(created.review_state, 'draft', 'a new definition starts as a draft');
      assert.strictEqual(created.is_system, false, 'authored knowledge is not a system template');
      assert.strictEqual(created.knowledge_type.type_code, 'MAINTENANCE_PROCEDURE');
      assert.strictEqual(created.task_family.family_code, 'inspect');
      assert.strictEqual(created.maintenance_strategy, 'preventive');
      assert.strictEqual(created.trigger.mechanism, 'no_fixed_interval',
        'the explicit absence of a trigger is representable');
      assert.strictEqual(created.knowledge_scope, 'shared');
      assert.strictEqual(created.organization_id, null, 'shared knowledge is bound to no tenant');
    });

    it('never infers a governed value from legacy-shaped input', async () => {
      // The caller supplies legacy scheduling and a title that names an equipment
      // type; none of it may become governed meaning.
      const created = await authoring.createAuthoredDefinition(governedInput({
        templateName: 'Diesel Generator - Inspection',
        frequencyValue: 1,
        frequencyUnit: 'month'
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.trigger.mechanism, 'no_fixed_interval',
        'a legacy scheduling value must never become a governed trigger');
      assert.strictEqual(created.maintenance_strategy, 'preventive');

      const legacy = await withConn((conn) => query(conn,
        `SELECT frequency_value, frequency_unit, frequency_type, frequency_interval
           FROM task_templates WHERE id = $1`, [created.id]));
      assert.strictEqual(legacy[0].frequency_value, null,
        'this primitive carries no scheduling value into a governed definition');
      assert.strictEqual(legacy[0].frequency_interval, null);
    });

    it('persists explicit applicability with its explicitly designated primary anchor', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        applicability: [
          { equipment_type_id: ETYPE_ALT, is_primary: false },
          { equipment_type_id: ETYPE_MAIN, is_primary: true }
        ]
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.applicability.length, 2);
      const primary = created.applicability.filter((row) => row.is_primary === true);
      assert.strictEqual(primary.length, 1);
      assert.strictEqual(Number(primary[0].equipment_type_id), ETYPE_MAIN,
        'the designated anchor is preserved exactly; it is never inferred');
      assert.strictEqual(primary[0].identity_state, 'canonical');
    });

    it('permits applicability to a retired Equipment Type and exposes its identity state', async () => {
      // Migration 020 has no canonical-only invariant, and the ratified legacy
      // manifest asserts applicability to superseded types. The primitive must
      // therefore not invent such a rule; it surfaces the state instead.
      const created = await authoring.createAuthoredDefinition(governedInput({
        applicability: [{ equipment_type_id: ETYPE_RETIRED, is_primary: true }]
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.applicability.length, 1);
      assert.strictEqual(created.applicability[0].identity_state, 'retired',
        'the target\u2019s identity state is visible to the caller rather than silently filtered');
    });

    it('persists steps in deterministic order with explicit acceptance criteria', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });

      assert.deepStrictEqual(created.steps.map((s) => s.step_no), [1, 2]);
      assert.deepStrictEqual(created.steps.map((s) => s.instruction),
        ['Synthetic observation step', 'Synthetic verification step']);
      assert.strictEqual(created.steps[0].data_type, 'measurement');
      assert.strictEqual(created.steps[0].unit, 'mm');
      assert.strictEqual(Number(created.steps[0].min_value), 0);
      assert.strictEqual(Number(created.steps[0].max_value), 10);
      assert.strictEqual(created.steps[1].data_type, null,
        'absent criteria stay absent — nothing is invented');
      assert.strictEqual(created.steps[1].expected_value, null);
    });

    it('assigns deterministic ordering when the caller supplies no step_no', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        steps: [
          { step_type: 'instruction', instruction: 'First supplied' },
          { step_type: 'instruction', instruction: 'Second supplied' },
          { step_type: 'instruction', instruction: 'Third supplied' }
        ]
      }), { actorUserId: ACTOR });

      assert.deepStrictEqual(created.steps.map((s) => s.step_no), [1, 2, 3]);
      assert.deepStrictEqual(created.steps.map((s) => s.instruction),
        ['First supplied', 'Second supplied', 'Third supplied']);
    });

    it('persists working safety controls and explicit legacy lineage', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        parentTemplateId: LEGACY_SYSTEM_ID,
        safetyControls: [
          { safety_type: 'guidance', description: 'Synthetic guidance', is_mandatory: false }
        ]
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.safety_controls.length, 1);
      assert.strictEqual(created.safety_controls[0].safety_type, 'guidance');
      assert.strictEqual(Number(created.parent_template_id), LEGACY_SYSTEM_ID,
        'lineage is preserved as lineage only');
    });

    it('does not fabricate AI disclosure the working definition has no column for', async () => {
      // Migration 009 places ai_assisted / ai_assistance_detail on the FROZEN
      // version tables, not on the working definition. The primitive therefore
      // neither accepts nor writes a draft-time disclosure, and it never records
      // `false` on the author's behalf.
      const aiColumns = await withConn((conn) => query(conn,
        `SELECT table_name, column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name IN ('ai_assisted', 'ai_assistance_detail')
          ORDER BY table_name, column_name`));

      assert.ok(aiColumns.length > 0, 'AI disclosure columns exist somewhere');
      assert.ok(aiColumns.every((row) => row.table_name !== 'task_templates'),
        'the working definition carries no AI disclosure column');

      const created = await authoring.createAuthoredDefinition(governedInput({
        aiAssisted: true,
        aiAssistanceDetail: { tool: 'synthetic' }
      }), { actorUserId: ACTOR });

      assert.strictEqual(Object.prototype.hasOwnProperty.call(created, 'ai'), false,
        'no AI disclosure is reported or invented for a working definition');
    });

    it('does not copy governed semantics, applicability, steps or controls from a lineage parent', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        parentTemplateId: LEGACY_SYSTEM_ID,
        maintenanceStrategy: null,
        triggerMechanism: null,
        applicability: [],
        steps: [],
        safetyControls: []
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.maintenance_strategy, null,
        'a parent never supplies governed semantics');
      assert.strictEqual(created.trigger.mechanism, null);
      assert.strictEqual(created.applicability.length, 0, 'applicability is never inherited');
      assert.strictEqual(created.steps.length, 0, 'legacy steps are never copied');
      assert.strictEqual(created.safety_controls.length, 0, 'legacy controls are never copied');
      assert.strictEqual(created.content_origin, 'authored');
    });

    it('records durable actor attribution', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });

      assert.strictEqual(Number(created.created_by), ACTOR,
        'authorship is attributed to the accountable actor');
      assert.ok(created.applicability.every((row) => Number(row.added_by_user_id) === ACTOR),
        'each applicability claim is attributed to the actor who asserted it');
    });

    it('reports incompleteness instead of filling it in', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeTypeId: null,
        taskFamilyId: null,
        maintenanceStrategy: null,
        triggerMechanism: null,
        knowledgeScope: null,
        applicability: [],
        steps: [],
        safetyControls: []
      }), { actorUserId: ACTOR });

      assert.strictEqual(created.completeness.is_complete_for_publication_candidate, false);
      for (const missing of ['knowledge_type', 'task_family', 'maintenance_strategy',
        'trigger_mechanism', 'knowledge_scope', 'steps', 'applicability', 'template_or_step_evidence']) {
        assert.ok(created.completeness.missing.includes(missing),
          `${missing} must be reported as missing rather than invented`);
      }
      assert.strictEqual(created.knowledge_type, null, 'nothing was filled in');
      assert.strictEqual(created.maintenance_strategy, null);
    });
  });

  // ==========================================================================
  // Accountable actor
  // ==========================================================================
  describe('accountable actor enforcement', () => {
    it('refuses a missing actor', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput(), {}),
        hasRule('ACTOR_REQUIRED'), 'missing actor'
      );
    });

    it('refuses a null actor and an anonymous identifier', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput(), { actorUserId: null }),
        hasRule('ACTOR_REQUIRED'), 'null actor'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput(), { actorUserId: 'system' }),
        hasRule('ACTOR_INVALID'), 'anonymous/system actor'
      );
    });

    it('refuses an existing but inactive actor, and writes nothing', async () => {
      const code = uniq('M64INACTIVE');
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ templateCode: code }),
          { actorUserId: INACTIVE_ACTOR }),
        (error) => error.code === 'ACTOR_INACTIVE', 'inactive actor'
      );
      assert.strictEqual(await countAuthoredTemplates(code), 0,
        'a refused inactive actor must write nothing');

      // The same principal is also refused on an existing definition.
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      await assertRejected(
        () => authoring.updateGovernedDraft(created.id, { maintenanceStrategy: 'predictive' },
          { actorUserId: INACTIVE_ACTOR }),
        (error) => error.code === 'ACTOR_INACTIVE', 'inactive actor on an existing definition'
      );
      const after = await authoring.loadAuthoredDefinition(created.id);
      assert.strictEqual(after.maintenance_strategy, 'preventive', 'the definition was not modified');
    });

    it('refuses an actor that does not exist, and writes nothing', async () => {
      const code = uniq('M64NOACTOR');
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ templateCode: code }),
          { actorUserId: 999999 }),
        (error) => error.code === 'ACTOR_NOT_FOUND', 'nonexistent actor'
      );
      assert.strictEqual(await countAuthoredTemplates(code), 0,
        'a refused creation must leave no definition behind');
    });
  });

  // ==========================================================================
  // Legacy and system-template protection
  // ==========================================================================
  describe('legacy and system-template protection', () => {
    it('refuses to author over a legacy_generated system template', async () => {
      await assertRejected(
        () => authoring.updateGovernedDraft(LEGACY_SYSTEM_ID,
          { maintenanceStrategy: 'preventive' }, { actorUserId: ACTOR }),
        (error) => error.code === 'LEGACY_DEFINITION_IMMUTABLE', 'legacy system template'
      );
    });

    it('refuses to author over any legacy_generated definition, system or not', async () => {
      await assertRejected(
        () => authoring.updateGovernedDraft(LEGACY_NON_SYSTEM_ID,
          { maintenanceStrategy: 'preventive' }, { actorUserId: ACTOR }),
        (error) => error.code === 'LEGACY_DEFINITION_IMMUTABLE', 'legacy non-system template'
      );
    });

    it('leaves the legacy fixtures exactly as they were', async () => {
      const rows = await withConn((conn) => query(conn,
        `SELECT id, template_name, maintenance_type, content_origin, is_system,
                review_state, knowledge_type_id, knowledge_scope, updated_at
           FROM task_templates WHERE id IN ($1, $2) ORDER BY id`,
        [LEGACY_SYSTEM_ID, LEGACY_NON_SYSTEM_ID]));

      assert.strictEqual(rows.length, 2);
      for (const row of rows) {
        assert.strictEqual(row.content_origin, 'legacy_generated',
          'legacy provenance is preserved; origin is never rewritten');
        assert.strictEqual(row.knowledge_type_id, null, 'no governed field was written to a legacy row');
        assert.strictEqual(row.knowledge_scope, null);
        assert.strictEqual(row.review_state, 'draft');
      }
    });

    it('cannot rewrite content_origin through an update', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });

      // content_origin is not a writable field: supplying it alone is refused as
      // an empty mutation, and the stored origin is unchanged afterwards.
      await assertRejected(
        () => authoring.updateGovernedDraft(created.id, { contentOrigin: 'legacy_generated' },
          { actorUserId: ACTOR }),
        hasRule('NO_WRITABLE_FIELDS'), 'origin rewrite attempt'
      );

      const after = await authoring.loadAuthoredDefinition(created.id);
      assert.strictEqual(after.content_origin, 'authored', 'origin was not rewritten');
    });
  });

  // ==========================================================================
  // Draft-only mutation
  // ==========================================================================
  describe('draft-only mutation', () => {
    it('refuses authoring once the definition is under review', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      await TaskTemplate.submitForReview(created.id, REVIEWER, null);

      await assertRejected(
        () => authoring.updateGovernedDraft(created.id, { maintenanceStrategy: 'predictive' },
          { actorUserId: ACTOR }),
        (error) => error.code === 'DRAFT_ONLY', 'under_review mutation'
      );
      await assertRejected(
        () => authoring.replaceSteps(created.id, [{ step_type: 'instruction', instruction: 'x' }],
          { actorUserId: ACTOR }),
        (error) => error.code === 'DRAFT_ONLY', 'under_review step replacement'
      );
      await assertRejected(
        () => authoring.setApplicability(created.id, [{ equipment_type_id: ETYPE_MAIN, is_primary: true }],
          { actorUserId: ACTOR }),
        (error) => error.code === 'DRAFT_ONLY', 'under_review applicability change'
      );

      const after = await authoring.loadAuthoredDefinition(created.id);
      assert.strictEqual(after.maintenance_strategy, 'preventive', 'no governed field changed');
    });

    it('refuses authoring once the definition is approved', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      await TaskTemplate.recordSafetyReview(created.id, REVIEWER, null, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(created.id, REVIEWER, null);
      await TaskTemplate.approveTemplate(created.id, APPROVER, null);

      await assertRejected(
        () => authoring.setSafetyControls(created.id, [], { actorUserId: ACTOR }),
        (error) => error.code === 'DRAFT_ONLY', 'approved mutation'
      );
    });
  });

  // ==========================================================================
  // Governed-field validation
  // ==========================================================================
  describe('governed-field validation', () => {
    it('refuses an unknown knowledge type or task family, and writes nothing', async () => {
      const code = uniq('M64BADKT');
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ templateCode: code, knowledgeTypeId: 987654 }),
          { actorUserId: ACTOR }),
        hasRule('KNOWLEDGE_TYPE_NOT_FOUND'), 'unknown knowledge type'
      );
      assert.strictEqual(await countAuthoredTemplates(code), 0);

      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ taskFamilyId: 987654 }),
          { actorUserId: ACTOR }),
        hasRule('TASK_FAMILY_NOT_FOUND'), 'unknown task family'
      );
    });

    it('refuses invalid governed vocabulary', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ maintenanceStrategy: 'reactive' }),
          { actorUserId: ACTOR }),
        hasRule('MAINTENANCE_STRATEGY_INVALID'), 'invalid maintenance strategy'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ priority: 'critical' }),
          { actorUserId: ACTOR }),
        hasRule('PRIORITY_INVALID'), 'invalid priority'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ taskKind: 'polishing' }),
          { actorUserId: ACTOR }),
        hasRule('TASK_KIND_INVALID'), 'invalid task kind'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ knowledgeScope: 'marketplace' }),
          { actorUserId: ACTOR }),
        hasRule('KNOWLEDGE_SCOPE_NOT_ASSIGNABLE'), 'non-assignable marketplace scope'
      );
    });

    it('requires the material structural fields rather than silently defaulting them', async () => {
      for (const [field, rule] of [
        ['templateName', 'TEMPLATE_NAME_REQUIRED'],
        ['maintenanceType', 'MAINTENANCE_TYPE_REQUIRED'],
        ['priority', 'PRIORITY_REQUIRED'],
        ['equipmentTypeId', 'EQUIPMENT_TYPE_REQUIRED']
      ]) {
        await assertRejected(
          () => authoring.createAuthoredDefinition(governedInput({ [field]: null }),
            { actorUserId: ACTOR }),
          hasRule(rule), `missing ${field}`
        );
      }
    });

    it('refuses an unknown Equipment Type or lineage parent', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ equipmentTypeId: 987654 }),
          { actorUserId: ACTOR }),
        hasRule('EQUIPMENT_TYPE_NOT_FOUND'), 'unknown equipment type'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({ parentTemplateId: 987654 }),
          { actorUserId: ACTOR }),
        hasRule('PARENT_TEMPLATE_NOT_FOUND'), 'unknown lineage parent'
      );
    });

    it('refuses scope and organization combinations that contradict each other', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          knowledgeScope: 'shared', organizationId: ORG_A
        }), { actorUserId: ACTOR }),
        hasRule('SCOPE_ORGANIZATION_NOT_ALLOWED'), 'shared with an organization'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          knowledgeScope: 'customer', organizationId: null
        }), { actorUserId: ACTOR }),
        hasRule('SCOPE_ORGANIZATION_REQUIRED'), 'customer without an organization'
      );
    });

    it('refuses an incoherent trigger and never infers one', async () => {
      const cases = [
        [{ triggerMechanism: 'calendar' }, 'TRIGGER_INTERVAL_MAGNITUDE_REQUIRED'],
        [{ triggerMechanism: 'calendar', triggerConditionValue: 30, triggerConditionUnit: 'day',
          triggerConditionParameter: 'x' }, 'TRIGGER_INTERVAL_CARRIES_CRITERION'],
        [{ triggerMechanism: 'condition_based' }, 'TRIGGER_CRITERION_INCOMPLETE'],
        [{ triggerMechanism: 'event' }, 'TRIGGER_EVENT_DESCRIPTION_REQUIRED'],
        [{ triggerMechanism: 'event', triggerEventDescription: 'x', triggerConditionUnit: 'mm' },
          'TRIGGER_EVENT_CARRIES_CRITERION'],
        [{ triggerMechanism: 'no_fixed_interval', triggerConditionValue: 1, triggerConditionUnit: 'month' },
          'TRIGGER_ABSENCE_CARRIES_DETAIL'],
        [{ triggerMechanism: 'no_fixed_interval', triggerBasisSourceVersionId: 1 },
          'TRIGGER_ABSENCE_BASIS_NOT_ALLOWED'],
        [{ triggerMechanism: null, triggerConditionUnit: 'mm' },
          'TRIGGER_DETAIL_WITHOUT_MECHANISM'],
        [{ triggerMechanism: 'condition_based', triggerConditionParameter: 'vibration',
          triggerConditionOperator: 'gt', triggerConditionValue: 4.5, triggerConditionUnit: 'mm/s',
          triggerConditionContext: 'bearing housing' }, null]
      ];

      for (const [overrides, rule] of cases) {
        if (rule === null) {
          const created = await authoring.createAuthoredDefinition(governedInput(overrides),
            { actorUserId: ACTOR });
          assert.strictEqual(created.trigger.mechanism, 'condition_based',
            'a coherent condition-based trigger is accepted');
          assert.strictEqual(created.trigger.condition_context, 'bearing housing');
          continue;
        }
        await assertRejected(
          () => authoring.createAuthoredDefinition(governedInput(overrides), { actorUserId: ACTOR }),
          hasRule(rule), `incoherent trigger ${rule}`
        );
      }
    });
  });

  // ==========================================================================
  // Applicability
  // ==========================================================================
  describe('applicability operations', () => {
    it('refuses duplicate applicability entries', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          applicability: [
            { equipment_type_id: ETYPE_MAIN, is_primary: true },
            { equipment_type_id: ETYPE_MAIN, is_primary: false }
          ]
        }), { actorUserId: ACTOR }),
        hasRule('APPLICABILITY_DUPLICATE'), 'duplicate applicability'
      );
    });

    it('refuses multiple primary anchors and a complete set with no anchor', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          applicability: [
            { equipment_type_id: ETYPE_MAIN, is_primary: true },
            { equipment_type_id: ETYPE_ALT, is_primary: true }
          ]
        }), { actorUserId: ACTOR }),
        hasRule('APPLICABILITY_MULTIPLE_PRIMARY'), 'multiple primary anchors'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          applicability: [{ equipment_type_id: ETYPE_MAIN }]
        }), { actorUserId: ACTOR }),
        hasRule('APPLICABILITY_PRIMARY_REQUIRED'), 'no primary anchor'
      );
    });

    it('refuses an unknown Equipment Type in the applicability set', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          applicability: [{ equipment_type_id: 987654, is_primary: true }]
        }), { actorUserId: ACTOR }),
        hasRule('APPLICABILITY_TYPE_NOT_FOUND'), 'unknown applicability target'
      );
    });

    it('replaces the applicability set transactionally and re-attributes the actor', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      assert.strictEqual(created.applicability.length, 1);

      const updated = await authoring.setApplicability(created.id,
        [{ equipment_type_id: ETYPE_ALT, is_primary: true }], { actorUserId: ACTOR });

      assert.strictEqual(updated.applicability.length, 1);
      assert.strictEqual(Number(updated.applicability[0].equipment_type_id), ETYPE_ALT);
      assert.strictEqual(updated.applicability[0].is_primary, true);
      assert.strictEqual(Number(updated.applicability[0].added_by_user_id), ACTOR);
    });

    it('permits clearing applicability while drafting (an incomplete draft is valid)', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      const cleared = await authoring.setApplicability(created.id, [], { actorUserId: ACTOR });
      assert.strictEqual(cleared.applicability.length, 0);
      assert.ok(cleared.completeness.missing.includes('applicability'));
    });
  });

  // ==========================================================================
  // Steps
  // ==========================================================================
  describe('step operations', () => {
    it('refuses a step without an instruction or a step type', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          steps: [{ step_type: 'instruction' }]
        }), { actorUserId: ACTOR }),
        hasRule('STEP_INSTRUCTION_REQUIRED'), 'step without instruction'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          steps: [{ instruction: 'no type' }]
        }), { actorUserId: ACTOR }),
        hasRule('STEP_TYPE_REQUIRED'), 'step without type'
      );
    });

    it('refuses an unsupported data type and incoherent measurement limits', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          steps: [{ step_type: 'instruction', instruction: 'x', data_type: 'telemetry' }]
        }), { actorUserId: ACTOR }),
        hasRule('STEP_DATA_TYPE_UNSUPPORTED'), 'unsupported data type'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          steps: [{ step_type: 'instruction', instruction: 'x', min_value: 10, max_value: 1 }]
        }), { actorUserId: ACTOR }),
        hasRule('STEP_LIMITS_INCOHERENT'), 'min greater than max'
      );
    });

    it('replaces steps in deterministic order while drafting', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      const updated = await authoring.replaceSteps(created.id, [
        { step_type: 'instruction', instruction: 'Replacement A' },
        { step_type: 'instruction', instruction: 'Replacement B' },
        { step_type: 'instruction', instruction: 'Replacement C' }
      ], { actorUserId: ACTOR });

      assert.deepStrictEqual(updated.steps.map((s) => s.step_no), [1, 2, 3]);
      assert.deepStrictEqual(updated.steps.map((s) => s.instruction),
        ['Replacement A', 'Replacement B', 'Replacement C']);
    });

    it('refuses to remove a step that carries working evidence, so provenance is never cascaded away', async () => {
      const source = await KnowledgeSource.createSource(
        { sourceCode: uniq('M64SRC'), sourceCategory: 'engineering_authored',
          defaultTitle: 'M6.4 synthetic evidence source' },
        { organizationId: ORG_A, userId: ACTOR }
      );
      const version = await KnowledgeSourceVersion.createVersion(source.id,
        { versionDesignation: '1.0', title: 'M6.4 synthetic evidence version' },
        { organizationId: ORG_A, userId: ACTOR });

      // A step subject requires a tenant-scoped definition, so this fixture is
      // created as customer-scoped.
      const tenantScoped = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });
      const tenantSteps = await withConn((conn) => query(conn,
        `SELECT id FROM task_template_steps WHERE task_template_id = $1 ORDER BY step_no`,
        [tenantScoped.id]));

      await KnowledgeTemplateEvidence.attachEvidence(
        { taskTemplateStepId: tenantSteps[0].id },
        { knowledgeSourceVersionId: version.id, sectionOrClause: 'Synthetic clause',
          confidenceLevel: 'provisional', supportingRole: 'supporting' },
        { organizationId: ORG_A, userId: ACTOR }
      );

      await assertRejected(
        () => authoring.replaceSteps(tenantScoped.id,
          [{ step_type: 'instruction', instruction: 'would cascade evidence' }],
          { actorUserId: ACTOR, organizationId: ORG_A }),
        (error) => error.code === 'STEP_EVIDENCE_PRESENT', 'step replacement over attached evidence'
      );

      const after = await withConn((conn) => query(conn,
        `SELECT count(*)::int AS n FROM task_template_steps WHERE task_template_id = $1`,
        [tenantScoped.id]));
      assert.strictEqual(after[0].n, 2, 'the refused replacement removed nothing');
    });
  });

  // ==========================================================================
  // Safety controls
  // ==========================================================================
  describe('safety-control operations', () => {
    it('refuses a control without a type or description', async () => {
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          safetyControls: [{ description: 'no type' }]
        }), { actorUserId: ACTOR }),
        hasRule('SAFETY_TYPE_REQUIRED'), 'control without safety_type'
      );
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          safetyControls: [{ safety_type: 'PPE' }]
        }), { actorUserId: ACTOR }),
        hasRule('SAFETY_DESCRIPTION_REQUIRED'), 'control without description'
      );
    });

    it('replaces working safety controls without touching safety-review state', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      const updated = await authoring.setSafetyControls(created.id, [
        { safety_type: 'guidance', description: 'Replacement control', is_mandatory: true }
      ], { actorUserId: ACTOR });

      assert.strictEqual(updated.safety_controls.length, 1);
      assert.strictEqual(updated.safety_controls[0].description, 'Replacement control');
      assert.strictEqual(updated.safety_review_state, 'not_assessed',
        'authoring never records a safety-review attestation');
    });
  });

  // ==========================================================================
  // Tenancy
  // ==========================================================================
  describe('tenancy', () => {
    it('refuses cross-tenant mutation and leaves the definition untouched', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      await assertRejected(
        () => authoring.updateGovernedDraft(created.id, { maintenanceStrategy: 'predictive' },
          { actorUserId: ACTOR, organizationId: ORG_B }),
        (error) => error.code === 'KNOWLEDGE_AUTHORING_NOT_FOUND', 'cross-tenant mutation'
      );

      const after = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG_A });
      assert.strictEqual(after.maintenance_strategy, 'preventive', 'the definition was not modified');
    });

    it('permits the owning organization to mutate its customer-scoped definition', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      const updated = await authoring.updateGovernedDraft(created.id,
        { maintenanceStrategy: 'predictive' }, { actorUserId: ACTOR, organizationId: ORG_A });
      assert.strictEqual(updated.maintenance_strategy, 'predictive');
    });

    it('refuses to create a tenant-scoped definition owned by another organization', async () => {
      // The actor belongs to ORG_A; the requested owner is ORG_B. Creating the
      // definition would be a cross-tenant write, so it is refused outright.
      const code = uniq('M64XORG');
      await assertRejected(
        () => authoring.createAuthoredDefinition(governedInput({
          templateCode: code, knowledgeScope: 'customer', organizationId: ORG_B
        }), { actorUserId: ACTOR }),
        (error) => error.code === 'ACTOR_ORGANIZATION_MISMATCH', 'cross-tenant creation'
      );
      assert.strictEqual(await countAuthoredTemplates(code), 0,
        'a refused cross-tenant creation writes nothing');
    });

    it('refuses to transfer a customer-scoped definition to another organization', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      await assertRejected(
        () => authoring.updateGovernedDraft(created.id,
          { knowledgeScope: 'customer', organizationId: ORG_B },
          { actorUserId: ACTOR, organizationId: ORG_A }),
        (error) => error.code === 'ACTOR_ORGANIZATION_MISMATCH', 'transfer to another organization'
      );

      const after = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG_A });
      assert.strictEqual(Number(after.organization_id), ORG_A,
        'ownership is unchanged: the transfer must not have landed');
      assert.strictEqual(after.knowledge_scope, 'customer');
    });

    it('refuses to convert a shared definition into another organization\'s knowledge', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'shared', organizationId: null
      }), { actorUserId: ACTOR });

      await assertRejected(
        () => authoring.updateGovernedDraft(created.id,
          { knowledgeScope: 'customer', organizationId: ORG_B }, { actorUserId: ACTOR }),
        (error) => error.code === 'ACTOR_ORGANIZATION_MISMATCH', 'shared to another organization'
      );

      const after = await authoring.loadAuthoredDefinition(created.id);
      assert.strictEqual(after.organization_id, null,
        'the shared definition must not have acquired an owner');
      assert.strictEqual(after.knowledge_scope, 'shared');
    });

    it('permits the owning organization to de-scope its own knowledge to shared', async () => {
      // Customer Org A -> shared is performed BY Org A on knowledge Org A owns. It
      // creates no organization ownership (shared is organization_id = NULL), so no
      // cross-tenant ownership arises; ownership only widens from one tenant to no
      // tenant, never from one tenant to another.
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      const updated = await authoring.updateGovernedDraft(created.id,
        { knowledgeScope: 'shared', organizationId: null },
        { actorUserId: ACTOR, organizationId: ORG_A });

      assert.strictEqual(updated.knowledge_scope, 'shared');
      assert.strictEqual(updated.organization_id, null,
        'shared knowledge is bound to no tenant');
    });

    it('permits the owning organization to keep ownership unchanged', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      const updated = await authoring.updateGovernedDraft(created.id,
        { knowledgeScope: 'customer', organizationId: ORG_A, maintenanceStrategy: 'predictive' },
        { actorUserId: ACTOR, organizationId: ORG_A });

      assert.strictEqual(Number(updated.organization_id), ORG_A);
      assert.strictEqual(updated.maintenance_strategy, 'predictive');
    });

    it('does not expose a customer-scoped definition to an unscoped caller', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      await assertRejected(
        () => authoring.loadAuthoredDefinition(created.id),
        (error) => error.code === 'KNOWLEDGE_AUTHORING_NOT_FOUND', 'unscoped read of a customer definition'
      );
    });
  });

  // ==========================================================================
  // Governance non-bypass
  // ==========================================================================
  describe('governance non-bypass', () => {
    it('exposes no capability to approve, publish or mutate versions', () => {
      const surface = Object.keys(authoring);
      for (const forbidden of ['approve', 'publish', 'publishVersion', 'approveTemplate',
        'submitForReview', 'recordSafetyReview', 'setReviewState', 'update', 'delete']) {
        assert.ok(!surface.includes(forbidden),
          `the authoring primitive must not expose ${forbidden}`);
      }
      assert.deepStrictEqual(surface.sort(), [
        'ASSIGNABLE_KNOWLEDGE_SCOPES', 'AUTHORED_CONTENT_ORIGIN', 'AuthoringConflictError',
        'AuthoringNotFoundError', 'AuthoringValidationError', 'MAINTENANCE_STRATEGIES',
        'PRIORITIES', 'TRIGGER_CONDITION_OPERATORS', 'TRIGGER_MECHANISMS',
        'createAuthoredDefinition', 'describeDraftCompleteness', 'loadAuthoredDefinition',
        'replaceSteps', 'setApplicability', 'setSafetyControls', 'updateGovernedDraft'
      ].sort(), 'the public surface is the narrow authoring seam and nothing else');
    });

    it('cannot even be approved while governed knowledge is absent — the database refuses', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeTypeId: null, taskFamilyId: null, maintenanceStrategy: null,
        triggerMechanism: null, knowledgeScope: null
      }), { actorUserId: ACTOR });

      await TaskTemplate.recordSafetyReview(created.id, REVIEWER, null, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(created.id, REVIEWER, null);
      await assert.rejects(
        () => TaskTemplate.approveTemplate(created.id, APPROVER, null),
        (error) => /chk_task_templates_governed_knowledge_required/.test(error.message || ''),
        'the schema refuses to approve a definition with no governed knowledge'
      );
    });

    it('leaves an approvable draft unpublishable when it is not publication-ready — admission still fails closed', async () => {
      // Governed knowledge is present (so approval is permitted) and steps exist,
      // but the governed applicability set is absent. Publication admission must
      // still fail closed.
      const created = await authoring.createAuthoredDefinition(governedInput({
        applicability: []
      }), { actorUserId: ACTOR });

      await TaskTemplate.recordSafetyReview(created.id, REVIEWER, null, 'reviewed_no_control_required');
      await TaskTemplate.submitForReview(created.id, REVIEWER, null);
      await TaskTemplate.approveTemplate(created.id, APPROVER, null);

      await assert.rejects(
        () => TaskTemplate.publishVersion(created.id, PUBLISHER, { publishedByOrganizationId: null }),
        (error) => {
          const rules = (error.failures || []).map((f) => f.rule);
          assert.ok(rules.length > 0,
            'publication admission must report structured failures rather than throwing generically');
          assert.ok(rules.includes('APPLICABILITY_MISSING'),
            `expected APPLICABILITY_MISSING, saw ${rules.join(',')}`);
          return true;
        },
        'an incomplete authored draft must not publish'
      );
    });

    it('produces knowledge the existing governed lifecycle can publish, and then refuses further authoring', async () => {
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      // Evidence is authored through the EXISTING governed provenance path, which
      // this primitive neither reimplements nor bypasses. Working evidence on a
      // step requires a tenant-scoped subject, hence the customer scope above.
      const steps = await withConn((conn) => query(conn,
        `SELECT id FROM task_template_steps WHERE task_template_id = $1 ORDER BY step_no`, [created.id]));
      const source = await KnowledgeSource.createSource(
        { sourceCode: uniq('M64PUB'), sourceCategory: 'engineering_authored',
          defaultTitle: 'M6.4 synthetic publication source' },
        { organizationId: ORG_A, userId: ACTOR }
      );
      const version = await KnowledgeSourceVersion.createVersion(source.id,
        { versionDesignation: '1.0', title: 'M6.4 synthetic publication source version' },
        { organizationId: ORG_A, userId: ACTOR });
      await KnowledgeTemplateEvidence.attachEvidence(
        { taskTemplateStepId: steps[0].id },
        { knowledgeSourceVersionId: version.id, sectionOrClause: 'Synthetic clause',
          confidenceLevel: 'provisional', supportingRole: 'primary' },
        { organizationId: ORG_A, userId: ACTOR }
      );

      await TaskTemplate.recordSafetyReview(created.id, REVIEWER, ORG_A, 'reviewed_controls_defined');
      await TaskTemplate.submitForReview(created.id, REVIEWER, ORG_A);
      await TaskTemplate.approveTemplate(created.id, APPROVER, ORG_A);
      const published = await TaskTemplate.publishVersion(created.id, PUBLISHER,
        { publishedByOrganizationId: ORG_A });

      assert.ok(published.versionId, 'the authored definition publishes through the real governed path');

      const frozen = await withConn((conn) => query(conn,
        `SELECT v.knowledge_type_id, v.task_family_id, v.maintenance_strategy, v.trigger_mechanism,
                v.knowledge_scope, v.organization_id, v.lifecycle_state_at_publish,
                (SELECT count(*)::int FROM task_template_version_equipment_types a
                  WHERE a.task_template_version_id = v.id) AS applicability,
                (SELECT count(*)::int FROM task_template_step_versions s
                  WHERE s.task_template_version_id = v.id) AS steps,
                (SELECT count(*)::int FROM knowledge_template_version_evidence e
                  WHERE e.task_template_version_id = v.id
                     OR e.task_template_step_version_id IN (
                          SELECT s.id FROM task_template_step_versions s
                           WHERE s.task_template_version_id = v.id)) AS evidence
           FROM task_template_versions v WHERE v.id = $1`, [published.versionId]));

      assert.strictEqual(frozen[0].trigger_mechanism, 'no_fixed_interval',
        'the governed trigger was frozen, not inferred');
      assert.strictEqual(frozen[0].knowledge_scope, 'customer');
      assert.strictEqual(Number(frozen[0].organization_id), ORG_A);
      assert.strictEqual(frozen[0].applicability, 1, 'applicability was frozen into the version');
      assert.strictEqual(frozen[0].steps, 2, 'the authored steps were frozen');
      assert.strictEqual(frozen[0].evidence, 1, 'the governed evidence was frozen');

      // After publication the definition is no longer authorable, and the frozen
      // version is untouched by the refused attempts.
      await assertRejected(
        () => authoring.replaceSteps(created.id, [{ step_type: 'instruction', instruction: 'late edit' }],
          { actorUserId: ACTOR, organizationId: ORG_A }),
        (error) => error.code === 'DRAFT_ONLY', 'authoring after publication'
      );
      await assertRejected(
        () => authoring.setApplicability(created.id, [{ equipment_type_id: ETYPE_ALT, is_primary: true }],
          { actorUserId: ACTOR, organizationId: ORG_A }),
        (error) => error.code === 'DRAFT_ONLY', 'applicability change after publication'
      );

      const after = await withConn((conn) => query(conn,
        `SELECT (SELECT count(*)::int FROM task_template_step_versions s
                  WHERE s.task_template_version_id = $1) AS steps,
                (SELECT count(*)::int FROM task_template_version_equipment_types a
                  WHERE a.task_template_version_id = $1) AS applicability`,
        [published.versionId]));
      assert.strictEqual(after[0].steps, 2, 'the frozen version steps are immutable');
      assert.strictEqual(after[0].applicability, 1, 'the frozen version applicability is immutable');
    });

    it('characterises the shared-knowledge evidence precondition of the existing provenance path', async () => {
      // A decision-relevant fact, asserted rather than assumed: the governed
      // provenance path refuses to attach working evidence to a SHARED (global)
      // definition, and requires the authoring principal to belong to an
      // organization. Because publication admission requires frozen evidence, a
      // shared-scope definition cannot currently be published either. This is a
      // property of the existing M3 path, not of this authoring primitive, and it
      // is recorded here so the pilot's scope is not chosen on an assumption.
      const shared = await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });
      const source = await KnowledgeSource.createSource(
        { sourceCode: uniq('M64SHARED'), sourceCategory: 'engineering_authored',
          defaultTitle: 'M6.4 synthetic shared-scope source' },
        { organizationId: ORG_A, userId: ACTOR }
      );
      const version = await KnowledgeSourceVersion.createVersion(source.id,
        { versionDesignation: '1.0', title: 'M6.4 synthetic shared-scope version' },
        { organizationId: ORG_A, userId: ACTOR });

      await assert.rejects(
        () => KnowledgeTemplateEvidence.attachEvidence(
          { taskTemplateId: shared.id },
          { knowledgeSourceVersionId: version.id, sectionOrClause: 'Synthetic clause',
            confidenceLevel: 'provisional', supportingRole: 'primary' },
          { organizationId: ORG_A, userId: ACTOR }
        ),
        (error) => error.code === 'EVIDENCE_SUBJECT_NOT_TENANT_SCOPED',
        'working evidence cannot attach to a shared global definition'
      );
    });
  });

  // ==========================================================================
  // Transaction / rollback
  // ==========================================================================
  describe('transaction behaviour', () => {
    it('rolls back the entire creation when a late write fails', async () => {
      // The definition row is inserted first, then its steps. A measurement limit
      // beyond NUMERIC(12,4) passes authoring validation but is rejected by the
      // database, so the failure happens AFTER the definition insert. Nothing may
      // survive.
      const code = uniq('M64ROLLBACK');
      await assert.rejects(
        () => authoring.createAuthoredDefinition(governedInput({
          templateCode: code,
          steps: [{
            step_type: 'instruction',
            instruction: 'overflowing limit',
            data_type: 'measurement',
            unit: 'mm',
            min_value: 999999999999
          }]
        }), { actorUserId: ACTOR }),
        () => true,
        'the overflowing limit must be refused'
      );

      assert.strictEqual(await countAuthoredTemplates(code), 0,
        'no partial authored definition may remain after a failed creation');
    });

    it('cannot author across a concurrent draft -> under_review transition', async () => {
      // Deterministic serialization proof, not a sequential call pair.
      //
      // A concurrent governed-lifecycle transaction takes the definition row lock
      // first and then commits `under_review` while an authoring mutation is in
      // flight. The authoring mutation must not land on the now-non-draft
      // definition: it either waits for the lock and then observes `under_review`,
      // or it fails closed. What it must never do is act on the stale `draft` it
      // would otherwise have read.
      const created = await authoring.createAuthoredDefinition(governedInput({
        knowledgeScope: 'customer', organizationId: ORG_A
      }), { actorUserId: ACTOR });

      const lifecycleConn = await getConnection();
      try {
        await query(lifecycleConn,
          `SELECT id FROM task_templates WHERE id = $1 FOR UPDATE`, [created.id]);

        const pending = authoring.updateGovernedDraft(created.id,
          { maintenanceStrategy: 'predictive' },
          { actorUserId: ACTOR, organizationId: ORG_A })
          .then(() => ({ ok: true }))
          .catch((error) => ({ ok: false, code: error.code }));

        // Give the authoring operation time to reach its own row acquisition.
        await new Promise((resolve) => { setTimeout(resolve, 200); });

        // The lifecycle transition completes and commits while authoring is in flight.
        await query(lifecycleConn,
          `UPDATE task_templates
              SET review_state = 'under_review',
                  submitted_for_review_by_user_id = $2,
                  submitted_for_review_at = CURRENT_TIMESTAMP
            WHERE id = $1`, [created.id, REVIEWER]);
        await lifecycleConn.commit();

        const outcome = await pending;
        assert.strictEqual(outcome.ok, false,
          'authoring must not cross a concurrent draft -> under_review transition');
        assert.strictEqual(outcome.code, 'DRAFT_ONLY',
          'the serialized authoring attempt must see the committed lifecycle state');
      } finally {
        try { await lifecycleConn.rollback(); } catch { /* already committed */ }
        lifecycleConn.release();
      }

      const after = await authoring.loadAuthoredDefinition(created.id, { organizationId: ORG_A });
      assert.strictEqual(after.review_state, 'under_review');
      assert.strictEqual(after.maintenance_strategy, 'preventive',
        'the refused authoring attempt left no governed change behind');
    });

    it('leaves no orphan child rows attributed to the author when creation fails', async () => {
      // Applicability is the only authored child table that carries accountable
      // attribution, so it is the only one a per-fixture orphan assertion can be
      // SOUND about. `task_template_steps` and `task_template_safety_controls`
      // have neither an actor column nor a foreign key to task_templates, so other
      // suites' teardown legitimately leaves orphans in those tables and a global
      // orphan count is not an invariant. This asserts the precise thing that
      // matters: the failed creation left no partially-written child row
      // attributed to the accountable author.
      const code = uniq('M64ORPHAN');
      await assert.rejects(
        () => authoring.createAuthoredDefinition(governedInput({
          templateCode: code,
          steps: [{ step_type: 'instruction', instruction: 'x', data_type: 'measurement',
            unit: 'mm', max_value: 999999999999 }]
        }), { actorUserId: ACTOR }),
        () => true
      );

      assert.strictEqual(await countAuthoredTemplates(code), 0,
        'the failed definition must not exist');

      const orphans = await withConn((conn) => query(conn,
        `SELECT count(*)::int AS n
           FROM task_template_equipment_types a
          WHERE a.added_by_user_id = $1
            AND NOT EXISTS (SELECT 1 FROM task_templates t WHERE t.id = a.task_template_id)`,
        [ACTOR]));
      assert.strictEqual(orphans[0].n, 0,
        'a failed creation must leave no applicability row attributed to the author');
    });
  });

  // ==========================================================================
  // Schema and collateral proof
  // ==========================================================================
  describe('no schema change and no collateral effect', () => {
    it('adds no column, table or constraint to the governed schema', async () => {
      const columns = await withConn((conn) => query(conn,
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'task_templates'
            AND column_name IN ('knowledge_type_id','task_family_id','maintenance_strategy',
              'trigger_mechanism','trigger_condition_parameter','trigger_condition_operator',
              'trigger_condition_value','trigger_condition_unit','trigger_condition_context',
              'trigger_event_description','trigger_basis_source_version_id','knowledge_scope',
              'content_origin','legacy_clearance_by_user_id','legacy_clearance_at',
              'legacy_clearance_rationale')`));
      assert.strictEqual(columns.length, 16,
        'the governed column set is exactly the one migration 020 established');

      const authoringColumns = await withConn((conn) => query(conn,
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'task_templates'
            AND column_name LIKE '%authored%'`));
      assert.strictEqual(authoringColumns.length, 0,
        'the authoring primitive introduces no schema of its own');
    });

    it('does not modify any definition it was not asked to author', async () => {
      const before = await withConn((conn) => query(conn,
        `SELECT count(*)::int AS n FROM task_templates WHERE content_origin IS NULL`));

      await authoring.createAuthoredDefinition(governedInput(), { actorUserId: ACTOR });

      const after = await withConn((conn) => query(conn,
        `SELECT count(*)::int AS n FROM task_templates WHERE content_origin IS NULL`));
      assert.strictEqual(after[0].n, before[0].n,
        'authoring one definition must not touch any other definition');
    });
  });
});
