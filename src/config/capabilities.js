/**
 * ATM-003 capability vocabulary, resolution modes and legacy compatibility
 * bundles.
 *
 * Source of authority:
 *   docs/architecture/ATM-003-R1-Role-Capability-Architecture.md (21 capabilities,
 *   six launch profiles, separation-of-duties decisions)
 *   OWNER adjudication 2026-09-27 (V1 human-grantable subset; platform.admin,
 *   knowledge.taxonomy_admin and integration.service are NOT human-grantable)
 *
 * This module contains no authorization decisions. It is vocabulary and mapping
 * only; the resolver in services/capability.service.js applies it, and the
 * authorization primitive in middleware consumes the resolver.
 */

/** The 21 capabilities the architecture recognises. */
const CAPABILITIES = Object.freeze({
  // knowledge governance
  KNOWLEDGE_AUTHOR: 'knowledge.author',
  KNOWLEDGE_SUBMIT: 'knowledge.submit',
  KNOWLEDGE_REVIEW: 'knowledge.review',
  KNOWLEDGE_APPROVE: 'knowledge.approve',
  KNOWLEDGE_PUBLISH: 'knowledge.publish',
  KNOWLEDGE_SAFETY_REVIEW: 'knowledge.safety_review',
  KNOWLEDGE_LEGACY_CLEARANCE: 'knowledge.legacy_clearance',
  EVIDENCE_ATTACH: 'evidence.attach',
  // inspection and findings
  INSPECTION_EXECUTE: 'inspection.execute',
  INSPECTION_ASSIGN: 'inspection.assign',
  FINDING_REPORT: 'finding.report',
  FINDING_ASSESS: 'finding.assess',
  FINDING_MONITOR: 'finding.monitor',
  FINDING_CLOSE: 'finding.close',
  ESCALATION_PREPARE: 'escalation.prepare',
  ESCALATION_APPROVE: 'escalation.approve',
  // organization administration
  ORG_USER_ADMIN: 'org.user_admin',
  ORG_CONFIG_ADMIN: 'org.config_admin',
  // recognised but not human-grantable in V1
  PLATFORM_ADMIN: 'platform.admin',
  KNOWLEDGE_TAXONOMY_ADMIN: 'knowledge.taxonomy_admin',
  INTEGRATION_SERVICE: 'integration.service'
});

/**
 * Capabilities that may be granted to a human principal in V1.
 *
 * Must stay identical to the CHECK constraint in migration 022
 * (chk_user_capabilities_grantable); the resolver and the schema are two
 * independent gates on the same set.
 */
const V1_HUMAN_GRANTABLE = Object.freeze([
  CAPABILITIES.KNOWLEDGE_AUTHOR, CAPABILITIES.KNOWLEDGE_SUBMIT,
  CAPABILITIES.KNOWLEDGE_REVIEW, CAPABILITIES.KNOWLEDGE_APPROVE,
  CAPABILITIES.KNOWLEDGE_PUBLISH, CAPABILITIES.KNOWLEDGE_SAFETY_REVIEW,
  CAPABILITIES.KNOWLEDGE_LEGACY_CLEARANCE, CAPABILITIES.EVIDENCE_ATTACH,
  CAPABILITIES.INSPECTION_EXECUTE, CAPABILITIES.INSPECTION_ASSIGN,
  CAPABILITIES.FINDING_REPORT, CAPABILITIES.FINDING_ASSESS,
  CAPABILITIES.FINDING_MONITOR, CAPABILITIES.FINDING_CLOSE,
  CAPABILITIES.ESCALATION_PREPARE, CAPABILITIES.ESCALATION_APPROVE,
  CAPABILITIES.ORG_USER_ADMIN, CAPABILITIES.ORG_CONFIG_ADMIN
]);

/**
 * Recognised by the architecture, deliberately never granted to a human:
 *   platform.admin           — no platform-scoped principal is authorised in V1;
 *                              future ATM-003 Platform Operations Authority.
 *   knowledge.taxonomy_admin — ATM-001 created no OWNER governance authorization.
 *   integration.service      — machine authority stays on the API-key path.
 * These are filtered out defensively by the resolver even if a row exists.
 */
