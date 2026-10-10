/**
 * Published Knowledge Resolution — read-only model (ATM-001-KF-04A)
 *
 * Serves IMMUTABLE PUBLISHED task-template versions to operational consumers.
 *
 * Why this exists (ATM-001 Knowledge Foundation §8.2, ATM-002-R6 §6):
 *   - "Operational references point to a specific published version."
 *   - An operational consumer must never be served the mutable working
 *     definition, a draft, or an unsealed row.
 *
 * Boundary (deliberate):
 *   - READ ONLY. This model issues no INSERT, UPDATE or DELETE. It cannot
 *     change publication semantics, immutability, or any business rule.
 *   - The generic BaseModel update()/delete() helpers are REFUSED outright
 *     (PUBLISHED_KNOWLEDGE_IMMUTABLE) instead of being inherited. Migration 009's
 *     immutability triggers remain the real enforcement; the refusal keeps the
 *     model honest about a mutation surface it must not advertise.
 *   - It does not choose a version. There is no implicit "latest"/"active
 *     default" resolution: ATM-001 §8.3 reserves `effective_from`/`effective_to`
 *     for an active default that is NOT implemented, so selecting one here
 *     would invent an unapproved business rule. Callers resolve explicitly.
 *   - Tenant scope is enforced on the FROZEN version row
 *     (`task_template_versions.organization_id`), not on the mutable working
 *     template, so a later change to the working definition cannot widen or
 *     narrow what a tenant may read.
 *
 * Scope rule (mirrors the provenance read predicate): a row is readable when
 * `organization_id IS NULL` (global / shared reference knowledge) or
 * `organization_id = <caller tenant>`. A NULL caller tenant therefore sees only
 * global knowledge — fail closed, never open.
 */

const BaseModel = require('./base.model');

/** The only lifecycle state an operational consumer may be served. */
const PUBLISHED_LIFECYCLE_STATE = 'published';

/**
 * Stable refusal code for every generic mutation this read model does not expose.
 * Callers and tests assert on this code, never on the message text.
 */
const PUBLISHED_KNOWLEDGE_IMMUTABLE = 'PUBLISHED_KNOWLEDGE_IMMUTABLE';

/**
 * Thrown when a generic mutation is attempted against the published-version read
 * model. Published knowledge is immutable, so no such operation can be servable.
 */
class PublishedKnowledgeImmutableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PublishedKnowledgeImmutableError';
    this.statusCode = 409;
    this.code = PUBLISHED_KNOWLEDGE_IMMUTABLE;
  }
}

/**
 * Refuse an operation this capability deliberately does not expose.
 *
 * BaseModel provides generic update()/delete() helpers. Inheriting them would
 * advertise a mutation surface this read model must not have, so both are
 * overridden explicitly (mirroring the established refusal pattern in
 * knowledge-provenance.model.js). Migration 009's immutability triggers remain
 * the real enforcement; these make the model honest about its boundary rather
 * than relying on a trigger to say no.
 */
function refuseMutation(operation, guidance) {
  return () => {
    throw new PublishedKnowledgeImmutableError(
      `${operation} is not available through published knowledge resolution. ${guidance}`
    );
  };
}

class PublishedKnowledgeModel extends BaseModel {
  constructor() {
    super('task_template_versions');
  }

  /**
   * Not exposed. Published versions are immutable: migration 009's
   * immutable_version_update_check trigger refuses every content change, and a
   * correction is a NEW published version — never an edit of a frozen one.
   */
  update = refuseMutation(
    'Updating a published knowledge version',
    'Published versions are immutable; publish a new version instead.'
  );

  /** Not exposed. Deleting a frozen version would destroy published provenance. */
  delete = refuseMutation(
    'Deleting a published knowledge version',
    'Published versions are immutable; a frozen version cannot be deleted.'
  );

