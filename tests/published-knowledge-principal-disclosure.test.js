/**
 * Published Knowledge Principal Disclosure — ATM-001-KF-05-R2
 *
 * The KF-05 independent review observed (finding R-2, probe P6b) that a
 * GLOBALLY scoped published version — readable by every tenant — disclosed the
 * accountable principals' identifiers (`governance.reviewerUserId`,
 * `governance.approverUserId`, `safetyReview.reviewedByUserId`) to *every*
 * tenant. Those columns name USERS of the publishing tenant, so a global version
 * leaked one tenant's user identity to all other tenants, and no operational
 * consumer needs the raw principal id to execute published knowledge.
 *
 * The remediation is a projection change only: internal publication and audit
 * evidence is untouched (same columns, same admission constraints, no schema or
 * migration change), while the operational DTO withholds principal identity
 * unless the FROZEN version scope is an explicit, well-formed tenant id.
 *
 * These are FOCUSED, non-database tests. They prove:
 *   - a global version projects NO principal user id to any caller;
 *   - the withholding is explicit (`principalIdentifiersWithheld`), never an
 *     ambiguous null that a consumer could misread as absent attribution;
 *   - attribution timestamps and the review state ARE preserved;
 *   - the owning tenant still receives its own principals on a tenant version;
 *   - the withholding predicate fails CLOSED on a missing/malformed scope;
 *   - the model still READS the principal columns, so internal publication and
 *     audit evidence is preserved;
 *   - the list projections never carried principal identity at all.
 *
 * Nothing here touches a database, so this suite needs no integration gate.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../src/services/published-knowledge.service');
const { PublishedKnowledge } = require('../src/models/published-knowledge.model');

const { resolvePublishedVersion, listPublishedVersionsForTemplate, withholdsPrincipalIdentity } = service;

const GLOBAL = null;      // explicit database NULL = shared / global reference knowledge
const TENANT_A = 5;       // the publishing tenant
const TENANT_B = 7;       // an unrelated tenant

// Distinct, implausible-as-anything-else principal ids, so a withheld id cannot
// be confused with an unrelated numeric field that happens to share the value.
const REVIEWER_A = 5050501;
const APPROVER_A = 5050502;
const SAFETY_REVIEWER_A = 5050503;

const REVIEWED_AT = '2026-01-02T03:04:05.000Z';
const APPROVED_AT = '2026-01-02T04:05:06.000Z';
const SAFETY_REVIEWED_AT = '2026-01-02T02:03:04.000Z';

/** A frozen version header shaped exactly as findVersionHeader returns it. */
const header = (organizationId) => ({
  id: 1,
  task_template_id: 11,
  version_number: 2,
  equipment_type_id: 21,
  template_code: 'KF04A-TPL',
  template_name: 'KF04A Template',
  maintenance_type: 'preventive',
  task_scope: 'component',
  description: 'frozen description',
  frequency_value: 3,
  frequency_unit: 'month',
  estimated_duration_minutes: 45,
  required_skills: ['mechanical'],
  required_tools: ['torque wrench'],
  priority: 'medium',
  task_kind: 'inspection',
  lifecycle_state_at_publish: 'published',
  is_step_set_sealed: true,
  published_at: '2026-01-02T05:06:07.000Z',
  superseded_by_version_id: null,
  change_rationale: 'initial publication',
  ai_assisted: null,
  ai_assistance_detail: null,
  reviewer_user_id: REVIEWER_A,
  reviewed_at: REVIEWED_AT,
  approver_user_id: APPROVER_A,
  approved_at: APPROVED_AT,
  safety_reviewed_by_user_id: SAFETY_REVIEWER_A,
  safety_reviewed_at: SAFETY_REVIEWED_AT,
  safety_review_state: 'reviewed_controls_defined',
  knowledge_type_id: 31,
  task_family_id: 41,
  maintenance_strategy: 'preventive',
  trigger_mechanism: 'no_fixed_interval',
  trigger_condition_parameter: null,
  trigger_condition_operator: null,
  trigger_condition_value: null,
  trigger_condition_unit: null,
  trigger_condition_context: null,
  trigger_event_description: null,
  trigger_basis_source_version_id: null,
  knowledge_scope: organizationId === null ? 'shared' : 'customer',
  organization_id: organizationId
});

