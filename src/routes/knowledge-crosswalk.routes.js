/**
 * Governed External Classification Crosswalk Routes
 *
 * ATM-001 M5R.3E — governed crosswalk application surface.
 *
 * This exposes the crosswalk knowledge accepted in M5R.3C and the evidence
 * accepted in M5R.3D. It adds no schema, no new capability and no new workflow
 * state.
 *
 * Authorization
 * -------------
 * Writes reuse the repository's EXISTING capability model, exactly as the
 * approved ADR section AC requires — no crosswalk-specific role, no parallel
 * RBAC system and no hard-coded admin check:
 *
 *   KNOWLEDGE.VIEW     reading crosswalks, history and evidence
 *                      (granted to all roles, matching existing knowledge reads)
 *   TASKS.UPDATE       proposing, editing a draft, attaching/detaching evidence
 *                      (admin-only, the same shape as M3 provenance authoring)
 *   KNOWLEDGE.REVIEW   submitting for review, reviewing and rejecting
 *   KNOWLEDGE.APPROVE  approving, and superseding a governed conclusion
 *
 * Every write route is a NAMED GOVERNED OPERATION. There is deliberately no
 * generic PUT/PATCH that could set review_state directly, and no route that can
 * reach the supersession pointer or the attribution columns: those move only
 * through the operations below.
 *
 * Relationship evidence only
 * --------------------------
 * These routes attach evidence to a CROSSWALK. Concept evidence (evidence about
 * an external classification) has no write surface here, because M5R.3 section P
 * keeps the two propositions separate and the approved API sketch exposes only
 * crosswalk-scoped evidence attachment. Concept evidence is readable and remains
 * distinct; it never satisfies the evidence-backed approval rule.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const crosswalkController = require('../controllers/knowledge-crosswalk.controller');

// All routes require authentication.
router.use(authenticate);

/**
 * @route   GET /api/knowledge-crosswalks?equipmentTypeId=&includeHistory=
 * @desc    List crosswalks for an Atiman equipment type (current truth, or with history)
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/', requirePermission('KNOWLEDGE', 'VIEW'), crosswalkController.listCrosswalks);

/**
 * @route   POST /api/knowledge-crosswalks
 * @desc    Propose a draft mapping or a draft NO_DIRECT_MAPPING conclusion
 * @access  Private (TASKS.UPDATE)
 */
router.post('/', requirePermission('TASKS', 'UPDATE'), crosswalkController.proposeCrosswalk);

/**
 * @route   GET /api/knowledge-crosswalks/:id
 * @desc    Read one crosswalk with its provenance and relationship evidence
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:id', requirePermission('KNOWLEDGE', 'VIEW'), crosswalkController.getCrosswalk);

/**
 * @route   GET /api/knowledge-crosswalks/:id/history
 * @desc    Walk the supersession chain; superseded knowledge is retained
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:id/history', requirePermission('KNOWLEDGE', 'VIEW'), crosswalkController.getCrosswalkHistory);

/**
 * @route   PATCH /api/knowledge-crosswalks/:id
 * @desc    Edit a DRAFT proposition (subject and investigated edition are fixed)
 * @access  Private (TASKS.UPDATE)
 */
router.patch('/:id', requirePermission('TASKS', 'UPDATE'), crosswalkController.updateDraftCrosswalk);

/**
 * @route   POST /api/knowledge-crosswalks/:id/submit
 * @desc    Submit a draft for review (draft -> under_review)
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:id/submit', requirePermission('KNOWLEDGE', 'REVIEW'), crosswalkController.submitCrosswalk);

/**
 * @route   POST /api/knowledge-crosswalks/:id/approve
 * @desc    Approve a crosswalk under review; refused without relationship evidence
 * @access  Private (KNOWLEDGE.APPROVE)
 */
router.post('/:id/approve', requirePermission('KNOWLEDGE', 'APPROVE'), crosswalkController.approveCrosswalk);

/**
 * @route   POST /api/knowledge-crosswalks/:id/reject
 * @desc    Reject a crosswalk under review; the rejected proposal is retained
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:id/reject', requirePermission('KNOWLEDGE', 'REVIEW'), crosswalkController.rejectCrosswalk);

/**
 * @route   POST /api/knowledge-crosswalks/:id/supersede
 * @desc    Link an APPROVED successor; the predecessor is retained with its evidence
 * @access  Private (KNOWLEDGE.APPROVE)
 */
router.post('/:id/supersede', requirePermission('KNOWLEDGE', 'APPROVE'), crosswalkController.supersedeCrosswalk);

/**
 * @route   GET /api/knowledge-crosswalks/:id/evidence
 * @desc    List the relationship evidence attached to this crosswalk
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/:id/evidence', requirePermission('KNOWLEDGE', 'VIEW'), crosswalkController.listEvidence);

/**
 * @route   POST /api/knowledge-crosswalks/:id/evidence
 * @desc    Attach relationship evidence to this crosswalk
 * @access  Private (TASKS.UPDATE)
 */
router.post('/:id/evidence', requirePermission('TASKS', 'UPDATE'), crosswalkController.attachEvidence);

/**
 * @route   DELETE /api/knowledge-crosswalks/:id/evidence/:evidenceId
 * @desc    Detach relationship evidence (refused once the crosswalk is approved)
 * @access  Private (TASKS.UPDATE)
 */
router.delete('/:id/evidence/:evidenceId', requirePermission('TASKS', 'UPDATE'), crosswalkController.detachEvidence);

module.exports = router;