  /**
   * Read one frozen version header by id, unrestricted by tenant.
   * Tenant scoping is applied by the service, which can then return a
   * non-disclosing not-found instead of a distinguishable forbidden.
   */
  async findVersionHeader(versionId) {
    const rows = await this.query(
      `SELECT
         v.id,
         v.task_template_id,
         v.version_number,
         v.equipment_type_id,
         v.template_code,
         v.template_name,
         v.maintenance_type,
         v.task_scope,
         v.description,
         v.frequency_value,
         v.frequency_unit,
         v.estimated_duration_minutes,
         v.required_skills,
         v.required_tools,
         v.priority,
         v.task_kind,
         v.lifecycle_state_at_publish,
         v.is_step_set_sealed,
         v.published_at,
         v.superseded_by_version_id,
         v.change_rationale,
         v.ai_assisted,
         v.ai_assistance_detail,
         v.reviewer_user_id,
         v.reviewed_at,
         v.approver_user_id,
         v.approved_at,
         v.safety_reviewed_by_user_id,
         v.safety_reviewed_at,
         v.safety_review_state,
         v.knowledge_type_id,
         v.task_family_id,
         v.maintenance_strategy,
         v.trigger_mechanism,
         v.trigger_condition_parameter,
         v.trigger_condition_operator,
         v.trigger_condition_value,
         v.trigger_condition_unit,
         v.trigger_condition_context,
         v.trigger_event_description,
         v.trigger_basis_source_version_id,
         v.knowledge_scope,
         v.organization_id
       FROM task_template_versions v
       WHERE v.id = ?`,
      [versionId]
    );
    return rows[0] || null;
  }

  /** Frozen step set, in execution order. */
  async listVersionSteps(versionId) {
    return this.query(
      `SELECT
         s.id, s.step_no, s.task_template_step_id, s.step_type, s.activity_code_id,
         s.instruction, s.data_type, s.expected_value, s.min_value, s.max_value,
         s.unit, s.is_required, s.options, s.safety_note, s.is_visual_only,
         s.requires_equipment_stopped, s.prohibit_if_running, s.prohibit_opening_covers,
         s.ai_assisted, s.ai_assistance_detail
       FROM task_template_step_versions s
       WHERE s.task_template_version_id = ?
       ORDER BY s.step_no`,
      [versionId]
    );
  }

  /** Frozen safety controls attested at publication. */
  async listVersionSafetyControls(versionId) {
    return this.query(
      `SELECT c.id, c.task_template_safety_control_id, c.safety_type, c.description, c.is_mandatory
       FROM task_template_safety_control_versions c
       WHERE c.task_template_version_id = ?
       ORDER BY c.id`,
      [versionId]
    );
  }

  /** Frozen Equipment-Type applicability, with the resolved taxonomy identity. */
  async listVersionApplicability(versionId) {
    return this.query(
      `SELECT a.equipment_type_id, a.is_primary,
              t.type_code, t.type_name
       FROM task_template_version_equipment_types a
       LEFT JOIN equipment_types t ON t.id = a.equipment_type_id
       WHERE a.task_template_version_id = ?
       ORDER BY a.is_primary DESC, a.equipment_type_id`,
      [versionId]
    );
  }

