/**
 * Governed External Classification Crosswalk Model
 *
 * ATM-001 M5R.3E — database access for the governed crosswalk application layer.
 *
 * This model reads and writes ONLY the two relations accepted in M5R.3C and
 * M5R.3D:
 *   equipment_type_external_classification
 *   equipment_type_external_classification_evidence
 *
 * It creates no schema and changes no accepted semantics. Every database guard
 * from migrations 017 and 018 remains the real enforcement — edition coherence,
 * the global-source rule, approved immutability, the delete guard, the R1
 * supersession rules and the exactly-one-subject CHECK are all surfaced here,
 * never worked around.
 *
 * Two rules are implemented here rather than in the database, deliberately:
 *
 *   1. APPROVAL MUST BE EVIDENCE-BACKED. The ADR (§O) states the requirement and
 *      §AG records that enforcing ">=1 evidence row" "is cross-table and remains
 *      a service/domain rule — consistent with migration 013's documented
 *      boundary". M5R.3D recorded that boundary and left the rule to this layer.
 *      It is enforced in `approve()` below, transactionally.
 *
 *   2. GOVERNED EVIDENCE IS NOT DETACHABLE. Detaching relationship evidence from
 *      an approved crosswalk could leave approved, unsupported truth — exactly
 *      what rule 1 exists to prevent — and would erase the historical support
 *      §Q and acceptance case 23 require to remain traceable. `detachEvidence()`
 *      therefore refuses it. This is the smallest rule that preserves the
 *      mandatory invariant; it adds no new state, no new capability and no
 *      schema change.
 */

const BaseModel = require('./base.model');
const { getConnection } = require('../config/database');
const {
  validateProposalInput,
  validateDraftEditInput,
  validatePropositionCoherence,
  validateCrosswalkEvidenceInput,
  assertValid,
  deriveLifecycle,
  parsePositiveInt
} = require('../services/knowledge-crosswalk.service');

/** Thrown when a referenced row is absent, or outside the caller's scope. */
class CrosswalkNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CrosswalkNotFoundError';
    this.statusCode = 404;
  }
}

/** Thrown when an operation conflicts with the current state of the knowledge. */
class CrosswalkConflictError extends Error {
  constructor(message, code = 'CROSSWALK_CONFLICT') {
    super(message);
    this.name = 'CrosswalkConflictError';
    this.statusCode = 409;
    this.code = code;
  }
}

const CROSSWALK_TABLE = 'equipment_type_external_classification';
const EVIDENCE_TABLE = 'equipment_type_external_classification_evidence';

/**
 * Columns a caller may restate on a DRAFT proposition.
 *
 * Excluded on purpose: equipment_type_id and knowledge_source_version_id (a
 * different subject or edition is a NEW proposition, M5R.3 §J), review_state and
 * the supersession pointer (they move only through governed operations), and all
 * attribution (set from the authenticated principal, never from a payload).
 */
const DRAFT_EDITABLE_COLUMNS = Object.freeze({
  mappingOutcome: 'mapping_outcome',
  relationship: 'relationship',
  externalClassificationId: 'external_classification_id',
  applicabilityIndustryId: 'applicability_industry_id',
  applicabilityNote: 'applicability_note',
  confidenceLevel: 'confidence_level',
  supportingRole: 'supporting_role',
  aiAssisted: 'ai_assisted',
  aiAssistanceDetail: 'ai_assistance_detail'
});

/** Normalise an optional value for a nullable column. */
const orNull = (value) => (value === undefined ? null : value);

/**
 * Surface a database refusal as a domain conflict rather than leaking raw
 * PostgreSQL internals, following the M3 controller/model convention.
 */
