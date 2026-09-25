/**
 * Knowledge Pack Model
 *
 * ATM-001 M4 — database access for governed Knowledge Pack authoring,
 * composition, review, approval and publication.
 *
 * This model writes ONLY to the Pack side of the knowledge model:
 *   knowledge_packs
 *   knowledge_pack_versions
 *   knowledge_pack_version_task_template_versions
 *
 * It deliberately contains NO method that can modify a task template, publish a
 * task template version, or reach governed provenance. A Pack COMPOSES already
 * published immutable knowledge by reference; it never authors, republishes, or
 * mutates the knowledge it contains. That boundary is exactly migration 014's
 * "composition, not duplication" contract, and M4 does not widen it.
 *
 * Integrity is owned by the database:
 *   - migration 009   immutable published knowledge versions
 *   - migration 013   governed task template publication attribution
 *   - migration 014   membership by reference + membership mutability guard
 *   - migration 015   Pack publisher attribution, governed-state attribution,
 *                     approver/publisher separation, and the parent-row lock
 *                     that serializes membership mutation against publication
 *
 * This model surfaces those refusals rather than working around them.
 *
 * Transaction discipline (ATM-001 M4 STEP 7)
 * ------------------------------------------
 * publication   One transaction. The Pack version row is locked FOR UPDATE
 *               BEFORE the composition is read and validated, so the
 *               composition that is validated is exactly the composition that
 *               is frozen. The lock is what makes the admission gate
 *               meaningful: without it, membership could change between
 *               validation and the transition.
 * membership    Composed inside one transaction. The durable protection that a
 *               membership mutation cannot land across the publication boundary
 *               is migration 015's FOR SHARE lock inside
 *               knowledge_pack_membership_guard(), not application code. The
 *               application checks here exist to return actionable errors.
 *
 * M1's advisory-lock convention (pg_advisory_xact_lock) is not reproduced here
 * because this publication updates an existing row rather than reading a
 * working template to construct a new one: SELECT ... FOR UPDATE on that exact
 * row provides strictly finer-grained mutual exclusion for the contended
 * resource, with no extra infrastructure.
 */

const BaseModel = require('./base.model');
const { getConnection } = require('../config/database');
const {
  PRE_PUBLICATION_PACK_STATES,
  MEMBER_TEMPLATE_LIFECYCLE_STATE,
  PackAdmissionError,
  PackNotFoundError,
  PackConflictError,
  assertValid,
  validatePackInput,
  validatePackVersionInput,
  validatePublicationAdmission
} = require('../services/knowledge-pack.service');

/**
 * Refuse an operation this capability deliberately does not expose.
 *
 * BaseModel provides generic update()/delete() helpers. Inheriting them would
 * advertise a mutation surface M4 must not have — a Pack version is a governed
 * lifecycle record, and a Pack identity is not silently renamed in place — so
 * both models override them explicitly rather than relying on a caller to know
 * better. This follows the boundary honesty established in M3.
 */
function refuseMutation(operation, guidance) {
  return () => {
    throw new PackConflictError(
      `${operation} is not exposed by ATM-001 M4: ${guidance}`,
      'PACK_MUTATION_NOT_EXPOSED'
    );
  };
}

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error) => error && (error.code === UNIQUE_VIOLATION
  || /duplicate key value violates unique constraint/i.test(error.message || ''));

class KnowledgePack extends BaseModel {
  constructor() {
    super('knowledge_packs');
  }

  /**
   * Create a Knowledge Pack identity.
   *
   * A Pack identity is shared knowledge: knowledge_packs has no organization_id
   * and migration 009 gives it none. Pack authoring is therefore an act on
   * shared knowledge, and the route layer restricts it accordingly.
   */
  async createPack(input, { userId = null } = {}) {
    assertValid(validatePackInput(input));

    const rows = await this.query(
      `INSERT INTO knowledge_packs (pack_code, pack_name, description)
       VALUES (?, ?, ?)
       RETURNING id`,
      [
        input.packCode.trim(),
        input.packName.trim(),
        input.description === undefined || input.description === null ? null : String(input.description)
      ]
    );

    if (!rows || !rows[0]) {
      throw new PackConflictError('Knowledge pack could not be created', 'PACK_CREATE_FAILED');
    }
    void userId; // authorship of a Pack identity is recorded by its versions
    return this.findPackById(rows[0].id);
  }

