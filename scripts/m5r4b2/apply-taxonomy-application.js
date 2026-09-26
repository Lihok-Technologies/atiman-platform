#!/usr/bin/env node
'use strict';

/**
 * ATM-001 M5R.4B2 — Governed Taxonomy Application
 *
 * Applies the OWNER-ratified M5R.4A / M5R.4B1 equipment-type package to an
 * already-bootstrapped Atiman database.
 *
 * ===========================================================================
 * WHY THIS IS A SCRIPT AND NOT MIGRATION 020
 * ===========================================================================
 *
 * The ratified M5R.4B1 record states, in three places, that
 * "Mechanism and content application remain separate governed steps": migration
 * 019 creates the mechanism and must NOT populate the taxonomy.
 *
 * The repository agrees with that separation, and the evidence is unambiguous:
 *
 *   - Across ALL NINETEEN migrations, the total number of `INSERT INTO`
 *     statements is ZERO. No migration has ever inserted a row. Migrations
 *     create structure.
 *   - Taxonomy and maintenance CONTENT is loaded exclusively by
 *     scripts/bootstrap-knowledge/bootstrap.js, which is a deliberate,
 *     separately-invoked, guarded operation that asserts empty target tables
 *     and aborts the whole transaction on any rejected row.
 *
 * A content-applying migration 020 would therefore break the established
 * convention, blur the ratified mechanism/content boundary, and — because a
 * freshly migrated database has NO taxonomy rows (the corpus is a separate
 * manual step) — would apply "successfully" while silently doing nothing.
 * That failure mode is worse than the problem it would solve.
 *
 * So this script is the architecture-correct application mechanism, and it
 * follows the bootstrap's own conventions: explicit invocation, loud
 * preconditions, all-or-nothing transactions, and no schema change.
 *
 * ===========================================================================
 * WHAT IT APPLIES (the ratified package, and nothing else)
 * ===========================================================================
 *
 *   Category          1 new       Mining Equipment
 *   Classes           5 new       Instrumentation > Level Switch
 *                                 Mining Equipment > Cutting Equipment
 *                                 Mining Equipment > Mine Hoisting
 *                                 Drilling > Well Control Equipment
 *                                 Drilling > Hoisting Equipment
 *   Types             1 new       Submersible Pump  (Pump > Submersible Pump)
 *   Existing rows     77 changed  14 relocated, 71 renamed, 8 of them both
 *                    153 unchanged
 *                    52 leave canonical standing (19 superseded, 33 retired)
 *   Resolutions      55 new       19 approved with target
 *                                33 approved without successor
 *                                 3 pending INSUFFICIENT_EVIDENCE
 *   Terminology      65 new       46 LEGACY_NAME, 2 SYNONYM, 17 MERGED_IDENTITY_TERM
 *
 * Resulting equipment types: 283 (was 282), of which 231 canonical,
 * 19 superseded, 33 retired.
 *
 * TWO DISCREPANCIES IN THE RATIFIED RECORD, REPORTED AND NOT SILENTLY FIXED
 *
 * 1. ATM-001-M5R4B1 section 21.15 prints "227 + 132 + 52 = 282". That total is
 *    411: the 129 KEEP-unchanged rows are a SUBSET of the 227 and are counted
 *    again inside "unchanged 132". The individual sub-figures are correct; the
 *    printed total is not.
 * 2. The same block states "relocated (class change) 62 - all 62
 *    placement-bearing rows". Only FOURTEEN rows actually change class. 62 is
 *    the count of REVIEWED rows; for the other 48 the ratified final placement
 *    is where the row already sat, which is exactly the R1 finding "48 of 62
 *    placements are unchanged". Measured: 14 relocated, 71 renamed, 8 both,
 *    therefore 77 changed; 52 leaving; 153 unchanged; 77 + 52 + 153 = 282.
 *
 * The ratified record was not edited. The operative accounting - 282 to
 * 230/19/33 and 283 to 231/19/33 - reconciles exactly and is what this script
 * produces.
 *
 * ===========================================================================
 * AUTHORITY
 * ===========================================================================
 *
 * The content is DERIVED FROM the ratified artifacts, never re-authored here:
 *
 *   docs/research/m5r4a/equipment-type-reconciliation.jsonl   the 282 dispositions
 *   docs/research/m5r4b1/parent-taxonomy-placement-review.jsonl  the 62 placements
 *   scripts/bootstrap-knowledge/*.jsonl                       corpus identity
 *
 * Two endpoint resolutions are not derivable from names alone and are therefore
 * stated explicitly, each traceable to the ratified record:
 *
 *   - candidates 7 and 8 target the NEW canonical "Submersible Pump"
 *     (M5R.4B1 section 21.5, ratified in section 21.14 C)
 *   - candidate 56 targets candidate 200 by IDENTITY, never by name, because
 *     two rows are named "Pressure Filter"
 *     (M5R.4B1 section 21.6, ratified in section 21.14 D)
 *
 * ===========================================================================
 * GOVERNANCE
 * ===========================================================================
 *
 * Human accountability is explicit and cannot be fabricated. The accountable
 * reviewer and approver MUST be named on the command line and must resolve to
 * real `users` rows; the script refuses to run without them. `ai_assisted` is
 * FALSE: these are human engineering decisions from a ratified package, and AI
 * is never the approving authority.
 *
 * Provenance reuses migration 011's substrate. Two global knowledge sources are
 * registered — `legacy_migration` (the 282-row corpus) and `engineering_authored`
 * (the Atiman reasoning) — which are exactly the two classes the ratified record
 * names. Governed records cite the `engineering_authored` edition, because the
 * decision's provenance is the reasoning; the corpus is its evidenced subject.
 *
 * Usage:
 *   node scripts/m5r4b2/apply-taxonomy-application.js --dry-run
 *   node scripts/m5r4b2/apply-taxonomy-application.js \
 *        --reviewer <username|id> --approver <username|id> [--apply]
 *
 * --dry-run  derive, validate every precondition and print the plan. No writes.
 * --apply    perform the application (idempotent).
 *
 * Database connection uses the same PG* / DB_* environment variables as
 * scripts/bootstrap-knowledge/bootstrap.js. This script refuses to run against a
 * database whose taxonomy is absent, and it never touches production implicitly.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RECONCILIATION = path.join(REPO_ROOT, 'docs', 'research', 'm5r4a', 'equipment-type-reconciliation.jsonl');
const PLACEMENT = path.join(REPO_ROOT, 'docs', 'research', 'm5r4b1', 'parent-taxonomy-placement-review.jsonl');
const CORPUS_DIR = path.join(REPO_ROOT, 'scripts', 'bootstrap-knowledge');

/** Ratified constants. Any drift from these is a hard failure. */
const EXPECTED = {
  corpusRows: 282,
  canonicalBefore: 230,
  superseded: 19,
  retired: 33,
  resolutions: 55,
  resolutionsWithTarget: 19,
  resolutionsWithoutTarget: 33,
  pending: 3,
  terms: 65,
  legacyNames: 46,
  synonyms: 2,
  mergedTerms: 17,
  // 62 rows carry a REVIEWED placement (29 ADD_TYPE + 33 RECLASSIFY).
  placementRows: 62,
  newCategories: 1,
  newClasses: 5,
  newTypes: 1,
  resultTypes: 283,
  resultCanonical: 231,

  // ---------------------------------------------------------------------
  // MEASURED from the authoritative artifacts, and DISCREPANT with two
  // explanatory sub-figures in the ratified record. Reported, not hidden,
  // and the ratified record was NOT edited.
  //
  // docs/architecture/ATM-001-M5R4B1-...md §21.15 prints:
  //     modified in place 227 + unchanged 132 + leaving 52 = 282
  // That total is 411, not 282: 227 (KEEP+RECLASSIFY+ADD_TYPE) already
  // CONTAINS the 129 KEEP-unchanged rows counted again in "unchanged 132".
  // The same block also states "relocated (class change) 62 — all 62
  // placement-bearing rows". Only 14 rows actually change class: for the
  // other 48 the review's final placement is where the row ALREADY was,
  // which is exactly the R1 finding "48 of 62 placements are unchanged".
  //
  // Measured from the ratified JSONL artifacts:
  //     71 renamed, 14 relocated, 8 both -> 77 changed
  //     52 leaving canonical standing, 153 unchanged
  //     77 + 52 + 153 = 282
  // ---------------------------------------------------------------------
  relocated: 14,
  renamed: 71,
  overlap: 8,
  changed: 77,
  unchanged: 153
};