const NON_HUMAN_GRANTABLE = Object.freeze([
  CAPABILITIES.PLATFORM_ADMIN,
  CAPABILITIES.KNOWLEDGE_TAXONOMY_ADMIN,
  CAPABILITIES.INTEGRATION_SERVICE
]);

/** A principal resolves in exactly one mode. There is no third state and no union. */
const RESOLUTION_MODES = Object.freeze({
  EXPLICIT_GRANTS: 'EXPLICIT_GRANTS',
  LEGACY_COMPATIBILITY: 'LEGACY_COMPATIBILITY'
});

/**
 * Legacy-role compatibility bundles.
 *
 * These exist so that existing users keep working while explicit grants become
 * the authority. A bundle is applied ONLY when the user has no active explicit
 * grant, and it must never exceed the authority that role had before the
 * capability model existed — see the parity record in the milestone 4 register.
 *
 * Deliberately absent from every bundle:
 *   platform.admin, knowledge.taxonomy_admin, integration.service.
 *
 * `knowledge.publish` is present for admin and supervisor because both could
 * publish through the existing requireAdmin seam before this campaign, and
 * removing it would be a compatibility regression rather than a safety gain.
 * `knowledge.legacy_clearance` is present for admin only, matching the
 * administrative act of clearing legacy content; it is not reachable by
 * supervisor or operator today.
 */
const LEGACY_COMPATIBILITY_BUNDLES = Object.freeze({
  operator: Object.freeze([
    CAPABILITIES.INSPECTION_EXECUTE,
    CAPABILITIES.FINDING_REPORT,
    CAPABILITIES.EVIDENCE_ATTACH
  ]),
  supervisor: Object.freeze([
    CAPABILITIES.INSPECTION_EXECUTE,
    CAPABILITIES.FINDING_REPORT,
    CAPABILITIES.EVIDENCE_ATTACH,
    CAPABILITIES.FINDING_ASSESS,
    CAPABILITIES.FINDING_MONITOR,
    CAPABILITIES.FINDING_CLOSE,
    CAPABILITIES.ESCALATION_PREPARE,
    CAPABILITIES.ESCALATION_APPROVE,
    CAPABILITIES.INSPECTION_ASSIGN,
    CAPABILITIES.KNOWLEDGE_REVIEW,
    CAPABILITIES.KNOWLEDGE_APPROVE,
    CAPABILITIES.KNOWLEDGE_PUBLISH,
    CAPABILITIES.KNOWLEDGE_SAFETY_REVIEW
  ]),
  admin: Object.freeze([
    CAPABILITIES.INSPECTION_EXECUTE, CAPABILITIES.INSPECTION_ASSIGN,
    CAPABILITIES.FINDING_REPORT, CAPABILITIES.FINDING_ASSESS,
    CAPABILITIES.FINDING_MONITOR, CAPABILITIES.FINDING_CLOSE,
    CAPABILITIES.ESCALATION_PREPARE, CAPABILITIES.ESCALATION_APPROVE,
    CAPABILITIES.EVIDENCE_ATTACH,
    CAPABILITIES.KNOWLEDGE_AUTHOR, CAPABILITIES.KNOWLEDGE_SUBMIT,
    CAPABILITIES.KNOWLEDGE_REVIEW, CAPABILITIES.KNOWLEDGE_APPROVE,
    CAPABILITIES.KNOWLEDGE_PUBLISH, CAPABILITIES.KNOWLEDGE_SAFETY_REVIEW,
    CAPABILITIES.KNOWLEDGE_LEGACY_CLEARANCE,
    CAPABILITIES.ORG_USER_ADMIN, CAPABILITIES.ORG_CONFIG_ADMIN
  ])
});

const isGrantable = (capability) => V1_HUMAN_GRANTABLE.includes(capability);

module.exports = {
  CAPABILITIES,
  V1_HUMAN_GRANTABLE,
  NON_HUMAN_GRANTABLE,
  RESOLUTION_MODES,
  LEGACY_COMPATIBILITY_BUNDLES,
  isGrantable
};
