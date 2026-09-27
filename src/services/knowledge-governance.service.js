/**
 * Knowledge Governance Service
 *
 * ATM-001 M1 — governed knowledge publication admission.
 *
 * Two responsibilities:
 *
 *  1. The working-template governance lifecycle. Knowledge is not publishable
 *     merely because an authorised principal called an endpoint: a template must
 *     be submitted for review, explicitly reviewed and approved, and its safety
 *     implications explicitly reviewed. Approval is a recorded act by an
 *     accountable principal, not a consequence of holding a permission.
 *
 *  2. The publication admission validator. It runs BEFORE the first irreversible
 *     publication write and fails closed with structured, deterministic reasons.
 *
 * Governance principles preserved:
 *   Knowledge Before Transactions — the gate runs before any version row exists.
 *   Evidence Before Assumption   — published knowledge must cite immutable sources.
 *   AI Augments Human Judgment   — approval is a human act with attribution.
 *
 * This is intentionally not a workflow engine: four states, an explicit safety
 * review, and one approval transition.
 */

const crypto = require('crypto');

const REVIEW_STATES = Object.freeze(['draft', 'under_review', 'approved', 'rejected']);

const SAFETY_REVIEW_STATES = Object.freeze([
  'not_assessed',
  'reviewed_no_control_required',
  'reviewed_controls_defined'
]);

/**
 * Fields of a template that constitute its material knowledge content. Approval
 * is bound to exactly these, so editing any of them invalidates the approval.
 */
const MATERIAL_TEMPLATE_FIELDS = Object.freeze([
  'template_code', 'template_name', 'maintenance_type', 'task_kind', 'task_scope',
  'description', 'frequency_value', 'frequency_unit', 'estimated_duration_minutes',
  'required_skills', 'required_tools', 'priority', 'activity_code_id',
  'equipment_type_id', 'industry_id',
  // ---- ATM-001 M6.3 governed semantics -------------------------------------
  // Approval binds the governed state the approver actually endorsed, so every
  // ratified M6.3 semantic field is material: changing any of them changes what
  // would publish while a stale approval would otherwise still describe the old
  // claim. Excluded deliberately: legacy_clearance_by_user_id / _at / _rationale.
  // Those record an accountable provenance act over legacy material rather than
  // knowledge content, are write-once, and are enforced separately by publication
  // admission, so they are not part of what the approver endorses.
  'knowledge_type_id', 'task_family_id', 'maintenance_strategy',
  'trigger_mechanism', 'trigger_condition_parameter', 'trigger_condition_operator',
  'trigger_condition_value', 'trigger_condition_unit', 'trigger_condition_context',
  'trigger_event_description', 'trigger_basis_source_version_id',
  'knowledge_scope', 'content_origin', 'organization_id',
  // ---- ATM-001 M6.4 Step 3B-B: AI-assistance disclosure --------------------
  // The disclosure is governed semantic state, so approval binds it: changing it
  // after approval stales the approval exactly as any other governed field
  // does. NULL and FALSE are DISTINCT values here and hash differently, because
  // they mean different things — "never captured under this regime" versus "AI
  // assistance was explicitly disclosed as not materially used".
  'ai_assisted', 'ai_assistance_detail'
]);

/**
 * Canonical Equipment-Type applicability for fingerprinting.
 *
 * Applicability is a SET of Equipment Type identities, so it is sorted by
 * identity before hashing: reordering the same membership never registers as a
 * change, while adding, removing, or retargeting a member always does. An absent
 * set and an empty set fingerprint alike, because neither is declared
 * applicability. Ids normalise through Number so 1 and "1" fingerprint alike,
 * mirroring how step numbers are treated.
 */
function canonicalApplicability(applicability) {
  return [...(applicability || [])]
    .map((entry) => {
      const rawId = entry === null || entry === undefined ? null : entry.equipment_type_id;
      const numeric = Number(rawId);
      return {
        equipment_type_id: rawId !== null && Number.isFinite(numeric) ? numeric : rawId,
        is_primary: Boolean(entry && entry.is_primary)
      };
    })
    .sort((a, b) => {
      if (a.equipment_type_id === b.equipment_type_id) return 0;
      return a.equipment_type_id < b.equipment_type_id ? -1 : 1;
    });
}

const MATERIAL_STEP_FIELDS = Object.freeze([
  'step_no', 'step_type', 'instruction', 'data_type', 'expected_value',
  'min_value', 'max_value', 'unit', 'is_required', 'options', 'safety_note',
  'is_visual_only', 'requires_equipment_stopped', 'prohibit_if_running',
  'prohibit_opening_covers', 'activity_code_id'
]);

const SUPPORTED_STEP_DATA_TYPES = Object.freeze([
  'boolean', 'number', 'integer', 'text', 'select', 'date', 'measurement'
]);