const NEW_CATEGORY = 'Mining Equipment';
const NEW_CLASSES = [
  ['Instrumentation', 'Level Switch'],
  ['Mining Equipment', 'Cutting Equipment'],
  ['Mining Equipment', 'Mine Hoisting'],
  ['Drilling', 'Well Control Equipment'],
  ['Drilling', 'Hoisting Equipment']
];
const NEW_TYPE = { category: 'Pump', class: 'Submersible Pump', code: 'SUBM_PUMP', name: 'Submersible Pump' };

/**
 * Endpoints stated explicitly because they are not derivable from names, each
 * traceable to the ratified record. Keys are M5R.4A candidate ids.
 */
const EXPLICIT_TARGETS = {
  7: { kind: 'NEW_TYPE', ref: 'M5R.4B1 §21.5 / §21.14 C' },
  8: { kind: 'NEW_TYPE', ref: 'M5R.4B1 §21.5 / §21.14 C' },
  56: { kind: 'CANDIDATE_ID', candidateId: 200, ref: 'M5R.4B1 §21.6 / §21.14 D' }
};

const PROVENANCE = {
  corpus: { code: 'M5R4B2-LEGACY-CORPUS', category: 'legacy_migration', title: 'Atiman legacy equipment-type corpus (282 identities)' },
  reasoning: {
    code: 'M5R4B2-ENGINEERING-REASONING',
    category: 'engineering_authored',
    title: 'ATM-001 M5R.4A/M5R.4B1 accepted equipment-type reconciliation package'
  }
};

// ---------------------------------------------------------------------------
// artefact loading and derivation
// ---------------------------------------------------------------------------

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/** The corpus is an array-per-line: [id, class_id, type_code, type_name, ...]. */
function loadCorpus() {
  const categories = readJsonl(path.join(CORPUS_DIR, 'equipment_categories.jsonl'));
  const classes = readJsonl(path.join(CORPUS_DIR, 'equipment_classes.jsonl'));
  const types = readJsonl(path.join(CORPUS_DIR, 'equipment_types.jsonl'));
  const categoryNameById = new Map(categories.map((c) => [c[0], c[2]]));
  const categoryCodeById = new Map(categories.map((c) => [c[0], c[1]]));
  const classById = new Map(classes.map((c) => [c[0], {
    categoryId: c[1],
    categoryName: categoryNameById.get(c[1]),
    categoryCode: categoryCodeById.get(c[1]),
    classCode: c[2],
    className: c[3]
  }]));
  return {
    categories, classes, types, categoryNameById, categoryCodeById, classById,
    byId: new Map(types.map((t) => [t[0], t]))
  };
}

/**
 * Derive the complete application package from the ratified artifacts.
 * Pure: no database access, no side effects.
 */