  /**
   * ALL frozen provenance evidence of a published version, with the immutable
   * source-edition identity it cites.
   *
   * A frozen evidence row is attached to EITHER the version as a whole OR one of
   * its step versions, never both (migration 011
   * `chk_knowledge_template_version_evidence_exactly_one_subject`). The step-level
   * rows carry `task_template_version_id = NULL` and are reachable only through
   * `task_template_step_version_id`, so a version-only predicate would silently
   * drop them — the publication admission trigger explicitly accepts a version
   * whose only provenance is step-level (migration 020). Both shapes are returned
   * here, and the exactly-one-subject check means no row can match twice.
   *
   * Evidence sources are scoped to the caller: a global (`organization_id IS
   * NULL`) source, or one owned by the caller's tenant. Migration 011's scope
   * trigger anchors on the MUTABLE working template's organization, not on the
   * frozen version's, so a globally readable version can legally cite a
   * tenant-private source; without this predicate the resolver would disclose
   * that tenant's source identity to every other tenant.
   */
  async listVersionEvidence(versionId, organizationId = null) {
    return this.query(
      `SELECT
         e.id,
         e.task_template_version_id,
         e.task_template_step_version_id,
         e.knowledge_source_version_id,
         e.section_or_clause,
         e.page_or_paragraph,
         e.derivation_notes,
         e.confidence_level,
         e.supporting_role,
         sv.version_designation,
         sv.title AS source_version_title,
         sv.reference_number AS source_version_reference,
         s.source_code,
         s.source_category,
         s.default_title AS source_title,
         s.issuing_organization
       FROM knowledge_template_version_evidence e
       JOIN knowledge_source_versions sv ON sv.id = e.knowledge_source_version_id
       JOIN knowledge_sources s ON s.id = sv.knowledge_source_id
       WHERE (e.task_template_version_id = ?
              OR e.task_template_step_version_id IN (
                   SELECT stv.id FROM task_template_step_versions stv
                    WHERE stv.task_template_version_id = ?))
         AND (s.organization_id IS NULL OR s.organization_id = ?)
       ORDER BY e.id`,
      [versionId, versionId, organizationId]
    );
  }

  /** Step-version -> version-step index, so evidence can be routed to its step. */
  async listStepVersionIndex(versionId) {
    return this.query(
      `SELECT id, step_no FROM task_template_step_versions WHERE task_template_version_id = ? ORDER BY step_no`,
      [versionId]
    );
  }

  /**
   * Published, sealed versions of one working definition, in scope, for
   * EXPLICIT selection. No ordering is offered as a "current" recommendation;
   * the caller decides. Empty is a valid, non-disclosing answer.
   */
  async listPublishedVersionsForTemplate(templateId, organizationId) {
    return this.query(
      `SELECT v.id, v.task_template_id, v.version_number, v.template_code, v.template_name,
              v.equipment_type_id, v.lifecycle_state_at_publish, v.is_step_set_sealed,
              v.published_at, v.superseded_by_version_id, v.knowledge_scope, v.organization_id
       FROM task_template_versions v
       WHERE v.task_template_id = ?
         AND v.lifecycle_state_at_publish = ?
         AND v.is_step_set_sealed = TRUE
         AND (v.organization_id IS NULL OR v.organization_id = ?)
       ORDER BY v.version_number DESC`,
      [templateId, PUBLISHED_LIFECYCLE_STATE, organizationId]
    );
  }

  /**
   * Published, sealed versions whose FROZEN applicability covers an Equipment
   * Type, in scope. This is discovery only: it never substitutes the working
   * definition and never asserts that one of the results "applies" — the frozen
   * applicability set is returned to the caller verbatim.
   */
  async listPublishedVersionsForEquipmentType(equipmentTypeId, organizationId) {
    return this.query(
      `SELECT v.id, v.task_template_id, v.version_number, v.template_code, v.template_name,
              v.equipment_type_id, v.lifecycle_state_at_publish, v.is_step_set_sealed,
              v.published_at, v.superseded_by_version_id, v.knowledge_scope, v.organization_id,
              a.is_primary
       FROM task_template_versions v
       JOIN task_template_version_equipment_types a
         ON a.task_template_version_id = v.id
       WHERE a.equipment_type_id = ?
         AND v.lifecycle_state_at_publish = ?
         AND v.is_step_set_sealed = TRUE
         AND (v.organization_id IS NULL OR v.organization_id = ?)
       ORDER BY v.version_number DESC, v.id`,
      [equipmentTypeId, PUBLISHED_LIFECYCLE_STATE, organizationId]
    );
  }
}

const PublishedKnowledge = new PublishedKnowledgeModel();

module.exports = {
  PublishedKnowledge,
  PublishedKnowledgeModel,
  PublishedKnowledgeImmutableError,
  PUBLISHED_LIFECYCLE_STATE,
  PUBLISHED_KNOWLEDGE_IMMUTABLE
};
