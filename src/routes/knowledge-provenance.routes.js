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
 * The four mutation routes are split across two accountable capabilities, as
 * OWNER-approved by ATM-001-K3-G2
 * (docs/architecture/ATM-001-K3-G2-Knowledge-Provenance-Authorization-Mapping.md):
 *
 *   knowledge.author   POST /sources
 *                      POST /sources/:id/versions
 *     Authoring a provenance source identity and its immutable editions. The
 *     accountable act is "Create and edit a draft definition" (ATM-003-R1 §3.1),
 *     enforced by `created_by` — here knowledge_sources.created_by_user_id and
 *     knowledge_source_versions.created_by_user_id.
 *
 *   evidence.attach    POST /templates/:templateId/evidence
 *                      DELETE /templates/:templateId/evidence/:evidenceId
 *     Attaching and detaching provenance evidence (a citation of an immutable
 *     source version) on a working definition or step. The accountable act is
 *     "Attach provenance evidence to a definition or step" (ATM-003-R1 §3.1),
 *     enforced by `added_by_user_id` — here
 *     knowledge_template_evidence.added_by_user_id. Detachment is the inverse of
 *     that act, and M3 models correction as detach-then-attach; both routes were
 *     guarded by TASKS.UPDATE before the capability model existed.
 *
 * How this mapping was reached. M3 authored these routes under the admin-only
 * TASKS.CREATE/TASKS.UPDATE matrix and recorded the authority question as a KNOWN
 * INCONSISTENCY rather than silently resolving it. ATM-001-K3 (commit 3aa5bbd)
 * answered it by placing all four routes under `knowledge.author`; that gave every
 * principal holding `knowledge.author` — including the legacy supervisor bundle,
 * which deliberately excludes `evidence.attach` (ATM-003-R3 §3/§4, under the OWNER
 * adjudication of 2026-09-27 §7) — the ability to attach provenance evidence.
 * ATM-001-K3-G2 reconciles the seam with ATM-003-R1 §3.1's two accountable acts
 * and two attribution columns, and with the ATM-003-R3 less-privileged mapping.
 *
 * Capability bundles are unchanged. A principal who must both author provenance
 * and cite it holds both capabilities through explicit grants (ATM-003-R3 §4:
 * "Explicit grant of `evidence.attach`"); `evidence.attach` is in the V1
 * human-grantable set. Nothing here confers knowledge.review, knowledge.approve,
 * knowledge.safety_review or knowledge.publish, and the evidence separation of
 * duties is unchanged. Capability guards answer who may attempt an act; they
 * never make a global source writable — the model's tenant write predicate
 * refuses that independently (ATM-001-K3-R1).
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
 * @access  Private (evidence.attach)
 */
router.post('/templates/:templateId/evidence', requireCapability('evidence.attach'), provenanceController.attachEvidence);

/**
 * @route   DELETE /api/knowledge-provenance/templates/:templateId/evidence/:evidenceId
 * @desc    Detach WORKING evidence (frozen evidence is unreachable here)
 * @access  Private (evidence.attach)
 */
router.delete('/templates/:templateId/evidence/:evidenceId', requireCapability('evidence.attach'), provenanceController.detachEvidence);

module.exports = router;