function translateDatabaseRefusal(error) {
  if (!error || !error.code) return null;
  if (error.code === '23514' && /chk_equipment_type_external_classification_evidence_subject/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'Evidence must substantiate exactly one subject: either an external classification '
        + 'or a crosswalk, never both and never neither',
      'EVIDENCE_SUBJECT_INVALID'
    );
  }
  if (error.code === '23514' && /outcome_coherent/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'The mapping outcome, relationship and external classification must be coherent',
      'CROSSWALK_OUTCOME_INCOHERENT'
    );
  }
  if (error.code === '23514'
    && /may not (cite|derive authority from) tenant-scoped knowledge_source/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'This crosswalk is global knowledge: it may not cite a tenant-scoped knowledge source',
      'CROSSWALK_SOURCE_NOT_GLOBAL'
    );
  }
  if (error.code === '23514' && /belongs to edition/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'The external classification must belong to the same authority edition the crosswalk investigated',
      'CROSSWALK_EDITION_MISMATCH'
    );
  }
  if (error.code === '23514' && /may only be superseded by an approved successor/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'An approved crosswalk may only be superseded by an approved successor',
      'SUPERSEDE_SUCCESSOR_NOT_APPROVED'
    );
  }
  if (error.code === '23514' && /may only be superseded by a successor for the same equipment type/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'An approved crosswalk may only be superseded by a successor for the same equipment type',
      'SUPERSEDE_SUBJECT_MISMATCH'
    );
  }
  if (error.code === '23514' && /would create a cycle/.test(error.message || '')) {
    return new CrosswalkConflictError(
      'That supersession would create a cycle',
      'SUPERSEDE_CYCLE'
    );
  }
  if (error.code === '23514' && /cannot supersede itself/.test(error.message || '')) {
    return new CrosswalkConflictError('A crosswalk cannot supersede itself', 'SUPERSEDE_SELF');
  }
  if (error.code === '23503') {
    return new CrosswalkConflictError(
      'The referenced record does not exist in a scope this operation may use',
      'CROSSWALK_REFERENCE_INVALID'
    );
  }
  if (error.code === '23505') {
    return new CrosswalkConflictError(
      'That would create a second simultaneously active approved conclusion for the same proposition',
      'CROSSWALK_DUPLICATE_ACTIVE_TRUTH'
    );
  }
  if (error.code === '42501' || (error.code === '23514' && /is immutable|only draft proposals are deletable/.test(error.message || ''))) {
    return new CrosswalkConflictError(
      'Approved knowledge is immutable; supersede it with a new governed proposition instead',
      'CROSSWALK_IMMUTABLE'
    );
  }
  return null;
}

/**
 * Run `fn` inside a transaction, mapping database refusals to domain conflicts.
 *
 * `getConnection()` already issues BEGIN. Both approval and evidence detachment
 * use this so their validation and their write are one atomic unit.
 */
async function inTransaction(fn) {
  const conn = await getConnection();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* the original error is what matters */ }
    throw translateDatabaseRefusal(error) || error;
  } finally {
    conn.release();
  }
}

class EquipmentTypeExternalClassificationModel extends BaseModel {
  constructor() {
    super(CROSSWALK_TABLE);
  }

  /** Not exposed: a crosswalk is never rewritten through generic update(). */
  update = () => {
    throw new CrosswalkConflictError(
      'Crosswalks are edited through their governed draft operation, never through a generic update',
      'CROSSWALK_UPDATE_NOT_ALLOWED'
    );
  };

  /** Not exposed: withdrawal of a draft is the only deletion, and it is guarded. */
  delete = () => {
    throw new CrosswalkConflictError(
      'Crosswalks are not deleted through a generic delete; only a withdrawn draft may be removed '
        + 'and that is a governed operation',
      'CROSSWALK_DELETE_NOT_ALLOWED'
    );
  };

