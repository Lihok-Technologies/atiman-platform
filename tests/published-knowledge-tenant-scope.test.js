/**
 * Published Knowledge Tenant Scope — ATM-001-KF-04A SEC-01
 *
 * SEC-01 recorded that the resolver's in-scope predicate treated a MISSING
 * organization scope (`organization_id === undefined`) as global knowledge:
 *
 *   const isInScope = (row, organizationId) =>
 *     row.organization_id === null
 *     || row.organization_id === undefined      // <-- fail-open
 *     || Number(row.organization_id) === Number(organizationId);
 *
 * Migration 020 models global knowledge as an EXPLICIT database NULL
 * (`task_template_versions.organization_id INTEGER DEFAULT NULL`, with
 * `chk_task_template_versions_scope_organization` binding `shared` to NULL and
 * `customer` to a non-null organization). `undefined` is therefore never a
 * legitimate stored state: treating it as global turns a missing column, a future
 * projection change, or a malformed row into a cross-tenant disclosure.
 *
 * These are FOCUSED, non-database tests. They prove:
 *   - only an explicit database NULL is global;
 *   - a missing or malformed scope fails CLOSED;
 *   - numeric coercion cannot manufacture an in-scope match;
 *   - authorized global and tenant reads, and the error contract, are preserved.
 *
 * Nothing here touches a database, so this suite needs no integration gate.
 */

const { describe, it, after } = require('node:test');
const assert = require('node:assert');

const service = require('../src/services/published-knowledge.service');
const { PublishedKnowledge } = require('../src/models/published-knowledge.model');

const {
  isInScope,
  resolvePublishedVersion,
  listPublishedVersionsForTemplate,
  listPublishedVersionsForEquipmentType,
  PublishedKnowledgeNotFoundError
} = service;

const GLOBAL = null; // explicit database NULL = shared / global reference knowledge
const TENANT_A = 5;  // an ordinary tenant id
const TENANT_B = 7;  // a different tenant id

/** A frozen version header shaped exactly as findVersionHeader returns it. */
const header = (organizationId) => ({
  id: 1,
  organization_id: organizationId,
  lifecycle_state_at_publish: 'published',
  is_step_set_sealed: true
});

