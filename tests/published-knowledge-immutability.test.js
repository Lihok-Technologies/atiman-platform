/**
 * Published Knowledge Immutability — ATM-001-KF-04A OBS-3
 *
 * OBS-3 recorded that PublishedKnowledgeModel inherited BaseModel's generic
 * update()/delete() helpers, so the read model advertised a mutation surface it
 * must not have; migration 009's immutability triggers were the only thing
 * refusing. This suite proves the model now refuses both generic mutation methods
 * itself, with the stable refusal code PUBLISHED_KNOWLEDGE_IMMUTABLE.
 *
 * This is a FOCUSED, non-database suite:
 *   - update() and delete() refuse execution before any database access;
 *   - the refusal carries the stable code and a conflict (409) severity;
 *   - the refusal replaces only the generic mutation surface;
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

  it('refuses both methods on a freshly constructed model instance', () => {
    const model = new PublishedKnowledgeModel();
    assertRefused('instance update', () => model.update(2, { template_name: 'mutated' }));
    assertRefused('instance delete', () => model.delete(2));
  });

  it('refuses before any database access is attempted', () => {
    const originalQuery = PublishedKnowledge.query;
    let databaseTouched = false;
    // If the refusal is ever weakened to reach the database, this stub proves it.
    PublishedKnowledge.query = async () => {
      databaseTouched = true;
      throw new Error('the refusal must prevent this database access');
    };
    try {
      assertRefused('update', () => PublishedKnowledge.update(1, { template_name: 'mutated' }));
      assertRefused('delete', () => PublishedKnowledge.delete(1));
    } finally {
      PublishedKnowledge.query = originalQuery;
    }
    assert.strictEqual(
      databaseTouched,
      false,
      'generic mutation must be refused before the database is reached'
    );
  });

  it('overrides only the generic mutation surface', () => {
    assert.notStrictEqual(
      PublishedKnowledge.update,
      BaseModel.prototype.update,
      'update() must not remain the inherited generic writer'
    );
    assert.notStrictEqual(
      PublishedKnowledge.delete,
      BaseModel.prototype.delete,
      'delete() must not remain the inherited generic writer'
    );
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
