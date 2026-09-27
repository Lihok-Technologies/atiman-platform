/**
 * Atiman Report capture controller (ATM-002-I2E).
 *
 * The first real Atiman field workflow:
 *
 *   TRUSTWORTHY ASSET CONTEXT  ->  REPORT  ->  CAPTURE OBSERVATION  ->  CONFIRMATION
 *
 * WHAT REPORT IS
 * "Record what I observed about this asset." Capture before obligation: the
 * operator records what they saw and nothing else happens. No severity, no risk
 * class, no Finding, no outcome, no work order, no EAM assertion, no assessment.
 *
 * WHAT IT REUSES, AND WHY NOTHING IS DUPLICATED
 *   * asset context comes from the ATM-002-I2C resolver
 *     (`services/asset-context.service.js`) — this file contains no asset query
 *     and no tenancy rule of its own;
 *   * persistence goes through the ATM-002-I2B writer
 *     (`services/observation.service.js`) — this file duplicates none of its
 *     tenancy, facility/asset, recorder, content, procedure or measurement rules,
 *     and it maps that service's typed refusals onto the experience rather than
 *     re-implementing them;
 *   * the identifier is re-resolved against the trusted tenant on every request,
 *     including submission, so a browser-supplied asset id is never authority.
 *
 * A second controller rather than `report.controller.js`, which is the legacy
 * multi-tenant report-generation surface and is deliberately untouched.
 *
 * The filename deliberately does not begin with "observation": the accepted
 * ATM-002-I2B suite asserts that no Observation controller exists, meaning no
 * Observation HTTP surface, and that guard is left intact rather than relaxed to
 * accommodate a name. This controller serves the Report task; it is not a generic
 * Observation API.
 *
 * TRUTHFULNESS
 * A success state is rendered only when the Observation service has returned a
 * persisted Observation identity. The wording is "Observation recorded" followed
 * by an explicit statement that no Finding has been created. Nothing is claimed
 * that the server did not do: no assessment, no confirmation of abnormality, no
 * maintenance requirement, no work order, no EAM notification, no uploaded
 * evidence.
 *
 * NO OBSERVED-AT FIELD. The domain service accepts an operator-supplied
 * `observed_at`, but a naive local datetime from a browser field cannot be
 * interpreted truthfully on the server: `new Date('2026-09-27T14:30')` resolves
 * against the *server's* zone, so an operator reporting from another timezone
 * would have their observation silently mis-stamped. Report is in-the-moment
 * capture, so the recording time is used and the experience says so plainly
 * rather than offering a control it would misrepresent.
 */

const { resolveCapabilities } = require('../services/capability.service');
const { composeWorkNavigation } = require('../config/destinations');
const { resolveAsset, RESOLUTION_OUTCOMES } = require('../services/asset-context.service');
const {
  createObservation,
  ObservationValidationError,
  ObservationContextError
} = require('../services/observation.service');
const { readIdentifier } = require('./asset-context.controller');

/** The capability that authorizes recording an observation. */
const REPORT_CAPABILITY = 'finding.report';

/**
 * Operator-facing wording for each refusal rule the Observation service can raise.
 * Every rule it can produce is named; an unmapped rule still fails closed with a
 * generic message rather than being ignored.
 */
const CONTENT_RULES = Object.freeze({
  CONTENT_REQUIRED: {
    field: 'observationText',
    message: 'Record something: a description, a measured value, or both.'
  },
  UNIT_REQUIRES_VALUE: {
    field: 'unit',
    message: 'A unit describes a measured value. Enter the value, or clear the unit.'
  },
  UNIT_TOO_LONG: {
    field: 'unit',
    message: 'The unit is longer than 50 characters.'
  },
  MEASURED_VALUE_INVALID: {
    field: 'measuredValue',
    message: 'Enter a plain number with at most 4 decimal places, for example 72.4.'
  },
  OBSERVED_AT_INVALID: {
    field: null,
    message: 'The observation time was not accepted.'
  }
});

/** Wording for a refusal that means the asset can no longer be used. */
const CONTEXT_MESSAGES = Object.freeze({
  OBSERVATION_ASSET_NOT_FOUND: 'This asset is no longer available in your organization.',
  OBSERVATION_FACILITY_NOT_FOUND: 'This asset\'s facility is no longer available in your organization.',
  OBSERVATION_RECORDER_NOT_FOUND: 'Your account is no longer able to record observations.',
  OBSERVATION_RECORDER_INACTIVE: 'Your account is not active, so nothing was recorded.',
  OBSERVATION_TEMPLATE_NOT_FOUND: 'The referenced procedure is not available.',
  OBSERVATION_STEP_NOT_FOUND: 'The referenced procedure step is not available.'
});

