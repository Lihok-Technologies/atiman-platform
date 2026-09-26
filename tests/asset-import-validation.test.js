const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const controller = require('../src/controllers/asset-import.controller');

describe('asset import validation limits', () => {
  it('applies the CSV row limit to validation uploads and removes the temporary file', async () => {
    const original = process.env.ASSET_IMPORT_MAX_ROWS;
    const filePath = path.join(os.tmpdir(), `odm-csv-limit-${Date.now()}.csv`);
    fs.writeFileSync(filePath, 'organization_id,facility_name,asset_name,equipment_type_code\nORG,Main,A1,PUMP\nORG,Main,A2,PUMP\n');
    process.env.ASSET_IMPORT_MAX_ROWS = '1';
    let response;
    const res = {
      status(code) { response = { code }; return this; },
      json(body) { response.body = body; return this; }
    };
    try {
      await controller.validateImport({ file: { path: filePath } }, res);
      assert.strictEqual(response.code, 400);
      assert.match(response.body.message, /1-row import limit/);
      assert.strictEqual(fs.existsSync(filePath), false);
    } finally {
      if (original === undefined) delete process.env.ASSET_IMPORT_MAX_ROWS;
      else process.env.ASSET_IMPORT_MAX_ROWS = original;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });
});

/**
 * The published import specification is user-facing: it is returned by
 * GET /api/assets/import/spec and drives the operator's understanding of what
 * `equipment_type_code` means.
 *
 * Atiman OWNS its equipment taxonomy. M5R.1 §1 establishes that no single
 * external standard owns Atiman equipment identity, and M5R.4A §10 records that
 * NO standards evidence exists — the crosswalk tables are empty and the legacy
 * `iso_*` columns are FALSE_PROVENANCE. Describing this field as an
 * "ISO 14224" code therefore claimed provenance that has never been
 * established.
 *
 * Scope note: this corrects the three EXECUTABLE, user-visible occurrences
 * inside the import workflow only. The remaining false-provenance commentary
 * elsewhere in the repository is separate, recorded debt and is deliberately
 * NOT cleaned up here.
 */
describe('asset import specification provenance', () => {
  // GET /api/assets/import/spec responds with { success, data: spec }.
  const getSpec = () => {
    let response;
    const res = { json(body) { response = body; return this; } };
    controller.getSpec({}, res);
    assert.ok(response && response.data, 'the specification endpoint must return its spec');
    return response.data;
  };

  it('does not describe the equipment type code as an ISO 14224 code', () => {
    const spec = getSpec();
    const field = spec.required_fields.find((f) => f.name === 'equipment_type_code');
    assert.ok(field, 'the specification must still declare equipment_type_code');
    assert.doesNotMatch(field.description, /ISO\s*14224/i,
      'Atiman equipment identity is Atiman-owned; no external-standard provenance has been established');
    assert.match(field.description, /Atiman/i,
      'the description must attribute the taxonomy to Atiman');
  });

  it('does not claim an ISO 14224 validation rule', () => {
    const spec = getSpec();
    const rule = spec.validation_rules.find((r) => r.startsWith('equipment_type_code'));
    assert.ok(rule, 'the specification must still declare the equipment_type_code rule');
    assert.doesNotMatch(rule, /ISO\s*14224/i);
    assert.match(rule, /canonical Atiman equipment type/i,
      'the rule must state the actual contract: one canonical Atiman equipment type');
  });

  it('publishes no ISO 14224 claim anywhere in the import workflow sources', () => {
    const workflow = [
      path.join(__dirname, '..', 'src', 'controllers', 'asset-import.controller.js'),
      path.join(__dirname, '..', 'src', 'services', 'asset-import.service.js'),
      path.join(__dirname, '..', 'src', 'routes', 'asset-import.routes.js')
    ];
    for (const file of workflow) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ISO\s*14224/i,
        `${path.basename(file)} must not claim ISO 14224 provenance`);
    }
  });
});