describe('Published Knowledge tenant scope fails closed (ATM-001-KF-04A SEC-01)', () => {
  // --------------------------------------------------------------- predicate
  it('exposes the scope predicate for adversarial testing', () => {
    assert.strictEqual(typeof isInScope, 'function');
  });

  it('treats an explicit database NULL as global, for every caller scope', () => {
    assert.strictEqual(isInScope({ organization_id: GLOBAL }, TENANT_A), true);
    assert.strictEqual(isInScope({ organization_id: GLOBAL }, TENANT_B), true);
    assert.strictEqual(isInScope({ organization_id: GLOBAL }, null), true);
    assert.strictEqual(isInScope({ organization_id: GLOBAL }, undefined), true);
  });

  it('grants a tenant-scoped row only to that same tenant', () => {
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, TENANT_A), true);
    assert.strictEqual(isInScope({ organization_id: String(TENANT_A) }, TENANT_A), true, 'driver string tolerance');
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, String(TENANT_A)), true, 'driver string tolerance');
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, TENANT_B), false);
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, null), false);
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, undefined), false);
  });

  it('fails CLOSED when the row scope is missing', () => {
    // SEC-01: the defect. `undefined` is not global; it is unknown, and unknown
    // must never be served.
    assert.strictEqual(isInScope({ organization_id: undefined }, TENANT_A), false);
    assert.strictEqual(isInScope({ organization_id: undefined }, TENANT_B), false);
    assert.strictEqual(isInScope({ organization_id: undefined }, null), false);
    assert.strictEqual(isInScope({ organization_id: undefined }, undefined), false);
    assert.strictEqual(isInScope({}, TENANT_A), false, 'an absent key is not global');
    assert.strictEqual(isInScope({}, null), false, 'an absent key is not global');
  });

  it('fails CLOSED when the row scope is malformed', () => {
    for (const malformed of [0, '0', '', NaN, 'abc', true, false, 5.5, {}, [], -5, '-5']) {
      assert.strictEqual(
        isInScope({ organization_id: malformed }, TENANT_A),
        false,
        `row scope ${JSON.stringify(malformed)} must not be in scope`
      );
    }
  });

  it('does not let numeric coercion manufacture an in-scope match', () => {
    assert.strictEqual(isInScope({ organization_id: 0 }, null), false, '0 must not equal a NULL caller');
    assert.strictEqual(isInScope({ organization_id: 0 }, 0), false, '0 is not a valid organization id');
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, true), false, 'true must not coerce to tenant 1');
    assert.strictEqual(isInScope({ organization_id: true }, 1), false, 'true is not a stored scope');
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, NaN), false);
    assert.strictEqual(isInScope({ organization_id: NaN }, NaN), false, 'NaN === NaN is a trap');
    assert.strictEqual(isInScope({ organization_id: TENANT_A }, 'abc'), false);
  });

  // ----------------------------------------------- service-level fail-closed
  describe('resolvePublishedVersion', () => {
    const originals = {};
    const METHODS = [
      'findVersionHeader',
      'listVersionSteps',
      'listVersionSafetyControls',
      'listVersionApplicability',
      'listVersionEvidence'
    ];

    const stubHeader = (organizationId) => {
      for (const method of METHODS) {
        originals[method] = PublishedKnowledge[method];
      }
      PublishedKnowledge.findVersionHeader = async () => header(organizationId);
      // Empty frozen sets: a row that clears the scope and servability gates
      // reaches the incomplete-record refusal, which is how we observe that the
      // scope gate was passed.
      PublishedKnowledge.listVersionSteps = async () => [];
      PublishedKnowledge.listVersionSafetyControls = async () => [];
      PublishedKnowledge.listVersionApplicability = async () => [];
      PublishedKnowledge.listVersionEvidence = async () => [];
    };

    const restore = () => {
      for (const method of METHODS) {
        PublishedKnowledge[method] = originals[method];
      }
    };

    /** The refusal code, or the code that proves the scope gate was passed. */
    const outcome = async (rowScope, callerScope) => {
      stubHeader(rowScope);
      try {
        await resolvePublishedVersion(1, { organizationId: callerScope });
        return 'RESOLVED';
      } catch (error) {
        return error.code || error.name;
      } finally {
        restore();
      }
    };

    it('serves a global version to a tenant caller (passes the scope gate)', async () => {
      assert.strictEqual(await outcome(GLOBAL, TENANT_A), 'PUBLISHED_VERSION_INCOMPLETE');
    });

    it('serves a global version to an organization-less caller', async () => {
      assert.strictEqual(await outcome(GLOBAL, null), 'PUBLISHED_VERSION_INCOMPLETE');
    });

    it('serves a tenant version to its own tenant (passes the scope gate)', async () => {
      assert.strictEqual(await outcome(TENANT_A, TENANT_A), 'PUBLISHED_VERSION_INCOMPLETE');
    });

    it('refuses a tenant version to a different tenant, non-disclosingly', async () => {
      assert.strictEqual(await outcome(TENANT_A, TENANT_B), 'PUBLISHED_VERSION_NOT_FOUND');
    });

    it('refuses a tenant version to an organization-less caller', async () => {
      assert.strictEqual(await outcome(TENANT_A, null), 'PUBLISHED_VERSION_NOT_FOUND');
      assert.strictEqual(await outcome(TENANT_A, undefined), 'PUBLISHED_VERSION_NOT_FOUND');
    });

    it('refuses a row with MISSING scope to every caller (SEC-01 regression)', async () => {
      assert.strictEqual(await outcome(undefined, TENANT_A), 'PUBLISHED_VERSION_NOT_FOUND');
      assert.strictEqual(await outcome(undefined, TENANT_B), 'PUBLISHED_VERSION_NOT_FOUND');
      assert.strictEqual(await outcome(undefined, null), 'PUBLISHED_VERSION_NOT_FOUND');
      assert.strictEqual(await outcome(undefined, undefined), 'PUBLISHED_VERSION_NOT_FOUND');
    });

    it('refuses a row with malformed scope, non-disclosingly', async () => {
      assert.strictEqual(await outcome('abc', TENANT_A), 'PUBLISHED_VERSION_NOT_FOUND');
      assert.strictEqual(await outcome(0, null), 'PUBLISHED_VERSION_NOT_FOUND');
    });

    it('uses the ordinary non-disclosing not-found error for a scope refusal', async () => {
      stubHeader(undefined);
      try {
        await assert.rejects(
          () => resolvePublishedVersion(1, { organizationId: TENANT_A }),
          (error) => {
            assert.ok(error instanceof PublishedKnowledgeNotFoundError, 'must be the ordinary 404');
            assert.strictEqual(error.statusCode, 404);
            assert.strictEqual(error.code, 'PUBLISHED_VERSION_NOT_FOUND');
            return true;
          }
        );
      } finally {
        restore();
      }
    });

    after(restore);
  });

  // --------------------------------------- list endpoints: caller-side scope
  describe('list endpoints', () => {
    const METHODS = [
      'listPublishedVersionsForTemplate',
      'listPublishedVersionsForEquipmentType'
    ];

    /** Capture the caller scope each list method passes to the model. */
    const captureCallerScope = async (call) => {
      const originals = {};
      const captured = {};
      for (const method of METHODS) originals[method] = PublishedKnowledge[method];
      PublishedKnowledge.listPublishedVersionsForTemplate = async (id, organizationId) => {
        captured.template = organizationId;
        return [];
      };
      PublishedKnowledge.listPublishedVersionsForEquipmentType = async (id, organizationId) => {
        captured.equipmentType = organizationId;
        return [];
      };
      try {
        await call();
      } finally {
        for (const method of METHODS) PublishedKnowledge[method] = originals[method];
      }
      return captured;
    };

    const both = (organizationId) => captureCallerScope(async () => {
      await listPublishedVersionsForTemplate(1, { organizationId });
      await listPublishedVersionsForEquipmentType(1, { organizationId });
    });

    it('passes an explicit tenant id through unchanged', async () => {
      const numeric = await both(TENANT_A);
      assert.strictEqual(numeric.template, TENANT_A);
      assert.strictEqual(numeric.equipmentType, TENANT_A);
      const stringly = await both(String(TENANT_A));
      assert.strictEqual(stringly.template, TENANT_A, 'a driver-returned string id is canonicalized');
    });

    it('normalizes a missing caller scope to NULL (global-only)', async () => {
      assert.strictEqual((await both(null)).template, null);
      assert.strictEqual((await both(undefined)).template, null);
    });

    it('normalizes a malformed caller scope to NULL instead of passing it to SQL', async () => {
      for (const malformed of ['abc', 0, '0', '', NaN, true, -1, 5.5]) {
        const captured = await both(malformed);
        assert.strictEqual(
          captured.template,
          null,
          `caller scope ${JSON.stringify(malformed)} must normalize to NULL`
        );
        assert.strictEqual(
          captured.equipmentType,
          null,
          `caller scope ${JSON.stringify(malformed)} must normalize to NULL`
        );
      }
    });
  });
});
