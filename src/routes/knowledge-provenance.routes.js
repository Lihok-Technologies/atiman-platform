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
 * Writes require the capability `knowledge.author`. M3 authored these routes and
 * recorded the authority question as a KNOWN INCONSISTENCY rather than silently
 * resolving it:
 *
 *   "task-template authoring routes use requireAdmin (admin + supervisor) while
 *    this path uses the stricter admin-only capability. Aligning them is a
 *    separate decision."
 *
 * ATM-001-K3 is that separate decision. M3's own rationale fixes the capability:
 * "provenance authoring is an act of authoring working maintenance knowledge,
 * which is what the TASKS authoring capabilities already govern" — and
 * `knowledge.author` is the accountable capability for authoring working
 * knowledge (ATM-003-R1 §3.1: "Create and edit a draft definition"; `created_by`;
 * draft-only). M3 explicitly refused a new capability ("not a new governance
 * vocabulary"), so no accession-specific capability is introduced here.
 *
 * Consequence, stated rather than left to be inferred: a principal holding
 * `knowledge.author` may now reach this entry point. Under the legacy
 * compatibility bundles that is admin and supervisor, so the supervisor gains
 * these four routes and the operator does not; under EXPLICIT_GRANTS the grant is
 * the authority. Nothing here confers knowledge.review, knowledge.approve,
 * knowledge.safety_review or knowledge.publish, and the evidence separation of
 * duties is unchanged.
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
const { requireCapability } = require('../middleware/capability.middleware');
const provenanceController = require('../controllers/knowledge-provenance.controller');

// All routes require authentication.
router.use(authenticate);

/**
 * @route   POST /api/knowledge-provenance/sources
 * @desc    Create a tenant-scoped knowledge source identity
 * @access  Private (knowledge.author)
 */
router.post('/sources', requireCapability('knowledge.author'), provenanceController.createSource);

/**
 * @route   GET /api/knowledge-provenance/sources
 * @desc    List knowledge sources visible to the caller's tenant scope
 * @access  Private (KNOWLEDGE.VIEW)
 */
router.get('/sources', requirePermission('KNOWLEDGE', 'VIEW'), provenanceController.listSources);

/**
 * @route   POST /api/knowledge-provenance/sources/:id/versions
 * @desc    Create an immutable source version
 * @access  Private (knowledge.author)
 */
router.post('/sources/:id/versions', requireCapability('knowledge.author'), provenanceController.createSourceVersion);

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
 * @access  Private (knowledge.author)
 */
router.post('/templates/:templateId/evidence', requireCapability('knowledge.author'), provenanceController.attachEvidence);

/**
 * @route   DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId
 * @desc    Detach WORKING evidence (frozen evidence is unreachable here)
 * @access  Private (knowledge.author)
 */
router.delete('/templates/:templateId/evidence/:evidenceId', requireCapability('knowledge.author'), provenanceController.detachEvidence);

module.exports = router;
