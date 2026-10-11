/**
 * Published Knowledge Immutability — ATM-001-KF-04A OBS-3 / OBS-3-R2
 *
 * OBS-3 recorded that PublishedKnowledgeModel inherited BaseModel's generic
 * update()/delete() helpers, so the read model advertised a mutation surface it
 * must not have; migration 009's immutability triggers were the only thing
 * refusing. OBS-3-R2 recorded the same gap for the inherited create(), which
 * would issue an unguarded `INSERT INTO task_template_versions`. This suite
 * proves the model refuses every generic mutation method itself, with the stable
 * refusal code PUBLISHED_KNOWLEDGE_IMMUTABLE, while remaining a read model.
 *
 * This is a FOCUSED, non-database suite:
 *   - create(), update() and delete() refuse before any database access;
 *   - each refusal carries the stable code and a conflict (409) severity;
 *   - the refusals are own class fields shadowing BaseModel, not prototype edits;
 *   - no unnamed writable surface remains inherited;
 *   - every legitimate read — including the ones the resolver calls — is intact.
 *
 * Nothing here touches a database, so this suite needs no integration gate.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

const BaseModel = require('../src/models/base.model');
const {
  PublishedKnowledge,
  PublishedKnowledgeModel,
  PublishedKnowledgeImmutableError,
  PUBLISHED_KNOWLEDGE_IMMUTABLE
} = require('../src/models/published-knowledge.model');

const IMMUTABLE_CODE = 'PUBLISHED_KNOWLEDGE_IMMUTABLE';

/** Assert a thunk refuses with the published-knowledge immutability refusal. */
function assertRefused(operation, thunk) {
  assert.throws(thunk, (error) => {
    assert.ok(
      error instanceof PublishedKnowledgeImmutableError,
      `${operation}: expected PublishedKnowledgeImmutableError, got ${error && error.name}`
    );
    assert.strictEqual(error.code, IMMUTABLE_CODE, `${operation}: stable refusal code`);
    assert.strictEqual(error.statusCode, 409, `${operation}: immutability is a conflict`);
    assert.match(error.message, /immutable/i, `${operation}: refusal must state immutability`);
    assert.match(
      error.message,
      /not available through published knowledge resolution/i,
      `${operation}: refusal must name the boundary it was refused by`
    );
    return true;
  });
}

