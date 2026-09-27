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
 * Legacy-role compatibility bundles — PARITY VERIFIED (milestone 4).
 *
 * These exist so existing users keep working while explicit grants become the
 * authority. A bundle applies ONLY when the principal holds no active explicit
 * grant, and every entry below was verified against the authority that role
 * actually had BEFORE the capability model existed:
 *
 *   src/config/permissions.js (resource/action matrix) and the guards on the
 *   routes that enforce it. The per-capability evidence, including where parity
 *   was impossible and the less-privileged mapping was chosen, is recorded in
 *   docs/architecture/ATM-003-R3-Compatibility-Parity-Register.md.
 *
 * Deliberately in NO bundle:
 *   platform.admin, knowledge.taxonomy_admin, integration.service
 *     — never human-grantable in V1.
 *   knowledge.legacy_clearance
 *     — no route enforces it, so no role could perform it; granting it through
 *       compatibility would pre-authorise a future capability. Explicit grant
 *       required.
 *
 * A bundle is an explicit enumeration, never a wildcard: a capability added to
 * the vocabulary later is NOT silently granted to any legacy role.
 */
const LEGACY_COMPATIBILITY_BUNDLES = Object.freeze({
  // Parity: INSPECTIONS.SUBMIT (supervisor=all, operator=all, ADMIN=NONE) and
  // FINDINGS.CREATE (all three roles).
  operator: Object.freeze([
    CAPABILITIES.INSPECTION_EXECUTE,
    CAPABILITIES.FINDING_REPORT
  ]),

  // Parity: inspection execution (INSPECTIONS.SUBMIT), finding reporting
  // (FINDINGS.CREATE), knowledge authoring and lifecycle (create/update were
  // guarded by requireAdmin = admin OR supervisor; submit/review/approve/
  // safety-review by the KNOWLEDGE matrix where supervisor=all), publication
  // (requireAdmin), finding management (FINDINGS.MANAGE, supervisor=all, mapped
  // to the finer assessment/monitoring/closure/escalation capabilities) and
  // inspection assignment (WORK_ORDERS.ASSIGN / INSPECTIONS.MANAGE_POINTS,
  // supervisor=all).
  supervisor: Object.freeze([
    CAPABILITIES.INSPECTION_EXECUTE,
    CAPABILITIES.FINDING_REPORT,
    CAPABILITIES.KNOWLEDGE_AUTHOR,
    CAPABILITIES.KNOWLEDGE_SUBMIT,
    CAPABILITIES.KNOWLEDGE_REVIEW,
    CAPABILITIES.KNOWLEDGE_APPROVE,
    CAPABILITIES.KNOWLEDGE_PUBLISH,
    CAPABILITIES.KNOWLEDGE_SAFETY_REVIEW,
    CAPABILITIES.FINDING_ASSESS,
    CAPABILITIES.FINDING_MONITOR,
    CAPABILITIES.FINDING_CLOSE,
    CAPABILITIES.ESCALATION_PREPARE,
    CAPABILITIES.ESCALATION_APPROVE,
    CAPABILITIES.INSPECTION_ASSIGN
  ]),

  // Everything the admin role could reach, minus the two entries recorded above.
  // Notably ABSENT: inspection.execute — INSPECTIONS.SUBMIT is `admin: none`
  // (the legacy application explicitly refuses to let an admin perform an
  // inspection), so granting it here would expand admin authority.
  admin: Object.freeze([
    CAPABILITIES.FINDING_REPORT,
    CAPABILITIES.FINDING_ASSESS,
    CAPABILITIES.FINDING_MONITOR,
    CAPABILITIES.FINDING_CLOSE,
    CAPABILITIES.ESCALATION_PREPARE,
    CAPABILITIES.ESCALATION_APPROVE,
    CAPABILITIES.INSPECTION_ASSIGN,
    CAPABILITIES.EVIDENCE_ATTACH,
    CAPABILITIES.KNOWLEDGE_AUTHOR,
    CAPABILITIES.KNOWLEDGE_SUBMIT,
    CAPABILITIES.KNOWLEDGE_REVIEW,
    CAPABILITIES.KNOWLEDGE_APPROVE,
    CAPABILITIES.KNOWLEDGE_PUBLISH,
    CAPABILITIES.KNOWLEDGE_SAFETY_REVIEW,
    CAPABILITIES.ORG_USER_ADMIN,
    CAPABILITIES.ORG_CONFIG_ADMIN
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
