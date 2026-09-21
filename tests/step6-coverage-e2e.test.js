/**
 * Step 6: End-to-End Tests for Coverage Management Flows
 * Tests: Dashboard, Equipment Browser, Gap Resolution, Templates, Audit, Validation
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createPool, isIntegrationTest } = require('../src/config/database');

// Test configuration
const TEST_PORT = 9999;
const TEST_TIMEOUT = 30000;

// Test data
const TEST_ORG_ID = 999999;
const TEST_ADMIN_TOKEN = 'test_admin_token_' + Date.now();
const TEST_SUPERVISOR_TOKEN = 'test_supervisor_token_' + Date.now();
const TEST_TECH_TOKEN = 'test_tech_token_' + Date.now();

// Destructive database suite: gated on isIntegrationTest(), the same predicate
// that selects TEST_DB_* credentials, so it can never run against runtime
// DB_*/PG* credentials.
describe('Step 6: Coverage Management E2E Tests', { skip: !isIntegrationTest() }, () => {
  let server;
  let pool;
  let baseUrl;

  before(async () => {
    // Setup test database connection
    pool = createPool();
    
    // Create test organization and users
    await setupTestData(pool);
    
    // Start test server
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(TEST_PORT, resolve));
    baseUrl = `http://localhost:${TEST_PORT}`;
  }, TEST_TIMEOUT);

  after(async () => {
    // Cleanup test data
    await cleanupTestData(pool);
    
    // Close server
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }, TEST_TIMEOUT);

  // ============================================================================
  // SECTION 1: Coverage Dashboard E2E
  // ============================================================================
  describe('Coverage Dashboard', () => {
    it('should return dashboard stats with valid admin token', async () => {
      const response = await fetch(`${baseUrl}/api/admin/coverage-ui/dashboard`, {
        headers: {
          'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
          'X-Tenant-ID': TEST_ORG_ID.toString()
        }
      });
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('stats'), 'Should have stats');
      assert.ok(data.hasOwnProperty('gaps'), 'Should have gaps summary');
      assert.ok(data.hasOwnProperty('recentChanges'), 'Should have recent changes');
      assert.ok(data.stats.hasOwnProperty('totalEquipmentTypes'), 'Should have total count');
      assert.ok(data.stats.hasOwnProperty('coveragePercentage'), 'Should have coverage %');
    });

    it('should return 403 for non-admin users', async () => {
      const response = await fetch(`${baseUrl}/api/admin/coverage-ui/dashboard`, {
        headers: {
          'Authorization': `Bearer ${TEST_SUPERVISOR_TOKEN}`,
          'X-Tenant-ID': TEST_ORG_ID.toString()
        }
      });
      
      assert.strictEqual(response.status, 403);
    });

    it('should return 401 without authentication', async () => {
      const response = await fetch(`${baseUrl}/api/admin/coverage-ui/dashboard`);
      assert.strictEqual(response.status, 401);
    });
  });

  // ============================================================================
  // SECTION 2: Equipment Browser E2E
  // ============================================================================
  describe('Equipment Browser', () => {
    it('should list equipment with pagination', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment?page=1&limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('items'), 'Should have items array');
      assert.ok(data.hasOwnProperty('pagination'), 'Should have pagination');
      assert.ok(data.pagination.hasOwnProperty('page'), 'Should have page number');
      assert.ok(data.pagination.hasOwnProperty('total'), 'Should have total count');
      assert.ok(Array.isArray(data.items), 'Items should be an array');
    });

    it('should filter by status', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment?status=unmapped`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      // All items should be unmapped
      for (const item of data.items) {
        assert.strictEqual(item.status, 'unmapped', 'All items should be unmapped');
      }
    });

    it('should search by equipment code', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment?search=PUMP`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      // Results should contain "PUMP" in code or name
      for (const item of data.items) {
        const searchable = `${item.type_code} ${item.type_name}`.toUpperCase();
        assert.ok(searchable.includes('PUMP'), 'Should contain search term');
      }
    });
  });

  // ============================================================================
  // SECTION 3: Gap Resolution E2E
  // ============================================================================
  describe('Gap Resolution', () => {
    it('should list gaps with filtering', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/gaps?type=unmapped`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(Array.isArray(data.gaps), 'Should have gaps array');
      for (const gap of data.gaps) {
        assert.strictEqual(gap.gap_type, 'unmapped', 'Gap type should match filter');
        assert.ok(gap.hasOwnProperty('equipment_type_id'), 'Should have equipment ID');
        assert.ok(gap.hasOwnProperty('action_required'), 'Should have action description');
      }
    });

    it('should resolve gap by assigning family', async () => {
      // First, create an unmapped equipment type
      const equipId = await createTestEquipment(pool, TEST_ORG_ID, 'TEST_EQUIP', 'Test Equipment');
      
      // Get a valid family
      const familyResult = await pool.query(
        'SELECT family_code FROM template_families WHERE org_id = ? LIMIT 1',
        [TEST_ORG_ID]
      );
      const familyCode = familyResult[0]?.family_code || 'PUMP_FAMILY';
      
      // Assign family
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment/${equipId}/family`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            family_code: familyCode,
            reason: 'Test gap resolution'
          })
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.strictEqual(data.success, true, 'Should succeed');
      assert.ok(data.audit_id, 'Should return audit ID');
      
      // Verify gap is resolved
      const gapResponse = await fetch(
        `${baseUrl}/api/admin/coverage-ui/gaps`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      const gapData = await gapResponse.json();
      const resolvedGap = gapData.gaps.find(g => g.equipment_type_id === equipId);
      assert.ok(!resolvedGap || resolvedGap.gap_type !== 'unmapped', 'Gap should be resolved');
    });
  });

  // ============================================================================
  // SECTION 4: Template Browser E2E
  // ============================================================================
  describe('Template Browser', () => {
    it('should list system templates with filters', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/templates?family_code=PUMP_FAMILY`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(Array.isArray(data.templates), 'Should have templates array');
      for (const template of data.templates) {
        assert.ok(template.hasOwnProperty('template_code'), 'Should have template code');
        assert.ok(template.hasOwnProperty('template_name'), 'Should have template name');
        assert.ok(template.hasOwnProperty('task_kind'), 'Should have task kind');
        assert.ok(template.hasOwnProperty('steps'), 'Should have steps array');
      }
    });

    it('should filter templates by industry', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/templates?industry_id=WATER_WW`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      for (const template of data.templates) {
        // Template should be applicable to water industry
        assert.ok(
          template.industries.includes('WATER_WW') || template.industries.includes('ALL'),
          'Template should be applicable to industry'
        );
      }
    });
  });

  // ============================================================================
  // SECTION 5: Audit Log E2E
  // ============================================================================
  describe('Audit Log', () => {
    it('should retrieve audit log with pagination', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/audit?page=1&limit=25`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(Array.isArray(data.entries), 'Should have entries array');
      assert.ok(data.hasOwnProperty('pagination'), 'Should have pagination');
      
      for (const entry of data.entries) {
        assert.ok(entry.hasOwnProperty('change_type'), 'Should have change type');
        assert.ok(entry.hasOwnProperty('changed_by'), 'Should have changed by');
        assert.ok(entry.hasOwnProperty('changed_at'), 'Should have changed at');
        assert.ok(entry.hasOwnProperty('equipment_type_id'), 'Should have equipment ID');
      }
    });

    it('should filter audit by change type', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/audit?change_type=family_assigned`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      for (const entry of data.entries) {
        assert.strictEqual(entry.change_type, 'family_assigned', 'Should match filter');
      }
    });

    it('should filter audit by date range', async () => {
      const today = new Date().toISOString().split('T')[0];
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/audit?start_date=${today}&end_date=${today}`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      for (const entry of data.entries) {
        const entryDate = new Date(entry.changed_at).toISOString().split('T')[0];
        assert.strictEqual(entryDate, today, 'Should be within date range');
      }
    });
  });

  // ============================================================================
  // SECTION 6: Validation E2E
  // ============================================================================
  describe('Coverage Validation', () => {
    it('should run validation and return results', async () => {
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/validate`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('validation'), 'Should have validation results');
      assert.ok(data.hasOwnProperty('gaps'), 'Should have gaps');
      assert.ok(data.validation.hasOwnProperty('overall_status'), 'Should have status');
      assert.ok(data.validation.hasOwnProperty('stats'), 'Should have stats');
      assert.ok(data.validation.hasOwnProperty('invariants'), 'Should have invariants');
      
      // Check invariant structure
      const invariants = data.validation.invariants;
      assert.ok(invariants.hasOwnProperty('exactly_one_family'), 'Should check family invariant');
      assert.ok(invariants.hasOwnProperty('at_least_one_industry'), 'Should check industry invariant');
      assert.ok(invariants.hasOwnProperty('industry_aware_templates'), 'Should check template invariant');
    });

    it('should detect unmapped equipment', async () => {
      // Create unmapped equipment
      const equipId = await createTestEquipment(pool, TEST_ORG_ID, 'UNMAPPED_TEST', 'Unmapped Test');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/validate`,
        {
          headers: {
            'Authorization': `Bearer ${TEST_ADMIN_TOKEN}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      const data = await response.json();
      
      // Should find the unmapped equipment
      const unmappedGap = data.gaps.find(
        g => g.gap_type === 'unmapped' && g.equipment_type_id === equipId
      );
      assert.ok(unmappedGap, 'Should detect unmapped equipment');
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupTestData(pool) {
  // Create test organization
  await pool.query(
    `INSERT INTO organizations (id, name, status, created_at) 
     VALUES (?, 'Test Org', 'active', NOW())
     ON DUPLICATE KEY UPDATE name = 'Test Org'`,
    [TEST_ORG_ID]
  );
  
  // Create test users with different roles
  await pool.query(
    `INSERT INTO users (id, org_id, email, role, status, created_at)
     VALUES 
       (?, ?, 'admin@test.com', 'admin', 'active', NOW()),
       (?, ?, 'supervisor@test.com', 'supervisor', 'active', NOW()),
       (?, ?, 'tech@test.com', 'technician', 'active', NOW())
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [
      999991, TEST_ORG_ID,
      999992, TEST_ORG_ID,
      999993, TEST_ORG_ID
    ]
  );
  
  // Create test template family
  await pool.query(
    `INSERT INTO template_families (family_code, family_name, description, org_id, is_system)
     VALUES ('TEST_FAMILY', 'Test Family', 'For testing', ?, 0)
     ON DUPLICATE KEY UPDATE family_name = 'Test Family'`,
    [TEST_ORG_ID]
  );
  
  // Create test industry
  await pool.query(
    `INSERT INTO industries (industry_code, industry_name, description, org_id)
     VALUES ('TEST_INDUSTRY', 'Test Industry', 'For testing', ?)
     ON DUPLICATE KEY UPDATE industry_name = 'Test Industry'`,
    [TEST_ORG_ID]
  );
}

async function cleanupTestData(pool) {
  // Clean up in reverse order
  await pool.query('DELETE FROM equipment_mapping_change_log WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM equipment_types WHERE org_id = ? AND type_code LIKE "TEST_%"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM template_families WHERE org_id = ? AND family_code = "TEST_FAMILY"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM industries WHERE org_id = ? AND industry_code = "TEST_INDUSTRY"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM users WHERE org_id = ? AND id IN (999991, 999992, 999993)', [TEST_ORG_ID]);
  await pool.query('DELETE FROM organizations WHERE id = ?', [TEST_ORG_ID]);
}

async function createTestEquipment(pool, orgId, code, name) {
  const result = await pool.query(
    `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
     VALUES (?, ?, 1, 1, ?, NOW())
     ON DUPLICATE KEY UPDATE type_name = VALUES(type_name)`,
    [code, name, orgId]
  );
  return result.insertId || code;
}
