/**
 * Finding Routes
 * ODM Findings / Defects with SAP catalog coding
 */

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const findingController = require('../controllers/finding.controller');
const findingAssessmentController = require('../controllers/finding-assessment.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/findings
 * @desc    Get all findings for organization
 * @access  Private
 */
router.get('/', requirePermission('FINDINGS', 'VIEW'), findingController.getAll);

/**
 * @route   GET /api/findings/stats
 * @desc    Get findings statistics
 * @access  Private
 */
router.get('/stats', requirePermission('FINDINGS', 'VIEW'), findingController.getStats);

/**
 * @route   GET /api/findings/search
 * @desc    Search findings
 * @access  Private
 */
router.get('/search', requirePermission('FINDINGS', 'VIEW'), findingController.search);

/**
 * @route   GET /api/findings/pending-sap
 * @desc    Get findings requiring SAP notification
 * @access  Private (Admin/Supervisor)
 */
router.get('/pending-sap', requirePermission('FINDINGS', 'MANAGE'), findingController.getPendingSapNotifications);

/**
 * @route   GET /api/findings/catalog-options/:equipmentClassId
 * @desc    Get SAP catalog options for finding creation
 * @access  Private
 */
router.get('/catalog-options/:equipmentClassId', requirePermission('FINDINGS', 'VIEW'), findingController.getCatalogOptions);

/**
 * @route   GET /api/findings/asset/:assetId
 * @desc    Get findings for a specific asset
 * @access  Private
 */
router.get('/asset/:assetId', requirePermission('FINDINGS', 'VIEW'), findingController.getByAsset);

/**
 * @route   GET /api/findings/assessments/queue
 * @desc    Findings awaiting an assessment decision (supervisor queue)
 * @access  Private
 *
 * Declared before /:id so the literal path is not captured as a finding id.
 */
router.get('/assessments/queue', requirePermission('FINDINGS', 'VIEW_ASSESSMENT'), findingAssessmentController.getAssessmentQueue);

/**
 * @route   POST /api/findings/assessments/:id/confirm
 * @desc    Confirm or override the recommended outcome (accountable decision)
 * @access  Private (Admin/Supervisor)
 */
router.post('/assessments/:id/confirm', requirePermission('FINDINGS', 'CONFIRM_OUTCOME'), findingAssessmentController.confirmAssessment);

/**
 * @route   POST /api/findings/assessments/:id/reject
 * @desc    Reject an assessment (reason required)
 * @access  Private (Admin/Supervisor)
 */
router.post('/assessments/:id/reject', requirePermission('FINDINGS', 'CONFIRM_OUTCOME'), findingAssessmentController.rejectAssessment);

/**
 * @route   POST /api/findings/assessments/:id/request-evidence
 * @desc    Request more evidence before deciding
 * @access  Private (Admin/Supervisor)
 */
router.post('/assessments/:id/request-evidence', requirePermission('FINDINGS', 'CONFIRM_OUTCOME'), findingAssessmentController.requestMoreEvidence);

/**
 * @route   GET /api/findings/:id
 * @desc    Get finding details
 * @access  Private
 */
router.get('/:id', requirePermission('FINDINGS', 'VIEW'), findingController.getById);

/**
 * @route   GET /api/findings/:id/assessments
 * @desc    Assessment history for a finding
 * @access  Private
 */
router.get('/:id/assessments', requirePermission('FINDINGS', 'VIEW_ASSESSMENT'), findingAssessmentController.getAssessmentHistory);

/**
 * @route   POST /api/findings/:id/assessments
 * @desc    Record a recommended outcome, opening an assessment
 * @access  Private (Operator and above)
 */
router.post('/:id/assessments', requirePermission('FINDINGS', 'RECOMMEND_OUTCOME'), findingAssessmentController.openAssessment);

/**
 * @route   POST /api/findings
 * @desc    Create a new finding
 * @access  Private (Operator and above)
 */
router.post('/', requirePermission('FINDINGS', 'CREATE'), findingController.create);

/**
 * @route   PATCH /api/findings/:id/sap-notification
 * @desc    Link SAP notification to finding
 * @access  Private (Admin/Supervisor)
 */
router.patch('/:id/sap-notification', requirePermission('FINDINGS', 'MANAGE'), findingController.linkSapNotification);

/**
 * @route   PATCH /api/findings/:id/status
 * @desc    Update finding status
 * @access  Private (Admin/Supervisor)
 */
router.patch('/:id/status', requirePermission('FINDINGS', 'MANAGE'), findingController.updateStatus);

module.exports = router;