function derivePackage() {
  const corpus = loadCorpus();
  const reconciliation = readJsonl(RECONCILIATION);
  const placement = readJsonl(PLACEMENT);

  if (reconciliation.length !== EXPECTED.corpusRows) {
    throw new Error(`reconciliation must hold ${EXPECTED.corpusRows} rows, found ${reconciliation.length}`);
  }
  if (corpus.types.length !== EXPECTED.corpusRows) {
    throw new Error(`corpus must hold ${EXPECTED.corpusRows} types, found ${corpus.types.length}`);
  }

  const byCandidateId = new Map(reconciliation.map((r) => [r.candidate_id, r]));
  const placementByCandidateId = new Map(placement.map((r) => [r.candidate_id, r]));

  // Identity key: (category_code, class_code, type_code) is unique by schema
  // constraint, so it is the only safe way to name a corpus row without relying
  // on a name that may not be unique.
  const identityOf = (corpusTypeId) => {
    const t = corpus.byId.get(corpusTypeId);
    if (!t) throw new Error(`corpus has no type id ${corpusTypeId}`);
    const cls = corpus.classById.get(t[1]);
    if (!cls) throw new Error(`corpus type ${corpusTypeId} references unknown class ${t[1]}`);
    return { categoryCode: cls.categoryCode, classCode: cls.classCode, typeCode: t[2], corpusId: t[0] };
  };

  // ---- canonical-name providers (for merge/synonym targets) ----------------
  const providersByName = new Map();
  for (const row of reconciliation) {
    if (!row.canonical_name) continue;
    if (['MERGE_DUPLICATE', 'SYNONYM_OR_ALIAS', 'NOT_EQUIPMENT_TYPE', 'TOO_BROAD_CONTAINER'].includes(row.disposition)) continue;
    if (!providersByName.has(row.canonical_name)) providersByName.set(row.canonical_name, row);
  }

  // ---- existing-row transformations ---------------------------------------
  const transformations = [];
  for (const row of reconciliation) {
    const id = row.candidate_id;
    const corpusType = corpus.byId.get(id);
    if (!corpusType) throw new Error(`disposition ${id} has no corpus row`);
    const placementRow = placementByCandidateId.get(id);
    const identity = identityOf(id);

    const targetName = row.canonical_name || row.candidate_name;
    const renamed = Boolean(row.canonical_name && row.canonical_name !== row.candidate_name);
    const relocated = Boolean(placementRow && !placementRow.placement_unchanged);
    if (relocated && !placementRow) throw new Error(`row ${id} has no placement entry`);

    transformations.push({
      candidateId: id,
      identity,
      corpusId: corpusType[0],
      corpusTypeCode: corpusType[2],
      corpusName: corpusType[3],
      currentCategory: identity.categoryCode,
      currentClass: identity.classCode,
      targetCategory: placementRow ? placementRow.final_category : null,
      targetClass: placementRow ? placementRow.final_class : null,
      targetName,
      renamed,
      relocated
    });
  }

  // ---- resolutions ---------------------------------------------------------
  const resolutions = [];
  for (const row of reconciliation) {
    const id = row.candidate_id;
    if (row.disposition === 'MERGE_DUPLICATE' || row.disposition === 'SYNONYM_OR_ALIAS') {
      const explicit = EXPLICIT_TARGETS[id];
      let target;
      if (explicit) {
        target = explicit.kind === 'NEW_TYPE'
          ? { kind: 'NEW_TYPE', name: NEW_TYPE.name, ref: explicit.ref }
          : { kind: 'EXISTING', candidateId: explicit.candidateId, ref: explicit.ref,
              identity: identityOf(explicit.candidateId) };
      } else {
        const provider = providersByName.get(row.canonical_target);
        if (!provider) throw new Error(`candidate ${id} target '${row.canonical_target}' has no identity provider`);
        target = { kind: 'EXISTING', candidateId: provider.candidate_id, ref: 'M5R.4B1 §21.3 (13 targets resolve via canonical_name)',
          identity: identityOf(provider.candidate_id) };
      }
      resolutions.push({
        candidateId: id,
        identity: identityOf(id),
        kind: row.disposition === 'SYNONYM_OR_ALIAS' ? 'SYNONYM_OF' : 'MERGED_DUPLICATE',
        approved: true,
        target,
        rationale: row.rationale
      });
    } else if (row.disposition === 'NOT_EQUIPMENT_TYPE' || row.disposition === 'TOO_BROAD_CONTAINER') {
      resolutions.push({
        candidateId: id,
        identity: identityOf(id),
        kind: row.disposition === 'TOO_BROAD_CONTAINER' ? 'TOO_BROAD_FOR_TYPE' : 'NOT_AN_EQUIPMENT_TYPE',
        approved: true,
        target: null,
        rationale: row.rationale
      });
    } else if (row.disposition === 'INSUFFICIENT_EVIDENCE') {
      resolutions.push({
        candidateId: id,
        identity: identityOf(id),
        kind: 'INSUFFICIENT_EVIDENCE',
        approved: false,
        target: null,
        rationale: row.rationale
      });
    }
  }

  // ---- terminology ---------------------------------------------------------
  const terms = [];
  for (const row of reconciliation) {
    const id = row.candidate_id;
    const legacyRename = row.canonical_name && row.canonical_name !== row.candidate_name
      && (row.disposition === 'KEEP_EXISTING' || row.disposition === 'RECLASSIFY');
    if (legacyRename) {
      terms.push({
        candidateId: id, term: row.candidate_name, kind: 'LEGACY_NAME',
        canonical: { kind: 'SELF', identity: identityOf(id) },
        source: identityOf(id),
        rationale: `Ratified rename of an existing identity to "${row.canonical_name}"; the former name remains discoverable vocabulary.`
      });
    } else if (row.disposition === 'SYNONYM_OR_ALIAS') {
      const entry = resolutions.find((r) => r.candidateId === id);
      terms.push({
        candidateId: id, term: row.candidate_name, kind: 'SYNONYM',
        canonical: entry.target, source: identityOf(id), rationale: row.rationale
      });
    } else if (row.disposition === 'MERGE_DUPLICATE') {
      const entry = resolutions.find((r) => r.candidateId === id);
      terms.push({
        candidateId: id, term: row.candidate_name, kind: 'MERGED_IDENTITY_TERM',
        canonical: entry.target, source: identityOf(id), rationale: row.rationale
      });
    }
  }

  return { corpus, reconciliation, placement, transformations, resolutions, terms, identityOf };
}

