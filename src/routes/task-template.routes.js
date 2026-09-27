/**
 * Task Template Routes
 * ISO 14224-aligned maintenance task templates
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requireCapability } = require('../middleware/capability.middleware');
const taskTemplateController = require('../controllers/task-template.controller');

// All routes require authentication
router.use(authenticate);

/**
 * ATM-003 milestone 6 — capability authorization for the governed knowledge
 * lifecycle (proof integration).
 *
 * WHO MAY ATTEMPT is now answered by capabilities; WHETHER THE OPERATION IS VALID
 * remains entirely with the ATM-001 domain services behind these handlers
 * (approval state machine, publication admission, safety attestation,
 * separation of duties, immutability). No business rule was moved or duplicated.
 *
 * Effective authority is unchanged for every legacy role: each mapping below was
 * verified against the guard it replaces, and the parity is asserted by
 * tests/capability-grants.test.js (see the proof-integration block).
 *
 * Deliberately NOT migrated: GET /stats keeps requireAdmin. There is no
 * accountable act behind reading aggregate statistics, so no capability exists
 * for it; mapping it to an authenticated-only read would WIDEN access to
 * operators, which the parity rule forbids.
 */

/**
 * @route   GET /api/task-templates
 * @desc    Get all task templates
 * @access  Private
 */
router.get('/', taskTemplateController.getAll);

/**
 * @route   GET /api/task-templates/stats
 * @desc    Get task template statistics
 * @access  Private (Admin/Supervisor)
 */
router.get('/stats', requireAdmin, taskTemplateController.getStats);

/**
 * @route   GET /api/task-templates/search
 * @desc    Search task templates
 * @access  Private
 */
router.get('/search', taskTemplateController.search);

/**
 * @route   GET /api/task-templates/task-kinds
 * @desc    Get available task kinds
 * @access  Private
 */
router.get('/task-kinds', taskTemplateController.getTaskKinds);

/**
 * @route   GET /api/task-templates/equipment-type/:equipmentTypeId
 * @desc    Get templates by equipment type
 * @access  Private
 */
router.get('/equipment-type/:equipmentTypeId', taskTemplateController.getByEquipmentType);

/**
 * @route   GET /api/task-templates/for-asset/:assetId
 * @desc    Get applicable templates for an asset
 * @access  Private
 */
router.get('/for-asset/:assetId', taskTemplateController.getForAsset);

/**
 * @route   GET /api/task-templates/:id
 * @desc    Get task template details
 * @access  Private
 */
router.get('/:id', taskTemplateController.getById);

/**
 * @route   POST /api/task-templates/:id/clone
 * @desc    Clone a system template to organization
 * @access  Private (Admin/Supervisor)
 */
router.post('/:id/clone', requireCapability('knowledge.author'), taskTemplateController.clone);

/**
 * @route   POST /api/task-templates
 * @desc    Create new task template
 * @access  Private (Admin/Supervisor)
 */
router.post('/', requireCapability('knowledge.author'), taskTemplateController.create);

/**
 * @route   PUT /api/task-templates/:id
 * @desc    Update task template
 * @access  Private (Admin/Supervisor)
 */
router.put('/:id', requireCapability('knowledge.author'), taskTemplateController.update);

/**
 * @route   DELETE /api/task-templates/:id
 * @desc    Delete task template
 * @access  Private (Admin/Supervisor)
 */
router.delete('/:id', requireCapability('knowledge.author'), taskTemplateController.remove);

/**
 * @route   POST /api/task-templates/:id/publish
 * @desc    Publish a working task template as an immutable version
 * @access  Private (Admin/Supervisor)
 */
router.post('/:id/publish', requireCapability('knowledge.publish'), taskTemplateController.publish);

/**
 * ATM-001 M1 — Knowledge Foundation governance lifecycle.
 *
 * Submission and review decisions require the KNOWLEDGE.REVIEW capability, the
 * accountable approval requires KNOWLEDGE.APPROVE, and the safety review
 * requires KNOWLEDGE.SAFETY_REVIEW. These are distinct from TASKS.CREATE/UPDATE:
 * being permitted to edit a template is not being accountable for approving it.
 */

/**
 * @route   POST /api/task-templates/:id/submit-for-review
 * @desc    Submit a draft template for governance review
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:id/submit-for-review', requireCapability('knowledge.review'), taskTemplateController.submitForReview);

/**
 * @route   POST /api/task-templates/:id/approve
 * @desc    Approve a template under review (binds approval to its content)
 * @access  Private (KNOWLEDGE.APPROVE)
 */
router.post('/:id/approve', requireCapability('knowledge.approve'), taskTemplateController.approve);

/**
 * @route   POST /api/task-templates/:id/reject
 * @desc    Reject a template under review; a reason is required
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:id/reject', requireCapability('knowledge.review'), taskTemplateController.reject);

/**
 * @route   POST /api/task-templates/:id/reopen
 * @desc    Return a rejected template to draft for rework
 * @access  Private (KNOWLEDGE.REVIEW)
 */
router.post('/:id/reopen', requireCapability('knowledge.review'), taskTemplateController.reopenForRework);

/**
 * @route   POST /api/task-templates/:id/safety-review
 * @desc    Record an explicit safety review of the working template
 * @access  Private (KNOWLEDGE.SAFETY_REVIEW)
 */
router.post('/:id/safety-review', requireCapability('knowledge.safety_review'), taskTemplateController.recordSafetyReview);

module.exports = router;