  /**
   * Load one crosswalk with the provenance a caller needs to interpret it: the
   * exact authority edition investigated, and the external concept when mapped.
   *
   * Returns null when the row does not exist, so the controller can answer 404.
   */
  async findCrosswalkById(crosswalkId) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) return null;

    const rows = await this.query(
      `SELECT ec.*,
              v.version_designation,
              v.title            AS source_version_title,
              v.reference_number,
              v.publication_date,
              v.effective_date,
              v.external_uri,
              s.source_code,
              s.source_category,
              s.default_title    AS source_title,
              s.issuing_organization,
              s.organization_id  AS source_organization_id,
              x.classification_code,
              x.classification_label,
              x.classification_path
         FROM ${CROSSWALK_TABLE} ec
         JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
         JOIN knowledge_sources s         ON s.id = v.knowledge_source_id
         LEFT JOIN external_classification x ON x.id = ec.external_classification_id
        WHERE ec.id = ?`,
      [id]
    );
    return rows[0] ? { ...rows[0], lifecycle: deriveLifecycle(rows[0]) } : null;
  }

  /**
   * List crosswalks for one Atiman equipment type.
   *
   * `includeHistory` is explicit because the two questions are different: the
   * default answers "what do we currently hold to be true", while history
   * answers "what have we believed, and when". A superseded row is retained and
   * reachable either way.
   *
   * The returned rows carry both `review_state` and `mapping_outcome` untouched,
   * plus the derived `lifecycle` label. They are never collapsed into one status.
   */
  async listCrosswalksForEquipmentType(equipmentTypeId, { includeHistory = false } = {}) {
    const id = parsePositiveInt(equipmentTypeId);
    if (!id) return [];

    const rows = await this.query(
      `SELECT ec.*,
              v.version_designation,
              v.reference_number,
              s.source_code,
              s.source_category,
              x.classification_code,
              x.classification_label
         FROM ${CROSSWALK_TABLE} ec
         JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
         JOIN knowledge_sources s         ON s.id = v.knowledge_source_id
         LEFT JOIN external_classification x ON x.id = ec.external_classification_id
        WHERE ec.equipment_type_id = ?
          ${includeHistory ? '' : "AND ec.superseded_by_crosswalk_id IS NULL"}
        ORDER BY ec.knowledge_source_version_id, ec.id`,
      [id]
    );
    return rows.map((row) => ({ ...row, lifecycle: deriveLifecycle(row) }));
  }

  /**
   * Does any crosswalk row exist for this (equipment type, authority edition)?
   *
   * Used to answer the NEVER_INVESTIGATED question honestly: absence of a row is
   * the representation, and this returns false rather than inventing a row.
   */
  async hasBeenInvestigated(equipmentTypeId, knowledgeSourceVersionId) {
    const typeId = parsePositiveInt(equipmentTypeId);
    const versionId = parsePositiveInt(knowledgeSourceVersionId);
    if (!typeId || !versionId) return false;
    const rows = await this.query(
      `SELECT 1 AS present FROM ${CROSSWALK_TABLE}
        WHERE equipment_type_id = ? AND knowledge_source_version_id = ? LIMIT 1`,
      [typeId, versionId]
    );
    return rows.length > 0;
  }

  /**
   * Walk the supersession chain forward from a row, so superseded history stays
   * reachable. Bounded, because the successor chain is a line, not a tree.
   */
  async getSupersessionChain(crosswalkId, { maxDepth = 25 } = {}) {
    const start = parsePositiveInt(crosswalkId);
    if (!start) return [];

    const chain = [];
    const seen = new Set([start]);
    let nextId = start;

    while (nextId !== null && nextId !== undefined && chain.length < maxDepth) {
      const rows = await this.query(
        `SELECT ec.id, ec.review_state, ec.mapping_outcome, ec.superseded_by_crosswalk_id,
                ec.knowledge_source_version_id, ec.approved_at,
                v.version_designation, s.source_code
           FROM ${CROSSWALK_TABLE} ec
           JOIN knowledge_source_versions v ON v.id = ec.knowledge_source_version_id
           JOIN knowledge_sources s         ON s.id = v.knowledge_source_id
          WHERE ec.id = ?`,
        [nextId]
      );
      const row = rows[0];
      if (!row) break;
      chain.push({ ...row, lifecycle: deriveLifecycle(row) });
      const successor = row.superseded_by_crosswalk_id;
      if (successor === null || successor === undefined || seen.has(Number(successor))) break;
      seen.add(Number(successor));
      nextId = successor;
    }
    return chain;
  }

  /**
   * PROPOSE a new draft proposition.
   *
   * The subject and the investigated edition are recorded here and never edited
   * afterwards. `proposed_by_user_id` is the authenticated principal — never a
   * payload value — and an AI-assisted proposal must say what was assisted while
   * remaining a draft.
   */
  async proposeCrosswalk(input, { userId }) {
    assertValid(validateProposalInput(input));

    const outcome = input.mappingOutcome;
    const relationship = outcome === 'NO_DIRECT_MAPPING' ? null : outcome;

    return inTransaction(async (conn) => {
      const rows = await conn.query(
        `INSERT INTO ${CROSSWALK_TABLE}
           (equipment_type_id, knowledge_source_version_id, external_classification_id,
            relationship, mapping_outcome, review_state,
            applicability_industry_id, applicability_note,
            confidence_level, supporting_role,
            proposed_by_user_id, ai_assisted, ai_assistance_detail)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?::jsonb)
         RETURNING id`,
        [
          parsePositiveInt(input.equipmentTypeId),
          parsePositiveInt(input.knowledgeSourceVersionId),
          outcome === 'NO_DIRECT_MAPPING' ? null : parsePositiveInt(input.externalClassificationId),
          relationship,
          outcome,
          parsePositiveInt(input.applicabilityIndustryId),
          orNull(input.applicabilityNote),
          input.confidenceLevel || 'provisional',
          input.supportingRole || 'supporting',
          userId || null,
          input.aiAssisted === true,
          input.aiAssistanceDetail === undefined || input.aiAssistanceDetail === null
            ? null
            : JSON.stringify(input.aiAssistanceDetail)
        ]
      );
      const id = rows.insertId;
      const created = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]);
      return created[0];
    });
  }

  /**
   * EDIT a draft proposition.
   *
   * Refused unless the row is still a draft: migration 017 freezes an approved
   * row by trigger, and an under-review or rejected row is not a working draft.
   *
   * The edit is applied to a copy of the current proposition and the MERGED state
   * is what gets validated, so a partial edit that would leave the row incoherent
   * (for example switching a mapped draft to NO_DIRECT_MAPPING while its
   * classification is still set) is refused here rather than by the database
   * CHECK. The CHECK remains the enforcement.
   */
  async updateDraftCrosswalk(crosswalkId, input, { userId } = {}) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) throw new CrosswalkNotFoundError('Crosswalk not found');

    assertValid(validateDraftEditInput(input));

    return inTransaction(async (conn) => {
      const current = await conn.query(
        `SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ? FOR UPDATE`, [id]
      );
      const row = current[0];
      if (!row) throw new CrosswalkNotFoundError('Crosswalk not found');
      if (row.review_state !== 'draft') {
        throw new CrosswalkConflictError(
          `Only a draft proposition can be edited; this crosswalk is '${row.review_state}'`,
          'CROSSWALK_NOT_EDITABLE'
        );
      }

      const has = (field) => Object.prototype.hasOwnProperty.call(input, field);
      const nextOutcome = has('mappingOutcome') ? input.mappingOutcome : row.mapping_outcome;
      const nextClassification = has('externalClassificationId')
        ? input.externalClassificationId
        : row.external_classification_id;

      assertValid(validatePropositionCoherence({
        mappingOutcome: nextOutcome,
        externalClassificationId: nextClassification
      }));

      const assignments = [];
      const params = [];
      for (const [field, column] of Object.entries(DRAFT_EDITABLE_COLUMNS)) {
        if (!has(field)) continue;
        let value = input[field];
        if (field === 'aiAssistanceDetail') {
          value = value === undefined || value === null ? null : JSON.stringify(value);
        } else if (field === 'externalClassificationId' || field === 'applicabilityIndustryId') {
          value = parsePositiveInt(value);
        }
        assignments.push(`${column} = ?`);
        params.push(value);
      }

      // Keep the mirror column coherent: migration 017 requires
      // relationship = mapping_outcome for a mapped row, and NULL for
      // NO_DIRECT_MAPPING, so the pair is always restated together.
      if (has('mappingOutcome')) {
        assignments.push('relationship = ?');
        params.push(nextOutcome === 'NO_DIRECT_MAPPING' ? null : nextOutcome);
      }

      assignments.push('updated_at = NOW()');
      params.push(id);

      await conn.query(
        `UPDATE ${CROSSWALK_TABLE} SET ${assignments.join(', ')} WHERE id = ?`, params
      );
      const updated = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]);
      return updated[0];
    });
  }

  /**
   * SUBMIT a draft for review (draft -> under_review).
   *
   * The guarded WHERE clause makes the transition atomic: a concurrent submit or
   * approval cannot both win.
   */
  async submitForReview(crosswalkId, { userId } = {}) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) throw new CrosswalkNotFoundError('Crosswalk not found');

    return inTransaction(async (conn) => {
      const rows = await conn.query(
        `UPDATE ${CROSSWALK_TABLE}
            SET review_state = 'under_review', updated_at = NOW()
          WHERE id = ? AND review_state = 'draft'
        RETURNING id`, [id]
      );
      if (rows.length === 0) {
        const current = await conn.query(
          `SELECT review_state FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]
        );
        if (!current[0]) throw new CrosswalkNotFoundError('Crosswalk not found');
        throw new CrosswalkConflictError(
          `Only a draft proposition can be submitted for review; this crosswalk is '${current[0].review_state}'`,
          'CROSSWALK_INVALID_TRANSITION'
        );
      }
      const updated = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]);
      return updated[0];
    });
  }

  /**
   * Count RELATIONSHIP evidence for a crosswalk.
   *
   * `crosswalk_id = ?` IS relationship evidence. Concept evidence carries
   * external_classification_id instead and is excluded by the exactly-one-subject
   * CHECK, so it can never satisfy this count — which is the whole point:
   * evidence that an external concept exists does not substantiate an Atiman
   * relationship (M5R.3 section P).
   */
  async countRelationshipEvidence(crosswalkId, conn = null) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) return 0;
    const runner = conn || this;
    const rows = await runner.query(
      `SELECT COUNT(*)::int AS n FROM ${EVIDENCE_TABLE}
        WHERE crosswalk_id = ? AND external_classification_id IS NULL`, [id]
    );
    return rows[0] ? rows[0].n : 0;
  }

  /**
   * APPROVE a crosswalk under review (under_review -> approved), enforcing that
   * approval is EVIDENCE-BACKED.
   *
   * Transaction and lock order are deliberate. The crosswalk row is locked FIRST,
   * then the relationship-evidence count is read, then the transition is written,
   * all inside one transaction. `detachEvidence` takes the same lock first, so the
   * two operations serialize: either the detachment commits first and approval
   * sees zero evidence and refuses, or approval commits first and the detachment
   * is refused. There is no interleaving that leaves approved, unsupported truth,
   * and there is no window where evidence is validated outside the transaction.
   *
   * The approving human is the authenticated principal. `reviewed_by_user_id` and
   * `approved_by_user_id` are both recorded from it — the schema requires both
   * attribution pairs for an approved row, and the ADR requires them to be
   * separate and required, not to be different people. No AI, no default and no
   * synthetic approver is ever substituted here.
   */
  async approveCrosswalk(crosswalkId, { userId } = {}) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) throw new CrosswalkNotFoundError('Crosswalk not found');

    if (!parsePositiveInt(userId)) {
      throw new CrosswalkConflictError(
        'Approval must be attributed to an authenticated accountable human',
        'CROSSWALK_APPROVER_REQUIRED'
      );
    }

    return inTransaction(async (conn) => {
      // Lock the crosswalk: this is what serializes against evidence detachment.
      const locked = await conn.query(
        `SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ? FOR UPDATE`, [id]
      );
      const row = locked[0];
      if (!row) throw new CrosswalkNotFoundError('Crosswalk not found');
      if (row.review_state !== 'under_review') {
        throw new CrosswalkConflictError(
          `Only a crosswalk under review can be approved; this crosswalk is '${row.review_state}'`,
          'CROSSWALK_INVALID_TRANSITION'
        );
      }

      const relationshipEvidence = await this.countRelationshipEvidence(id, conn);
      if (relationshipEvidence === 0) {
        throw new CrosswalkConflictError(
          (row.mapping_outcome === 'NO_DIRECT_MAPPING'
            ? 'An approved NO_DIRECT_MAPPING is a positive conclusion and must carry relationship '
            : 'An approved mapping must carry relationship ')
            + 'evidence: attach at least one evidence row substantiating this crosswalk. '
            + 'Evidence attached to an external classification does not satisfy this requirement.',
          'CROSSWALK_RELATIONSHIP_EVIDENCE_REQUIRED'
        );
      }

      await conn.query(
        `UPDATE ${CROSSWALK_TABLE}
            SET review_state = 'approved',
                reviewed_by_user_id = ?, reviewed_at = NOW(),
                approved_by_user_id = ?, approved_at = NOW(),
                updated_at = NOW()
          WHERE id = ? AND review_state = 'under_review'`,
        [userId, userId, id]
      );
      const updated = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]);
      return { crosswalk: updated[0], relationshipEvidence };
    });
  }

  /**
   * REJECT a crosswalk under review (under_review -> rejected).
   *
   * A rejected proposal is governed knowledge ("this was considered and refused")
   * and is RETAINED, never deleted, so the same proposal cannot be re-litigated
   * with no record that it was declined.
   *
   * Note: migration 017 defines no rejection-reason column for crosswalks
   * (unlike M1's task_templates), and this mission creates no migration, so a
   * rejection records reviewer attribution without a free-text reason. That is
   * the accepted schema, faithfully reported rather than papered over with an
   * unapproved column.
   */
  async rejectCrosswalk(crosswalkId, { userId } = {}) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) throw new CrosswalkNotFoundError('Crosswalk not found');

    if (!parsePositiveInt(userId)) {
      throw new CrosswalkConflictError(
        'A rejection must be attributed to an authenticated accountable human',
        'CROSSWALK_REVIEWER_REQUIRED'
      );
    }

    return inTransaction(async (conn) => {
      const rows = await conn.query(
        `UPDATE ${CROSSWALK_TABLE}
            SET review_state = 'rejected',
                reviewed_by_user_id = ?, reviewed_at = NOW(),
                approved_by_user_id = NULL, approved_at = NULL,
                updated_at = NOW()
          WHERE id = ? AND review_state = 'under_review'
        RETURNING id`, [userId, id]
      );
      if (rows.length === 0) {
        const current = await conn.query(
          `SELECT review_state FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]
        );
        if (!current[0]) throw new CrosswalkNotFoundError('Crosswalk not found');
        throw new CrosswalkConflictError(
          `Only a crosswalk under review can be rejected; this crosswalk is '${current[0].review_state}'`,
          'CROSSWALK_INVALID_TRANSITION'
        );
      }
      const updated = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]);
      return updated[0];
    });
  }

  /**
   * SUPERSEDE an approved crosswalk with an approved successor.
   *
   * This LINKS; it never creates. Creating a replacement is an ordinary governed
   * proposal that must pass through the workflow and the evidence rule on its own,
   * so an approved predecessor can only ever be retired by knowledge that is
   * itself approved and evidence-backed (M5R.3 §J and the M5R.3C-R1 refinement).
   *
   * Migration 017's trigger remains the enforcement; the checks below exist so a
   * caller gets a specific conflict code instead of a raw constraint error, and
   * the guarded WHERE makes the assignment atomic.
   */
  async supersedeCrosswalk(predecessorId, successorId, { userId } = {}) {
    const predecessor = parsePositiveInt(predecessorId);
    const successor = parsePositiveInt(successorId);
    if (!predecessor) throw new CrosswalkNotFoundError('Crosswalk not found');
    if (!successor) {
      throw new CrosswalkConflictError(
        'A successor crosswalk id is required', 'SUPERSEDE_SUCCESSOR_REQUIRED'
      );
    }
    if (predecessor === successor) {
      throw new CrosswalkConflictError('A crosswalk cannot supersede itself', 'SUPERSEDE_SELF');
    }

    return inTransaction(async (conn) => {
      const before = await conn.query(
        `SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ? FOR UPDATE`, [predecessor]
      );
      const row = before[0];
      if (!row) throw new CrosswalkNotFoundError('Crosswalk not found');
      if (row.review_state !== 'approved') {
        throw new CrosswalkConflictError(
          `Only an approved crosswalk can be superseded; this crosswalk is '${row.review_state}'`,
          'SUPERSEDE_PREDECESSOR_NOT_APPROVED'
        );
      }
      if (row.superseded_by_crosswalk_id !== null && row.superseded_by_crosswalk_id !== undefined) {
        throw new CrosswalkConflictError(
          'This crosswalk has already been superseded',
          'SUPERSEDE_ALREADY_SUPERSEDED'
        );
      }

      const successorRows = await conn.query(
        `SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [successor]
      );
      const next = successorRows[0];
      if (!next) throw new CrosswalkNotFoundError('Successor crosswalk not found');
      if (next.review_state !== 'approved') {
        throw new CrosswalkConflictError(
          `An approved crosswalk may only be superseded by an approved successor; the successor `
            + `is '${next.review_state}'. Approve it through the governed workflow, including its `
            + 'own relationship evidence, first.',
          'SUPERSEDE_SUCCESSOR_NOT_APPROVED'
        );
      }
      if (Number(next.equipment_type_id) !== Number(row.equipment_type_id)) {
        throw new CrosswalkConflictError(
          'An approved crosswalk may only be superseded by a successor for the same equipment type',
          'SUPERSEDE_SUBJECT_MISMATCH'
        );
      }

      // NOTE: updated_at is deliberately NOT set here. Migration 017 freezes an
      // approved row in every column except superseded_by_crosswalk_id, so
      // writing a timestamp would be refused by the immutability trigger — the
      // pointer really is the only change governed history permits.
      await conn.query(
        `UPDATE ${CROSSWALK_TABLE}
            SET superseded_by_crosswalk_id = ?
          WHERE id = ? AND review_state = 'approved' AND superseded_by_crosswalk_id IS NULL`,
        [successor, predecessor]
      );
      const updated = await conn.query(`SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ?`, [predecessor]);
      return updated[0];
    });
  }
}

class ExternalClassificationCrosswalkEvidenceModel extends BaseModel {
  constructor() {
    super(EVIDENCE_TABLE);
  }

  /** Not exposed: evidence is attached and detached, never silently rewritten. */
  update = () => {
    throw new CrosswalkConflictError(
      'Evidence is immutable; detach it and attach a corrected row instead',
      'EVIDENCE_UPDATE_NOT_ALLOWED'
    );
  };

  /** Not exposed: subject-scoped detachment is the only removal. */
  delete = () => {
    throw new CrosswalkConflictError(
      'Evidence is detached through its governed crosswalk operation',
      'EVIDENCE_DELETE_NOT_ALLOWED'
    );
  };

  /** List the RELATIONSHIP evidence attached to one crosswalk, with provenance. */
  async listEvidenceForCrosswalk(crosswalkId) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) return [];
    return this.query(
      `SELECT e.*,
              v.version_designation,
              v.title           AS source_version_title,
              v.reference_number,
              s.source_code,
              s.source_category,
              s.issuing_organization
         FROM ${EVIDENCE_TABLE} e
         JOIN knowledge_source_versions v ON v.id = e.knowledge_source_version_id
         JOIN knowledge_sources s         ON s.id = v.knowledge_source_id
        WHERE e.crosswalk_id = ?
        ORDER BY e.id`,
      [id]
    );
  }

  /**
   * ATTACH relationship evidence to a crosswalk.
   *
   * `crosswalk_id` comes from the route and `external_classification_id` is left
   * NULL, so the exactly-one-subject rule can never be violated from this path
   * and concept evidence can never be smuggled in as relationship evidence.
   *
   * The cited edition is whatever the ADR permits: a corroborating source may be
   * a different governed edition from the one being mapped (M5R.3D established
   * that deliberately), and migration 018's global-source trigger independently
   * refuses a tenant-scoped one.
   */
  async attachEvidence(crosswalkId, input, { userId } = {}) {
    const id = parsePositiveInt(crosswalkId);
    if (!id) throw new CrosswalkNotFoundError('Crosswalk not found');

    assertValid(validateCrosswalkEvidenceInput(input));

    return inTransaction(async (conn) => {
      const crosswalk = await conn.query(
        `SELECT id FROM ${CROSSWALK_TABLE} WHERE id = ?`, [id]
      );
      if (!crosswalk[0]) throw new CrosswalkNotFoundError('Crosswalk not found');

      const rows = await conn.query(
        `INSERT INTO ${EVIDENCE_TABLE}
           (knowledge_source_version_id, external_classification_id, crosswalk_id,
            section_or_clause, page_or_paragraph, derivation_notes,
            confidence_level, supporting_role, added_by_user_id)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          parsePositiveInt(input.knowledgeSourceVersionId),
          id,
          orNull(input.sectionOrClause),
          orNull(input.pageOrParagraph),
          orNull(input.derivationNotes),
          input.confidenceLevel || 'provisional',
          input.supportingRole || 'supporting',
          userId || null
        ]
      );
      const created = await conn.query(
        `SELECT * FROM ${EVIDENCE_TABLE} WHERE id = ?`, [rows.insertId]
      );
      return created[0];
    });
  }

  /**
   * DETACH relationship evidence from a crosswalk.
   *
   * REFUSED once the crosswalk is approved. Two reasons, both architectural:
   * detaching could leave approved truth with zero relationship evidence — the
   * exact state the evidence-backed approval rule exists to make impossible — and
   * M5R.3 §Q and acceptance case 23 require evidence attached to governed (and
   * superseded) knowledge to remain traceable history.
   *
   * The crosswalk row is locked BEFORE the evidence row is touched, matching
   * `approveCrosswalk`'s lock order, so the two operations serialize and no
   * interleaving can produce unsupported approved truth.
   */
  async detachEvidence(evidenceId, crosswalkId, { userId } = {}) {
    const target = parsePositiveInt(evidenceId);
    const id = parsePositiveInt(crosswalkId);
    if (!target || !id) throw new CrosswalkNotFoundError('Evidence not found');

    return inTransaction(async (conn) => {
      const locked = await conn.query(
        `SELECT * FROM ${CROSSWALK_TABLE} WHERE id = ? FOR UPDATE`, [id]
      );
      const crosswalk = locked[0];
      if (!crosswalk) throw new CrosswalkNotFoundError('Crosswalk not found');

      // Evidence must belong to THIS crosswalk; anything else is reported absent
      // rather than confirming the existence of another row.
      const evidenceRows = await conn.query(
        `SELECT * FROM ${EVIDENCE_TABLE} WHERE id = ? AND crosswalk_id = ?`, [target, id]
      );
      if (!evidenceRows[0]) throw new CrosswalkNotFoundError('Evidence not found');

      if (crosswalk.review_state === 'approved') {
        throw new CrosswalkConflictError(
          (crosswalk.superseded_by_crosswalk_id
            ? 'This crosswalk is superseded governed history; its evidence is a historical record '
            : 'This crosswalk is approved; its relationship evidence is a historical record ')
            + 'and cannot be detached. Supersede it with a new governed proposition instead.',
          'EVIDENCE_APPROVED_IMMUTABLE'
        );
      }

      await conn.query(`DELETE FROM ${EVIDENCE_TABLE} WHERE id = ?`, [target]);
      return { detached: true, evidenceId: target, crosswalkId: id };
    });
  }
}

const EquipmentTypeExternalClassification = new EquipmentTypeExternalClassificationModel();
const ExternalClassificationCrosswalkEvidence = new ExternalClassificationCrosswalkEvidenceModel();

module.exports = {
  EquipmentTypeExternalClassification,
  ExternalClassificationCrosswalkEvidence,
  EquipmentTypeExternalClassificationModel,
  ExternalClassificationCrosswalkEvidenceModel,
  CrosswalkNotFoundError,
  CrosswalkConflictError,
  translateDatabaseRefusal,
  DRAFT_EDITABLE_COLUMNS
};