/** Fail loudly if the derivation departs from the ratified accounting. */
function assertAccounting(pkg) {
  const { transformations, resolutions, terms } = pkg;
  const changed = transformations.filter((t) => t.renamed || t.relocated);
  // "unchanged" excludes the rows that leave canonical standing: those are
  // accounted for separately and are not unchanged, they are withdrawn.
  const leavingIds = new Set(resolutions.filter((r) => r.approved).map((r) => r.candidateId));
  const unchanged = transformations.filter(
    (t) => !t.renamed && !t.relocated && !leavingIds.has(t.candidateId));
  const relocated = transformations.filter((t) => t.relocated);
  const renamed = transformations.filter((t) => t.renamed);
  const both = transformations.filter((t) => t.renamed && t.relocated);

  const withTarget = resolutions.filter((r) => r.approved && r.target);
  const withoutTarget = resolutions.filter((r) => r.approved && !r.target);
  const pending = resolutions.filter((r) => !r.approved);
  const byKind = terms.reduce((acc, t) => { acc[t.kind] = (acc[t.kind] || 0) + 1; return acc; }, {});

  const checks = [
    ['relocated', relocated.length, EXPECTED.relocated],
    ['renamed', renamed.length, EXPECTED.renamed],
    ['relocated AND renamed', both.length, EXPECTED.overlap],
    ['changed (union)', changed.length, EXPECTED.changed],
    ['unchanged', unchanged.length, EXPECTED.unchanged],
    ['resolutions total', resolutions.length, EXPECTED.resolutions],
    ['resolutions approved with target', withTarget.length, EXPECTED.resolutionsWithTarget],
    ['resolutions approved without target', withoutTarget.length, EXPECTED.resolutionsWithoutTarget],
    ['pending INSUFFICIENT_EVIDENCE', pending.length, EXPECTED.pending],
    ['terms total', terms.length, EXPECTED.terms],
    ['LEGACY_NAME', byKind.LEGACY_NAME || 0, EXPECTED.legacyNames],
    ['SYNONYM', byKind.SYNONYM || 0, EXPECTED.synonyms],
    ['MERGED_IDENTITY_TERM', byKind.MERGED_IDENTITY_TERM || 0, EXPECTED.mergedTerms],
    ['placement rows', pkg.placement.length, EXPECTED.placementRows]
  ];

  const failures = checks.filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual, expected]) => `${label}: derived ${actual}, ratified ${expected}`);
  if (failures.length) {
    throw new Error(`derived package departs from the ratified accounting:\n  - ${failures.join('\n  - ')}`);
  }

  // Every approved target must be an identity, and no approved no-successor row
  // may carry one. A pending row must carry none.
  for (const r of resolutions) {
    if (r.approved && !r.target && !['NOT_AN_EQUIPMENT_TYPE', 'TOO_BROAD_FOR_TYPE'].includes(r.kind)) {
      throw new Error(`approved resolution ${r.candidateId} (${r.kind}) must carry a target`);
    }
    if (!r.approved && r.target) throw new Error(`pending resolution ${r.candidateId} must not carry a target`);
  }

  const newClasses = new Set(pkg.placement.filter((p) => p.class_action === 'ADD_REQUIRED')
    .map((p) => `${p.final_category}|${p.final_class}`));
  if (newClasses.size !== EXPECTED.newClasses) {
    throw new Error(`expected ${EXPECTED.newClasses} distinct new classes, derived ${newClasses.size}`);
  }
  const newCategories = new Set(pkg.placement.filter((p) => p.category_action === 'ADD_REQUIRED')
    .map((p) => p.final_category));
  if (newCategories.size !== EXPECTED.newCategories) {
    throw new Error(`expected ${EXPECTED.newCategories} new category, derived ${newCategories.size}`);
  }
  for (const [cat, cls] of NEW_CLASSES) {
    if (!newClasses.has(`${cat}|${cls}`)) throw new Error(`ratified new class missing from derivation: ${cat} > ${cls}`);
  }

  return {
    changed: changed.length, unchanged: unchanged.length, relocated: relocated.length,
    renamed: renamed.length, both: both.length,
    withTarget: withTarget.length, withoutTarget: withoutTarget.length, pending: pending.length,
    byKind
  };
}

// ---------------------------------------------------------------------------
// database adapter
// ---------------------------------------------------------------------------

const normalise = (text) => String(text).trim().toLowerCase().replace(/\s+/g, ' ');

function createPool() {
  return new Pool({
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.PGPORT || process.env.DB_PORT || '5432', 10),
    database: process.env.PGDATABASE || process.env.DB_NAME || 'odm_cmms',
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
  });
}

async function resolvePrincipal(client, value, role) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`--${role} is required: the accountable human must be named explicitly and is never fabricated by this script`);
  }
  const asId = /^\d+$/.test(String(value)) ? parseInt(value, 10) : null;
  const { rows } = await client.query(
    asId === null
      ? 'SELECT id, username FROM users WHERE username = $1'
      : 'SELECT id, username FROM users WHERE id = $1',
    [asId === null ? String(value) : asId]
  );
  if (rows.length !== 1) {
    throw new Error(`--${role} '${value}' does not resolve to exactly one users row`);
  }
  return rows[0];
}

