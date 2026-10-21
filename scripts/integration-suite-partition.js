/**
 * ATM-001 F-3 — sanctioned integration suite partitioning.
 *
 * The sanctioned runner executes the contracted suites in one `node --test`
 * invocation against ONE shared disposable database. Some of those suites
 * re-apply a migration artifact on that shared database, which takes
 * ACCESS EXCLUSIVE locks. Other suites take row locks on the same relations.
 * When the two run concurrently PostgreSQL can detect a lock cycle and abort one
 * side with SQLSTATE 40P01.
 *
 * Two independent inversions of this class were identified:
 *   - migration 015 re-applied (`knowledge-pack-publication-admission`) taking
 *     AE on `knowledge_pack_versions` then AE on
 *     `knowledge_pack_version_task_template_versions`, against the membership
 *     INSERT + guard `FOR SHARE` on `knowledge_pack_versions`;
 *   - migration 019 re-applied (`taxonomy-identity-lifecycle`) taking AE on
 *     `equipment_types` then AE on `equipment_type_identity_resolution`, against
 *     the resolver INSERT into that child table (ROW EXCLUSIVE) whose foreign key
 *     and trigger need `equipment_types`.
 *
 * Isolating one suite removes one instance; isolating the CLASS removes the
 * condition. This module is pure (no I/O) so the partition is directly testable,
 * and it fails closed on any inconsistency.
 */

/**
 * Detects a suite that reads a migration artifact and executes that SQL on the
 * shared connection. Deliberately precise: the two patterns must both be
 * present, so suites that merely read migration FILENAMES (inventory checks) are
 * not misclassified as DDL actors.
 *
 * Matches, in the current tree, exactly:
 *   tests/knowledge-versioning.test.js                    (migration 012)
 *   tests/knowledge-pack-publication-admission.test.js    (migration 015)
 *   tests/taxonomy-identity-lifecycle.test.js             (migration 019)
 *   tests/capability-grants.test.js                       (migration 022)
 */
function executesSharedDatabaseMigrationDdl(source) {
  const readsArtifact = /readFileSync\(\s*[^)]*(?:MIGRATION|migrationPath|\.sql)/.test(source);
  const executesIt = /(?:conn|pool|client)\.query\(\s*sql\s*\)|\bquery\(\s*conn\s*,\s*sql\s*\)/.test(source);
  return readsArtifact && executesIt;
}

/**
 * Partition the sanctioned contract list into a sequential DDL group and the
 * remaining parallel group. Fails closed on any inconsistency.
 *
 * @param {string[]} sanctioned the declared contract list
 * @param {string[]} isolated suites that must run in their own invocation
 * @returns {{ddlSuites: string[], parallelSuites: string[]}}
 */
function partitionSuites(sanctioned, isolated) {
  if (!Array.isArray(sanctioned) || !Array.isArray(isolated)) {
    throw new Error('sanctioned and isolated must both be arrays');
  }
  if (isolated.length === 0) {
    throw new Error('the shared-database DDL isolation list must not be empty');
  }
  const duplicates = isolated.filter((suite, index) => isolated.indexOf(suite) !== index);
  if (duplicates.length) {
    throw new Error(`duplicate isolation entries: ${[...new Set(duplicates)].join(', ')}`);
  }
  const unlisted = isolated.filter((suite) => !sanctioned.includes(suite));
  if (unlisted.length) {
    throw new Error(
      `shared-database DDL suite(s) are not part of the sanctioned contract: ${unlisted.join(', ')}`
    );
  }
  const ddlSuites = sanctioned.filter((suite) => isolated.includes(suite));
  const parallelSuites = sanctioned.filter((suite) => !isolated.includes(suite));

  // Invariants: disjoint, complete, and order-preserving over the contract list.
  if (ddlSuites.some((suite) => parallelSuites.includes(suite))) {
    throw new Error('the DDL group and the parallel group must be disjoint');
  }
  if (ddlSuites.length + parallelSuites.length !== sanctioned.length) {
    throw new Error('the groups must account for every sanctioned suite exactly once');
  }
  return { ddlSuites, parallelSuites };
}

module.exports = { partitionSuites, executesSharedDatabaseMigrationDdl };
