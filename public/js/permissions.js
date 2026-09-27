/**
 * Role display helpers (presentation only).
 *
 * ATM-003 milestone 5 removed this file's duplicated client-side authorization
 * matrix. The browser must never hold a copy of the authorization rules: it is
 * not an authorization boundary, and a duplicated matrix drifts from the server
 * silently. Measured before removal, that matrix had no consumer — its
 * `checkPermission`, `hasPermission` and `showIfPermitted` functions were loaded
 * by two pages and called by none.
 *
 * Capability-based presentation now comes from the capability descriptor:
 *   public/js/capabilities.js  ->  GET /api/users/me/capabilities
 *
 * What remains here are role *display* helpers used to label and organise the UI.
 * A role is NOT authority in the capability model: to decide whether to show a
 * control, use `window.atimanCapabilities.hasCapability(...)`, and remember that
 * showing or hiding a control never authorizes the operation — the server
 * authorizes it from the same resolver.
 */

let userRole = null;

/**
 * Get current user's role (display only).
 * @returns {string|null}
 */
function getUserRole() {
  if (userRole) return userRole;

  const bodyRole = document.body.getAttribute('data-user-role');
  if (bodyRole) {
    userRole = bodyRole;
    return userRole;
  }

  return null;
}

/**
 * Does the authenticated principal hold this capability?
 *
 * Delegates to the server-supplied descriptor. Presentation only, and fail-closed:
 * if the descriptor has not loaded or has failed, no capability is reported and
 * gated controls stay hidden. Forging this state in the browser authorizes nothing.
 */
function hasCapability(capability) {
  const descriptor = window.atimanCapabilities;
  return !!(descriptor && typeof descriptor.hasCapability === 'function'
    && descriptor.hasCapability(capability));
}

/** Role display helper. Not an authorization check. */
function isAdmin() {
  return getUserRole() === 'admin';
}

/** Role display helper. Not an authorization check. */
function isSupervisor() {
  const role = getUserRole();
  return role === 'admin' || role === 'supervisor';
}

/** Role display helper. Not an authorization check. */
function isOperator() {
  return getUserRole() === 'operator';
}

/**
 * @deprecated The client authorization matrix was removed in ATM-003 milestone 5.
 *
 * These are retained only as fail-closed no-ops so that a stale caller cannot
 * treat a removed matrix as a permissive default, and cannot show or hide a
 * control based on duplicated rules. Always reports none / false / does nothing.
 */
function checkPermission() { return 'none'; }

/** @deprecated see checkPermission. */
function hasPermission() { return false; }

/** @deprecated see checkPermission. */
function showIfPermitted() { /* no-op by design */ }

/** @deprecated see checkPermission. */
function disableIfNotPermitted() { /* no-op by design */ }

/** @deprecated see checkPermission. */
function fetchUserPermissions() { return Promise.resolve(null); }

/** @deprecated see checkPermission. */
function clearPermissionsCache() { /* no-op by design */ }

/**
 * Load the capability descriptor on page load.
 *
 * The client no longer derives or enforces authorization; it loads the
 * presentation descriptor and capability-aware callers consume it.
 */
function applyRBAC() {
  if (window.atimanCapabilities && typeof window.atimanCapabilities.load === 'function') {
    window.atimanCapabilities.load();
  }
}

document.addEventListener('DOMContentLoaded', applyRBAC);

window.RBAC = {
  getUserRole,
  hasCapability,
  isAdmin,
  isSupervisor,
  isOperator,
  checkPermission,
  hasPermission,
  showIfPermitted,
  disableIfNotPermitted,
  applyRBAC,
  fetchUserPermissions,
  clearPermissionsCache
};