/** Resolve every corpus identity to its live equipment_types.id, loudly. */
async function resolveCorpusIdentities(client, pkg) {
  const resolved = new Map();
  for (const row of pkg.reconciliation) {
    const identity = pkg.identityOf(row.candidate_id);
    const { rows } = await client.query(`
      SELECT t.id, t.type_code, t.type_name
      FROM equipment_types t
      JOIN equipment_classes c ON c.id = t.class_id
      JOIN equipment_categories g ON g.id = c.category_id
      WHERE g.category_code = $1 AND c.class_code = $2 AND t.type_code = $3`,
    [identity.categoryCode, identity.classCode, identity.typeCode]);

    if (rows.length !== 1) {
      throw new Error(
        `candidate ${row.candidate_id} (${identity.categoryCode}/${identity.classCode}/${identity.typeCode}) `
        + `resolved to ${rows.length} equipment_types rows; exactly one is required. `
        + 'The corpus is absent or has drifted — refusing to guess.');
    }
    if (rows[0].id !== identity.corpusId) {
      throw new Error(
        `candidate ${row.candidate_id} resolved to equipment_types.id ${rows[0].id} but the corpus records id `
        + `${identity.corpusId}. Identity drift — refusing to apply.`);
    }
    resolved.set(row.candidate_id, rows[0].id);
  }
  if (resolved.size !== EXPECTED.corpusRows) {
    throw new Error(`resolved ${resolved.size} identities, expected ${EXPECTED.corpusRows}`);
  }
  return resolved;
}

async function loadProvenance(client) {
  const { rows } = await client.query(
    'SELECT id, source_code FROM knowledge_sources WHERE source_code = ANY($1)',
    [[PROVENANCE.corpus.code, PROVENANCE.reasoning.code]]);
  return new Map(rows.map((r) => [r.source_code, r.id]));
}

/**
 * Align an identity sequence with the rows that already exist.
 *
 * ---------------------------------------------------------------------------
 * DISCOVERED PREREQUISITE DEFECT — the bootstrap never advances the sequences
 * ---------------------------------------------------------------------------
 * `scripts/bootstrap-knowledge/bootstrap.js` inserts taxonomy rows with EXPLICIT
 * ids straight from the corpus (`columns: ['id', 'class_id', 'type_code', ...]`),
 * and it does so inside a plain INSERT that never calls `nextval`. The identity
 * sequences are therefore left where they started. Measured on a freshly
 * bootstrapped database:
 *
 *     equipment_categories  rows 65   max(id) 223   sequence last_value 1
 *     equipment_classes     rows 311  max(id) 789   sequence never called
 *     equipment_types       rows 282  max(id) 283   sequence last_value 1
 *
 * (The corpus uses its own sparse id space: type id 73 does not exist, and the
 * categories/classes spaces are sparse too. Only sequences are affected.)
 *
 * The consequence is not specific to this application: ANY insert into these
 * tables that lets the database assign the id collides with an existing row.
 * This application therefore cannot create one category, five classes or one
 * type until the sequences are aligned. The alignment is the root-cause repair,
 * it is idempotent, and it is a no-op on a healthy database because it only ever
 * moves a sequence FORWARD to meet the data that already exists.
 *
 * This is sequence state, not schema and not taxonomy content: no row is created,
 * changed or removed by it, and it is deliberately conditional so a correctly
 * sequenced database is left untouched.
 */
async function alignIdentitySequence(client, table) {
  const allowed = ['equipment_categories', 'equipment_classes', 'equipment_types'];
  if (!allowed.includes(table)) throw new Error(`refusing to align an unlisted table: ${table}`);
  const { rows } = await client.query(`
    WITH state AS (
      SELECT
        pg_get_serial_sequence('${table}', 'id') AS seq,
        (SELECT COALESCE(max(id), 0) FROM ${table}) AS max_id,
        (SELECT last_value FROM pg_sequences
          WHERE schemaname = 'public'
            AND sequencename = replace(pg_get_serial_sequence('${table}', 'id'), 'public.', '')) AS last_value
    )
    SELECT seq, max_id, last_value,
           CASE WHEN seq IS NULL THEN false
                WHEN last_value IS NULL THEN true
                ELSE last_value < max_id END AS needs_alignment
    FROM state`);
  const state = rows[0];
  if (!state.needs_alignment) return { table, aligned: false, maxId: Number(state.max_id) };
  await client.query(
    `SELECT setval($1, GREATEST((SELECT COALESCE(max(id),0) FROM ${table}), 1),
                    (SELECT COALESCE(max(id),0) FROM ${table}) > 0)`,
    [state.seq]);
  return { table, aligned: true, maxId: Number(state.max_id) };
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

async function applyTransaction(client, label, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    error.message = `[${label}] ${error.message}`;
    throw error;
  }
}

