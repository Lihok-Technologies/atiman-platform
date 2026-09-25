/**
 * Knowledge Pack Routes
 *
 * ATM-001 M4 — governed Knowledge Pack authoring, composition, review, approval
 * and publication.
 *
 * This is the minimum governed application path M4 requires. It is deliberately
 * NOT a Pack product surface: there is no UI, no marketplace, no tenant
 * adoption or deployment, no import/export, no pack dependency or taxonomy
 * versioning, no search, and no candidate curation or publication.
 *
 * Authorization
 * -------------
 * Reuses the repository's existing capability model. No new framework, and no
 * capability is broadened. Nothing is granted to generic authenticated users:
 * every authoring capability below is admin-only in src/config/permissions.js.
 *
 *   TASKS.CREATE      creating a Knowledge Pack identity (authoring shared knowledge)
 *   TASKS.UPDATE      creating a pack version, and adding/removing membership
 *   KNOWLEDGE.REVIEW  submitting a pack version for review, and recording that review
 *   KNOWLEDGE.APPROVE approving a pack version
 *   requireAdmin      releasing a pack version (the M1 publication pattern)
 *   KNOWLEDGE.VIEW    reading packs, pack versions and membership
 *
 * Segregation of duties is expressed through these routes: the identity that
 * approves a pack version is not the identity that may publish it, and
 * migration 015 enforces the same rule in the database.
 *
 * An accountable act is always attributed to the authenticated principal
 * (req.user.id), never to a value supplied in the request body.
 *
 * Lifecycle exposed: draft -> under_review -> approved -> published.
 * `rejected` is deliberately not implemented, and no supersession or retirement
 * workflow is exposed; the schema continues to support those states.
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const packController = require('../controllers/knowledge-pack.controller');

// All routes require authentication.
router.use(authenticate);

/**
 * @route   POST /api/knowledge-packs
 * @desc    Create a Knowledge Pack identity
 * @access  Private (TASKS.CREATE)
 */
router.post('/', requirePermission('TASKS', 'CREATE'), packController.createPack);

/**
 * @route   GET /api/knowledge-packs
 * @desc    List Knowledge Packs
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/', requirePermission('KNOWLEDGE', 'VIEW'), packController.listPacks);

/**
 * @route   GET /api/knowledge-packs/:packId
 * @desc    Inspect a Knowledge Pack and its versions
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:packId', requirePermission('KNOWLEDGE', 'VIEW'), packController.getPack);

/**
 * @route   POST /api/knowledge-packs/:packId/versions
 * @desc    Create a new pack version in draft
 * @access  Private (TASKS.UPDATE)
 */
router.post('/:packId/versions', requirePermission('TASKS', 'UPDATE'), packController.createVersion);

/**
 * @route   GET /api/knowledge-packs/:packId/versions
 * @desc    List the versions of a Knowledge Pack
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:packId/versions', requirePermission('KNOWLEDGE', 'VIEW'), packController.listVersions);

/**
 * @route   GET /api/knowledge-packs/:packId/versions/:versionId
 * @desc    Inspect one pack version and its composition
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:packId/versions/:versionId', requirePermission('KNOWLEDGE', 'VIEW'), packController.getVersion);

/**
 * @route   GET /api/knowledge-packs/:packId/versions/:versionId/members
 * @desc    List the immutable published task template versions composing this pack version
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:packId/versions/:versionId/members',
  requirePermission('KNOWLEDGE', 'VIEW'), packController.listMembers);

/**
 * @route   POST /api/knowledge-packs/:packId/versions/:versionId/members
 * @desc    Add an immutable published task template version as a member
 * @access  Private (TASKS.UPDATE)
 */
router.post('/:packId/versions/:versionId/members',
  requirePermission('TASKS', 'UPDATE'), packController.addMember);

/**
 * @route   DELETE /api/knowledge-packs/:packId/versions/:versionId/members/:membershipId
 * @desc    Remove a member while the pack version is still mutable
 * @access  Private (TASKS.UPDATE)
 */
router.delete('/:packId/versions/:versionId/members/:membershipId',
  requirePermission('TASKS', 'UPDATE'), packController.removeMember);

/**
 * @route   POST /api/knowledge-packs/:packId/versions/:versionId/submit-for-review
 * @desc    Submit a draft pack version for review
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:packId/versions/:versionId/submit-for-review',
  requirePermission('KNOWLEDGE', 'REVIEW'), packController.submitForReview);

/**
 * @route   POST /api/knowledge-packs/:packId/versions/:versionId/review
 * @desc    Record the accountable review of an under_review pack version
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:packId/versions/:versionId/review',
  requirePermission('KNOWLEDGE', 'REVIEW'), packController.recordReview);

/**
 * @route   POST /api/knowledge-packs/:packId/versions/:versionId/approve
 * @desc    Approve a reviewed pack version
 * @access  Private (KNOWLEDGE.APPROVE)
 */
router.post('/:packId/versions/:versionId/approve',
  requirePermission('KNOWLEDGE', 'APPROVE'), packController.approveVersion);

/**
 * @route   POST /api/knowledge-packs/:packId/versions/:versionId/publish
 * @desc    Publish a pack version through the governed admission boundary
 * @access  Private (admin — the established M1 publication authorization)
 */
router.post('/:packId/versions/:versionId/publish', requireAdmin, packController.publishVersion);

module.exports = router;