describe('PublishedKnowledgeModel refuses generic mutation (ATM-001-KF-04A OBS-3)', () => {
  it('exposes the stable refusal code', () => {
    assert.strictEqual(PUBLISHED_KNOWLEDGE_IMMUTABLE, IMMUTABLE_CODE);
  });

  it('refuses update() through the shared model singleton', () => {
    assertRefused('update', () => PublishedKnowledge.update(1, { template_name: 'mutated' }));
  });

  it('refuses delete() through the shared model singleton', () => {
    assertRefused('delete', () => PublishedKnowledge.delete(1));
  });

  it('refuses create() through the shared model singleton', () => {
    assertRefused('create', () => PublishedKnowledge.create({ template_name: 'inserted' }));
  });

  it('refuses create() unconditionally, before any validation, for any payload', () => {
    const payloads = [
      {},
      { id: 1 },
      { template_name: 'inserted' },
      { task_template_id: 1, version_number: 1, lifecycle_state_at_publish: 'published' },
      { '; DROP TABLE task_template_versions': 1 }
    ];
    for (const payload of payloads) {
      assertRefused(`create ${JSON.stringify(payload)}`, () => PublishedKnowledge.create(payload));
    }
  });

  it('refuses every generic mutation method on a freshly constructed instance', () => {
    const model = new PublishedKnowledgeModel();
    assertRefused('instance create', () => model.create({}));
    assertRefused('instance update', () => model.update(2, { template_name: 'mutated' }));
    assertRefused('instance delete', () => model.delete(2));
  });

  it('refuses before any database access is attempted', () => {
    const originalQuery = PublishedKnowledge.query;
    const originalPool = PublishedKnowledge.pool;
    let databaseTouched = false;
    // Every generic helper AND this model's own reads funnel through
    // `this.query` -> `this.pool.execute`, so poisoning both is the tightest
    // proof that the refusal precedes any database access.
    PublishedKnowledge.query = async () => {
      databaseTouched = true;
      throw new Error('the refusal must prevent this database access');
    };
    PublishedKnowledge.pool = {
      execute: async () => {
        databaseTouched = true;
        throw new Error('the refusal must prevent this database access');
      }
    };
    try {
      assertRefused('create', () => PublishedKnowledge.create({ template_name: 'inserted' }));
      assertRefused('update', () => PublishedKnowledge.update(1, { template_name: 'mutated' }));
      assertRefused('delete', () => PublishedKnowledge.delete(1));
    } finally {
      PublishedKnowledge.query = originalQuery;
      PublishedKnowledge.pool = originalPool;
    }
    assert.strictEqual(
      databaseTouched,
      false,
      'generic mutation must be refused before the database is reached'
    );
  });

  it('exposes create/update/delete as own refusing fields, never the inherited writers', () => {
    for (const method of ['create', 'update', 'delete']) {
      assert.notStrictEqual(
        PublishedKnowledge[method],
        BaseModel.prototype[method],
        `${method}() must not remain the inherited generic writer`
      );
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(PublishedKnowledge, method),
        true,
        `${method} must be an own class field on the instance`
      );
      // Class fields are instance properties, so the model's OWN prototype must
      // not carry them — which is exactly why the identity checks are on the
      // instance (a plain `PublishedKnowledgeModel.prototype.create` read would
      // resolve up the chain to BaseModel.prototype.create).
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(PublishedKnowledgeModel.prototype, method),
        false,
        `${method} must not be an own property of the model prototype`
      );
    }
  });

  it('refuses create, update and delete with one identical error contract', () => {
    const refusals = [
      ['create', () => PublishedKnowledge.create({})],
      ['update', () => PublishedKnowledge.update(1, {})],
      ['delete', () => PublishedKnowledge.delete(1)]
    ].map(([operation, thunk]) => {
      try {
        thunk();
      } catch (error) {
        return { operation, error };
      }
      throw new Error(`${operation} did not refuse`);
    });

    for (const { operation, error } of refusals) {
      assert.ok(error instanceof PublishedKnowledgeImmutableError, `${operation}: error class`);
      assert.strictEqual(error.code, IMMUTABLE_CODE, `${operation}: stable code`);
      assert.strictEqual(error.statusCode, 409, `${operation}: conflict severity`);
    }
  });

  it('inherits no unnamed writable surface from BaseModel', () => {
    const READ_ALLOWLIST = new Set(['findAll', 'findById', 'findByField', 'count', 'query']);
    const WRITABLE = /create|insert|update|delete|save|upsert|remove|destroy|replace|patch|mutate|write/i;
    const inherited = Object.getOwnPropertyNames(BaseModel.prototype)
      .filter((name) => name !== 'constructor')
      .filter((name) => !Object.prototype.hasOwnProperty.call(PublishedKnowledge, name));

    for (const name of inherited) {
      assert.ok(READ_ALLOWLIST.has(name), `unexpected inherited method on the read model: ${name}`);
      assert.ok(!WRITABLE.test(name), `inherited method ${name} looks like an unrefused mutator`);
    }
    // The refusal must not have been implemented by neutering the DB accessor.
    assert.strictEqual(PublishedKnowledge.query, BaseModel.prototype.query,
      'query() must remain the inherited accessor the read methods depend on');
  });

  it('leaves every legitimate read intact', () => {
    const modelReads = [
      'findVersionHeader',
      'listVersionSteps',
      'listVersionSafetyControls',
      'listVersionApplicability',
      'listVersionEvidence',
      'listStepVersionIndex',
      'listPublishedVersionsForTemplate',
      'listPublishedVersionsForEquipmentType'
    ];
    for (const read of modelReads) {
      assert.strictEqual(typeof PublishedKnowledge[read], 'function', `${read} must remain callable`);
      assert.strictEqual(
        PublishedKnowledge[read],
        PublishedKnowledgeModel.prototype[read],
        `${read} must remain the model's own read implementation`
      );
    }

    // Inherited read-only helpers stay inherited; only mutation is refused.
    for (const read of ['findAll', 'findById', 'findByField', 'count']) {
      assert.strictEqual(
        PublishedKnowledge[read],
        BaseModel.prototype[read],
        `${read} must remain the inherited read helper`
      );
    }
  });
});
