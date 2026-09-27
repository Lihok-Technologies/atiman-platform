/**
 * Atiman shell behaviour (ATM-002-I1).
 *
 * Two responsibilities, both presentation-only:
 *   1. connectivity state (ATM-002-R7 §11) — three named states, never a promise
 *      that unsaved work will synchronise. Offline means read-only; durable
 *      offline capture is NOT ratified and nothing here implies otherwise.
 *   2. fail-closed gating of controls marked with data-capability, using the
 *      ATM-003 descriptor. Hiding a control is convenience; the server remains the
 *      only authority (ATM-003-R2 §2).
 */
(function () {
  'use strict';

  function setConnectivity(state) {
    var node = document.getElementById('atiman-connectivity');
    var label = document.getElementById('atiman-connectivity-label');
    if (!node || !label) return;
    var text = { online: 'Online', degraded: 'Limited connection', offline: 'Offline — read only' };
    node.setAttribute('data-state', state);
    label.textContent = text[state] || text.online;
    document.body.setAttribute('data-connectivity', state);
  }

  function evaluateConnectivity() {
    if (navigator.onLine === false) return setConnectivity('offline');
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection && connection.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) {
      return setConnectivity('degraded');
    }
    return setConnectivity('online');
  }

  /** Hide gated controls until the descriptor confirms the capability. */
  function applyCapabilityGating() {
    var gated = document.querySelectorAll('[data-capability]');
    if (!gated.length) return;
    var descriptor = window.atimanCapabilities;
    var permitted = function (capability) {
      return !!(descriptor && typeof descriptor.hasCapability === 'function'
        && descriptor.hasCapability(capability));
    };
    Array.prototype.forEach.call(gated, function (node) {
      var capabilities = (node.getAttribute('data-capability') || '').split(/\s+/).filter(Boolean);
      var allowed = capabilities.length > 0 && capabilities.every(permitted);
      if (allowed) node.removeAttribute('hidden');
      else node.setAttribute('hidden', 'hidden');
    });
  }

  function init() {
    evaluateConnectivity();
    window.addEventListener('online', evaluateConnectivity);
    window.addEventListener('offline', evaluateConnectivity);
    if (window.atimanCapabilities && typeof window.atimanCapabilities.load === 'function') {
      window.atimanCapabilities.load().then(applyCapabilityGating, applyCapabilityGating);
    } else {
      applyCapabilityGating();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