async function apply(client, pkg, stats, principals, log) {
  const { transformations, resolutions, terms } = pkg;

  // =========================================================================
  // ONE TRANSACTION FOR THE WHOLE GOVERNED PACKAGE
  // =========================================================================
  //
  // The package is applied in a SINGLE transaction, deliberately.
  //
  // An earlier revision committed three transactions (structure, resolutions,
  // terminology) and created the provenance anchor in the first. A failure in a
  // later stage therefore left a PARTIALLY applied package committed, including
  // the anchor that marks the package as applied — and the re-run path, seeing
  // that anchor, verified instead of applying, so the incomplete package could
  // never be completed by retrying. That is the defect this structure removes:
  // either the whole ratified package commits, or nothing does, and a failed run
  // leaves a database that is honestly un-applied and cleanly retryable.
  //
  // Migration 019's lifecycle coherence is DEFERRABLE INITIALLY DEFERRED, so it
  // is evaluated once at COMMIT against the final state — which is exactly what
  // makes a single transaction possible. Every Type is coherent by then: 19
  // superseded each with one active approved target-bearing resolution, 33
  // retired each with one active approved resolution and no target, and 231
  // canonical with none.
  // =========================================================================
  return applyTransaction(client, 'M5R.4B2 governed content application', async () => {
    // ---- stage 1: sequence alignment -------------------------------------
    // setval() is NOT transactional in PostgreSQL: it is not rolled back when
    // the surrounding transaction aborts (verified empirically against this
    // repository's target versions). That is harmless here and is relied on
    // only in the safe direction — it moves a sequence FORWARD to meet rows that
    // already exist, creates no row, cannot mark the package applied (the
    // provenance anchor row does that, and a row IS transactional), and cannot
    // collide with an existing identity because the sequence is left at or above
    // max(id).
    const alignments = [];
    for (const table of ['equipment_categories', 'equipment_classes', 'equipment_types']) {
      alignments.push(await alignIdentitySequence(client, table));
    }

    // ---- stage 2: provenance substrate -----------------------------------
    const sourceIds = {};
    for (const [key, source] of Object.entries(PROVENANCE)) {
      const inserted = await client.query(`
        INSERT INTO knowledge_sources (source_code, source_category, default_title, issuing_organization, organization_id)
        VALUES ($1, $2, $3, 'Atiman', NULL) RETURNING id`,
      [source.code, source.category, source.title]);
      sourceIds[key] = inserted.rows[0].id;
    }
    const version = await client.query(`
      INSERT INTO knowledge_source_versions
        (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
      VALUES ($1, $2, $3, $4, 'Atiman') RETURNING id`,
    [sourceIds.reasoning, 'M5R.4B2',
      'ATM-001 M5R.4A/M5R.4B1 accepted equipment-type reconciliation package',
      'docs/architecture/ATM-001-M5R4A-Equipment-Type-Reconciliation.md + docs/architecture/ATM-001-M5R4B1-Taxonomy-Identity-Lifecycle-Architecture.md']);
    await client.query(`
      INSERT INTO knowledge_source_versions
        (knowledge_source_id, version_designation, title, reference_number, issuing_organization)
      VALUES ($1, $2, $3, $4, 'Atiman')`,
    [sourceIds.corpus, 'v1', 'Atiman legacy equipment-type corpus (282 identities)',
      'scripts/bootstrap-knowledge/equipment_types.jsonl']);

    // ---- stage 3: parent structure ---------------------------------------
    await client.query(
      'INSERT INTO equipment_categories (category_code, category_name, description) VALUES ($1, $2, $3)',
      ['MINE_EQ', NEW_CATEGORY, 'Mining machinery domain established by ATM-001 M5R.4B1.']);

    for (const [categoryName, className] of NEW_CLASSES) {
      const owner = await client.query(
        'SELECT id FROM equipment_categories WHERE category_name = $1', [categoryName]);
      if (owner.rows.length !== 1) throw new Error(`new class "${className}" needs category "${categoryName}"`);
      await client.query(
        'INSERT INTO equipment_classes (category_id, class_code, class_name, description) VALUES ($1, $2, $3, $4)',
        [owner.rows[0].id, className.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 50), className,
          'Class established by ATM-001 M5R.4B1.']);
    }

    // ---- stage 4: the one genuinely new canonical Type -------------------
    const pumpClass = await client.query(`
      SELECT c.id FROM equipment_classes c
      JOIN equipment_categories g ON g.id = c.category_id
      WHERE g.category_name = $1 AND c.class_name = $2`, [NEW_TYPE.category, NEW_TYPE.class]);
    if (pumpClass.rows.length !== 1) throw new Error(`new type needs class ${NEW_TYPE.category} > ${NEW_TYPE.class}`);
    const newTypeClassId = pumpClass.rows[0].id;

    const clash = await client.query(
      'SELECT id FROM equipment_types WHERE class_id = $1 AND type_code = $2', [newTypeClassId, NEW_TYPE.code]);
    if (clash.rows.length) throw new Error(`type_code ${NEW_TYPE.code} already exists in the target class`);
    const newType = await client.query(
      'INSERT INTO equipment_types (class_id, type_code, type_name, description) VALUES ($1, $2, $3, $4) RETURNING id',
      [newTypeClassId, NEW_TYPE.code, NEW_TYPE.name,
        'Canonical Type established by ATM-001 M5R.4B1 section 21.5 as the endpoint for candidates 7 and 8.']);
    const newTypeId = newType.rows[0].id;

    // ---- stage 5: existing-row transformations ---------------------------
    // Resolved by live id, never by name.
    for (const t of transformations) {
      const liveId = stats.resolved.get(t.candidateId);
      const sets = []; const params = [];
      if (t.relocated && (t.targetCategory !== null || t.targetClass !== null)) {
        const target = await client.query(`
          SELECT c.id FROM equipment_classes c
          JOIN equipment_categories g ON g.id = c.category_id
          WHERE g.category_name = $1 AND c.class_name = $2`, [t.targetCategory, t.targetClass]);
        if (target.rows.length !== 1) {
          throw new Error(`candidate ${t.candidateId} target class ${t.targetCategory} > ${t.targetClass} unresolved`);
        }
        params.push(target.rows[0].id); sets.push(`class_id = $${params.length}`);
      }
      if (t.renamed) { params.push(t.targetName); sets.push(`type_name = $${params.length}`); }
      if (!sets.length) continue;
      params.push(liveId);
      await client.query(
        `UPDATE equipment_types SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`, params);
    }

    // ---- stage 6: governed identity resolutions --------------------------
    for (const r of resolutions) {
      const fromId = stats.resolved.get(r.candidateId);
      let toId = null;
      if (r.target) {
        toId = r.target.kind === 'NEW_TYPE' ? newTypeId : stats.resolved.get(r.target.candidateId);
        if (!toId) throw new Error(`resolution ${r.candidateId} target did not resolve to an identity`);
      }
      if (r.approved) {
        await client.query(`
          INSERT INTO equipment_type_identity_resolution
            (from_type_id, to_type_id, resolution_kind, rationale, review_state,
             proposed_by_user_id, reviewed_by_user_id, reviewed_at,
             approved_by_user_id, approved_at, ai_assisted, knowledge_source_version_id, effective_from)
          VALUES ($1, $2, $3, $4, 'approved', $5, $5, CURRENT_TIMESTAMP, $6, CURRENT_TIMESTAMP,
                  FALSE, $7, CURRENT_TIMESTAMP)`,
        [fromId, toId, r.kind, r.rationale, principals.reviewer.id, principals.approver.id, version.rows[0].id]);
      } else {
        await client.query(`
          INSERT INTO equipment_type_identity_resolution
            (from_type_id, to_type_id, resolution_kind, rationale, review_state,
             proposed_by_user_id, ai_assisted, knowledge_source_version_id)
          VALUES ($1, NULL, 'INSUFFICIENT_EVIDENCE', $2, 'under_review', $3, FALSE, $4)`,
        [fromId, r.rationale, principals.reviewer.id, version.rows[0].id]);
      }
    }

    // ---- stage 7: governed terminology -----------------------------------
    for (const t of terms) {
      const canonicalId = t.canonical.kind === 'NEW_TYPE'
        ? newTypeId
        : (t.canonical.kind === 'SELF' ? stats.resolved.get(t.candidateId)
          : (t.canonical.kind === 'EXISTING' ? stats.resolved.get(t.canonical.candidateId) : null));
      if (!canonicalId) throw new Error(`term for candidate ${t.candidateId} has no canonical identity`);
      await client.query(`
        INSERT INTO equipment_type_term
          (term, normalized_term, canonical_type_id, source_type_id, term_kind, rationale, review_state,
           proposed_by_user_id, reviewed_by_user_id, reviewed_at,
           approved_by_user_id, approved_at, ai_assisted, knowledge_source_version_id, effective_from)
        VALUES ($1, $2, $3, $4, $5, $6, 'approved', $7, $7, CURRENT_TIMESTAMP, $8, CURRENT_TIMESTAMP,
                FALSE, $9, CURRENT_TIMESTAMP)`,
      [t.term, normalise(t.term), canonicalId, stats.resolved.get(t.candidateId), t.kind, t.rationale,
        principals.reviewer.id, principals.approver.id, version.rows[0].id]);
    }

    const aligned = alignments.filter((a) => a.aligned).map((a) => `${a.table}(max ${a.maxId})`);
    if (aligned.length) log(`  sequences : aligned ${aligned.join(', ')}`);
    log(`  structure : category + ${NEW_CLASSES.length} classes + 1 type; `
      + `${transformations.filter((t) => t.relocated).length} relocations, `
      + `${transformations.filter((t) => t.renamed).length} renames`);
    log(`  resolutions: ${resolutions.filter((r) => r.approved).length} approved, `
      + `${resolutions.filter((r) => !r.approved).length} pending`);
    log(`  terminology: ${terms.length} governed terms`);

    return { newTypeId, versionId: version.rows[0].id };
  });
}

