/**
 * Knowledge Provenance Routes
 *
 * ATM-001 M3 — governed provenance authoring.
 *
 * This is the minimum product-level capability needed to satisfy the evidence
 * contract M1 already enforces at publication time. It is provenance AUTHORING
 * only: no document upload, no file storage, no ingestion pipeline, no search,
 * and no Knowledge Pack surface.
 *
 * Authorization
 * -------------
 * Writes reuse the repository's existing capability model rather than adding a
 * new one:
 *   TASKS.CREATE  creating a new knowledge source identity (authoring knowledge)
 *   TASKS.UPDATE  creating a source version, and attaching/detaching WORKING evidence
 * Both are admin-only in src/config/permissions.js, so this path is narrower
 * than the existing task-template routes, which use requireAdmin
 * (admin + supervisor). Nothing is granted to generic authenticated users.
 *
 * Reads reuse KNOWLEDGE.VIEW, consistent with how knowledge is already readable.
 *
 * No route in this file can reach frozen published evidence
 * (knowledge_template_version_evidence).
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const provenanceController = require('../controllers/knowledge-provenance.controller');

// All routes require authentication.
router.use(authenticate);

/**
 * @route   POST /api/knowledge-provenance/sources
 * @desc    Create a tenant-scoped knowledge source identity
 * @access  Private (TASKS.CREATE)
 */
router.post('/sources', requirePermission('TASKS', 'CREATE'), provenanceController.createSource);

/**
 * @route   GET /api/knowledge-provenance/sources
 * @desc    List knowledge sources visible to the caller's tenant scope
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/sources', requirePermission('KNOWLEDGE', 'VIEW'), provenanceController.listSources);

/**
 * @route   POST /api/knowledge-provenance/sources/:id/versions
 * @desc    Create an immutable source version
 * @access  Private (TASKS.UPDATE)
 */
router.post('/sources/:id/versions', requirePermission('TASKS', 'UPDATE'), provenanceController.createSourceVersion);

/**
 * @route   GET /api/knowledge-provenance/sources/:id/versions
 * @desc    List the immutable versions of a source
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/sources/:id/versions', requirePermission('KNOWLEDGE', 'VIEW'), provenanceController.listSourceVersions);

/**
 * @route   GET /api/knowledge-provenance/templates/:templateId/evidence
 * @desc    List WORKING evidence attached to a working task template
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/templates/:templateId/evidence', requirePermission('KNOWLEDGE', 'VIEW'), provenanceController.listWorkingEvidence);

/**
 * @route   POST /api/knowledge-provenance/templates/:templateId/evidence
 * @desc    Attach an immutable source version as WORKING evidence
 * @access  Private (TASKS.UPDATE)
 */
router.post('/templates/:templateId/evidence', requirePermission('TASKS', 'UPDATE'), provenanceController.attachEvidence);

/**
 * @route   DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId
 * @desc    Detach WORKING evidence (frozen evidence is unreachable here)
 * @access  Private (TASKS.UPDATE)
 */
router.delete('/templates/:templateId/evidence/:evidenceId', requirePermission('TASKS', 'UPDATE'), provenanceController.detachEvidence);

module.exports = router;
