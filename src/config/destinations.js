/**
 * Atiman work destinations (ATM-002-R2 §2).
 *
 * A destination is admitted only if it answers a distinct user objective AND a
 * truthful surface exists for it today. This registry is the single place that
 * decides what the shell may present, so no role and no route list can leak into
 * navigation.
 *
 * `available: false` means the destination is approved architecture but has no
 * truthful implementation yet. Those are NOT rendered: a navigation item that
 * leads to a mock, to a work-order-scoped legacy screen, or nowhere would
 * misrepresent the product (ATM-002-R2 §2, mission §8).
 *
 * `capability: null` means the destination requires an authenticated principal
 * and nothing more — reading is not an accountable act in the ATM-003-R1
 * capability model (ATM-003 milestone 3, KNOWLEDGE.VIEW → authenticated-only).
 */

// `REPORT` was removed in ATM-002-I2E: observation capture is implemented, so a
// reason for Report being unavailable no longer exists and leaving one here would
// be a false statement inside the source of truth for availability.
const UNAVAILABLE = Object.freeze({
  INSPECT: 'inspection execution is not implemented',
  ASSESS: 'finding assessment is not implemented',
  MONITOR: 'monitoring is not implemented',
  ESCALATE: 'escalation is not implemented'
});

const DESTINATIONS = Object.freeze([
  Object.freeze({
    id: 'today',
    label: 'Today',
    href: '/today',
    capability: null,
    available: true,
    canonicalEntry: true
  }),
  Object.freeze({
    id: 'inspect',
    label: 'Inspect',
    href: null,
    capability: 'inspection.execute',
    available: false,
    unavailableReason: UNAVAILABLE.INSPECT
  }),
  Object.freeze({
    id: 'report',
    label: 'Report',
    // ATM-002-I2E: observation capture is implemented, so Report is a real
    // destination. It records an observation and nothing else — no Finding, no
    // outcome, no work order. Availability is still evaluated before capability,
    // so enabling it here cannot surface it to a principal who does not hold
    // `finding.report`.
    href: '/atiman/report',
    capability: 'finding.report',
    available: true
  }),
  Object.freeze({
    id: 'assess',
    label: 'Assess',
    href: null,
    capability: 'finding.assess',
    available: false,
    unavailableReason: UNAVAILABLE.ASSESS
  }),
  Object.freeze({
    id: 'monitor',
    label: 'Monitor',
    href: null,
    capability: 'finding.monitor',
    available: false,
    unavailableReason: UNAVAILABLE.MONITOR
  }),
  Object.freeze({
    id: 'escalate',
    label: 'Escalate',
    href: null,
    capability: 'escalation.approve',
    available: false,
    unavailableReason: UNAVAILABLE.ESCALATE
  }),
  Object.freeze({
    id: 'knowledge',
    label: 'Knowledge',
    // Transitional: the governed Knowledge experience is ATM-002-R6 and is not
    // built. This points at the existing truthful template list and is labelled
    // transitional so it is not mistaken for the finished experience.
    href: '/mobile/templates',
    capability: null,
    available: true,
    transitional: true
  })
]);

/**
 * Compose the work navigation for a principal.
 *
 * Server-side, from the authoritative capability set. A destination appears only
 * when it is available AND its capability (if any) is held.
 *
 * @param {Set<string>} capabilities - resolved capabilities for the principal
 * @returns {Array<Object>} destinations, registry order, no duplicates
 */
function composeWorkNavigation(capabilities = new Set()) {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return DESTINATIONS.filter((destination) => {
    if (!destination.available) return false;
    if (destination.capability === null) return true;
    return held.has(destination.capability);
  });
}

/** Destinations deliberately withheld, for reporting and tests. */
function withheldDestinations(capabilities = new Set()) {
  const held = capabilities instanceof Set ? capabilities : new Set(capabilities);
  return DESTINATIONS.filter((destination) => {
    if (!destination.available) return true;
    return destination.capability !== null && !held.has(destination.capability);
  });
}

module.exports = { DESTINATIONS, composeWorkNavigation, withheldDestinations };