// ---------------------------------------------------------------------------
// verification
// ---------------------------------------------------------------------------

async function verify(client, pkg) {
  const failures = [];
  const check = (label, actual, expected) => {
    if (actual !== expected) failures.push(`${label}: found ${actual}, expected ${expected}`);
  };

  const totals = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE identity_state = 'canonical')::int AS canonical,
           count(*) FILTER (WHERE identity_state = 'superseded')::int AS superseded,
           count(*) FILTER (WHERE identity_state = 'retired')::int AS retired,
           count(*) FILTER (WHERE identity_state NOT IN ('canonical','superseded','retired'))::int AS invalid
    FROM equipment_types`);
  check('equipment types total', totals.rows[0].total, EXPECTED.resultTypes);
  check('canonical', totals.rows[0].canonical, EXPECTED.resultCanonical);
  check('superseded', totals.rows[0].superseded, EXPECTED.superseded);
  check('retired', totals.rows[0].retired, EXPECTED.retired);
  check('invalid lifecycle values', totals.rows[0].invalid, 0);

  const structure = await client.query(`
    SELECT
      (SELECT count(*)::int FROM equipment_categories WHERE category_name = $1) AS category,
      (SELECT count(*)::int FROM equipment_types WHERE type_name = $2) AS new_type`,
  [NEW_CATEGORY, NEW_TYPE.name]);
  check(`category "${NEW_CATEGORY}"`, structure.rows[0].category, 1);
  check(`type "${NEW_TYPE.name}"`, structure.rows[0].new_type, 1);

  for (const [categoryName, className] of NEW_CLASSES) {
    const r = await client.query(`
      SELECT count(*)::int AS n FROM equipment_classes c
      JOIN equipment_categories g ON g.id = c.category_id
      WHERE g.category_name = $1 AND c.class_name = $2`, [categoryName, className]);
    check(`class ${categoryName} > ${className}`, r.rows[0].n, 1);
  }

  const resolutions = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE review_state = 'approved' AND to_type_id IS NOT NULL)::int AS with_target,
           count(*) FILTER (WHERE review_state = 'approved' AND to_type_id IS NULL)::int AS without_target,
           count(*) FILTER (WHERE resolution_kind = 'INSUFFICIENT_EVIDENCE' AND review_state <> 'approved')::int AS pending
    FROM equipment_type_identity_resolution`);
  check('resolutions total', resolutions.rows[0].total, EXPECTED.resolutions);
  check('resolutions with target', resolutions.rows[0].with_target, EXPECTED.resolutionsWithTarget);
  check('resolutions without target', resolutions.rows[0].without_target, EXPECTED.resolutionsWithoutTarget);
  check('pending resolutions', resolutions.rows[0].pending, EXPECTED.pending);

  const terms = await client.query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE term_kind = 'LEGACY_NAME')::int AS legacy,
           count(*) FILTER (WHERE term_kind = 'SYNONYM')::int AS synonym,
           count(*) FILTER (WHERE term_kind = 'MERGED_IDENTITY_TERM')::int AS merged
    FROM equipment_type_term`);
  check('terms total', terms.rows[0].total, EXPECTED.terms);
  check('LEGACY_NAME', terms.rows[0].legacy, EXPECTED.legacyNames);
  check('SYNONYM', terms.rows[0].synonym, EXPECTED.synonyms);
  check('MERGED_IDENTITY_TERM', terms.rows[0].merged, EXPECTED.mergedTerms);

  // Lifecycle coherence, stated independently of the application.
  const incoherent = await client.query(`
    SELECT t.id FROM equipment_types t
    LEFT JOIN equipment_type_identity_resolution r
      ON r.from_type_id = t.id AND r.review_state = 'approved' AND r.superseded_by_resolution_id IS NULL
    GROUP BY t.id, t.identity_state
    HAVING (t.identity_state = 'canonical'  AND count(r.id) <> 0)
        OR (t.identity_state = 'superseded' AND (count(r.id) <> 1
             OR count(r.id) FILTER (WHERE r.to_type_id IS NOT NULL) <> 1))
        OR (t.identity_state = 'retired'    AND (count(r.id) <> 1
             OR count(r.id) FILTER (WHERE r.to_type_id IS NOT NULL) <> 0))`);
  check('lifecycle-incoherent types', incoherent.rows.length, 0);

  // Import safety after application.
  for (const code of ['COMPACT']) {
    const r = await client.query(`
      SELECT count(*)::int AS n FROM equipment_types
      WHERE LOWER(type_code) = LOWER($1) AND identity_state = 'canonical'`, [code]);
    check(`canonical matches for ${code} after application`, r.rows[0].n, 0);
  }

  return { failures, summary: { totalling: totals.rows[0], resolutions: resolutions.rows[0], terms: terms.rows[0] } };
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const applyRequested = process.argv.includes('--apply');
  if (!dryRun && !applyRequested) {
    throw new Error('refusing to guess intent: pass --dry-run to inspect or --apply to perform the application');
  }

  const log = (message) => console.log(message);

  log('ATM-001 M5R.4B2 — governed taxonomy application');
  log('');
  log('deriving the package from the ratified artifacts...');
  const pkg = derivePackage();
  const stats = assertAccounting(pkg);
  log(`  dispositions  ${pkg.reconciliation.length} rows`);
  log(`  transformations ${stats.changed} changed (${stats.relocated} relocated, ${stats.renamed} renamed, ${stats.both} both), ${stats.unchanged} unchanged`);
  log(`  resolutions   ${stats.withTarget} with target, ${stats.withoutTarget} without, ${stats.pending} pending`);
  log(`  terminology   ${stats.byKind.LEGACY_NAME} LEGACY_NAME, ${stats.byKind.SYNONYM} SYNONYM, ${stats.byKind.MERGED_IDENTITY_TERM} MERGED_IDENTITY_TERM`);
  log(`  new structure 1 category "${NEW_CATEGORY}", ${NEW_CLASSES.length} classes, 1 type "${NEW_TYPE.name}" (code ${NEW_TYPE.code})`);
  log('  derived package matches the ratified accounting.');

  const pool = createPool();
  const client = await pool.connect();
  try {
    const existing = await loadProvenance(client);
    if (existing.has(PROVENANCE.reasoning.code)) {
      log('');
      log('M5R.4B2 already applied (provenance anchor present) — verifying instead of re-applying.');
      const result = await verify(client, pkg);
      if (result.failures.length) {
        log('VERIFICATION FAILED:');
        for (const f of result.failures) log(`  - ${f}`);
        process.exitCode = 1;
        return;
      }
      log('postconditions hold. Nothing to do.');
      return;
    }

    stats.resolved = await resolveCorpusIdentities(client, pkg);
    log(`  resolved ${stats.resolved.size}/282 corpus identities to live equipment_types ids (no drift).`);

    if (dryRun) {
      log('');
      log('DRY RUN — all preconditions satisfied. No writes performed.');
      log('Re-run with --apply --reviewer <user> --approver <user> to apply.');
      return;
    }

    const principals = {
      reviewer: await resolvePrincipal(client, argValue('--reviewer'), 'reviewer'),
      approver: await resolvePrincipal(client, argValue('--approver'), 'approver')
    };
    log('');
    log(`accountable reviewer : ${principals.reviewer.username} (users.id ${principals.reviewer.id})`);
    log(`accountable approver : ${principals.approver.username} (users.id ${principals.approver.id})`);
    log('');

    await apply(client, pkg, stats, principals, log);

    log('');
    const result = await verify(client, pkg);
    if (result.failures.length) {
      log('POSTCONDITION VERIFICATION FAILED:');
      for (const f of result.failures) log(`  - ${f}`);
      process.exitCode = 1;
      return;
    }
    const s = result.summary;
    log(`applied. equipment types ${s.totalling.total} `
      + `(canonical ${s.totalling.canonical}, superseded ${s.totalling.superseded}, retired ${s.totalling.retired}); `
      + `resolutions ${s.resolutions.total}; terms ${s.terms.total}.`);
    log('all postconditions verified.');
  } finally {
    client.release();
    await pool.end();
  }
}

if (require.main === module) {
  main()
    .then(() => {
      if (process.exitCode) process.exit(process.exitCode);
    })
    .catch((error) => {
      console.error('');
      console.error('M5R.4B2 APPLICATION FAILED — no partial state was committed beyond completed transactions.');
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = { derivePackage, assertAccounting, normalise, EXPECTED, NEW_CATEGORY, NEW_CLASSES, NEW_TYPE };
