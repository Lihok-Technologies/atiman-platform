/**
 * Step 6: Performance Tests for Coverage Queries
 * Validates: Query performance, pagination efficiency, index usage
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { createPool, isIntegrationTest } = require('../src/config/database');

const TEST_TIMEOUT = 120000;
const PERF_THRESHOLD_MS = 1000; // 1 second max for queries

// Destructive database suite: gated on isIntegrationTest(), the same predicate
// that selects TEST_DB_* credentials, so it can never run against runtime
// DB_*/PG* credentials.
describe('Step 6: Performance Tests', { skip: !isIntegrationTest() }, () => {
  let pool;

  before(async () => {
    pool = createPool();
    await setupPerformanceTestData(pool);
  }, TEST_TIMEOUT);

  after(async () => {
    await cleanupPerformanceTestData(pool);
    await pool.end();
  }, TEST_TIMEOUT);

  // ============================================================================
  // SECTION 1: Dashboard Query Performance
  // ============================================================================
  describe('Dashboard Query Performance', () => {
    it('should load dashboard stats within threshold', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          COUNT(DISTINCT e.type_code) as total_equipment,
          COUNT(DISTINCT CASE WHEN m.family_code IS NOT NULL THEN e.type_code END) as with_family,
          COUNT(DISTINCT CASE WHEN i.industry_code IS NOT NULL THEN e.type_code END) as with_industry
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        WHERE e.org_id = 555555
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Dashboard stats query: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS, 
        `Dashboard query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should load gap summary efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          COUNT(DISTINCT CASE WHEN m.family_code IS NULL THEN e.type_code END) as unmapped,
          COUNT(DISTINCT CASE WHEN m.family_code IS NOT NULL AND i.industry_code IS NULL THEN e.type_code END) as missing_industry,
          COUNT(DISTINCT CASE WHEN m.family_code IS NOT NULL AND i.industry_code IS NOT NULL AND t.template_id IS NULL THEN e.type_code END) as missing_templates
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        LEFT JOIN smp_templates t ON t.family_code = m.family_code AND t.org_id = e.org_id
        WHERE e.org_id = 555555
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Gap summary query: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Gap summary query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should load recent changes efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          a.*,
          e.type_name as equipment_name
        FROM equipment_mapping_change_log a
        LEFT JOIN equipment_types e ON a.equipment_type_id = e.type_code AND a.org_id = e.org_id
        WHERE a.org_id = 555555
        ORDER BY a.created_at DESC
        LIMIT 10
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Recent changes query: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Recent changes query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });
  });

  // ============================================================================
  // SECTION 2: Equipment Browser Pagination Performance
  // ============================================================================
  describe('Equipment Browser Pagination Performance', () => {
    it('should paginate equipment list efficiently (page 1)', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          e.*,
          m.family_code,
          COUNT(DISTINCT i.industry_code) as industry_count,
          COUNT(DISTINCT t.template_id) as template_count
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        LEFT JOIN smp_templates t ON t.family_code = m.family_code AND t.org_id = e.org_id
        WHERE e.org_id = 555555
        GROUP BY e.type_code
        ORDER BY e.type_name
        LIMIT 20 OFFSET 0
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Equipment pagination (page 1): ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Equipment pagination took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should paginate efficiently on high page numbers', async () => {
      const startTime = Date.now();
      
      // Get total count first
      const [countResult] = await pool.query(
        'SELECT COUNT(*) as total FROM equipment_types WHERE org_id = 555555'
      );
      const total = countResult.total;
      const lastPageOffset = Math.max(0, total - 20);
      
      await pool.query(`
        SELECT 
          e.*,
          m.family_code,
          COUNT(DISTINCT i.industry_code) as industry_count,
          COUNT(DISTINCT t.template_id) as template_count
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        LEFT JOIN smp_templates t ON t.family_code = m.family_code AND t.org_id = e.org_id
        WHERE e.org_id = 555555
        GROUP BY e.type_code
        ORDER BY e.type_name
        LIMIT 20 OFFSET ?
      `, [lastPageOffset]);
      
      const duration = Date.now() - startTime;
      console.log(`Equipment pagination (last page): ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Last page pagination took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should filter equipment by status efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          e.*,
          m.family_code,
          CASE 
            WHEN m.family_code IS NULL THEN 'unmapped'
            WHEN i.industry_code IS NULL THEN 'missing_industry'
            WHEN t.template_id IS NULL THEN 'missing_templates'
            ELSE 'complete'
          END as status
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        LEFT JOIN smp_templates t ON t.family_code = m.family_code AND t.org_id = e.org_id
        WHERE e.org_id = 555555
        HAVING status = 'unmapped'
        ORDER BY e.type_name
        LIMIT 20
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Equipment status filter: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Status filter query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should search equipment efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          e.*,
          m.family_code
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        WHERE e.org_id = 555555
          AND (e.type_name LIKE ? OR e.type_code LIKE ?)
        ORDER BY e.type_name
        LIMIT 20
      `, ['%PUMP%', '%PUMP%']);
      
      const duration = Date.now() - startTime;
      console.log(`Equipment search: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Search query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });
  });

  // ============================================================================
  // SECTION 3: Gap Query Performance
  // ============================================================================
  describe('Gap Query Performance', () => {
    it('should load gap list efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          e.type_code as equipment_type_id,
          e.type_name as equipment_name,
          'unmapped' as gap_type,
          'Assign family mapping' as action_required
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        WHERE e.org_id = 555555 AND m.family_code IS NULL
        
        UNION ALL
        
        SELECT 
          e.type_code as equipment_type_id,
          e.type_name as equipment_name,
          'missing_industry' as gap_type,
          'Add industry mapping' as action_required
        FROM equipment_types e
        JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        WHERE e.org_id = 555555 AND i.industry_code IS NULL
        
        ORDER BY equipment_name
        LIMIT 50
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Gap list query: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Gap list query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });
  });

  // ============================================================================
  // SECTION 4: Template Browser Performance
  // ============================================================================
  describe('Template Browser Performance', () => {
    it('should load template list efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          t.*,
          COUNT(s.step_id) as step_count,
          COUNT(CASE WHEN s.requires_safety = 1 THEN 1 END) as safety_count
        FROM smp_templates t
        LEFT JOIN template_steps s ON t.template_id = s.template_id
        WHERE t.org_id = 555555
        GROUP BY t.template_id
        ORDER BY t.template_name
        LIMIT 20
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Template list query: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Template list query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should filter templates by family efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          t.*,
          f.family_name
        FROM smp_templates t
        JOIN template_families f ON t.family_code = f.family_code AND t.org_id = f.org_id
        WHERE t.org_id = 555555 AND t.family_code = 'PUMP_FAMILY'
        ORDER BY t.template_name
        LIMIT 20
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Template family filter: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Family filter query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });
  });

  // ============================================================================
  // SECTION 5: Audit Log Performance
  // ============================================================================
  describe('Audit Log Performance', () => {
    it('should paginate audit log efficiently', async () => {
      const startTime = Date.now();
      
      await pool.query(`
        SELECT 
          a.*,
          e.type_name as equipment_name,
          u.name as changed_by_name
        FROM equipment_mapping_change_log a
        LEFT JOIN equipment_types e ON a.equipment_type_id = e.type_code AND a.org_id = e.org_id
        LEFT JOIN users u ON a.changed_by = u.id
        WHERE a.org_id = 555555
        ORDER BY a.created_at DESC
        LIMIT 25 OFFSET 0
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Audit log pagination: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Audit log pagination took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });

    it('should filter audit by date range efficiently', async () => {
      const startDate = '2024-01-01';
      const endDate = '2024-12-31';
      
      const startTime = Date.now();
      
      await pool.query(`
        SELECT *
        FROM equipment_mapping_change_log
        WHERE org_id = 555555
          AND created_at >= ?
          AND created_at <= ?
        ORDER BY created_at DESC
        LIMIT 25
      `, [startDate, endDate + ' 23:59:59']);
      
      const duration = Date.now() - startTime;
      console.log(`Audit date filter: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS,
        `Date filter query took ${duration}ms, threshold is ${PERF_THRESHOLD_MS}ms`);
    });
  });

  // ============================================================================
  // SECTION 6: Validation Query Performance
  // ============================================================================
  describe('Validation Query Performance', () => {
    it('should run full validation within threshold', async () => {
      const startTime = Date.now();
      
      // Exactly one family check
      await pool.query(`
        SELECT e.type_code, COUNT(m.family_code) as family_count
        FROM equipment_types e
        LEFT JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        WHERE e.org_id = 555555
        GROUP BY e.type_code
        HAVING family_count != 1
      `);
      
      // At least one industry check
      await pool.query(`
        SELECT e.type_code
        FROM equipment_types e
        JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        LEFT JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        WHERE e.org_id = 555555
        GROUP BY e.type_code
        HAVING COUNT(i.industry_code) = 0
      `);
      
      // Industry-aware templates check
      await pool.query(`
        SELECT e.type_code, i.industry_code
        FROM equipment_types e
        JOIN equipment_type_mappings m ON e.type_code = m.equipment_type_id AND e.org_id = m.org_id
        JOIN equipment_type_industries i ON e.type_code = i.equipment_type_id AND e.org_id = i.org_id
        LEFT JOIN smp_templates t ON t.family_code = m.family_code AND t.org_id = e.org_id
        WHERE e.org_id = 555555
        GROUP BY e.type_code, i.industry_code
        HAVING COUNT(t.template_id) = 0
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Full validation: ${duration}ms`);
      
      assert.ok(duration < PERF_THRESHOLD_MS * 2, // Allow 2x threshold for full validation
        `Full validation took ${duration}ms, threshold is ${PERF_THRESHOLD_MS * 2}ms`);
    });
  });

  // ============================================================================
  // SECTION 7: Index Usage Validation
  // ============================================================================
  describe('Index Usage Validation', () => {
    it('should use index on equipment_types org_id', async () => {
      const [explain] = await pool.query(`
        EXPLAIN SELECT * FROM equipment_types WHERE org_id = 555555
      `);
      
      const usesIndex = explain.possible_keys?.includes('org_id') || 
                       explain.key?.includes('org_id') ||
                       explain.Extra?.includes('Using index');
      
      assert.ok(usesIndex, 'Should use index on org_id for equipment_types');
    });

    it('should use index on equipment_mapping_change_log org_id + equipment_type_id', async () => {
      const [explain] = await pool.query(`
        EXPLAIN SELECT * FROM equipment_mapping_change_log 
        WHERE org_id = 555555 AND equipment_type_id = 'TEST'
      `);
      
      const usesIndex = explain.possible_keys?.includes('idx_org_equipment') || 
                       explain.key?.includes('idx_org_equipment');
      
      assert.ok(usesIndex, 'Should use composite index on org_id + equipment_type_id');
    });

    it('should use index on audit log created_at for sorting', async () => {
      const [explain] = await pool.query(`
        EXPLAIN SELECT * FROM equipment_mapping_change_log 
        WHERE org_id = 555555 
        ORDER BY created_at DESC 
        LIMIT 10
      `);
      
      // Should either use index or filesort efficiently
      assert.ok(
        explain.Extra?.includes('Using index') || 
        !explain.Extra?.includes('Using filesort'),
        'Should use index to avoid filesort'
      );
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupPerformanceTestData(pool) {
  // Create test org
  await pool.query(
    `INSERT INTO organizations (id, name, status, created_at) 
     VALUES (555555, 'Performance Test Org', 'active', NOW())
     ON DUPLICATE KEY UPDATE name = 'Performance Test Org'`,
    []
  );
  
  // Create bulk equipment types (500 records)
  const equipmentValues = [];
  for (let i = 0; i < 500; i++) {
    equipmentValues.push(`('EQUIP_${i}', 'Equipment ${i}', 1, 1, 555555, NOW())`);
  }
  
  await pool.query(`
    INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
    VALUES ${equipmentValues.join(',')}
    ON DUPLICATE KEY UPDATE type_name = VALUES(type_name)
  `);
  
  // Create families
  await pool.query(`
    INSERT INTO template_families (family_code, family_name, org_id, is_system, created_at)
    VALUES 
      ('PUMP_FAMILY', 'Pump Family', 555555, 1, NOW()),
      ('MOTOR_FAMILY', 'Motor Family', 555555, 1, NOW()),
      ('VALVE_FAMILY', 'Valve Family', 555555, 1, NOW())
    ON DUPLICATE KEY UPDATE family_name = VALUES(family_name)
  `);
  
  // Create mappings for 80% of equipment
  const mappingValues = [];
  for (let i = 0; i < 400; i++) {
    const family = ['PUMP_FAMILY', 'MOTOR_FAMILY', 'VALVE_FAMILY'][i % 3];
    mappingValues.push(`('EQUIP_${i}', '${family}', 555555, NOW())`);
  }
  
  await pool.query(`
    INSERT INTO equipment_type_mappings (equipment_type_id, family_code, org_id, created_at)
    VALUES ${mappingValues.join(',')}
    ON DUPLICATE KEY UPDATE family_code = VALUES(family_code)
  `);
  
  // Create industries
  await pool.query(`
    INSERT INTO industries (industry_code, industry_name, org_id, created_at)
    VALUES 
      ('WATER', 'Water', 555555, NOW()),
      ('OIL', 'Oil & Gas', 555555, NOW())
    ON DUPLICATE KEY UPDATE industry_name = VALUES(industry_name)
  `);
  
  // Create industry mappings for 70% of mapped equipment
  const industryValues = [];
  for (let i = 0; i < 280; i++) {
    const industry = i % 2 === 0 ? 'WATER' : 'OIL';
    industryValues.push(`('EQUIP_${i}', '${industry}', 555555, NOW())`);
  }
  
  await pool.query(`
    INSERT INTO equipment_type_industries (equipment_type_id, industry_code, org_id, created_at)
    VALUES ${industryValues.join(',')}
    ON DUPLICATE KEY UPDATE industry_code = VALUES(industry_code)
  `);
  
  // Create templates
  await pool.query(`
    INSERT INTO smp_templates (template_code, template_name, family_code, org_id, is_system, created_at)
    VALUES 
      ('PUMP_TPL_1', 'Pump Inspection', 'PUMP_FAMILY', 555555, 1, NOW()),
      ('PUMP_TPL_2', 'Pump Maintenance', 'PUMP_FAMILY', 555555, 1, NOW()),
      ('MOTOR_TPL_1', 'Motor Inspection', 'MOTOR_FAMILY', 555555, 1, NOW()),
      ('VALVE_TPL_1', 'Valve Inspection', 'VALVE_FAMILY', 555555, 1, NOW())
    ON DUPLICATE KEY UPDATE template_name = VALUES(template_name)
  `);
  
  // Create audit log entries (1000 records)
  const auditValues = [];
  for (let i = 0; i < 1000; i++) {
    const equipIdx = i % 500;
    const changeType = ['family_assigned', 'family_changed', 'industry_added', 'template_created'][i % 4];
    auditValues.push(`(555555, 'EQUIP_${equipIdx}', '${changeType}', 1, NULL, 'NEW_VALUE', 'Performance test', NOW() - INTERVAL ${i} MINUTE)`);
  }
  
  await pool.query(`
    INSERT INTO equipment_mapping_change_log (org_id, equipment_type_id, change_type, changed_by, old_value, new_value, change_reason, created_at)
    VALUES ${auditValues.join(',')}
  `);
}

async function cleanupPerformanceTestData(pool) {
  await pool.query('DELETE FROM equipment_mapping_change_log WHERE org_id = 555555');
  await pool.query('DELETE FROM equipment_type_industries WHERE org_id = 555555');
  await pool.query('DELETE FROM equipment_type_mappings WHERE org_id = 555555');
  await pool.query('DELETE FROM smp_templates WHERE org_id = 555555');
  await pool.query('DELETE FROM template_families WHERE org_id = 555555');
  await pool.query('DELETE FROM industries WHERE org_id = 555555');
  await pool.query('DELETE FROM equipment_types WHERE org_id = 555555');
  await pool.query('DELETE FROM organizations WHERE id = 555555');
}
