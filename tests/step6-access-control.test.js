/**
 * Step 6: Access Control and Tenant Protection Tests
 * Validates: Admin-only enforcement, org scoping, no cross-tenant leakage
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createPool, isIntegrationTest } = require('../src/config/database');

const TEST_PORT = 9998;
const TEST_TIMEOUT = 30000;

// Multiple tenant contexts for cross-tenant testing
const TENANT_A = { id: 888888, name: 'Tenant A' };
const TENANT_B = { id: 888889, name: 'Tenant B' };

// Destructive database suite: gated on isIntegrationTest(), the same predicate
// that selects TEST_DB_* credentials, so it can never run against runtime
// DB_*/PG* credentials.
describe('Step 6: Access Control & Tenant Protection', { skip: !isIntegrationTest() }, () => {
  let server;
  let pool;
  let baseUrl;

  before(async () => {
    pool = createPool();
    await setupMultiTenantData(pool);
    
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(TEST_PORT, resolve));
    baseUrl = `http://localhost:${TEST_PORT}`;
  }, TEST_TIMEOUT);

  after(async () => {
    await cleanupMultiTenantData(pool);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }, TEST_TIMEOUT);

  // ============================================================================
  // SECTION 1: Admin-Only Enforcement
  // ============================================================================
  describe('Admin-Only Enforcement', () => {
    const adminEndpoints = [
      { method: 'GET', path: '/api/admin/coverage-ui/dashboard' },
      { method: 'GET', path: '/api/admin/coverage-ui/equipment' },
      { method: 'GET', path: '/api/admin/coverage-ui/gaps' },
      { method: 'PUT', path: '/api/admin/coverage-ui/equipment/TEST/gap' },
      { method: 'GET', path: '/api/admin/coverage-ui/templates' },
      { method: 'GET', path: '/api/admin/coverage-ui/audit' },
      { method: 'GET', path: '/api/admin/coverage-ui/validate' },
    ];

    for (const endpoint of adminEndpoints) {
      it(`${endpoint.method} ${endpoint.path} should reject unauthenticated requests`, async () => {
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: { 'X-Tenant-ID': TENANT_A.id.toString() }
        });
        
        assert.strictEqual(response.status, 401, 'Should require authentication');
      });

      it(`${endpoint.method} ${endpoint.path} should reject technician users`, async () => {
        const token = await getUserToken(pool, TENANT_A.id, 'technician');
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        });
        
        assert.strictEqual(response.status, 403, 'Should reject non-admin');
      });

      it(`${endpoint.method} ${endpoint.path} should reject supervisor users`, async () => {
        const token = await getUserToken(pool, TENANT_A.id, 'supervisor');
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        });
        
        assert.strictEqual(response.status, 403, 'Should reject non-admin');
      });

      it(`${endpoint.method} ${endpoint.path} should allow admin users`, async () => {
        const token = await getUserToken(pool, TENANT_A.id, 'admin');
        
        // For PUT endpoints, we might get 400 (bad request) instead of 200
        // if the body is missing, but we shouldn't get 403
        const response = await fetch(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString(),
            'Content-Type': 'application/json'
          },
          body: endpoint.method === 'PUT' ? '{}' : undefined
        });
        
        assert.ok(
          response.status !== 403 && response.status !== 401,
          `Should allow admin (got ${response.status})`
        );
      });
    }
  });

  // ============================================================================
  // SECTION 2: Org Scoping
  // ============================================================================
  describe('Organization Scoping', () => {
    it('should only return equipment for specified tenant', async () => {
      const token = await getUserToken(pool, TENANT_A.id, 'admin');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      // Verify all items belong to tenant A
      for (const item of data.items) {
        const belongsToTenant = await checkEquipmentBelongsToTenant(
          pool, item.equipment_type_id, TENANT_A.id
        );
        assert.ok(belongsToTenant, 'Equipment should belong to specified tenant');
      }
    });

    it('should only return audit entries for specified tenant', async () => {
      const token = await getUserToken(pool, TENANT_A.id, 'admin');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/audit`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      // Verify all entries belong to tenant A
      for (const entry of data.entries) {
        const belongsToTenant = await checkAuditBelongsToTenant(
          pool, entry.audit_id, TENANT_A.id
        );
        assert.ok(belongsToTenant, 'Audit entry should belong to specified tenant');
      }
    });

    it('should use authenticated users org_id when X-Tenant-ID is missing', async () => {
      const token = await getUserToken(pool, TENANT_A.id, 'admin');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/dashboard`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
            // X-Tenant-ID intentionally omitted
          }
        }
      );
      
      // Should succeed using token's org context
      assert.ok(response.status === 200 || response.status === 400, 
        'Should use token org context');
    });
  });

  // ============================================================================
  // SECTION 3: Cross-Tenant Leakage Prevention
  // ============================================================================
  describe('Cross-Tenant Leakage Prevention', () => {
    it('should not expose Tenant B equipment to Tenant A admin', async () => {
      const token = await getUserToken(pool, TENANT_A.id, 'admin');
      
      // Get all equipment for tenant A
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment?limit=1000`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        }
      );
      
      const data = await response.json();
      
      // Get list of tenant B equipment codes
      const tenantBEquipment = await getTenantEquipmentCodes(pool, TENANT_B.id);
      
      // Verify no tenant B equipment appears in response
      for (const item of data.items) {
        assert.ok(
          !tenantBEquipment.includes(item.type_code),
          `Should not expose ${item.type_code} from Tenant B`
        );
      }
    });

    it('should not expose Tenant B audit entries to Tenant A admin', async () => {
      const token = await getUserToken(pool, TENANT_A.id, 'admin');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/audit?limit=1000`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        }
      );
      
      const data = await response.json();
      
      // Get list of tenant B audit IDs
      const tenantBAuditIds = await getTenantAuditIds(pool, TENANT_B.id);
      
      // Verify no tenant B audit entries appear
      for (const entry of data.entries) {
        assert.ok(
          !tenantBAuditIds.includes(entry.audit_id),
          `Should not expose audit ${entry.audit_id} from Tenant B`
        );
      }
    });

    it('should reject requests with mismatched tenant ID in URL vs header', async () => {
      // This tests if someone tries to access tenant B data with tenant A token
      const tokenA = await getUserToken(pool, TENANT_A.id, 'admin');
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/equipment`,
        {
          headers: {
            'Authorization': `Bearer ${tokenA}`,
            'X-Tenant-ID': TENANT_B.id.toString() // Different from token's tenant
          }
        }
      );
      
      // Should either reject or use token's tenant (not header's)
      const data = await response.json();
      for (const item of data.items) {
        const belongsToTokenTenant = await checkEquipmentBelongsToTenant(
          pool, item.equipment_type_id, TENANT_A.id
        );
        assert.ok(belongsToTokenTenant, 'Should use token tenant, not header tenant');
      }
    });

    it('should prevent access to coverage data without org_id', async () => {
      // Create a token without org context
      const malformedToken = 'malformed_token_no_org';
      
      const response = await fetch(
        `${baseUrl}/api/admin/coverage-ui/dashboard`,
        {
          headers: {
            'Authorization': `Bearer ${malformedToken}`,
            'X-Tenant-ID': '999999'
          }
        }
      );
      
      // Should reject or require valid org context
      assert.ok(
        response.status === 401 || response.status === 403,
        'Should reject requests without valid org context'
      );
    });
  });

  // ============================================================================
  // SECTION 4: UI Route Protection
  // ============================================================================
  describe('UI Route Protection', () => {
    const uiRoutes = [
      '/mobile/admin/coverage',
      '/mobile/admin/coverage/equipment',
      '/mobile/admin/coverage/gaps',
      '/mobile/admin/coverage/templates',
      '/mobile/admin/coverage/audit',
      '/mobile/admin/coverage/validate',
    ];

    for (const route of uiRoutes) {
      it(`${route} should redirect to login when unauthenticated`, async () => {
        const response = await fetch(`${baseUrl}${route}`, {
          redirect: 'manual'
        });
        
        assert.ok(
          response.status === 302 || response.status === 401,
          'Should redirect or reject unauthenticated'
        );
        
        if (response.status === 302) {
          const location = response.headers.get('location');
          assert.ok(
            location.includes('login') || location.includes('auth'),
            'Should redirect to login'
          );
        }
      });

      it(`${route} should reject non-admin users`, async () => {
        const token = await getUserToken(pool, TENANT_A.id, 'technician');
        const response = await fetch(`${baseUrl}${route}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        });
        
        assert.strictEqual(response.status, 403, 'Should reject non-admin');
      });

      it(`${route} should render for admin users`, async () => {
        const token = await getUserToken(pool, TENANT_A.id, 'admin');
        const response = await fetch(`${baseUrl}${route}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Tenant-ID': TENANT_A.id.toString()
          }
        });
        
        assert.ok(
          response.status === 200,
          `Should render for admin (got ${response.status})`
        );
        
        const html = await response.text();
        assert.ok(
          html.includes('Coverage') || html.includes('coverage'),
          'Should render coverage UI'
        );
      });
    }
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupMultiTenantData(pool) {
  // Tenant A setup
  await pool.query(
    `INSERT INTO organizations (id, name, status, created_at) 
     VALUES (?, ?, 'active', NOW()), (?, ?, 'active', NOW())
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [TENANT_A.id, TENANT_A.name, TENANT_B.id, TENANT_B.name]
  );
  
  // Create admin users for both tenants
  await pool.query(
    `INSERT INTO users (id, org_id, email, role, status, created_at)
     VALUES 
       (888001, ?, 'admin_a@test.com', 'admin', 'active', NOW()),
       (888002, ?, 'admin_b@test.com', 'admin', 'active', NOW()),
       (888003, ?, 'tech_a@test.com', 'technician', 'active', NOW()),
       (888004, ?, 'super_a@test.com', 'supervisor', 'active', NOW())
     ON DUPLICATE KEY UPDATE role = VALUES(role)`,
    [TENANT_A.id, TENANT_B.id, TENANT_A.id, TENANT_A.id]
  );
  
  // Create distinct equipment for each tenant
  await pool.query(
    `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
     VALUES 
       ('TENANT_A_PUMP', 'Tenant A Pump', 1, 1, ?, NOW()),
       ('TENANT_B_PUMP', 'Tenant B Pump', 1, 1, ?, NOW())
     ON DUPLICATE KEY UPDATE type_name = VALUES(type_name)`,
    [TENANT_A.id, TENANT_B.id]
  );
  
  // Create audit entries for each tenant
  await pool.query(
    `INSERT INTO equipment_mapping_change_log (org_id, equipment_type_id, change_type, changed_by, old_value, new_value, change_reason, created_at)
     VALUES 
       (?, 'TENANT_A_PUMP', 'family_assigned', 888001, NULL, 'FAMILY_A', 'Test', NOW()),
       (?, 'TENANT_B_PUMP', 'family_assigned', 888002, NULL, 'FAMILY_B', 'Test', NOW())
     ON DUPLICATE KEY UPDATE change_reason = VALUES(change_reason)`,
    [TENANT_A.id, TENANT_B.id]
  );
}

async function cleanupMultiTenantData(pool) {
  await pool.query('DELETE FROM equipment_mapping_change_log WHERE org_id IN (?, ?)', [TENANT_A.id, TENANT_B.id]);
  await pool.query('DELETE FROM equipment_types WHERE org_id IN (?, ?)', [TENANT_A.id, TENANT_B.id]);
  await pool.query('DELETE FROM users WHERE id IN (888001, 888002, 888003, 888004)');
  await pool.query('DELETE FROM organizations WHERE id IN (?, ?)', [TENANT_A.id, TENANT_B.id]);
}

async function getUserToken(pool, orgId, role) {
  // In a real implementation, this would generate a proper JWT
  // For testing, we return a token that the auth middleware can validate
  return `test_token_${orgId}_${role}_${Date.now()}`;
}

async function checkEquipmentBelongsToTenant(pool, equipmentId, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM equipment_types WHERE type_code = ? AND org_id = ?',
    [equipmentId, orgId]
  );
  return result.count > 0;
}

async function checkAuditBelongsToTenant(pool, auditId, orgId) {
  const [result] = await pool.query(
    'SELECT COUNT(*) as count FROM equipment_mapping_change_log WHERE id = ? AND org_id = ?',
    [auditId, orgId]
  );
  return result.count > 0;
}

async function getTenantEquipmentCodes(pool, orgId) {
  const results = await pool.query(
    'SELECT type_code FROM equipment_types WHERE org_id = ?',
    [orgId]
  );
  return results.map(r => r.type_code);
}

async function getTenantAuditIds(pool, orgId) {
  const results = await pool.query(
    'SELECT id FROM equipment_mapping_change_log WHERE org_id = ?',
    [orgId]
  );
  return results.map(r => r.id);
}
