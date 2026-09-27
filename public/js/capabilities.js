/**
 * ATM-003 capability descriptor consumer (presentation only).
 *
 * The browser uses this to decide what to SHOW. It never decides what is
 * AUTHORIZED: every protected operation is authorized on the server by the
 * capability guard, from the same resolver. Forging this state in the browser
 * grants nothing.
 *
 * Fail-closed: until the descriptor loads, and whenever it fails, the capability
 * set is EMPTY and `isAvailable()` is false, so gated controls stay hidden. There
 * is no permissive default and no cached-from-a-previous-session authority.
 */
(function () {
  'use strict';

  var DESCRIPTOR_URL = '/api/users/me/capabilities';

  var state = {
    capabilities: [],
    organization: null,
    version: null,
    available: false,
    loaded: false,
    error: null
  };

  function fromPayload(data) {
    if (!data || !Array.isArray(data.capabilities)) return null;
    return {
      capabilities: data.capabilities.filter(function (c) { return typeof c === 'string'; }),
      organization: data.organization || null,
      version: data.version || null
    };
  }

  function load() {
    return fetch(DESCRIPTOR_URL, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (response) {
        if (!response.ok) throw new Error('descriptor unavailable (' + response.status + ')');
        return response.json();
      })
      .then(function (body) {
        var parsed = fromPayload(body && body.data);
        if (!parsed) throw new Error('descriptor malformed');
        state.capabilities = parsed.capabilities;
        state.organization = parsed.organization;
        state.version = parsed.version;
        state.available = true;
        state.loaded = true;
        state.error = null;
        return state;
      })
      .catch(function (error) {
        // Fail closed.
        state.capabilities = [];
        state.organization = null;
        state.version = null;
        state.available = false;
        state.loaded = true;
        state.error = error.message;
        return state;
      });
  }

  function hasCapability(capability) {
    if (!state.available) return false;
    return state.capabilities.indexOf(capability) !== -1;
  }

  function hasAnyCapability(capabilities) {
    return capabilities.some(hasCapability);
  }

  function hasAllCapabilities(capabilities) {
    return capabilities.every(hasCapability);
  }

  /** True when the descriptor has been loaded and is usable. */
  function isAvailable() { return state.available; }

  /** Version stamp for stale detection, or null when unavailable. */
  function getVersion() { return state.version; }

  function getCapabilities() { return state.capabilities.slice(); }

  /** Reload after an event that may have changed authority (or to detect staleness). */
  function refresh() { return load(); }

  window.atimanCapabilities = {
    load: load,
    refresh: refresh,
    hasCapability: hasCapability,
    hasAnyCapability: hasAnyCapability,
    hasAllCapabilities: hasAllCapabilities,
    isAvailable: isAvailable,
    getVersion: getVersion,
    getCapabilities: getCapabilities,
    state: state
  };
})();
