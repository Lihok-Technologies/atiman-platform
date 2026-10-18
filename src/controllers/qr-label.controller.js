/**
 * QR Label Controller
 * API endpoints for QR label generation
 */

const qrLabelService = require('../services/qr-label.service');
const { getPublicBaseUrl } = require('../utils/helpers');

class QRLabelController {
  /**
   * GET /api/assets/:id/qr
   * Get QR code for single asset
   */
  async getAssetQR(req, res) {
    try {
      const assetId = req.params.id;
      
      const baseUrl = getPublicBaseUrl();
      
      const result = await qrLabelService.generateForAsset(assetId, baseUrl);
      
      res.json({
        success: true,
        data: {
          assetId: result.asset.id,
          assetName: result.asset.name,
          assetCode: result.asset.code,
          qrData: result.qrData,
          qrImage: result.qrImage
        }
      });
    } catch (error) {
      console.error('Get QR error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate QR code',
        error: error.message
      });
    }
  }

  /**
   * GET /api/assets/:id/qr-label.png
   * Download single label as PNG
   */
  async downloadLabelPNG(req, res) {
    try {
      const assetId = req.params.id;
      const size = req.query.size || '70x40';
      const result = await qrLabelService.generateForAsset(assetId);
      
      const baseUrl = getPublicBaseUrl();
      
      const labelBuffer = await qrLabelService.generateLabelImage(result.asset, { size, baseUrl });
      
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="label-${result.asset.code}.png"`);
      res.send(labelBuffer);
    } catch (error) {
      console.error('Download PNG error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate label',
        error: error.message
      });
    }
  }

  /**
   * GET /api/assets/:id/qr-label.pdf
   * Download single label as PDF
   */
  async downloadLabelPDF(req, res) {
    try {
      const assetId = req.params.id;
      const size = req.query.size || '70x40';
      const result = await qrLabelService.generateForAsset(assetId);
      
      const baseUrl = getPublicBaseUrl();
      
      const pdfBuffer = await qrLabelService.generateLabelPDF(result.asset, { size, baseUrl });
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="label-${result.asset.code}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error('Download PDF error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate PDF',
        error: error.message
      });
    }
  }

  /**
   * POST /api/assets/qr-labels/batch
   * Generate batch PDF for multiple assets
   */
  async downloadBatchPDF(req, res) {
    try {
      const { assetIds, size } = req.body;
      
      if (!assetIds || !Array.isArray(assetIds) || assetIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'assetIds array required'
        });
      }

      const organizationId = req.user?.organization_id || req.user?.organizationId;
      const { Equipment } = require('../models');
      
      // Get base URL for QR generation
      const baseUrl = getPublicBaseUrl();
      
      console.log('[QR-BATCH] Generating for', assetIds.length, 'assets, size:', size);
      
      const assets = [];
      
      for (const id of assetIds) {
        try {
          // Verify asset belongs to organization and get full details
          const asset = await Equipment.getWithIsoClassification(id, organizationId);
          if (asset) {
            console.log('[QR-BATCH] Processing asset:', asset.code, asset.name);
            // Ensure QR exists (generates QR data)
            await qrLabelService.generateForAsset(id, baseUrl);
            assets.push(asset);
          } else {
            console.log('[QR-BATCH] Asset not found or not in org:', id);
          }
        } catch (assetErr) {
          console.error('[QR-BATCH] Error processing asset', id, ':', assetErr.message);
        }
      }

      if (assets.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'No valid assets found'
        });
      }

      console.log('[QR-BATCH] Generating PDF for', assets.length, 'assets');
      const pdfBuffer = await qrLabelService.generateBatchPDF(assets, { size, baseUrl });
      
      console.log('[QR-BATCH] PDF generated, size:', pdfBuffer.length, 'bytes');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="qr-labels-batch.pdf"');
      res.send(pdfBuffer);
    } catch (error) {
      console.error('[QR-BATCH] Error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate batch PDF: ' + error.message,
        error: error.message
      });
    }
  }

  /**
   * POST /api/assets/:id/qr/regenerate
   * Regenerate QR code for asset
   */
  async regenerateQR(req, res) {
    try {
      const assetId = req.params.id;
      
      const baseUrl = getPublicBaseUrl();
      
      const result = await qrLabelService.generateForAsset(assetId, baseUrl);
      
      res.json({
        success: true,
        message: 'QR code regenerated',
        data: {
          qrData: result.qrData,
          qrImage: result.qrImage
        }
      });
    } catch (error) {
      console.error('Regenerate QR error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate QR',
        error: error.message
      });
    }
  }

  /**
   * GET /mobile/assets/:id/qr-label
   * Mobile UI for viewing QR label
   */
  async viewLabelUI(req, res) {
    try {
      const assetId = req.params.id;
      
      const baseUrl = getPublicBaseUrl();
      
      const result = await qrLabelService.generateForAsset(assetId, baseUrl);
      
      res.render('mobile/qr-label-view', {
        layout: 'mobile/layout',
        title: 'QR Label',
        showBack: true,
        showNav: true,
        activeNav: 'admin',
        asset: result.asset,
        qrData: result.qrData,
        qrImage: result.qrImage
      });
    } catch (error) {
      console.error('View label UI error:', error);
      res.status(500).send('Error loading QR label');
    }
  }

  /**
   * GET /mobile/qr-labels/batch
   * Mobile UI for batch QR generation
   */
  async batchLabelUI(req, res) {
    try {
      const organizationId = req.user?.organization_id || req.user?.organizationId;
      const { Equipment, Facility, EquipmentCategory, EquipmentClass, EquipmentType } = require('../models');
      
      // Get all assets for organization
      const assets = await Equipment.getAllWithIsoClassification(organizationId, {});
      
      // Get facilities for filter
      const facilities = await Facility.getByOrganization(organizationId);
      
      // Get ISO hierarchy for cascading filters
      const categories = await EquipmentCategory.findAll({}, { orderBy: 'category_name' });
      const classes = await EquipmentClass.findAll({}, { orderBy: 'class_name' });
      const types = await EquipmentType.findAll({}, { orderBy: 'type_name' });
      
      res.render('mobile/qr-labels-batch', {
        layout: 'mobile/layout',
        title: 'Generate QR Labels',
        showBack: true,
        showNav: true,
        activeNav: 'admin',
        assets: assets,
        facilities: facilities,
        categories: categories,
        classes: classes,
        types: types
      });
    } catch (error) {
      console.error('Batch label UI error:', error);
      res.status(500).send(`Error loading batch label page: ${error.message}`);
    }
  }
}

module.exports = new QRLabelController();