/**
 * Deterministic fingerprint of the material knowledge content.
 *
 * Any change to a material template field, to the step set, to the ordering or
 * content of steps, or to the declared Equipment-Type applicability set changes
 * the fingerprint. It is captured at approval and recomputed at publication, so
 * an approval can never be applied to content the approver did not see.
 *
 * Applicability participates because it is a material governed claim — it states
 * which Equipment Types the procedure applies to — and it is represented
 * order-independently so reordering never fabricates a change.
 *
 * @param {Object} template - working template row
 * @param {Array<Object>} steps - working steps, ordered by step_no
 * @param {Array<Object>} [applicability] - declared Equipment Type applicability
 * @returns {string} sha256 hex digest
 */
function computeContentSha(template, steps, applicability) {
  const canonicalTemplate = {};
  for (const field of MATERIAL_TEMPLATE_FIELDS) {
    canonicalTemplate[field] = template[field] === undefined ? null : template[field];
  }

  const canonicalSteps = [...(steps || [])]
    .sort((a, b) => (a.step_no ?? 0) - (b.step_no ?? 0))
    .map((step) => {
      const canonicalStep = {};
      for (const field of MATERIAL_STEP_FIELDS) {
        let value = step[field] === undefined ? null : step[field];
        // Numbers normalise through Number so that 1 and "1" fingerprint alike.
        if (['min_value', 'max_value', 'step_no'].includes(field) && value !== null) {
          const numeric = Number(value);
          value = Number.isFinite(numeric) ? numeric : String(value);
        }
        canonicalStep[field] = value;
      }
      return canonicalStep;
    });

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      template: canonicalTemplate,
      steps: canonicalSteps,
      applicability: canonicalApplicability(applicability)
    }))
    .digest('hex');
}

/** Structured admission failure, carrying every reason rather than the first. */
class AdmissionError extends Error {
  constructor(failures) {
    const summary = failures.map((f) => f.rule).join(', ');
    super(`Publication admission failed: ${summary}`);
    this.name = 'AdmissionError';
    this.statusCode = 409;
    this.code = 'PUBLICATION_ADMISSION_FAILED';
    this.failures = failures;
  }
}

const failure = (rule, message, detail) => ({
  rule,
  message,
  ...(detail === undefined ? {} : { detail })
});

/**
 * Validate a candidate for publication. Pure function: it reads only the
 * snapshot it is given, performs no writes, and returns every failure.
 *
 * @param {Object} input
 * @param {Object} input.template
 * @param {Array<Object>} input.steps
 * @param {Array<Object>} input.safetyControls
 * @param {Array<Object>} input.evidence - working knowledge_template_evidence rows
 * @param {number|null} input.publisherUserId
 * @param {Set<number>} [input.validActivityCodeIds]
 * @param {Set<number>} [input.validSourceVersionIds] - source versions in template scope
 * @returns {Array<Object>} failures (empty when admissible)
 */
