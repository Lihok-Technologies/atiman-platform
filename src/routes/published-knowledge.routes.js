/**
 * Published Knowledge Resolution Routes (ATM-001-KF-04A)
 *
 * Read-only. Operational consumers resolve an IMMUTABLE PUBLISHED task-template
 * version — never a working definition and never a draft.
 *
 * Authorization: `KNOWLEDGE.VIEW` (the existing read matrix: admin, supervisor,
 * operator), the same guard the other knowledge read surfaces use. No new
 * capability and no bundle change is introduced.
 *
 * Tenant scope is derived from the authenticated principal inside the service;
 * it is never read from the body or the query string.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const controller = require('../controllers/published-knowledge.controller');

// All routes require authentication.
router.use(authenticate);

/**
 * @route   GET /api/knowledge-published/versions/:versionId
 * @desc    Resolve one explicit immutable PUBLISHED version with its frozen
 *          steps, safety controls, applicability and provenance evidence
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/versions/:versionId', requirePermission('KNOWLEDGE', 'VIEW'), controller.getVersion);

/**
 * @route   GET /api/knowledge-published/templates/:templateId/versions
 * @desc    List the published, sealed versions of a definition for EXPLICIT
 *          selection (never an implicit "current" choice)
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get(
  '/templates/:templateId/versions',
  requirePermission('KNOWLEDGE', 'VIEW'),
  controller.listVersionsForTemplate
);

/**
 * @route   GET /api/knowledge-published/equipment-types/:equipmentTypeId/versions
 * @desc    List published, sealed versions whose frozen applicability covers an
 *          Equipment Type (discovery; the frozen applicability is returned
 *          verbatim and is never inferred)
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get(
  '/equipment-types/:equipmentTypeId/versions',
  requirePermission('KNOWLEDGE', 'VIEW'),
  controller.listVersionsForEquipmentType
);

module.exports = router;
