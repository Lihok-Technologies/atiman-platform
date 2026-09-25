/**
 * Knowledge Provenance Model
 *
 * ATM-001 M3 — database access for governed provenance authoring.
 *
 * This model writes ONLY to the working-provenance side of migration 011:
 *   knowledge_sources
 *   knowledge_source_versions
 *   knowledge_template_evidence
 *
 * It deliberately contains NO method that can read or write
 * knowledge_template_version_evidence. Frozen provenance is owned by the M1
 * publication path and is immutable by database trigger; M3 must not be able to
 * reach it at all.
 *
 * Immutability guarantees are enforced by migration 011's triggers, not by this
 * model. The model surfaces those refusals rather than working around them:
 * there is no updateSource or updateSourceVersion or updateEvidence method,
 * because updating a source version is forbidden and updating working evidence
 * is modelled as detach-then-attach.
 */

const BaseModel = require('./base.model');
const {
  validateSourceInput,
  validateSourceVersionInput,
  validateEvidenceInput,
  assertValid
} = require('../services/knowledge-provenance.service');

/** Thrown when a referenced row is absent, or outside the caller's tenant scope. */
class ProvenanceNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProvenanceNotFoundError';
    this.statusCode = 404;
  }
}

/** Thrown when an operation conflicts with existing state. */
class ProvenanceConflictError extends Error {
  constructor(message, code = 'PROVENANCE_CONFLICT') {
    super(message);
    this.name = 'ProvenanceConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

/**
 * Refuse an operation this capability deliberately does not expose.
 *
 * BaseModel provides generic update()/delete() helpers. Inheriting them would
 * advertise a mutation surface M3 must not have, so every model here overrides
 * them explicitly. The database guards remain the real enforcement; these make
 * the model honest about its boundary rather than relying on a trigger to say no.
 */
function refuseMutation(operation, guidance, code) {
  return () => {
    throw new ProvenanceConflictError(
      `${operation} is not available through provenance authoring. ${guidance}`,
      code
    );
  };
}

class KnowledgeSourceModel extends BaseModel {
  constructor() {
    super('knowledge_sources');
  }

  /**
   * Not exposed. A source identity locks (organization_id, source_code,
   * source_category) by trigger once versions exist, and M3 offers no source
   * edit surface.
   */
  update = refuseMutation(
    'Updating a knowledge source',
    'Source identity is locked once versions exist; create a new source if the identity is wrong.',
    'SOURCE_UPDATE_NOT_SUPPORTED'
  );

  /** Not exposed. Deleting a source would cascade to its versions and evidence. */
  delete = refuseMutation(
    'Deleting a knowledge source',
    'Source deletion is not part of provenance authoring; deactivate it instead.',
    'SOURCE_DELETE_NOT_SUPPORTED'
  );

  /**
   * Create a tenant-scoped source identity.
   *
   * organization_id is always the caller's organization: M3 never creates a
   * global (NULL-organization) source, because shared reference provenance is a
   * system/OWNER act, not a tenant act.
   */
  async createSource(input, { organizationId, userId }) {
    assertValid(validateSourceInput(input));

    if (!organizationId) {
      throw new ProvenanceConflictError(
        'Provenance sources are tenant-scoped: the authenticated principal must belong to an organization',
        'SOURCE_ORGANIZATION_REQUIRED'
      );
    }

    const rows = await this.query(
      `INSERT INTO knowledge_sources
         (source_code, source_category, default_title, issuing_organization, organization_id, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        input.sourceCode.trim(),
        input.sourceCategory,
        input.defaultTitle.trim(),
        input.issuingOrganization === undefined ? null : input.issuingOrganization,
        organizationId,
        userId || null
      ]
    );

    return this.findSourceById(rows.insertId, organizationId);
  }

  /** Tenant-scoped read: global sources plus the caller's organization. */
  async findSourceById(id, organizationId) {
    const rows = await this.query(
      `SELECT * FROM knowledge_sources
        WHERE id = ? AND (organization_id IS NULL OR organization_id = ?)`,
      [id, organizationId]
    );
    return rows[0] || null;
  }

  /** List sources visible to the caller's tenant scope. */
  async listSources(organizationId) {
    return this.query(
      `SELECT * FROM knowledge_sources
        WHERE organization_id IS NULL OR organization_id = ?
        ORDER BY source_code`,
      [organizationId]
    );
  }
}

class KnowledgeSourceVersionModel extends BaseModel {
  constructor() {
    super('knowledge_source_versions');
  }

  /**
   * Not exposed. Migration 011 makes a source version immutable: the database
   * refuses every UPDATE. A corrected citation is a NEW version.
   */
  update = refuseMutation(
    'Updating a knowledge source version',
    'Source versions are immutable; publish a new version designation instead.',
    'SOURCE_VERSION_IMMUTABLE'
  );

  /** Not exposed. Deleting a version would destroy cited provenance. */
  delete = refuseMutation(
    'Deleting a knowledge source version',
    'Source versions are immutable provenance; they cannot be deleted.',
    'SOURCE_VERSION_IMMUTABLE'
  );

  /**
   * Create an immutable source version.
   *
   * The parent source must exist within the caller's tenant scope. There is no
   * update or delete counterpart: migration 011 makes the row immutable and
   * refuses deletion once evidence references it.
   */
  async createVersion(knowledgeSourceId, input, { organizationId, userId }) {
    assertValid(validateSourceVersionInput(input));

    const source = await KnowledgeSource.findSourceById(knowledgeSourceId, organizationId);
    if (!source) {
      throw new ProvenanceNotFoundError('Knowledge source not found');
    }

    const rows = await this.query(
      `INSERT INTO knowledge_source_versions
         (knowledge_source_id, version_designation, title, reference_number, issuing_organization,
          publication_date, effective_date, external_uri, content_sha256, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        source.id,
        input.versionDesignation.trim(),
        input.title.trim(),
        input.referenceNumber === undefined ? null : input.referenceNumber,
        input.issuingOrganization === undefined ? null : input.issuingOrganization,
        input.publicationDate === undefined ? null : input.publicationDate,
        input.effectiveDate === undefined ? null : input.effectiveDate,
        input.externalUri === undefined ? null : input.externalUri,
        input.contentSha256 === undefined ? null : input.contentSha256,
        userId || null
      ]
    );

    return this.findVersionById(rows.insertId, organizationId);
  }

  /** Find a source version, scoped through its parent source's tenant scope. */
  async findVersionById(id, organizationId) {
    const rows = await this.query(
      `SELECT v.*, s.source_code, s.organization_id AS source_organization_id
         FROM knowledge_source_versions v
         JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE v.id = ? AND (s.organization_id IS NULL OR s.organization_id = ?)`,
      [id, organizationId]
    );
    return rows[0] || null;
  }

  /** List the immutable versions of a source, newest first. */
  async listVersionsForSource(knowledgeSourceId, organizationId) {
    const source = await KnowledgeSource.findSourceById(knowledgeSourceId, organizationId);
    if (!source) {
      throw new ProvenanceNotFoundError('Knowledge source not found');
    }
    return this.query(
      `SELECT * FROM knowledge_source_versions
        WHERE knowledge_source_id = ?
        ORDER BY created_at DESC, id DESC`,
      [knowledgeSourceId]
    );
  }
}

class KnowledgeTemplateEvidenceModel extends BaseModel {
  constructor() {
    super('knowledge_template_evidence');
  }

  /**
   * Not exposed. Working evidence is corrected by detaching and re-attaching, so
   * a partial edit can never leave an evidence row in an ambiguous state.
   */
  update = refuseMutation(
    'Updating working evidence',
    'Detach the evidence and attach a corrected association instead.',
    'EVIDENCE_UPDATE_NOT_SUPPORTED'
  );

  /** Not exposed: use detachWorkingEvidence, which is tenant-scoped. */
  delete = refuseMutation(
    'Deleting working evidence',
    'Use the tenant-scoped detach operation instead.',
    'EVIDENCE_DELETE_NOT_SUPPORTED'
  );

  /**
   * Resolve the working template's tenant scope for a template or step subject.
   * Returns null when the subject does not exist.
   */
  async resolveWorkingSubject({ taskTemplateId = null, taskTemplateStepId = null }) {
    if (taskTemplateId !== null) {
      const rows = await this.query(
        `SELECT id, organization_id FROM task_templates WHERE id = ?`,
        [taskTemplateId]
      );
      return rows[0] ? { taskTemplateId: rows[0].id, organizationId: rows[0].organization_id } : null;
    }

    const rows = await this.query(
      `SELECT s.id, t.organization_id
         FROM task_template_steps s
         JOIN task_templates t ON t.id = s.task_template_id
        WHERE s.id = ?`,
      [taskTemplateStepId]
    );
    return rows[0] ? { taskTemplateStepId: rows[0].id, organizationId: rows[0].organization_id } : null;
  }

  /**
   * Attach an immutable source version as WORKING evidence on a working subject.
   *
   * Scope rules (mirroring migration 011's provenance_tenant_scope_check, but
   * reported as a clean 404/409 instead of a raw database error):
   *   - the subject must be tenant-scoped to the caller (global shared templates
   *     are not authorable by a tenant);
   *   - the source version must be reachable within the caller's tenant scope;
   *   - a tenant-scoped source version may only support a template in the SAME
   *     organization.
   */
  async attachEvidence({ taskTemplateId = null, taskTemplateStepId = null }, input, { organizationId, userId }) {
    assertValid(validateEvidenceInput({
      ...input,
      taskTemplateId,
      taskTemplateStepId
    }));

    if (!organizationId) {
      throw new ProvenanceConflictError(
        'Working evidence authoring requires the authenticated principal to belong to an organization',
        'EVIDENCE_ORGANIZATION_REQUIRED'
      );
    }

    const subject = await this.resolveWorkingSubject({ taskTemplateId, taskTemplateStepId });
    if (!subject) {
      throw new ProvenanceNotFoundError('Task template or step not found');
    }

    if (subject.organizationId === null) {
      throw new ProvenanceConflictError(
        'Shared global task templates are not tenant-authorable; evidence cannot be attached to them',
        'EVIDENCE_SUBJECT_NOT_TENANT_SCOPED'
      );
    }

    if (Number(subject.organizationId) !== Number(organizationId)) {
      // Do not disclose that the subject exists in another tenant.
      throw new ProvenanceNotFoundError('Task template or step not found');
    }

    const sourceVersion = await KnowledgeSourceVersion.findVersionById(
      input.knowledgeSourceVersionId, organizationId
    );
    if (!sourceVersion) {
      throw new ProvenanceNotFoundError('Knowledge source version not found');
    }

    if (sourceVersion.source_organization_id !== null
      && Number(sourceVersion.source_organization_id) !== Number(subject.organizationId)) {
      throw new ProvenanceConflictError(
        'A tenant-scoped source version may only support knowledge in the same organization',
        'EVIDENCE_SOURCE_SCOPE_MISMATCH'
      );
    }

    const rows = await this.query(
      `INSERT INTO knowledge_template_evidence
         (task_template_id, task_template_step_id, knowledge_source_version_id,
          section_or_clause, page_or_paragraph, derivation_notes,
          confidence_level, supporting_role, added_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        subject.taskTemplateId || null,
        subject.taskTemplateStepId || null,
        sourceVersion.id,
        input.sectionOrClause === undefined ? null : input.sectionOrClause,
        input.pageOrParagraph === undefined ? null : input.pageOrParagraph,
        input.derivationNotes === undefined ? null : input.derivationNotes,
        input.confidenceLevel === undefined ? 'provisional' : input.confidenceLevel,
        input.supportingRole === undefined ? 'supporting' : input.supportingRole,
        userId || null
      ]
    );

    return this.findWorkingEvidenceById(rows.insertId, organizationId);
  }

  /** Find a single working evidence row, scoped to the caller's tenant. */
  async findWorkingEvidenceById(id, organizationId) {
    const rows = await this.query(
      `SELECT e.*
         FROM knowledge_template_evidence e
         LEFT JOIN task_templates t ON t.id = e.task_template_id
         LEFT JOIN task_template_steps s ON s.id = e.task_template_step_id
         LEFT JOIN task_templates st ON st.id = s.task_template_id
        WHERE e.id = ?
          AND COALESCE(t.organization_id, st.organization_id) = ?`,
      [id, organizationId]
    );
    return rows[0] || null;
  }

  /** List working evidence for a working template (template-level and step-level). */
  async listWorkingEvidenceForTemplate(taskTemplateId, organizationId) {
    const subject = await this.resolveWorkingSubject({ taskTemplateId });
    if (!subject || subject.organizationId === null
      || Number(subject.organizationId) !== Number(organizationId)) {
      throw new ProvenanceNotFoundError('Task template not found');
    }

    return this.query(
      `SELECT e.*,
              v.version_designation,
              v.title AS source_version_title,
              s.source_code,
              s.source_category
         FROM knowledge_template_evidence e
         JOIN knowledge_source_versions v ON v.id = e.knowledge_source_version_id
         JOIN knowledge_sources s ON s.id = v.knowledge_source_id
        WHERE e.task_template_id = ?
           OR e.task_template_step_id IN (SELECT id FROM task_template_steps WHERE task_template_id = ?)
        ORDER BY e.id`,
      [taskTemplateId, taskTemplateId]
    );
  }

  /**
   * Detach WORKING evidence. Permitted only while the row is working evidence.
   *
   * Frozen evidence lives in knowledge_template_version_evidence, which has no
   * access path from this model, so this method cannot reach it.
   */
  async detachWorkingEvidence(evidenceId, organizationId) {
    const existing = await this.findWorkingEvidenceById(evidenceId, organizationId);
    if (!existing) {
      throw new ProvenanceNotFoundError('Working evidence not found');
    }

    try {
      await this.query(`DELETE FROM knowledge_template_evidence WHERE id = ?`, [evidenceId]);
    } catch (error) {
      // Migration 011 pins WORKING evidence once it has been copied into a
      // published version: fk_knowledge_template_version_evidence_copied_from is
      // ON DELETE RESTRICT. Detach is therefore permitted only before the
      // knowledge is published, which is exactly the intended boundary.
      if (error && error.code === '23503') {
        throw new ProvenanceConflictError(
          'This working evidence is part of a published task-template version and cannot be detached; '
            + 'published provenance is immutable',
          'EVIDENCE_FROZEN'
        );
      }
      throw error;
    }
    return { id: Number(evidenceId), detached: true };
  }
}

const KnowledgeSource = new KnowledgeSourceModel();
const KnowledgeSourceVersion = new KnowledgeSourceVersionModel();
const KnowledgeTemplateEvidence = new KnowledgeTemplateEvidenceModel();

module.exports = {
  KnowledgeSource,
  KnowledgeSourceVersion,
  KnowledgeTemplateEvidence,
  KnowledgeSourceModel,
  KnowledgeSourceVersionModel,
  KnowledgeTemplateEvidenceModel,
  ProvenanceNotFoundError,
  ProvenanceConflictError
};
