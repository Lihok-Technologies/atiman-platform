/**
 * Mobile Inspection Routes
 * Mobile-first inspection workflow APIs
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const mobileInspectionController = require('../controllers/mobile-inspection.controller');

/**
 * Middleware to prevent admin users from performing inspections
 * Admins can view/manage but cannot execute inspection workflows
 */
const preventAdminInspection = (req, res, next) => {
  if (req.user?.role === 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin users cannot perform inspections. Please re-assign this task to a technician or supervisor.'
    });
  }
  next();
};

// Every route in this router requires authentication.
//
// DEFECT B (ATM-002-I2A) — `GET /asset/:token` was previously mounted ABOVE this
// line behind `optionalAuth`, and its handler skipped its organization comparison
// entirely whenever no principal was present. An anonymous caller holding a token
// therefore received the asset, its classification, its SAP references, its recent
// findings and its recent inspections. There is no such thing as an anonymous
// Atiman asset context, so the route now sits behind the same authentication as
// every other route here and delegates to the authoritative tenant-safe resolver.
router.use(authenticate);

// QR Asset Page — authenticated, tenant-scoped asset context.
router.get('/asset/:token', mobileInspectionController.getAssetPage);

// Facility and Asset browsing
router.get('/facilities', requirePermission('INSPECTIONS', 'VIEW'), mobileInspectionController.getFacilitiesList);
router.get('/facility/:facilityId/assets', requirePermission('INSPECTIONS', 'VIEW'), mobileInspectionController.getAssetsByFacility);

// Asset History
router.get('/asset/:assetId/history', requirePermission('INSPECTIONS', 'VIEW'), mobileInspectionController.getAssetHistory);

// Inspection Runner - GET viewable by all, POST blocked for admins
router.get('/asset/:assetId/inspect/:templateId', requirePermission('INSPECTIONS', 'VIEW'), mobileInspectionController.getInspectionRunner);
router.post('/asset/:assetId/inspect', requirePermission('INSPECTIONS', 'SUBMIT'), preventAdminInspection, mobileInspectionController.submitInspectionResults);

// Finding Recorder
router.get('/asset/:assetId/finding-form', requirePermission('FINDINGS', 'CREATE'), mobileInspectionController.getFindingForm);
router.post('/asset/:assetId/finding', requirePermission('FINDINGS', 'CREATE'), mobileInspectionController.submitFinding);

module.exports = router;