function validatePublicationAdmission(input) {
  const {
    template,
    steps = [],
    safetyControls = [],
    evidence = [],
    applicability = [],
    publisherUserId = null,
    validActivityCodeIds = null,
    validSourceVersionIds = null
  } = input;

  const failures = [];

  // ---- A. Structural integrity -------------------------------------------
  if (!template) {
    failures.push(failure('TEMPLATE_NOT_FOUND', 'Task template does not exist'));
    return failures;
  }
  if (!template.is_editable) {
    failures.push(failure('TEMPLATE_NOT_PUBLISHABLE', 'Template is not editable/publishable'));
  }
  if (steps.length === 0) {
    failures.push(failure('NO_STEPS', 'Cannot publish a template with no steps'));
  }

  // ---- A2. Governed knowledge (ATM-001 M6.3) ------------------------------
  // Publication SNAPSHOTS an already-governed working definition. The runtime
  // carries ratified values and never invents them: no knowledge type is inferred
  // from task_kind, no task family from legacy fields, no scope from the presence
  // or absence of an organization, no origin from a caller omission, no strategy
  // from unrelated legacy semantics, and no trigger mechanism from frequency_value.
  // Absent governed data fails publication rather than fabricating meaning.
  if (!template.knowledge_type_id) {
    failures.push(failure('KNOWLEDGE_TYPE_MISSING',
      'The working definition has no explicit knowledge type'));
  }
  if (!template.task_family_id) {
    failures.push(failure('TASK_FAMILY_MISSING',
      'The working definition has no explicit task family'));
  }
  if (!template.maintenance_strategy) {
    failures.push(failure('MAINTENANCE_STRATEGY_MISSING',
      'The working definition has no ratified maintenance strategy'));
  }
  if (!template.trigger_mechanism) {
    failures.push(failure('TRIGGER_MISSING',
      'The working definition has no recommended maintenance trigger'));
  }
  if (template.trigger_mechanism
      && template.trigger_mechanism !== 'no_fixed_interval'
      && !template.trigger_basis_source_version_id) {
    failures.push(failure('TRIGGER_BASIS_MISSING',
      'An asserted trigger recommendation must cite its basis'));
  }
  if (!template.knowledge_scope) {
    failures.push(failure('KNOWLEDGE_SCOPE_MISSING',
      'The working definition has no explicit knowledge scope'));
  }
  if (template.knowledge_scope === 'customer' && !template.organization_id) {
    failures.push(failure('SCOPE_ORGANIZATION_MISSING',
      'Customer-scoped knowledge requires its organization binding'));
  }
  if (!template.content_origin) {
    failures.push(failure('CONTENT_ORIGIN_MISSING',
      'The working definition has no established content origin'));
  }
  if (applicability.length === 0) {
    failures.push(failure('APPLICABILITY_MISSING',
      'Publication requires at least one explicit Equipment Type applicability'));
  }

  // ---- A3. AI-assistance disclosure (ATM-001 M6.4 Step 3B-B) --------------
  // Authored knowledge must declare whether AI materially assisted its production.
  // The published version freezes that claim, so a human approver must have been
  // able to see it before approving; an undeclared disclosure would let an
  // immutable record assert an attribution nobody reviewed.
  //
  // Legacy-generated knowledge is deliberately EXEMPT. The disclosure regime
  // postdates it, so its NULL means "never captured under this regime" — not
  // "no AI was used". Requiring a declaration, or rewriting the value to FALSE,
  // would fabricate historical truth that no controlled artifact establishes.
  //
  // This is a single rule raising a single failure for a single condition.
  if (template.content_origin === 'authored'
      && (template.ai_assisted === null || template.ai_assisted === undefined)) {
    failures.push(failure('AI_DISCLOSURE_MISSING',
      'Authored knowledge must declare whether AI materially assisted its production'));
  }

  const stepNos = new Set();
  for (const step of steps) {
    if (!step.instruction || !String(step.instruction).trim()) {
      failures.push(failure(
        'STEP_INSTRUCTION_MISSING',
        'Every step must have a non-empty instruction',
        { step_no: step.step_no }
      ));
    }
    if (step.step_no === null || step.step_no === undefined || Number.isNaN(Number(step.step_no))) {
      failures.push(failure('STEP_ORDER_INVALID', 'Step ordering value is invalid', { step_no: step.step_no }));
    } else if (stepNos.has(Number(step.step_no))) {
      failures.push(failure('STEP_ORDER_DUPLICATE', 'Duplicate step_no within the template', { step_no: step.step_no }));
    } else {
      stepNos.add(Number(step.step_no));
    }
  }

  // ---- D. Step / rule conformance ----------------------------------------
  for (const step of steps) {
    const where = { step_no: step.step_no };

    if (!step.step_type || !String(step.step_type).trim()) {
      failures.push(failure('STEP_TYPE_MISSING', 'Step type is required', where));
    }

    const dataType = step.data_type === null || step.data_type === undefined
      ? null
      : String(step.data_type).trim();
    if (dataType && !SUPPORTED_STEP_DATA_TYPES.includes(dataType)) {
      failures.push(failure('STEP_DATA_TYPE_UNSUPPORTED', `Unsupported step data type: ${dataType}`, where));
    }

    const min = step.min_value === null || step.min_value === undefined ? null : Number(step.min_value);
    const max = step.max_value === null || step.max_value === undefined ? null : Number(step.max_value);
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
      failures.push(failure('STEP_LIMIT_NOT_NUMERIC', 'Measurement limits must be numeric', where));
    }
    if (min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min > max) {
      failures.push(failure('STEP_LIMITS_INCOHERENT', 'min_value must not exceed max_value', where));
    }
    // A unit is meaningless without a numeric bound, and a numeric bound without
    // a unit is not verifiable. Instructional steps carry neither and are exempt:
    // measurement semantics are only required when measurement is expressed.
    const isMeasurement = dataType === 'measurement'
      || (min !== null && Number.isFinite(min))
      || (max !== null && Number.isFinite(max));
    if (isMeasurement && !(step.unit && String(step.unit).trim())) {
      failures.push(failure('STEP_MEASUREMENT_UNIT_MISSING', 'A measurement step must declare a unit', where));
    }

    if (step.activity_code_id !== null && step.activity_code_id !== undefined && validActivityCodeIds) {
      if (!validActivityCodeIds.has(Number(step.activity_code_id))) {
        failures.push(failure(
          'STEP_ACTIVITY_CODE_INVALID',
          'Step references an unknown activity code',
          { ...where, activity_code_id: step.activity_code_id }
        ));
      }
    }
  }

  // ---- A. Parent-template cycle ------------------------------------------
  if (template.parent_template_id !== null && template.parent_template_id !== undefined) {
    if (Number(template.parent_template_id) === Number(template.id)) {
      failures.push(failure('PARENT_CYCLE', 'Template cannot be its own parent'));
    }
  }

  // ---- E. Governance: approval must exist and be attributable -------------
  if (template.review_state !== 'approved') {
    failures.push(failure(
      'NOT_APPROVED',
      `Template review state is '${template.review_state}'; publication requires 'approved'`,
      { review_state: template.review_state }
    ));
  } else {
    if (!template.reviewer_user_id || !template.reviewed_at) {
      failures.push(failure('REVIEW_ATTRIBUTION_MISSING', 'Approved knowledge must record its reviewer and review time'));
    }
    if (!template.approver_user_id || !template.approved_at) {
      failures.push(failure('APPROVAL_ATTRIBUTION_MISSING', 'Approved knowledge must record its approver and approval time'));
    }
  }

  if (!publisherUserId) {
    failures.push(failure('PUBLISHER_UNKNOWN', 'Publication requires an authenticated principal'));
  } else if (template.approver_user_id && Number(template.approver_user_id) === Number(publisherUserId)) {
    // ATM-001 M1: segregation of duties — the approver must not be the publisher.
    failures.push(failure(
      'SEGREGATION_OF_DUTIES',
      'The approver must not be the publisher of the same knowledge'
    ));
  }

  // Approval applies to the content the approver saw. If the material content
  // changed after approval, the approval no longer describes what would publish.
  if (template.review_state === 'approved') {
    const currentSha = computeContentSha(template, steps, applicability);
    if (!template.approved_content_sha) {
      failures.push(failure('APPROVED_CONTENT_UNBOUND', 'Approval is not bound to content; re-approval required'));
    } else if (template.approved_content_sha !== currentSha) {
      failures.push(failure(
        'APPROVAL_STALE',
        'Material knowledge changed after approval; re-approval is required before publication'
      ));
    }
  }

  // ---- C. Safety review ---------------------------------------------------
  const safetyState = template.safety_review_state;
  if (!safetyState || safetyState === 'not_assessed') {
    failures.push(failure(
      'SAFETY_NOT_ASSESSED',
      'Safety must be explicitly reviewed before publication'
    ));
  } else if (!SAFETY_REVIEW_STATES.includes(safetyState)) {
    failures.push(failure('SAFETY_STATE_INVALID', `Unknown safety review state: ${safetyState}`));
  } else {
    if (!template.safety_reviewed_by_user_id || !template.safety_reviewed_at) {
      failures.push(failure(
        'SAFETY_REVIEW_ATTRIBUTION_MISSING',
        'A completed safety review must record who performed it and when'
      ));
    }
    // Cross-table invariant, enforced here rather than by a CHECK constraint.
    if (safetyState === 'reviewed_controls_defined' && safetyControls.length === 0) {
      failures.push(failure(
        'SAFETY_CONTROLS_MISSING',
        "Safety review declares controls defined, but no safety control rows exist"
      ));
    }
  }

  // ---- B. Evidence / provenance ------------------------------------------
  if (evidence.length === 0) {
    failures.push(failure(
      'EVIDENCE_MISSING',
      'Published knowledge must cite at least one attributable evidence record'
    ));
  } else {
    for (const row of evidence) {
      if (!row.knowledge_source_version_id) {
        failures.push(failure(
          'EVIDENCE_SOURCE_VERSION_MISSING',
          'Evidence must reference an immutable knowledge source version',
          { evidence_id: row.id }
        ));
        continue;
      }
      if (validSourceVersionIds && !validSourceVersionIds.has(Number(row.knowledge_source_version_id))) {
        failures.push(failure(
          'EVIDENCE_SOURCE_OUT_OF_SCOPE',
          'Evidence references a source version outside the template tenant scope',
          { evidence_id: row.id, knowledge_source_version_id: row.knowledge_source_version_id }
        ));
      }
      if (!row.derivation_notes && !row.section_or_clause && !row.page_or_paragraph) {
        failures.push(failure(
          'EVIDENCE_ATTRIBUTION_INCOMPLETE',
          'Evidence must state where in the source it is derived from',
          { evidence_id: row.id }
        ));
      }
    }
  }

  return failures;
}

module.exports = {
  REVIEW_STATES,
  SAFETY_REVIEW_STATES,
  SUPPORTED_STEP_DATA_TYPES,
  MATERIAL_TEMPLATE_FIELDS,
  MATERIAL_STEP_FIELDS,
  computeContentSha,
  validatePublicationAdmission,
  AdmissionError,
  failure
};