  async findPackById(id) {
    const rows = await this.query('SELECT * FROM knowledge_packs WHERE id = ?', [id]);
    return rows[0] || null;
  }

  async findPackByCode(packCode) {
    const rows = await this.query('SELECT * FROM knowledge_packs WHERE pack_code = ?', [packCode]);
    return rows[0] || null;
  }

  async listPacks({ limit = 50, offset = 0 } = {}) {
    return this.query(
      `SELECT * FROM knowledge_packs ORDER BY id LIMIT ? OFFSET ?`,
      [parseInt(limit, 10) || 50, parseInt(offset, 10) || 0]
    );
  }

  update = refuseMutation('KnowledgePack.update',
    'pack identity mutation is a future product decision, not part of M4');
  delete = refuseMutation('KnowledgePack.delete',
    'pack deletion is a future product decision, not part of M4');
}

class KnowledgePackVersion extends BaseModel {
  constructor() {
    super('knowledge_pack_versions');
  }

  // ------------------------------------------------------------------ reads

  async findVersionById(versionId) {
    const rows = await this.query('SELECT * FROM knowledge_pack_versions WHERE id = ?', [versionId]);
    return rows[0] || null;
  }

  /**
   * Resolve a Pack version ONLY within the Pack that was addressed.
   *
   * Resource binding is deliberate: a version id that exists under a different
   * Pack must not be reachable through this Pack's URL. Returning null lets the
   * caller report 404 for the address it was actually given.
   */
  async findVersionInPack(packId, versionId) {
    const rows = await this.query(
      'SELECT * FROM knowledge_pack_versions WHERE id = ? AND knowledge_pack_id = ?',
      [versionId, packId]
    );
    return rows[0] || null;
  }

  async listVersions(packId) {
    return this.query(
      'SELECT * FROM knowledge_pack_versions WHERE knowledge_pack_id = ? ORDER BY id',
      [packId]
    );
  }

  /** Membership of a Pack version, joined to the immutable member it references. */
  async listMembers(packId, versionId) {
    return this.query(
      `SELECT m.id,
              m.knowledge_pack_version_id,
              m.task_template_version_id,
              m.added_by_user_id,
              m.added_at,
              v.version_number AS task_template_version_number,
              v.template_name,
              v.lifecycle_state_at_publish
         FROM knowledge_pack_version_task_template_versions m
         JOIN knowledge_pack_versions pv ON pv.id = m.knowledge_pack_version_id
         LEFT JOIN task_template_versions v ON v.id = m.task_template_version_id
        WHERE m.knowledge_pack_version_id = ? AND pv.knowledge_pack_id = ?
        ORDER BY m.id`,
      [versionId, packId]
    );
  }

  // ------------------------------------------------------- version authoring