const STEP = {
  id: 51,
  step_no: 1,
  task_template_step_id: 61,
  step_type: 'check',
  activity_code_id: null,
  instruction: 'frozen instruction',
  data_type: 'text',
  expected_value: null,
  min_value: null,
  max_value: null,
  unit: null,
  is_required: true,
  options: null,
  safety_note: null,
  is_visual_only: false,
  requires_equipment_stopped: false,
  prohibit_if_running: false,
  prohibit_opening_covers: false,
  ai_assisted: null,
  ai_assistance_detail: null
};

/**
 * Recursively collect every key that names an identity, with its path and value.
 *
 * Matches on `user` rather than a `*UserId` suffix so that a reintroduction is
 * caught in ANY shape — `reviewer_user_id`, `reviewerId`, `reviewedByUserId`,
 * `publishedBy`, `createdBy` — and at any depth, including inside the steps,
 * safety-control, applicability and evidence collections. No legitimate
 * published-knowledge field contains "user", so this cannot false-positive.
 */
const collectIdentityFields = (value, prefix = '') => {
  const found = [];
  if (value === null || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    const here = prefix ? `${prefix}.${key}` : key;
    if (/user/i.test(key)) found.push([here, child]);
    else found.push(...collectIdentityFields(child, here));
  }
  return found;
};

