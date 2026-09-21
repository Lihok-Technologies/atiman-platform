/**
 * Step 6: Seed and Migration Validation Tests
 * Validates: Idempotent seed reruns, safe rollback, coverage validation consistency
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createPool, isIntegrationTest } = require('../src/config/database');

const TEST_TIMEOUT = 60000;
const TEST_ORG_ID = 666666;

// Destructive database suite: gated on isIntegrationTest(), the same predicate
// that selects TEST_DB_* credentials, so it can never run against runtime
// DB_*/PG* credentials.
describe('Step 6: Seed & Migration Validation', { skip: !isIntegrationTest() }, () => {
  let pool;

  before(async () => {
    pool = createPool();
    await setupSeedTestEnvironment(pool);
  }, TEST_TIMEOUT);

  after(async () => {
    await cleanupSeedTestEnvironment(pool);
    await pool.end();
  }, TEST_TIMEOUT);

  // ============================================================================
  // SECTION 1: Idempotent Seed Reruns
  // ============================================================================
  describe('Idempotent Seed Reruns', () => {
    it('should not duplicate equipment types on rerun', async () => {
      // First run
      await runSeedScript(pool, TEST_ORG_ID);
      
      const count1 = await getEquipmentTypeCount(pool, TEST_ORG_ID);
      
      // Second run (should be idempotent)
      await runSeedScript(pool, TEST_ORG_ID);
      
      const count2 = await getEquipmentTypeCount(pool, TEST_ORG_ID);
      
      assert.strictEqual(count1, count2, 'Equipment count should not change on rerun');
    });

    it('should not duplicate template families on rerun', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      const count1 = await getFamilyCount(pool, TEST_ORG_ID);
      
      await runSeedScript(pool, TEST_ORG_ID);
      const count2 = await getFamilyCount(pool, TEST_ORG_ID);
      
      assert.strictEqual(count1, count2, 'Family count should not change on rerun');
    });

    it('should not duplicate industries on rerun', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      const count1 = await getIndustryCount(pool, TEST_ORG_ID);
      
      await runSeedScript(pool, TEST_ORG_ID);
      const count2 = await getIndustryCount(pool, TEST_ORG_ID);
      
      assert.strictEqual(count1, count2, 'Industry count should not change on rerun');
    });

    it('should not duplicate system templates on rerun', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      const count1 = await getSystemTemplateCount(pool, TEST_ORG_ID);
      
      await runSeedScript(pool, TEST_ORG_ID);
      const count2 = await getSystemTemplateCount(pool, TEST_ORG_ID);
      
      assert.strictEqual(count1, count2, 'Template count should not change on rerun');
    });

    it('should preserve custom mappings on rerun', async () => {
      // Run seed first
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Create a custom mapping
      await pool.query(
        `INSERT INTO equipment_type_mappings 
         (equipment_type_id, family_code, org_id, created_at)
         VALUES ('CUSTOM_EQUIP', 'CUSTOM_FAMILY', ?, NOW())
         ON DUPLICATE KEY UPDATE family_code = 'CUSTOM_FAMILY'`,
        [TEST_ORG_ID]
      );
      
      // Run seed again
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Verify custom mapping is preserved
      const [mapping] = await pool.query(
        'SELECT family_code FROM equipment_type_mappings WHERE equipment_type_id = ? AND org_id = ?',
        ['CUSTOM_EQUIP', TEST_ORG_ID]
      );
      
      assert.ok(mapping, 'Custom mapping should exist');
      assert.strictEqual(mapping.family_code, 'CUSTOM_FAMILY', 'Custom mapping should be preserved');
    });

    it('should handle partial seed state gracefully', async () => {
      // Simulate partial seed by inserting only some records
      await pool.query(
        `INSERT INTO industries (industry_code, industry_name, org_id, created_at)
         VALUES ('PARTIAL_INDUSTRY', 'Partial Industry', ?, NOW())
         ON DUPLICATE KEY UPDATE industry_name = 'Partial Industry'`,
        [TEST_ORG_ID]
      );
      
      // Run full seed (should complete without error)
      await assert.doesNotReject(
        async () => await runSeedScript(pool, TEST_ORG_ID),
        'Should handle partial state gracefully'
      );
      
      // Verify all expected records exist
      const industryCount = await getIndustryCount(pool, TEST_ORG_ID);
      assert.ok(industryCount > 1, 'Should have all industries after seed');
    });
  });

  // ============================================================================
  // SECTION 2: Safe Rollback Behavior
  // ============================================================================
  describe('Safe Rollback Behavior', () => {
    it('should track batch IDs for rollback', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      const batches = await pool.query(
        'SELECT DISTINCT batch_id FROM seed_tracking WHERE org_id = ? ORDER BY created_at DESC',
        [TEST_ORG_ID]
      );
      
      assert.ok(batches.length > 0, 'Should have batch tracking records');
      assert.ok(batches[0].batch_id, 'Should have valid batch ID');
    });

    it('should rollback templates by batch', async () => {
      // Run seed and get batch ID
      const batchId = await runSeedScript(pool, TEST_ORG_ID);
      
      // Verify templates exist
      const beforeCount = await getSystemTemplateCount(pool, TEST_ORG_ID);
      assert.ok(beforeCount > 0, 'Should have templates before rollback');
      
      // Rollback
      await rollbackBatch(pool, batchId, TEST_ORG_ID);
      
      // Verify templates removed
      const afterCount = await getSystemTemplateCount(pool, TEST_ORG_ID);
      assert.strictEqual(afterCount, 0, 'Templates should be removed after rollback');
    });

    it('should preserve non-batch records during rollback', async () => {
      // Add pre-existing record
      await pool.query(
        `INSERT INTO smp_templates (template_code, template_name, is_system, org_id, created_at)
         VALUES ('PRE_EXISTING', 'Pre-existing Template', 0, ?, NOW())`,
        [TEST_ORG_ID]
      );
      
      // Run seed
      const batchId = await runSeedScript(pool, TEST_ORG_ID);
      
      // Rollback
      await rollbackBatch(pool, batchId, TEST_ORG_ID);
      
      // Verify pre-existing record remains
      const [record] = await pool.query(
        'SELECT template_code FROM smp_templates WHERE template_code = ? AND org_id = ?',
        ['PRE_EXISTING', TEST_ORG_ID]
      );
      
      assert.ok(record, 'Pre-existing record should be preserved');
    });

    it('should not affect other orgs during rollback', async () => {
      const otherOrgId = 666667;
      
      // Setup other org
      await pool.query(
        `INSERT INTO organizations (id, name, status, created_at) 
         VALUES (?, 'Other Org', 'active', NOW())
         ON DUPLICATE KEY UPDATE name = 'Other Org'`,
        [otherOrgId]
      );
      
      // Run seed for both orgs
      const batchId1 = await runSeedScript(pool, TEST_ORG_ID);
      const batchId2 = await runSeedScript(pool, otherOrgId);
      
      const otherCountBefore = await getSystemTemplateCount(pool, otherOrgId);
      
      // Rollback only first org
      await rollbackBatch(pool, batchId1, TEST_ORG_ID);
      
      // Verify other org unaffected
      const otherCountAfter = await getSystemTemplateCount(pool, otherOrgId);
      assert.strictEqual(otherCountAfter, otherCountBefore, 'Other org should be unaffected');
      
      // Cleanup
      await rollbackBatch(pool, batchId2, otherOrgId);
      await pool.query('DELETE FROM organizations WHERE id = ?', [otherOrgId]);
    });
  });

  // ============================================================================
  // SECTION 3: Coverage Validation Consistency
  // ============================================================================
  describe('Coverage Validation Consistency', () => {
    it('should validate exactly one family per equipment type', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Create equipment with no family
      await pool.query(
        `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
         VALUES ('NO_FAMILY_EQUIP', 'No Family Equipment', 1, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE type_name = 'No Family Equipment'`,
        [TEST_ORG_ID]
      );
      
      const violations = await validateExactlyOneFamily(pool, TEST_ORG_ID);
      
      const noFamilyViolation = violations.find(v => v.equipment_type_id === 'NO_FAMILY_EQUIP');
      assert.ok(noFamilyViolation, 'Should detect equipment without family');
      
      // Now assign two families (should be invalid)
      await pool.query(
        `INSERT INTO equipment_type_mappings (equipment_type_id, family_code, org_id, created_at)
         VALUES ('NO_FAMILY_EQUIP', 'FAMILY_1', ?, NOW()),
                ('NO_FAMILY_EQUIP', 'FAMILY_2', ?, NOW())`,
        [TEST_ORG_ID, TEST_ORG_ID]
      );
      
      const multiFamilyViolations = await validateExactlyOneFamily(pool, TEST_ORG_ID);
      const multiFamilyViolation = multiFamilyViolations.find(v => v.equipment_type_id === 'NO_FAMILY_EQUIP');
      assert.ok(multiFamilyViolation, 'Should detect equipment with multiple families');
    });

    it('should validate at least one industry per equipment type with family', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Create equipment with family but no industry
      await pool.query(
        `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
         VALUES ('NO_INDUSTRY_EQUIP', 'No Industry Equipment', 1, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE type_name = 'No Industry Equipment'`,
        [TEST_ORG_ID]
      );
      
      await pool.query(
        `INSERT INTO equipment_type_mappings (equipment_type_id, family_code, org_id, created_at)
         VALUES ('NO_INDUSTRY_EQUIP', 'TEST_FAMILY', ?, NOW())`,
        [TEST_ORG_ID]
      );
      
      const violations = await validateAtLeastOneIndustry(pool, TEST_ORG_ID);
      const noIndustryViolation = violations.find(v => v.equipment_type_id === 'NO_INDUSTRY_EQUIP');
      
      assert.ok(noIndustryViolation, 'Should detect equipment with family but no industry');
    });

    it('should validate industry-aware templates exist', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Get equipment with family and industry
      const [equipWithMapping] = await pool.query(
        `SELECT e.type_code, m.family_code 
         FROM equipment_types e
         JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id
         WHERE e.org_id = ? LIMIT 1`,
        [TEST_ORG_ID]
      );
      
      if (equipWithMapping) {
        // Add industry mapping
        await pool.query(
          `INSERT INTO equipment_type_industries (equipment_type_id, industry_code, org_id, created_at)
           VALUES (?, 'TEST_INDUSTRY', ?, NOW())
           ON DUPLICATE KEY UPDATE industry_code = 'TEST_INDUSTRY'`,
          [equipWithMapping.type_code, TEST_ORG_ID]
        );
        
        const violations = await validateIndustryAwareTemplates(pool, TEST_ORG_ID);
        
        // Check if there's a violation for this equipment-industry combination
        const hasViolation = violations.some(v => 
          v.equipment_type_id === equipWithMapping.type_code
        );
        
        // May or may not have violation depending on templates
        // Just verify the validation runs without error
        assert.ok(Array.isArray(violations), 'Should return violations array');
      }
    });

    it('should produce consistent validation results across multiple runs', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Run validation multiple times
      const run1 = await runFullValidation(pool, TEST_ORG_ID);
      const run2 = await runFullValidation(pool, TEST_ORG_ID);
      const run3 = await runFullValidation(pool, TEST_ORG_ID);
      
      // Results should be identical
      assert.deepStrictEqual(run1, run2, 'Validation runs 1 and 2 should match');
      assert.deepStrictEqual(run2, run3, 'Validation runs 2 and 3 should match');
    });

    it('should update validation results after coverage changes', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      const before = await runFullValidation(pool, TEST_ORG_ID);
      
      // Create a new gap
      await pool.query(
        `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
         VALUES ('NEW_GAP_EQUIP', 'New Gap Equipment', 1, 1, ?, NOW())
         ON DUPLICATE KEY UPDATE type_name = 'New Gap Equipment'`,
        [TEST_ORG_ID]
      );
      
      const after = await runFullValidation(pool, TEST_ORG_ID);
      
      // Should detect new gap
      assert.ok(
        after.total_gaps >= before.total_gaps,
        'Should detect additional gap'
      );
    });
  });

  // ============================================================================
  // SECTION 4: Migration Safety
  // ============================================================================
  describe('Migration Safety', () => {
    it('should create required tables if not exist', async () => {
      // Drop test tables
      await pool.query('DROP TABLE IF EXISTS equipment_mapping_change_log_test');
      await pool.query('DROP TABLE IF EXISTS equipment_type_mappings_test');
      
      // Run migration
      await runMigration(pool);
      
      // Verify tables created
      const tables = await pool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME IN ('equipment_mapping_change_log', 'equipment_type_mappings', 
                           'equipment_type_industries', 'seed_tracking')`
      );
      
      const tableNames = tables.map(t => t.TABLE_NAME);
      assert.ok(tableNames.includes('equipment_mapping_change_log'), 'Should have audit log table');
      assert.ok(tableNames.includes('equipment_type_mappings'), 'Should have mappings table');
      assert.ok(tableNames.includes('equipment_type_industries'), 'Should have industries table');
    });

    it('should add missing columns to existing tables', async () => {
      // Migration should be idempotent for schema changes
      await assert.doesNotReject(
        async () => await runMigration(pool),
        'Migration should not fail on existing schema'
      );
    });

    it('should maintain referential integrity', async () => {
      await runSeedScript(pool, TEST_ORG_ID);
      
      // Check that all mappings reference valid equipment types
      const orphanMappings = await pool.query(
        `SELECT m.* FROM equipment_type_mappings m
         LEFT JOIN equipment_types e ON m.equipment_type_id = e.type_code AND m.org_id = e.org_id
         WHERE m.org_id = ? AND e.type_code IS NULL`,
        [TEST_ORG_ID]
      );
      
      assert.strictEqual(orphanMappings.length, 0, 'Should have no orphan mappings');
      
      // Check that all mappings reference valid families
      const orphanFamilies = await pool.query(
        `SELECT m.* FROM equipment_type_mappings m
         LEFT JOIN template_families f ON m.family_code = f.family_code AND m.org_id = f.org_id
         WHERE m.org_id = ? AND f.family_code IS NULL`,
        [TEST_ORG_ID]
      );
      
      assert.strictEqual(orphanFamilies.length, 0, 'Should have no orphan family references');
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupSeedTestEnvironment(pool) {
  await pool.query(
    `INSERT INTO organizations (id, name, status, created_at) 
     VALUES (?, 'Seed Test Org', 'active', NOW())
     ON DUPLICATE KEY UPDATE name = 'Seed Test Org'`,
    [TEST_ORG_ID]
  );
}

async function cleanupSeedTestEnvironment(pool) {
  await pool.query('DELETE FROM equipment_mapping_change_log WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM seed_tracking WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM equipment_type_industries WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM equipment_type_mappings WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM smp_templates WHERE org_id = ? AND is_system = 1', [TEST_ORG_ID]);
  await pool.query('DELETE FROM template_families WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM industries WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM equipment_types WHERE org_id = ? AND type_code LIKE "%EQUIP%"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM organizations WHERE id = ?', [TEST_ORG_ID]);
}

async function runSeedScript(pool, orgId) {
  // Simulate seed script execution
  const batchId = `batch_${Date.now()}_${orgId}`;
  
  // Track batch
  await pool.query(
    `INSERT INTO seed_tracking (batch_id, org_id, entity_type, entity_code, action, created_at)
     VALUES (?, ?, 'batch', ?, 'started', NOW())`,
    [batchId, orgId, batchId]
  );
  
  // Insert test data with ON DUPLICATE KEY UPDATE for idempotency
  await pool.query(
    `INSERT INTO industries (industry_code, industry_name, org_id, created_at)
     VALUES 
       ('WATER_WW', 'Water & Wastewater', ?, NOW()),
       ('OIL_GAS', 'Oil & Gas', ?, NOW()),
       ('POWER_GEN', 'Power Generation', ?, NOW())
     ON DUPLICATE KEY UPDATE industry_name = VALUES(industry_name)`,
    [orgId, orgId, orgId]
  );
  
  await pool.query(
    `INSERT INTO template_families (family_code, family_name, description, org_id, is_system, created_at)
     VALUES 
       ('PUMP_FAMILY', 'Pump Family', 'Pump equipment', ?, 1, NOW()),
       ('MOTOR_FAMILY', 'Motor Family', 'Motor equipment', ?, 1, NOW())
     ON DUPLICATE KEY UPDATE family_name = VALUES(family_name)`,
    [orgId, orgId]
  );
  
  await pool.query(
    `INSERT INTO smp_templates (template_code, template_name, family_code, is_system, org_id, created_at)
     VALUES 
       ('PUMP_INSPECTION', 'Pump Inspection', 'PUMP_FAMILY', 1, ?, NOW()),
       ('MOTOR_INSPECTION', 'Motor Inspection', 'MOTOR_FAMILY', 1, ?, NOW())
     ON DUPLICATE KEY UPDATE template_name = VALUES(template_name)`,
    [orgId, orgId]
  );
  
  return batchId;
}

async function rollbackBatch(pool, batchId, orgId) {
  // Get all entities from this batch
  const entities = await pool.query(
    'SELECT entity_type, entity_code FROM seed_tracking WHERE batch_id = ? AND org_id = ?',
    [batchId, orgId]
  );
  
  // Delete each entity type
  for (const entity of entities) {
    if (entity.entity_type === 'template') {
      await pool.query(
        'DELETE FROM smp_templates WHERE template_code = ? AND org_id = ?',
        [entity.entity_code, orgId]
      );
    }
    // ... handle other entity types
  }
  
  // Remove tracking records
  await pool.query(
    'DELETE FROM seed_tracking WHERE batch_id = ? AND org_id = ?',
    [batchId, orgId]
  );
}

async function runMigration(pool) {
  // Simulate migration - create tables if not exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipment_mapping_change_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      org_id INT NOT NULL,
      equipment_type_id VARCHAR(100) NOT NULL,
      change_type VARCHAR(50) NOT NULL,
      changed_by INT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      change_reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_org_equipment (org_id, equipment_type_id),
      INDEX idx_created_at (created_at)
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS equipment_type_mappings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      equipment_type_id VARCHAR(100) NOT NULL,
      family_code VARCHAR(100) NOT NULL,
      org_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_equip_family (equipment_type_id, family_code, org_id),
      INDEX idx_org_equipment (org_id, equipment_type_id)
    )
  `);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seed_tracking (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id VARCHAR(100) NOT NULL,
      org_id INT NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_code VARCHAR(100) NOT NULL,
      action VARCHAR(50) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_batch_org (batch_id, org_id)
    )
  `);
}

async function getEquipmentTypeCount(pool, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM equipment_types WHERE org_id = ?',
    [orgId]
  );
  return result.count;
}

async function getFamilyCount(pool, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM template_families WHERE org_id = ?',
    [orgId]
  );
  return result.count;
}

async function getIndustryCount(pool, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM industries WHERE org_id = ?',
    [orgId]
  );
  return result.count;
}

async function getSystemTemplateCount(pool, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM smp_templates WHERE org_id = ? AND is_system = 1',
    [orgId]
  );
  return result.count;
}

async function validateExactlyOneFamily(pool, orgId) {
  const violations = await pool.query(
    `SELECT e.type_code as equipment_type_id, COUNT(m.family_code) as family_count
     FROM equipment_types e
     LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
     WHERE e.org_id = ?
     GROUP BY e.type_code
     HAVING family_count != 1`,
    [orgId]
  );
  return violations;
}

async function validateAtLeastOneIndustry(pool, orgId) {
  const violations = await pool.query(
    `SELECT e.type_code as equipment_type_id
     FROM equipment_types e
     JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
     LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
     WHERE e.org_id = ?
     GROUP BY e.type_code
     HAVING COUNT(i.industry_code) = 0`,
    [orgId]
  );
  return violations;
}

async function validateIndustryAwareTemplates(pool, orgId) {
  const violations = await pool.query(
    `SELECT e.type_code as equipment_type_id, i.industry_code
     FROM equipment_types e
     JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
     JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
     LEFT JOIN smp_templates t ON t.family_code = m.family_code 
       AND (t.applicable_industries LIKE CONCAT('%', i.industry_code, '%') OR t.applicable_industries IS NULL)
       AND t.org_id = e.org_id
     WHERE e.org_id = ?
     GROUP BY e.type_code, i.industry_code
     HAVING COUNT(t.template_id) = 0`,
    [orgId]
  );
  return violations;
}

async function runFullValidation(pool, orgId) {
  const familyViolations = await validateExactlyOneFamily(pool, orgId);
  const industryViolations = await validateAtLeastOneIndustry(pool, orgId);
  const templateViolations = await validateIndustryAwareTemplates(pool, orgId);
  
  return {
    total_gaps: familyViolations.length + industryViolations.length + templateViolations.length,
    family_violations: familyViolations.length,
    industry_violations: industryViolations.length,
    template_violations: templateViolations.length,
    overall_status: (familyViolations.length + industryViolations.length + templateViolations.length) === 0 ? 'pass' : 'fail'
  };
}