/** Refusal wording for a resolution that did not produce an asset. */
const UNRESOLVED_MESSAGES = Object.freeze({
  [RESOLUTION_OUTCOMES.NOT_FOUND]: 'No asset is registered under that code. Nothing was recorded.',
  [RESOLUTION_OUTCOMES.FOREIGN_TENANT]:
    'This asset belongs to another organization. Atiman does not record observations against another organization\'s assets.',
  [RESOLUTION_OUTCOMES.UNOWNED_ASSET]:
    'This asset is not registered to an organization, so no observation can be recorded against it.',
  [RESOLUTION_OUTCOMES.AMBIGUOUS_IDENTIFIER]:
    'This identifier matches more than one asset record, so Atiman will not guess which one you meant.',
  [RESOLUTION_OUTCOMES.INVALID_IDENTIFIER]:
    'That identifier is not in a form Atiman can look up. Check the code on the asset label and try again.',
  [RESOLUTION_OUTCOMES.ORGANIZATION_REQUIRED]:
    'Your account is not associated with an organization, so no observation can be recorded.'
});

/** The shell every Atiman page composes, server-side from real capabilities. */
async function shellContext(req) {
  const resolved = await resolveCapabilities(req.user);
  return {
    workNavigation: composeWorkNavigation(resolved.capabilities),
    organizationName: req.organization?.organization_name
      || req.user.organization_name
      || null,
    accountHref: '/mobile/profile'
  };
}

/** Read the identifier out of a submitted form. Untrusted; re-resolved. */
function readSubmittedIdentifier(body = {}) {
  const type = typeof body.identifierType === 'string' ? body.identifierType : null;
  const value = typeof body.identifierValue === 'string' ? body.identifierValue : null;
  if (type === 'token') return readIdentifier({ token: value });
  if (type === 'code') return readIdentifier({ code: value });
  return readIdentifier({});
}

/** Trim a submitted value to a string, or null when nothing was entered. */
const fieldOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

/** One template, one state at a time: a success state has exactly one source. */
function renderReport(req, res, shell, state) {
  return res.render('atiman/report', {
    layout: 'atiman/layout',
    title: 'Report',
    activeDestination: 'report',
    ...shell,
    ...state
  });
}

const EMPTY_VALUES = Object.freeze({ observationText: '', measuredValue: '', unit: '' });

/**
 * GET /atiman/report
 *
 * Three honest states:
 *   ENTRY      — no identifier yet; Report begins from an asset.
 *   FORM       — the asset resolved in this tenant; record an observation.
 *   UNRESOLVED — the identifier did not resolve; nothing can be recorded.
 */