describe('Published knowledge withholds principal identity on a GLOBAL version (ATM-001-KF-05-R2)', () => {
  // ------------------------------------------------------------- the predicate
  it('withholds unless the frozen scope is an explicit, well-formed tenant id', () => {
    assert.strictEqual(withholdsPrincipalIdentity({ organization_id: GLOBAL }), true,
      'a global (database NULL) version must withhold');
    assert.strictEqual(withholdsPrincipalIdentity({ organization_id: GLOBAL }), true);
    for (const malformed of [undefined, 'abc', '', 0, '0', NaN, true, false, -5, 5.5, {}, []]) {
      assert.strictEqual(
        withholdsPrincipalIdentity({ organization_id: malformed }),
        true,
        `scope ${JSON.stringify(malformed)} must fail closed and withhold`
      );
    }
    assert.strictEqual(withholdsPrincipalIdentity({ organization_id: TENANT_A }), false,
      'an explicit tenant scope may attribute its own principals');
    assert.strictEqual(withholdsPrincipalIdentity({ organization_id: String(TENANT_A) }), false,
      'a driver-returned string id is still an explicit tenant scope');
  });

  // ------------------------------------------------- service-level projection
  describe('resolvePublishedVersion', () => {
    const METHODS = [
      'findVersionHeader',
      'listVersionSteps',
      'listVersionSafetyControls',
      'listVersionApplicability',
      'listVersionEvidence'
    ];
    const originals = {};

    /** Serve one servable version whose header carries live principal ids. */
    const serve = async (organizationId, callerScope) => {
      for (const method of METHODS) originals[method] = PublishedKnowledge[method];
      PublishedKnowledge.findVersionHeader = async () => header(organizationId);
      PublishedKnowledge.listVersionSteps = async () => [STEP];
      PublishedKnowledge.listVersionSafetyControls = async () => [];
      PublishedKnowledge.listVersionApplicability = async () => [];
      PublishedKnowledge.listVersionEvidence = async () => [];
      return resolvePublishedVersion(1, { organizationId: callerScope });
    };

    const restore = () => {
      for (const method of METHODS) PublishedKnowledge[method] = originals[method];
    };

    after(restore);

    it('projects NO principal user id on a global version, to any caller', async () => {
      for (const caller of [TENANT_A, TENANT_B, null]) {
        const resolved = await serve(GLOBAL, caller);
        restore();
        const { version } = resolved;

        assert.strictEqual(version.principalIdentifiersWithheld, true, 'withholding must be explicit');
        assert.strictEqual(version.organizationScope, 'global');

        // Scan the WHOLE served payload, not just the version header: a leak in a
        // step, safety control, applicability row or evidence row must also fail.
        const idFields = collectIdentityFields(resolved);
        assert.ok(idFields.length >= 3, `expected the principal id fields to exist, saw ${idFields.length}`);
        for (const [field, value] of idFields) {
          assert.strictEqual(value, null, `${field} must be withheld from a global version (caller ${caller})`);
        }

        // The scan is not vacuous: the three governance fields really are present.
        const paths = idFields.map(([field]) => field);
        for (const expected of ['version.governance.reviewerUserId',
          'version.governance.approverUserId', 'version.safetyReview.reviewedByUserId']) {
          assert.ok(paths.includes(expected), `the scan must see ${expected}`);
        }
      }
    });

    it('never serialises a principal id into a global version payload', async () => {
      const resolved = await serve(GLOBAL, TENANT_B);
      restore();
      const serialised = JSON.stringify(resolved.version);
      for (const principalId of [REVIEWER_A, APPROVER_A, SAFETY_REVIEWER_A]) {
        assert.ok(
          !serialised.includes(String(principalId)),
          `principal id ${principalId} must not appear anywhere in a global version payload`
        );
      }
    });

    it('PRESERVES the attribution evidence: state and timestamps survive the withholding', async () => {
      const resolved = await serve(GLOBAL, TENANT_B);
      restore();
      const { version } = resolved;

      // Governance evidence the operational consumer actually acts on is kept.
      assert.strictEqual(version.governance.reviewedAt, REVIEWED_AT);
      assert.strictEqual(version.governance.approvedAt, APPROVED_AT);
      assert.strictEqual(version.safetyReview.state, 'reviewed_controls_defined');
      assert.strictEqual(version.safetyReview.reviewedAt, SAFETY_REVIEWED_AT);
    });

    it('NEGATIVE CONTROL: the raw header DOES carry the ids being withheld', async () => {
      // Without this control, the nulls above would also pass if the fixture were
      // simply missing its principal ids — the test must be able to fail.
      const raw = header(GLOBAL);
      assert.strictEqual(raw.reviewer_user_id, REVIEWER_A);
      assert.strictEqual(raw.approver_user_id, APPROVER_A);
      assert.strictEqual(raw.safety_reviewed_by_user_id, SAFETY_REVIEWER_A);
      assert.strictEqual(withholdsPrincipalIdentity(raw), true);
    });

    it('attributes a TENANT version to its own tenant, as numbers', async () => {
      const resolved = await serve(TENANT_A, TENANT_A);
      restore();
      const { version } = resolved;

      assert.strictEqual(version.principalIdentifiersWithheld, false);
      assert.strictEqual(version.organizationScope, 'tenant');
      assert.strictEqual(version.governance.reviewerUserId, REVIEWER_A);
      assert.strictEqual(version.governance.approverUserId, APPROVER_A);
      assert.strictEqual(version.safetyReview.reviewedByUserId, SAFETY_REVIEWER_A);
      const disclosed = collectIdentityFields(resolved);
      assert.ok(disclosed.length >= 3, 'the tenant version discloses its principals');
      for (const [, value] of disclosed) {
        assert.strictEqual(typeof value, 'number', 'a disclosed principal id is a number, never a driver string');
      }
    });

    it('does not disclose a tenant version to a foreign tenant at all', async () => {
      await assert.rejects(
        () => serve(TENANT_A, TENANT_B).finally(restore),
        (error) => {
          assert.strictEqual(error.code, 'PUBLISHED_VERSION_NOT_FOUND', 'non-disclosing 404');
          return true;
        }
      );
    });

    it('is not a DTO redesign: the version key set changes by exactly one additive key', async () => {
      const resolved = await serve(GLOBAL, TENANT_A);
      restore();
      const keys = Object.keys(resolved.version).sort();
      assert.deepStrictEqual(keys, [
        'aiAssistanceDetail',
        'aiAssisted',
        'changeRationale',
        'description',
        'equipmentTypeId',
        'estimatedDurationMinutes',
        'frequency',
        'governance',
        'governedClassification',
        'id',
        'isStepSetSealed',
        'knowledgeScope',
        'lifecycleState',
        'maintenanceType',
        'organizationScope',
        'principalIdentifiersWithheld',
        'priority',
        'publishedAt',
        'requiredSkills',
        'requiredTools',
        'safetyReview',
        'supersededByVersionId',
        'taskKind',
        'taskScope',
        'taskTemplateId',
        'templateCode',
        'templateName',
        'trigger',
        'versionNumber'
      ]);
    });
  });

  // --------------------------------------------------- list surface hygiene
  describe('list projections', () => {
    const originals = {};

    it('never carried principal identity, and still does not', async () => {
      originals.listPublishedVersionsForTemplate = PublishedKnowledge.listPublishedVersionsForTemplate;
      PublishedKnowledge.listPublishedVersionsForTemplate = async () => [
        {
          id: 1,
          task_template_id: 11,
          version_number: 2,
          template_code: 'KF04A-TPL',
          template_name: 'KF04A Template',
          equipment_type_id: 21,
          lifecycle_state_at_publish: 'published',
          is_step_set_sealed: true,
          published_at: '2026-01-02T05:06:07.000Z',
          superseded_by_version_id: null,
          knowledge_scope: 'shared',
          organization_id: GLOBAL,
          // Even if a future projection widened the SELECT, the summary must not
          // surface identity.
          reviewer_user_id: REVIEWER_A,
          approver_user_id: APPROVER_A
        }
      ];
      try {
        const [summary] = await listPublishedVersionsForTemplate(11, { organizationId: TENANT_B });
        assert.deepStrictEqual(collectIdentityFields(summary), [], 'the list summary exposes no user id');
        assert.ok(!JSON.stringify(summary).includes(String(REVIEWER_A)));
      } finally {
        PublishedKnowledge.listPublishedVersionsForTemplate = originals.listPublishedVersionsForTemplate;
      }
    });
  });

  // ------------------------------------------- internal evidence preservation
  describe('internal publication and audit evidence', () => {
    const modelSource = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'models', 'published-knowledge.model.js'), 'utf8');

    it('the model still READS every principal column (projection change, not a query change)', () => {
      for (const column of ['v.reviewer_user_id', 'v.approver_user_id', 'v.safety_reviewed_by_user_id']) {
        assert.ok(
          modelSource.includes(column),
          `${column} must still be selected: the withholding is a projection rule, and the owning `
            + 'tenant and the governed authoring surfaces still need this audit evidence'
        );
      }
    });

    it('withholds by PROJECTION, not by mutating the frozen row', async () => {
      const raw = header(GLOBAL);
      const METHODS = [
        'findVersionHeader',
        'listVersionSteps',
        'listVersionSafetyControls',
        'listVersionApplicability',
        'listVersionEvidence'
      ];
      const originals = {};
      for (const method of METHODS) originals[method] = PublishedKnowledge[method];
      PublishedKnowledge.findVersionHeader = async () => raw;
      PublishedKnowledge.listVersionSteps = async () => [STEP];
      PublishedKnowledge.listVersionSafetyControls = async () => [];
      PublishedKnowledge.listVersionApplicability = async () => [];
      PublishedKnowledge.listVersionEvidence = async () => [];
      try {
        const resolved = await resolvePublishedVersion(1, { organizationId: TENANT_B });
        assert.strictEqual(resolved.version.governance.reviewerUserId, null, 'the projection withholds');
        // The row handed to the projection is untouched, so any internal consumer
        // of the SAME row still sees the full audit evidence.
        assert.strictEqual(raw.reviewer_user_id, REVIEWER_A, 'the frozen row is not mutated');
        assert.strictEqual(raw.approver_user_id, APPROVER_A, 'the frozen row is not mutated');
        assert.strictEqual(raw.safety_reviewed_by_user_id, SAFETY_REVIEWER_A, 'the frozen row is not mutated');
      } finally {
        for (const method of METHODS) PublishedKnowledge[method] = originals[method];
      }
    });
  });
});
