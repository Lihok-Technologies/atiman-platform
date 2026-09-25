/**
 * Import the ODM legacy equipment taxonomy design (seed copy) and task templates.
 * The taxonomy is ODM-authored and ISO 14224-informed; it is NOT an ISO extract.
 * Path is resolved from __dirname, so it does not depend on the working directory.
 * Usage: node import-iso-data.js
 */

const fs = require('fs');
const path = require('path');
const { pool } = require('./src/config/database');

async function runMigration(connection) {
  console.log('[MIGRATION] Checking scheduler fields...');
  
  // Check if frequency_type column exists
  const [columns] = await connection.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_templates' AND COLUMN_NAME = 'frequency_type'
  `);
  
  if (columns.length === 0) {
    console.log('[MIGRATION] Adding scheduler fields...');
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN frequency_type ENUM('daily', 'weekly', 'monthly') NULL`);
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN frequency_interval INT DEFAULT 1`);
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN day_of_week TINYINT NULL`);
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN day_of_month TINYINT NULL`);
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN start_date DATE NULL`);
    await connection.execute(`ALTER TABLE task_templates ADD COLUMN priority ENUM('low', 'medium', 'high', 'urgent') DEFAULT 'medium'`);
    console.log('[MIGRATION] ✓ Scheduler fields added');
  } else {
    console.log('[MIGRATION] ✓ Scheduler fields already exist');
  }
}

async function importData() {
  const connection = await pool.getConnection();
  
  // Run migration first
  await runMigration(connection);
  
  try {
    console.log('[IMPORT] Loading taxonomy data...');
    const taxonomy = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'odm_seed/master_data/taxonomy.v1.json'), 'utf8')
    );
    
    await connection.beginTransaction();
    
    // 1. Import Equipment Categories
    console.log('[IMPORT] Importing equipment categories...');
    for (const cat of taxonomy.equipment_categories) {
      await connection.execute(
        `INSERT INTO equipment_categories (category_code, category_name, description) 
         VALUES (?, ?, ?) 
         ON DUPLICATE KEY UPDATE 
         category_name = VALUES(category_name),
         description = VALUES(description)`,
        [cat.code, cat.name, cat.description]
      );
    }
    
    // 2. Import Equipment Classes
    console.log('[IMPORT] Importing equipment classes...');
    for (const cls of taxonomy.equipment_classes) {
      // Get category_id from code
      const [catRows] = await connection.execute(
        'SELECT id FROM equipment_categories WHERE category_code = ?',
        [cls.equipment_category_id.replace('ECAT-', '') === '001' ? 'ROTATING' :
         cls.equipment_category_id.replace('ECAT-', '') === '002' ? 'ELECTRICAL' :
         cls.equipment_category_id.replace('ECAT-', '') === '003' ? 'INSTRUMENT' :
         cls.equipment_category_id.replace('ECAT-', '') === '004' ? 'VALVE' :
         cls.equipment_category_id.replace('ECAT-', '') === '005' ? 'STATIC' :
         cls.equipment_category_id.replace('ECAT-', '') === '006' ? 'PIPING' :
         cls.equipment_category_id.replace('ECAT-', '') === '007' ? 'HVAC' :
         cls.equipment_category_id.replace('ECAT-', '') === '008' ? 'STRUCTURE' :
         cls.equipment_category_id.replace('ECAT-', '') === '009' ? 'SAFETY' : 'UTILITY']
      );
      
      if (catRows.length > 0) {
        await connection.execute(
          `INSERT INTO equipment_classes (category_id, class_code, class_name, description) 
           VALUES (?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE 
           class_name = VALUES(class_name),
           description = VALUES(description)`,
          [catRows[0].id, cls.code, cls.name, cls.description]
        );
      }
    }
    
    // 3. Import Equipment Types
    console.log('[IMPORT] Importing equipment types...');
    for (const type of taxonomy.equipment_types) {
      // Get class_id from code
      const [clsRows] = await connection.execute(
        'SELECT id FROM equipment_classes WHERE class_code = ?',
        [type.equipment_class_id.replace('ECLS-', 'PUMP').replace('001', 'PUMP').replace('002', 'COMPRESSOR')]
      );
      
      if (clsRows.length > 0) {
        await connection.execute(
          `INSERT INTO equipment_types (class_id, type_code, type_name, description, typical_components) 
           VALUES (?, ?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE 
           type_name = VALUES(type_name),
           description = VALUES(description),
           typical_components = VALUES(typical_components)`,
          [clsRows[0].id, type.code, type.name, type.description, 
           type.typical_components ? JSON.stringify(type.typical_components) : null]
        );
      }
    }
    
    // 4. Create default inspection templates for each equipment type
    console.log('[IMPORT] Creating default inspection templates...');
    const [equipmentTypes] = await connection.execute('SELECT id, type_code, type_name FROM equipment_types');
    
    for (const et of equipmentTypes) {
      // Check if template already exists
      const [existing] = await connection.execute(
        'SELECT id FROM task_templates WHERE equipment_type_id = ? AND template_code = ?',
        [et.id, `DAILY-${et.type_code}`]
      );
      
      if (existing.length === 0) {
        // Create daily inspection template
        await connection.execute(
          `INSERT INTO task_templates 
           (organization_id, equipment_type_id, template_code, template_name, 
            maintenance_type, description, frequency_type, frequency_interval, 
            start_date, priority, is_active)
           VALUES (NULL, ?, ?, ?, 'inspection', ?, 'daily', 1, CURDATE(), 'medium', TRUE)`,
          [et.id, `DAILY-${et.type_code}`, `Daily ${et.type_name} Inspection`, 
           `Standard daily inspection for ${et.type_name}`]
        );
        
        console.log(`  Created template: Daily ${et.type_name} Inspection`);
      }
    }
    
    await connection.commit();
    console.log('[IMPORT] ✓ Import completed successfully!');
    console.log(`[IMPORT] Imported ${taxonomy.equipment_categories.length} categories`);
    console.log(`[IMPORT] Imported ${taxonomy.equipment_classes.length} classes`);
    console.log(`[IMPORT] Imported ${taxonomy.equipment_types.length} equipment types`);
    
  } catch (error) {
    await connection.rollback();
    console.error('[IMPORT] ✗ Import failed:', error.message);
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

importData().catch(console.error);