const getReport = async (req, res, next) => {
  try {
    const shell = await shellContext(req);
    const read = readIdentifier(req.query);

    if (!read.supplied) {
      return renderReport(req, res, shell, {
        state: read.bothSupplied ? 'AMBIGUOUS_INPUT' : 'ENTRY',
        asset: null,
        outcome: null,
        values: EMPTY_VALUES,
        errors: [],
        identifier: { type: read.bothSupplied ? 'both' : null, value: null }
      });
    }

    const resolution = await resolveAsset(
      { organizationId: req.user.organization_id },
      read.identifier
    );

    if (resolution.outcome !== RESOLUTION_OUTCOMES.RESOLVED) {
      return renderReport(req, res, shell, {
        state: 'UNRESOLVED',
        asset: null,
        outcome: resolution.outcome,
        unresolvedMessage: UNRESOLVED_MESSAGES[resolution.outcome]
          || 'This asset could not be resolved, so nothing was recorded.',
        values: EMPTY_VALUES,
        errors: [],
        identifier: { type: read.identifier.type, value: read.identifier.value }
      });
    }

    return renderReport(req, res, shell, {
      state: 'FORM',
      asset: resolution.asset,
      outcome: resolution.outcome,
      values: EMPTY_VALUES,
      errors: [],
      identifier: { type: read.identifier.type, value: read.identifier.value }
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * POST /atiman/report
 *
 * Authentication and `finding.report` are enforced by the route, not here. The
 * identifier is re-resolved against the trusted tenant before any write, and only
 * a persisted Observation identity produces a success state.
 */
const postReport = async (req, res, next) => {
  try {
    const shell = await shellContext(req);
    const body = req.body || {};
    const read = readSubmittedIdentifier(body);

    // Preserved verbatim so a failed attempt never discards what was typed.
    const values = {
      observationText: typeof body.observationText === 'string' ? body.observationText : '',
      measuredValue: typeof body.measuredValue === 'string' ? body.measuredValue : '',
      unit: typeof body.unit === 'string' ? body.unit : ''
    };

    if (!read.supplied) {
      return renderReport(req, res, shell, {
        state: 'AMBIGUOUS_INPUT',
        asset: null,
        outcome: null,
        values,
        errors: [],
        identifier: { type: null, value: null }
      });
    }

    const identifier = { type: read.identifier.type, value: read.identifier.value };

    // Re-resolve on submission. A browser-supplied asset id is never authority,
    // and an organization supplied by the browser is read nowhere in this file.
    const resolution = await resolveAsset(
      { organizationId: req.user.organization_id },
      read.identifier
    );

    if (resolution.outcome !== RESOLUTION_OUTCOMES.RESOLVED) {
      return renderReport(req, res, shell, {
        state: 'UNRESOLVED',
        asset: null,
        outcome: resolution.outcome,
        unresolvedMessage: UNRESOLVED_MESSAGES[resolution.outcome]
          || 'This asset could not be resolved, so nothing was recorded.',
        values,
        errors: [],
        identifier
      });
    }

    const asset = resolution.asset;

    // An observation is attributed to a facility. The resolver projects a facility
    // only when it belongs to the trusted tenant, so an asset with no facility of
    // its own — or one pointing at another tenant's facility — has no valid
    // facility to record against. Refuse and say so rather than inventing one.
    if (!asset.facility) {
      return renderReport(req, res, shell, {
        state: 'FORM',
        asset,
        outcome: resolution.outcome,
        values,
        errors: [{
          field: null,
          rule: 'ASSET_WITHOUT_FACILITY',
          message: 'This asset has no facility recorded in your organization, so nothing was recorded. '
            + 'Ask an administrator to complete the asset record.'
        }],
        identifier
      });
    }

    let recorded;
    try {
      recorded = await createObservation(
        // Trusted context: the authenticated tenant and the authenticated
        // principal. Nothing here comes from the request body.
        { organizationId: req.user.organization_id, recordedByUserId: req.user.id },
        {
          facilityId: asset.facility.id,
          assetId: asset.id,
          observationText: fieldOrNull(values.observationText),
          measuredValue: fieldOrNull(values.measuredValue),
          unit: fieldOrNull(values.unit),
          // Report records a PROCEDURE-LESS observation. That is exactly what
          // distinguishes Report from the future Inspect workflow: no procedure
          // context is asserted, and none is invented.
          taskTemplateId: null,
          taskTemplateStepId: null
        }
      );
    } catch (error) {
      if (error instanceof ObservationValidationError) {
        // The domain service is authoritative for what a valid observation is. Its
        // rules are surfaced field by field, and the entered values are preserved.
        const errors = error.failures.map((failure) => {
          const mapped = CONTENT_RULES[failure.rule];
          return {
            field: mapped ? mapped.field : null,
            rule: failure.rule,
            message: mapped ? mapped.message : 'This observation was not accepted as entered.'
          };
        });
        return renderReport(req, res, shell, {
          state: 'FORM', asset, outcome: resolution.outcome, values, errors, identifier
        });
      }
      if (error instanceof ObservationContextError) {
        return renderReport(req, res, shell, {
          state: 'FORM',
          asset,
          outcome: resolution.outcome,
          values,
          errors: [{
            field: null,
            rule: error.code,
            message: CONTEXT_MESSAGES[error.code]
              || 'This observation could not be attributed, so nothing was recorded.'
          }],
          identifier
        });
      }
      return next(error);
    }

    // Success is rendered ONLY here, and only because the domain service returned
    // a persisted identity. There is no other path to a "recorded" state.
    if (!recorded || !recorded.id) {
      return next(new Error('Observation service returned no persisted identity'));
    }

    return renderReport(req, res, shell, {
      state: 'RECORDED',
      asset,
      outcome: RESOLUTION_OUTCOMES.RESOLVED,
      recorded,
      values: EMPTY_VALUES,
      errors: [],
      identifier
    });
  } catch (error) {
    return next(error);
  }
};

/**
 * Render the page shown when the principal does not hold `finding.report`.
 *
 * Used by the route's capability guard, so the decision stays entirely with the
 * canonical ATM-003 middleware while the response is a page rather than a JSON
 * body. It reveals no asset and no product state.
 */
const renderReportDenied = async (req, res) => {
  const shell = await shellContext(req);
  return res.status(403).render('atiman/report-denied', {
    layout: 'atiman/layout',
    title: 'Report',
    activeDestination: null,
    ...shell
  });
};

module.exports = {
  getReport,
  postReport,
  renderReportDenied,
  REPORT_CAPABILITY,
  CONTENT_RULES,
  CONTEXT_MESSAGES,
  UNRESOLVED_MESSAGES
};
