/**
 * Routes Index
 */

const express = require('express');
const router = express.Router();

console.log('[ROUTES] Loading routes...');

// API routes
router.use('/auth', require('./auth.routes'));
router.use('/users', require('./user.routes'));
router.use('/organizations', require('./organization.routes'));
router.use('/subscriptions', require('./subscription.routes'));
router.use('/payments', require('./payment.routes'));
router.use('/invitations', require('./invitation.routes'));
router.use('/facilities', require('./facility.routes'));
router.use('/equipment', require('./equipment.routes'));
router.use('/tasks', require('./task.routes'));
router.use('/schedules', require('./schedule.routes'));
console.log('[ROUTES] About to load work-orders routes');
router.use('/work-orders', require('./work-order.routes'));
console.log('[ROUTES] Work-orders routes loaded');
router.use('/inspections', require('./inspection.routes'));
router.use('/inspection-results', require('./inspection-result.routes'));
router.use('/reports', require('./report.routes'));

// ISO 14224 Equipment Classification
router.use('/iso-equipment', require('./iso-equipment.routes'));

// Industry Layer (Step 2)
router.use('/industries', require('./industry.routes'));

// ISO 14224 Levels 4-5 (Subunits and Maintainable Items)
router.use('/subunits', require('./subunit.routes'));

// Task Templates (ISO 14224 aligned)
router.use('/task-templates', require('./task-template.routes'));
router.use('/templates', require('./task-template.routes'));

// Step 4: Coverage Validation (Admin only)
router.use('/admin/coverage', require('./coverage-validation.routes'));

// Step 5: Admin Coverage UI
router.use('/admin/coverage-ui', require('./admin-coverage-ui.routes'));

// Maintenance Plans (Schedules - separates WHEN from WHAT)
router.use('/maintenance-plans', require('./maintenance-plan.routes'));

// ODM Scheduler (Auto WO Generation)
router.use('/scheduler', require('./scheduler.routes'));

// Asset Bulk Import
router.use('/assets', require('./asset-import.routes'));

// QR Label Generation
router.use(require('./qr-label.routes'));

// ODM Findings with SAP Catalog Support
router.use('/findings', require('./finding.routes'));

// Subscription-based Premium Features
// Custom Fields (Professional+)
router.use('/custom-fields', require('./custom-field.routes'));

// SSO (Enterprise)
router.use('/sso', require('./sso.routes'));

// Audit Logs (Enterprise)
router.use('/audit-logs', require('./audit-log.routes'));

// API Keys (Professional+)
router.use('/api-keys', require('./api-key.routes'));

// SAP S/4HANA PM Catalogs (A, B, C, 5)
router.use('/sap-catalogs', require('./sap-catalog.routes'));

// Knowledge Provenance authoring (ATM-001 M3)
router.use('/knowledge-provenance', require('./knowledge-provenance.routes'));

// Knowledge Pack authoring, composition and publication (ATM-001 M4)
router.use('/knowledge-packs', require('./knowledge-pack.routes'));

// Mobile Inspection Workflow (API)
router.use('/m', require('./mobile-inspection.routes'));

// Mobile UI Routes (Views)
router.use('/mobile', require('./mobile.routes'));

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
