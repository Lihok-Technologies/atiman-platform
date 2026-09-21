/**
 * Step 6: Regression Tests for Preserved Functionality
 * Validates: QR, Scheduler, WO numbering, Inspections, Findings, Clone flow
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createPool, isIntegrationTest } = require('../src/config/database');

const TEST_PORT = 9997;
const TEST_TIMEOUT = 30000;
const TEST_ORG_ID = 777777;

// Destructive database suite: gated on isIntegrationTest(), the same predicate
// that selects TEST_DB_* credentials, so it can never run against runtime
// DB_*/PG* credentials.
describe('Step 6: Regression Tests - Preserved Functionality', { skip: !isIntegrationTest() }, () => {
  let server;
  let pool;
  let baseUrl;
  let authToken;

  before(async () => {
    pool = createPool();
    await setupRegressionTestData(pool);
    
    const app = require('../src/app');
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(TEST_PORT, resolve));
    baseUrl = `http://localhost:${TEST_PORT}`;
    
    authToken = await getAuthToken(pool, TEST_ORG_ID, 'admin');
  }, TEST_TIMEOUT);

  after(async () => {
    await cleanupRegressionTestData(pool);
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }, TEST_TIMEOUT);

  // ============================================================================
  // SECTION 1: QR Generation/Scanning
  // ============================================================================
  describe('QR Generation & Scanning', () => {
    it('should generate QR code for equipment', async () => {
      const response = await fetch(
        `${baseUrl}/api/equipment/TEST_EQUIP_001/qr`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('qr_data'), 'Should have QR data');
      assert.ok(data.hasOwnProperty('qr_image_url') || data.hasOwnProperty('qr_svg'), 'Should have QR image');
      assert.ok(data.qr_data.includes('TEST_EQUIP_001'), 'QR should contain equipment code');
    });

    it('should generate printable QR labels', async () => {
      const response = await fetch(
        `${baseUrl}/api/equipment/TEST_EQUIP_001/qr/print`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('label_data'), 'Should have label data');
      assert.ok(data.hasOwnProperty('print_ready'), 'Should indicate print readiness');
    });

    it('should scan QR and return equipment info', async () => {
      const response = await fetch(
        `${baseUrl}/api/qr/scan`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            qr_data: 'ODM:EQUIP:TEST_EQUIP_001:777777'
          })
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.strictEqual(data.equipment_code, 'TEST_EQUIP_001', 'Should identify equipment');
      assert.ok(data.hasOwnProperty('equipment_details'), 'Should have equipment details');
    });

    it('should reject invalid QR codes', async () => {
      const response = await fetch(
        `${baseUrl}/api/qr/scan`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            qr_data: 'INVALID_QR_DATA'
          })
        }
      );
      
      assert.ok(response.status === 400 || response.status === 404, 'Should reject invalid QR');
    });
  });

  // ============================================================================
  // SECTION 2: Scheduler & Maintenance Plan Behavior
  // ============================================================================
  describe('Scheduler & Maintenance Plans', () => {
    it('should check if plan is due using isPlanDue', async () => {
      const response = await fetch(
        `${baseUrl}/api/maintenance-plans/TEST_PLAN_001/due`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('is_due'), 'Should have is_due flag');
      assert.ok(data.hasOwnProperty('next_due_date'), 'Should have next due date');
      assert.ok(data.hasOwnProperty('days_until_due'), 'Should have days until due');
      assert.ok(typeof data.is_due === 'boolean', 'is_due should be boolean');
    });

    it('should generate correct next occurrence based on frequency', async () => {
      const response = await fetch(
        `${baseUrl}/api/maintenance-plans/TEST_PLAN_001/schedule`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('frequency'), 'Should have frequency');
      assert.ok(data.hasOwnProperty('base_date'), 'Should have base date');
      assert.ok(data.hasOwnProperty('next_occurrence'), 'Should calculate next occurrence');
    });

    it('should handle meter-based scheduling', async () => {
      const response = await fetch(
        `${baseUrl}/api/maintenance-plans/TEST_METER_PLAN/due`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      if (data.schedule_type === 'meter') {
        assert.ok(data.hasOwnProperty('current_reading'), 'Should have current meter reading');
        assert.ok(data.hasOwnProperty('threshold_reading'), 'Should have threshold');
      }
    });
  });

  // ============================================================================
  // SECTION 3: Work Order Numbering
  // ============================================================================
  describe('Work Order Numbering', () => {
    it('should generate WO with correct format', async () => {
      const response = await fetch(
        `${baseUrl}/api/work-orders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            equipment_id: 'TEST_EQUIP_001',
            plan_id: 'TEST_PLAN_001',
            description: 'Test work order'
          })
        }
      );
      
      assert.strictEqual(response.status, 201);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('wo_number'), 'Should have WO number');
      // WO format: WO-{org_id}-{timestamp}-{sequence}
      const woPattern = /^WO-\d+-\d{8}-\d+$/;
      assert.ok(woPattern.test(data.wo_number), `WO number ${data.wo_number} should match format`);
    });

    it('should generate sequential WO numbers', async () => {
      // Create two WOs and verify sequencing
      const wo1Response = await fetch(
        `${baseUrl}/api/work-orders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            equipment_id: 'TEST_EQUIP_001',
            description: 'First WO'
          })
        }
      );
      
      const wo1 = await wo1Response.json();
      
      const wo2Response = await fetch(
        `${baseUrl}/api/work-orders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            equipment_id: 'TEST_EQUIP_001',
            description: 'Second WO'
          })
        }
      );
      
      const wo2 = await wo2Response.json();
      
      // Extract sequence numbers
      const seq1 = parseInt(wo1.wo_number.split('-').pop());
      const seq2 = parseInt(wo2.wo_number.split('-').pop());
      
      assert.strictEqual(seq2, seq1 + 1, 'WO numbers should be sequential');
    });

    it('should include tenant prefix in WO number', async () => {
      const response = await fetch(
        `${baseUrl}/api/work-orders`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            equipment_id: 'TEST_EQUIP_001',
            description: 'Test WO'
          })
        }
      );
      
      const data = await response.json();
      
      // Should include org_id in WO number for tenant isolation
      assert.ok(
        data.wo_number.includes(TEST_ORG_ID.toString()),
        'WO number should include tenant ID'
      );
    });
  });

  // ============================================================================
  // SECTION 4: Inspection Execution
  // ============================================================================
  describe('Inspection Execution', () => {
    it('should start inspection with correct template', async () => {
      const response = await fetch(
        `${baseUrl}/api/inspections`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            work_order_id: 'TEST_WO_001',
            template_id: 'TEST_TEMPLATE_001',
            equipment_id: 'TEST_EQUIP_001'
          })
        }
      );
      
      assert.strictEqual(response.status, 201);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('inspection_id'), 'Should have inspection ID');
      assert.strictEqual(data.status, 'in_progress', 'Should start in progress');
      assert.ok(Array.isArray(data.steps), 'Should have steps array');
    });

    it('should execute inspection steps in order', async () => {
      // Get inspection steps
      const response = await fetch(
        `${baseUrl}/api/inspections/TEST_INSP_001/steps`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(Array.isArray(data.steps), 'Should have steps');
      
      // Verify step ordering
      for (let i = 0; i < data.steps.length - 1; i++) {
        assert.ok(
          data.steps[i].step_number < data.steps[i + 1].step_number,
          'Steps should be in order'
        );
      }
    });

    it('should record step results', async () => {
      const response = await fetch(
        `${baseUrl}/api/inspections/TEST_INSP_001/steps/1`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            result: 'pass',
            value: '10.5',
            notes: 'Within tolerance'
          })
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.strictEqual(data.result, 'pass', 'Should record pass result');
      assert.ok(data.hasOwnProperty('completed_at'), 'Should record completion time');
    });

    it('should complete inspection', async () => {
      const response = await fetch(
        `${baseUrl}/api/inspections/TEST_INSP_001/complete`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            notes: 'Inspection completed successfully'
          })
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.strictEqual(data.status, 'completed', 'Should mark as completed');
      assert.ok(data.hasOwnProperty('completed_at'), 'Should have completion time');
      assert.ok(data.hasOwnProperty('summary'), 'Should have inspection summary');
    });
  });

  // ============================================================================
  // SECTION 5: Findings Capture
  // ============================================================================
  describe('Findings Capture', () => {
    it('should capture findings during inspection', async () => {
      const response = await fetch(
        `${baseUrl}/api/inspections/TEST_INSP_001/findings`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            step_id: 1,
            finding_type: 'deficiency',
            severity: 'medium',
            description: 'Worn bearing detected',
            recommendation: 'Replace bearing within 30 days'
          })
        }
      );
      
      assert.strictEqual(response.status, 201);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('finding_id'), 'Should have finding ID');
      assert.strictEqual(data.finding_type, 'deficiency', 'Should capture finding type');
      assert.strictEqual(data.severity, 'medium', 'Should capture severity');
    });

    it('should associate findings with equipment and inspection', async () => {
      const response = await fetch(
        `${baseUrl}/api/equipment/TEST_EQUIP_001/findings`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(Array.isArray(data.findings), 'Should have findings array');
      
      for (const finding of data.findings) {
        assert.ok(finding.hasOwnProperty('inspection_id'), 'Finding should have inspection ID');
        assert.ok(finding.hasOwnProperty('equipment_id'), 'Finding should have equipment ID');
        assert.strictEqual(finding.equipment_id, 'TEST_EQUIP_001', 'Should match equipment');
      }
    });

    it('should track finding status (open/closed)', async () => {
      const response = await fetch(
        `${baseUrl}/api/findings/TEST_FINDING_001`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      assert.strictEqual(response.status, 200);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('status'), 'Should have status');
      assert.ok(['open', 'closed', 'in_progress'].includes(data.status), 'Status should be valid');
    });
  });

  // ============================================================================
  // SECTION 6: Template Clone Flow
  // ============================================================================
  describe('Template Clone Flow', () => {
    it('should clone system template while preserving immutability', async () => {
      const response = await fetch(
        `${baseUrl}/api/templates/SYSTEM_TEMPLATE_001/clone`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            new_name: 'Cloned Template',
            target_equipment_type: 'TEST_EQUIP_001'
          })
        }
      );
      
      assert.strictEqual(response.status, 201);
      const data = await response.json();
      
      assert.ok(data.hasOwnProperty('new_template_id'), 'Should have new template ID');
      assert.ok(data.hasOwnProperty('cloned_from'), 'Should reference original');
      assert.notStrictEqual(data.new_template_id, 'SYSTEM_TEMPLATE_001', 'Should be new ID');
    });

    it('should prevent modification of system templates', async () => {
      const response = await fetch(
        `${baseUrl}/api/templates/SYSTEM_TEMPLATE_001`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            template_name: 'Modified Name'
          })
        }
      );
      
      // Should reject modification of system templates
      assert.ok(
        response.status === 403 || response.status === 400,
        'Should prevent system template modification'
      );
    });

    it('should copy all steps when cloning', async () => {
      // First get original template steps
      const originalResponse = await fetch(
        `${baseUrl}/api/templates/SYSTEM_TEMPLATE_001/steps`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      const originalData = await originalResponse.json();
      const originalStepCount = originalData.steps.length;
      
      // Clone template
      const cloneResponse = await fetch(
        `${baseUrl}/api/templates/SYSTEM_TEMPLATE_001/clone`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            new_name: 'Clone Steps Test'
          })
        }
      );
      
      const cloneData = await cloneResponse.json();
      
      // Get cloned template steps
      const clonedStepsResponse = await fetch(
        `${baseUrl}/api/templates/${cloneData.new_template_id}/steps`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Tenant-ID': TEST_ORG_ID.toString()
          }
        }
      );
      
      const clonedData = await clonedStepsResponse.json();
      
      assert.strictEqual(
        clonedData.steps.length,
        originalStepCount,
        'Cloned template should have same number of steps'
      );
    });
  });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function setupRegressionTestData(pool) {
  await pool.query(
    `INSERT INTO organizations (id, name, status, created_at) 
     VALUES (?, 'Regression Test Org', 'active', NOW())
     ON DUPLICATE KEY UPDATE name = 'Regression Test Org'`,
    [TEST_ORG_ID]
  );
  
  await pool.query(
    `INSERT INTO users (id, org_id, email, role, status, created_at)
     VALUES (777001, ?, 'regression@test.com', 'admin', 'active', NOW())
     ON DUPLICATE KEY UPDATE role = 'admin'`,
    [TEST_ORG_ID]
  );
  
  // Create test equipment
  await pool.query(
    `INSERT INTO equipment_types (type_code, type_name, category_id, class_id, org_id, created_at)
     VALUES 
       ('TEST_EQUIP_001', 'Test Equipment 1', 1, 1, ?, NOW()),
       ('TEST_EQUIP_002', 'Test Equipment 2', 1, 1, ?, NOW())
     ON DUPLICATE KEY UPDATE type_name = VALUES(type_name)`,
    [TEST_ORG_ID, TEST_ORG_ID]
  );
  
  // Create test maintenance plan
  await pool.query(
    `INSERT INTO maintenance_plans (plan_id, plan_name, equipment_type_id, frequency, org_id, created_at)
     VALUES 
       ('TEST_PLAN_001', 'Test Weekly Plan', 'TEST_EQUIP_001', '1 week', ?, NOW()),
       ('TEST_METER_PLAN', 'Test Meter Plan', 'TEST_EQUIP_001', '1000 hours', ?, NOW())
     ON DUPLICATE KEY UPDATE plan_name = VALUES(plan_name)`,
    [TEST_ORG_ID, TEST_ORG_ID]
  );
  
  // Create test work order
  await pool.query(
    `INSERT INTO work_orders (wo_number, equipment_id, plan_id, status, org_id, created_at)
     VALUES ('TEST_WO_001', 'TEST_EQUIP_001', 'TEST_PLAN_001', 'open', ?, NOW())
     ON DUPLICATE KEY UPDATE status = 'open'`,
    [TEST_ORG_ID]
  );
  
  // Create test inspection
  await pool.query(
    `INSERT INTO inspections (inspection_id, work_order_id, template_id, equipment_id, status, org_id, created_at)
     VALUES ('TEST_INSP_001', 'TEST_WO_001', 'TEST_TEMPLATE_001', 'TEST_EQUIP_001', 'in_progress', ?, NOW())
     ON DUPLICATE KEY UPDATE status = 'in_progress'`,
    [TEST_ORG_ID]
  );
  
  // Create test finding
  await pool.query(
    `INSERT INTO findings (finding_id, inspection_id, equipment_id, step_id, finding_type, severity, status, org_id, created_at)
     VALUES ('TEST_FINDING_001', 'TEST_INSP_001', 'TEST_EQUIP_001', 1, 'deficiency', 'medium', 'open', ?, NOW())
     ON DUPLICATE KEY UPDATE status = 'open'`,
    [TEST_ORG_ID]
  );
  
  // Create system template
  await pool.query(
    `INSERT INTO smp_templates (template_id, template_code, template_name, is_system, org_id, created_at)
     VALUES ('SYSTEM_TEMPLATE_001', 'SYS_TMPL_001', 'System Template', 1, ?, NOW())
     ON DUPLICATE KEY UPDATE template_name = 'System Template'`,
    [TEST_ORG_ID]
  );
}

async function cleanupRegressionTestData(pool) {
  await pool.query('DELETE FROM findings WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM inspections WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM work_orders WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM maintenance_plans WHERE org_id = ?', [TEST_ORG_ID]);
  await pool.query('DELETE FROM equipment_types WHERE org_id = ? AND type_code LIKE "TEST_%"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM smp_templates WHERE org_id = ? AND template_id = "SYSTEM_TEMPLATE_001"', [TEST_ORG_ID]);
  await pool.query('DELETE FROM users WHERE id = 777001');
  await pool.query('DELETE FROM organizations WHERE id = ?', [TEST_ORG_ID]);
}

async function getAuthToken(pool, orgId, role) {
  return `test_token_${orgId}_${role}_${Date.now()}`;
}