  /** Create a new Pack version in `draft`, recording its author. */
  async createVersion(packId, input, { userId } = {}) {
    assertValid(validatePackVersionInput(input));

    const conn = await getConnection();
    try {
      const packRows = await conn.query(
        'SELECT id FROM knowledge_packs WHERE id = ? FOR SHARE', [packId]
      );
      if (!packRows[0]) {
        throw new PackNotFoundError('Knowledge pack not found');
      }

      const authorId = userId || null;
      let rows;
      try {
        rows = await conn.query(
          `INSERT INTO knowledge_pack_versions
             (knowledge_pack_id, version_number, lifecycle_state, author_user_id)
           VALUES (?, ?, 'draft', ?)
           RETURNING id`,
          [packId, input.versionNumber.trim(), authorId]
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PackConflictError(
            `Knowledge pack version ${input.versionNumber} already exists for this pack`,
            'PACK_VERSION_ALREADY_EXISTS'
          );
        }
        throw error;
      }

      const versionId = rows[0].id;
      await conn.commit();
      return this.findVersionById(versionId);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Advance a Pack version through an atomic compare-and-set on its current
   * lifecycle state (`WHERE ... AND lifecycle_state = <expected>`), so two
   * concurrent callers cannot both observe a stale state and drive the version
   * forward twice.
   *
   * `params` must be supplied in the exact placeholder order of `sql`: a SET
   * placeholder precedes the WHERE placeholders, so the caller — not this
   * helper — owns the ordering.
   */
  async #transition({ sql, params, versionId, packId, conflictCode, conflictMessage, notFoundMessage }) {
    const conn = await getConnection();
    try {
      const rows = await conn.query(sql, params);
      if (!rows[0]) {
        // Distinguish "not addressed" from "wrong state" with a read inside the
        // same transaction, so the reported reason cannot be decided by a
        // separate unlocked read.
        const existing = await conn.query(
          'SELECT lifecycle_state FROM knowledge_pack_versions WHERE id = ? AND knowledge_pack_id = ?',
          [versionId, packId]
        );
        if (!existing[0]) {
          throw new PackNotFoundError(notFoundMessage);
        }
        throw new PackConflictError(
          `${conflictMessage} (current lifecycle state is ${existing[0].lifecycle_state})`,
          conflictCode
        );
      }
      const id = rows[0].id;
      await conn.commit();
      return this.findVersionById(id);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async submitForReview(packId, versionId) {
    return this.#transition({
      sql: `UPDATE knowledge_pack_versions
               SET lifecycle_state = 'under_review'
             WHERE id = ? AND knowledge_pack_id = ? AND lifecycle_state = 'draft'
             RETURNING id`,
      params: [versionId, packId],
      versionId,
      packId,
      conflictCode: 'PACK_VERSION_NOT_SUBMITTABLE',
      conflictMessage: 'Only a draft knowledge pack version can be submitted for review',
      notFoundMessage: 'Knowledge pack version not found'
    });
  }

  /**
   * Record the accountable review of an under_review Pack version.
   *
   * The review attribution is recorded, not the state advanced: approval is a
   * separate accountable act by a separate capability.
   */
  async recordReview(packId, versionId, reviewerUserId) {
    if (!reviewerUserId) {
      throw new PackConflictError('An authenticated reviewer is required', 'REVIEWER_REQUIRED');
    }
    return this.#transition({
      sql: `UPDATE knowledge_pack_versions
               SET reviewer_user_id = ?, reviewed_at = NOW()
             WHERE id = ? AND knowledge_pack_id = ? AND lifecycle_state = 'under_review'
             RETURNING id`,
      params: [reviewerUserId, versionId, packId],
      versionId,
      packId,
      conflictCode: 'PACK_VERSION_NOT_REVIEWABLE',
      conflictMessage: 'Only an under_review knowledge pack version can be reviewed',
      notFoundMessage: 'Knowledge pack version not found'
    });
  }

  /**
   * Approve an under_review Pack version that has actually been reviewed.
   *
   * Approval without a recorded review would make the governed-state
   * attribution constraint unsatisfiable at publication, so it is refused here
   * as well as being unreachable there. The `reviewer_user_id IS NOT NULL`
   * predicate is repeated in the UPDATE itself so the requirement cannot be
   * satisfied by a stale pre-read.
   */
  async approveVersion(packId, versionId, approverUserId) {
    if (!approverUserId) {
      throw new PackConflictError('An authenticated approver is required', 'APPROVER_REQUIRED');
    }

    // Diagnostic only. Enforcement is the `reviewer_user_id IS NOT NULL AND
    // reviewed_at IS NOT NULL` predicate inside the UPDATE below, which no
    // concurrent change can slip past; this read exists so an unreviewed pack
    // version is refused with a reason that names the real problem.
    const current = await this.findVersionInPack(packId, versionId);
    if (current
        && current.lifecycle_state === 'under_review'
        && (current.reviewer_user_id === null || current.reviewed_at === null)) {
      throw new PackConflictError(
        'A knowledge pack version must be reviewed before it can be approved',
        'PACK_VERSION_NOT_REVIEWED'
      );
    }

    return this.#transition({
      sql: `UPDATE knowledge_pack_versions
               SET approver_user_id = ?, approved_at = NOW(), lifecycle_state = 'approved'
             WHERE id = ? AND knowledge_pack_id = ? AND lifecycle_state = 'under_review'
               AND reviewer_user_id IS NOT NULL AND reviewed_at IS NOT NULL
             RETURNING id`,
      params: [approverUserId, versionId, packId],
      versionId,
      packId,
      conflictCode: 'PACK_VERSION_NOT_APPROVABLE',
      conflictMessage: 'Only a reviewed, under_review knowledge pack version can be approved',
      notFoundMessage: 'Knowledge pack version not found'
    });
  }

  // -------------------------------------------------------------- composition

  /**
   * Add an immutable published task_template_version as a member.
   *
   * A working task_template is not addressable here at all: the membership
   * column is a foreign key to task_template_versions, so the type-specific,
   * reference-only membership architecture of migration 014 is what makes a
   * working template structurally impossible to compose. The checks below
   * narrow that to published, globally applicable knowledge.
   */
  async addMember(packId, versionId, taskTemplateVersionId, userId) {
    const conn = await getConnection();
    try {
      const versionRows = await conn.query(
        'SELECT id, lifecycle_state FROM knowledge_pack_versions WHERE id = ? AND knowledge_pack_id = ?',
        [versionId, packId]
      );
      const version = versionRows[0];
      if (!version) {
        throw new PackNotFoundError('Knowledge pack version not found');
      }
      if (!PRE_PUBLICATION_PACK_STATES.includes(version.lifecycle_state)) {
        throw new PackConflictError(
          `Membership is frozen once a knowledge pack version is released (current lifecycle state is ${version.lifecycle_state})`,
          'PACK_MEMBERSHIP_FROZEN'
        );
      }

      const memberRows = await conn.query(
        `SELECT v.id,
                v.lifecycle_state_at_publish,
                t.organization_id
           FROM task_template_versions v
           JOIN task_templates t ON t.id = v.task_template_id
          WHERE v.id = ?`,
        [taskTemplateVersionId]
      );
      const member = memberRows[0];
      if (!member) {
        throw new PackNotFoundError(
          'A pack member must reference an existing immutable task template version'
        );
      }
      if (member.lifecycle_state_at_publish !== MEMBER_TEMPLATE_LIFECYCLE_STATE) {
        throw new PackConflictError(
          `A pack member must be a published task template version (found ${member.lifecycle_state_at_publish})`,
          'MEMBER_NOT_PUBLISHED'
        );
      }
      if (member.organization_id !== null && member.organization_id !== undefined) {
        throw new PackConflictError(
          'A pack member must be globally applicable knowledge, not tenant-scoped knowledge',
          'MEMBER_SCOPE_VIOLATION'
        );
      }

      let rows;
      try {
        rows = await conn.query(
          `INSERT INTO knowledge_pack_version_task_template_versions
             (knowledge_pack_version_id, task_template_version_id, added_by_user_id)
           VALUES (?, ?, ?)
           RETURNING id`,
          [versionId, taskTemplateVersionId, userId || null]
        );
      } catch (error) {
        // Duplicate membership is decided by uq_kpvtv_pack_version_template_version
        // rather than by an unlocked read-then-write check.
        if (isUniqueViolation(error)) {
          throw new PackConflictError(
            'That task template version is already a member of this knowledge pack version',
            'MEMBER_ALREADY_PRESENT'
          );
        }
        throw error;
      }

      const membershipId = rows[0].id;
      await conn.commit();
      return membershipId;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  /**
   * Remove a member while the Pack version is still mutable.
   *
   * The DELETE repeats the parent binding so a membership id belonging to
   * another Pack version can never be removed through this address.
   */
  async removeMember(packId, versionId, membershipId) {
    const conn = await getConnection();
    try {
      const versionRows = await conn.query(
        'SELECT id, lifecycle_state FROM knowledge_pack_versions WHERE id = ? AND knowledge_pack_id = ?',
        [versionId, packId]
      );
      const version = versionRows[0];
      if (!version) {
        throw new PackNotFoundError('Knowledge pack version not found');
      }
      if (!PRE_PUBLICATION_PACK_STATES.includes(version.lifecycle_state)) {
        throw new PackConflictError(
          `Membership is frozen once a knowledge pack version is released (current lifecycle state is ${version.lifecycle_state})`,
          'PACK_MEMBERSHIP_FROZEN'
        );
      }

      const rows = await conn.query(
        `DELETE FROM knowledge_pack_version_task_template_versions
          WHERE id = ? AND knowledge_pack_version_id = ?
          RETURNING id`,
        [membershipId, versionId]
      );
      if (!rows[0]) {
        throw new PackNotFoundError('Knowledge pack membership not found');
      }

      await conn.commit();
      return rows[0].id;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  // -------------------------------------------------------------- publication

  /**
   * Publish a Pack version through the governed admission boundary.
   *
   * One transaction, in this order:
   *   1. lock the Pack version row FOR UPDATE — no membership mutation can be
   *      in flight or commit between this point and the transition, because
   *      migration 015's guard takes FOR SHARE on this same row;
   *   2. read the module's composition, unvalidated, so a missing member is
   *      visible as a failure rather than silently absent;
   *   3. run the admission gate over the locked row and that composition;
   *   4. write publisher, publication time and lifecycle state together.
   *
   * The gate fails closed with every reason it found, and nothing is written.
   */
  async publishVersion(packId, versionId, publisherUserId) {
    const conn = await getConnection();
    try {
      // 1. Serialize against membership mutation and any concurrent publication.
      const lockedRows = await conn.query(
        `SELECT * FROM knowledge_pack_versions
          WHERE id = ? AND knowledge_pack_id = ?
          FOR UPDATE`,
        [versionId, packId]
      );
      const packVersion = lockedRows[0];
      if (!packVersion) {
        // The admission gate is still made to speak, so an unreachable Pack
        // version is reported through the same contract as every other refusal.
        throw new PackAdmissionError(
          validatePublicationAdmission({ packVersion: null, members: [], publisherUserId })
        );
      }

      // 2. Read the composition that this locked row protects. LEFT JOINs are
      // deliberate: a member whose version is unreachable must appear as an
      // explicit MEMBER_VERSION_NOT_FOUND failure, never vanish from the count.
      const members = await conn.query(
        `SELECT m.id AS membership_id,
                m.task_template_version_id,
                v.lifecycle_state_at_publish,
                v.template_name,
                t.organization_id
           FROM knowledge_pack_version_task_template_versions m
           LEFT JOIN task_template_versions v ON v.id = m.task_template_version_id
           LEFT JOIN task_templates t ON t.id = v.task_template_id
          WHERE m.knowledge_pack_version_id = ?
          ORDER BY m.id`,
        [versionId]
      );

      // 3. Governed admission gate.
      const failures = validatePublicationAdmission({ packVersion, members, publisherUserId });
      if (failures.length) {
        throw new PackAdmissionError(failures);
      }

      // 4. Publisher attribution, publication time and state, written together.
      // Post-publication backfill of publisher identity is impossible: after
      // this transition migration 009 permits no content change, and migration
      // 015 requires the publisher to be present for a governed state.
      const updated = await conn.query(
        `UPDATE knowledge_pack_versions
            SET lifecycle_state = 'published',
                published_at = NOW(),
                published_by_user_id = ?
          WHERE id = ? AND knowledge_pack_id = ? AND lifecycle_state = 'approved'
          RETURNING id`,
        [publisherUserId, versionId, packId]
      );
      if (!updated[0]) {
        // The row was approved when it was locked, so this can only mean the
        // locked state changed underneath the transaction: refuse rather than
        // claim a publication that did not happen exactly as admitted.
        throw new PackConflictError(
          'Knowledge pack version changed state during publication',
          'PACK_PUBLICATION_RACE'
        );
      }

      await conn.commit();
      return this.findVersionById(updated[0].id);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  update = refuseMutation('KnowledgePackVersion.update',
    'a governed pack version transitions through its lifecycle, and is immutable once published');
  delete = refuseMutation('KnowledgePackVersion.delete',
    'a governed pack version is a historical record and is never deleted');
}

// Exported as instances, following task-template.model.js (the closest analog: a
// model the controllers consume directly). The classes are exported alongside so
// the boundary they refuse can be inspected without constructing one.
module.exports = {
  KnowledgePack: new KnowledgePack(),
  KnowledgePackVersion: new KnowledgePackVersion(),
  KnowledgePackModel: KnowledgePack,
  KnowledgePackVersionModel: KnowledgePackVersion
};
