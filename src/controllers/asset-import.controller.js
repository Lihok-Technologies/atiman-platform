/**
 * Asset Import Controller
 * API endpoints for bulk asset import
 */

const assetImportService = require('../services/asset-import.service');
const fs = require('fs');
const path = require('path');
const os = require('os');

class AssetImportController {
  /**
   * POST /api/assets/import
   * Upload and process asset import CSV
   */
  async uploadImport(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No CSV file provided'
        });
      }

      const userId = req.user?.id;
      const filePath = req.file.path;
      
      console.log(`[Import] Processing file: ${req.file.originalname}`);
      
      // Process import
      const results = await assetImportService.importFromCSV(filePath, userId);
      
      // Clean up uploaded file
      fs.unlinkSync(filePath);
      
      res.json({
        success: true,
        message: `Import complete: ${results.success} assets created, ${results.failed} failed`,
        data: results
      });
      
    } catch (error) {
      console.error('[Import] Error:', error);
      
      // Clean up file on error
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        message: 'Import failed',
        error: error.message
      });
    }
  }

  /**
   * POST /api/assets/import/validate
   * Validate CSV without importing
   */
  async validateImport(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'No CSV file provided'
        });
      }

      const filePath = req.file.path;
      
      // Parse CSV and validate headers only
      const csv = require('csv-parser');
      const results = {
        valid: true,
        total_rows: 0,
        errors: [],
        sample: []
      };
      
      const maxRows = assetImportService.getMaxImportRows();
      const input = fs.createReadStream(filePath);
      const stream = input.pipe(csv())
        .on('data', (row) => {
          if (results.total_rows >= maxRows) {
            input.destroy(new Error(`CSV exceeds the ${maxRows}-row import limit`));
            return;
          }
          results.total_rows++;
          if (results.sample.length < 3) {
            results.sample.push(row);
          }
        })
        .on('headers', (headers) => {
          try {
            assetImportService.validateHeaders(headers);
          } catch (headerError) {
            results.valid = false;
            results.errors.push(headerError.message);
          }
        });
      
      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
        input.on('error', reject);
      });
      
      // Clean up
      fs.unlinkSync(filePath);
      
      res.json({
        success: true,
        message: results.valid ? 'CSV is valid' : 'CSV validation failed',
        data: results
      });
      
    } catch (error) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      
      const isRowLimitError = error.message && error.message.includes('row import limit');
      res.status(isRowLimitError ? 400 : 500).json({
        success: false,
        message: isRowLimitError ? error.message : 'Validation failed'
      });
    }
  }

  /**
   * GET /api/assets/import/template
   * Download CSV template file
   */
  downloadTemplate(req, res) {
    const templatePath = path.join(__dirname, '../../import-templates/asset-import-example.csv');
    
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({
        success: false,
        message: 'Template file not found'
      });
    }
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="asset-import-template.csv"');
    fs.createReadStream(templatePath).pipe(res);
  }

  /**
   * GET /api/assets/import/spec
   * Get import specification
   */
  getSpec(req, res) {
    const spec = {
      required_fields: [
        { name: 'organization_id', type: 'string', description: 'Organization code (e.g., ORG-001)' },
        { name: 'facility_name', type: 'string', description: 'Facility name (auto-created if new)' },
        { name: 'asset_name', type: 'string', description: 'Asset name (unique within facility)' },
        { name: 'equipment_type_code', type: 'string', description: 'Atiman equipment type code' }
      ],
      optional_fields: [
        { name: 'asset_description', type: 'string', description: 'Asset description' },
        { name: 'manufacturer', type: 'string', description: 'Equipment manufacturer' },
        { name: 'model', type: 'string', description: 'Model number' },
        { name: 'serial_number', type: 'string', description: 'Serial number' },
        { name: 'commission_date', type: 'date', format: 'YYYY-MM-DD', description: 'Commissioning date' },
        { name: 'criticality', type: 'enum', values: ['low', 'medium', 'high', 'critical'], default: 'medium' }
      ],
      auto_generated_fields: [
        { name: 'asset_code', description: 'URL-safe slug from asset_name' },
        { name: 'qr_code', description: 'ODM-{org}-{facility}-{asset} format' },
        { name: 'status', description: 'Defaults to operational' }
      ],
      validation_rules: [
        'organization_id must exist and be active',
        'equipment_type_code must resolve to exactly one canonical Atiman equipment type',
        'asset_name must be unique within facility (case-insensitive)',
        'commission_date cannot be in the future',
        'criticality must be one of: low, medium, high, critical'
      ],
      template_inheritance: 'Assets automatically linked to templates matching equipment_type_id',
      scheduler_impact: 'Imported assets immediately eligible for work order generation',
      notes: [
        'Facilities are created automatically if they do not exist',
        'No SAP functional location hierarchy is created',
        'ODM uses flat facility grouping only'
      ]
    };
    
    res.json({
      success: true,
      data: spec
    });
  }
}

module.exports = new AssetImportController();
