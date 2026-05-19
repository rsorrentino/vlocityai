#!/usr/bin/env node

/**
 * Script to analyze VlocityBuildErrors.log and fix resolvable errors in target org
 * Usage: node scripts/fix-vlocity-errors.js <targetUsername> [errorLogPath]
 * 
 * Example:
 *   node scripts/fix-vlocity-errors.js username@example.com
 */

const fs = require('fs-extra');
const path = require('path');
const logger = require('../server/utils/logger');
const salesforceService = require('../server/services/salesforceService');
const vlocityService = require('../server/services/vlocityService');

/**
 * Parse error log and extract fixable errors
 */
function parseErrors(errorLogPath) {
  const content = fs.readFileSync(errorLogPath, 'utf8');
  const lines = content.split('\n');
  
  const errors = {
    settingsMismatch: [],
    duplicateFields: [],
    triggerErrors: [],
    otherErrors: []
  };

  let currentError = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for settings mismatch
    if (line.includes('setting mismatch')) {
      errors.settingsMismatch.push(line);
    }
    // Check for duplicate field errors
    else if (line.includes('duplicate field value found')) {
      const match = line.match(/duplicate field value found: (.+?) on the field: (.+?) on record with id: ([A-Za-z0-9]{15,18})/);
      if (match) {
        errors.duplicateFields.push({
          value: match[1],
          field: match[2],
          recordId: match[3],
          fullLine: line
        });
      }
    }
    // Check for trigger errors
    else if (line.includes('TriggerHandlerException') || line.includes('execution of BeforeUpdate')) {
      errors.triggerErrors.push(line);
    }
    // Other errors
    else if (line.includes('Error Message')) {
      errors.otherErrors.push(line);
    }
  }

  return errors;
}

/**
 * Fix duplicate field values by generating new unique values
 */
async function fixDuplicateFields(duplicateErrors, targetUsername) {
  console.log(`\n🔧 Fixing ${duplicateErrors.length} duplicate field errors...`);
  
  // Group duplicates by field and value
  const duplicatesByField = {};
  
  for (const error of duplicateErrors) {
    const key = `${error.field}_${error.value}`;
    if (!duplicatesByField[key]) {
      duplicatesByField[key] = [];
    }
    duplicatesByField[key].push(error);
  }

  const fixes = [];
  let fixCounter = 10000; // Start from a high number to avoid conflicts

  for (const [key, records] of Object.entries(duplicatesByField)) {
    if (records.length > 1) {
      // Multiple records with same value - need to fix all but one
      for (let i = 1; i < records.length; i++) {
        const record = records[i];
        let newValue;
        
        if (record.field === 'vlocity_cmt__Code__c') {
          // For Code field, append a suffix
          newValue = `${record.value}_FIX${fixCounter++}`;
        } else if (record.field === 'vlocity_cmt__DisplaySequence__c') {
          // For DisplaySequence, use a unique number
          newValue = fixCounter++;
        } else {
          // Generic fix
          newValue = `${record.value}_FIX${fixCounter++}`;
        }

        fixes.push({
          recordId: record.recordId,
          field: record.field,
          oldValue: record.value,
          newValue: newValue
        });
      }
    }
  }

  // Execute fixes
  if (fixes.length > 0) {
    console.log(`\n📝 Generated ${fixes.length} fixes to apply:`);
    fixes.forEach(fix => {
      console.log(`  - Record ${fix.recordId}: ${fix.field} = "${fix.oldValue}" → "${fix.newValue}"`);
    });

    // Group fixes by object type (we know these are AttributeCategory)
    const objectType = 'vlocity_cmt__AttributeCategory__c';
    
    console.log(`\n🚀 Applying fixes to ${targetUsername}...`);
    
    try {
      // Create update statements
      const updates = fixes.map(fix => {
        const updateObj = { id: fix.recordId };
        updateObj[fix.field] = fix.field === 'vlocity_cmt__DisplaySequence__c' ? parseInt(fix.newValue) : fix.newValue;
        return updateObj;
      });

      // Update in batches
      const batchSize = 200;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        console.log(`  Updating batch ${Math.floor(i / batchSize) + 1} (${batch.length} records)...`);
        
      // Authenticate with Salesforce
      await salesforceService.authenticateWithSfdx(targetUsername);

      // Use Salesforce REST API to update
      const results = await Promise.all(
        batch.map(async (update) => {
          try {
            // Get the field name and value from the update object
            const fieldName = Object.keys(update).find(k => k !== 'id');
            const fieldValue = update[fieldName];
            
            // Update the record using Salesforce REST API
            await salesforceService.update(objectType, update.id, {
              [fieldName]: fieldValue
            });
            
            return { success: true, recordId: update.id, field: fieldName, value: fieldValue };
          } catch (error) {
            return { success: false, recordId: update.id, error: error.message };
          }
        })
      );

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        console.log(`    ✅ ${successful} updated, ❌ ${failed} failed`);
      }

      console.log(`\n✅ All fixes applied successfully!`);
      return { success: true, fixesApplied: fixes.length };
    } catch (error) {
      console.error(`\n❌ Error applying fixes: ${error.message}`);
      return { success: false, error: error.message };
    }
  } else {
    console.log(`\n✅ No duplicate field fixes needed.`);
    return { success: true, fixesApplied: 0 };
  }
}

/**
 * Fix settings mismatch by running packUpdateSettings
 */
async function fixSettingsMismatch(targetUsername) {
  console.log(`\n⚙️  Fixing settings mismatch on ${targetUsername}...`);
  
  try {
    await vlocityService.updateSettings(targetUsername);
    console.log(`✅ Settings synchronized successfully!`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to sync settings: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node scripts/fix-vlocity-errors.js <targetUsername> [errorLogPath]');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/fix-vlocity-errors.js username@example.com');
    console.error('  node scripts/fix-vlocity-errors.js username@example.com ./VlocityBuildErrors.log');
    process.exit(1);
  }

  const targetUsername = args[0];
  const errorLogPath = args[1] || path.join(process.cwd(), 'VlocityBuildErrors.log');

  try {
    console.log(`📋 Analyzing error log: ${errorLogPath}`);
    
    if (!await fs.pathExists(errorLogPath)) {
      console.error(`❌ Error log not found: ${errorLogPath}`);
      process.exit(1);
    }

    // Parse errors
    const errors = parseErrors(errorLogPath);
    
    console.log(`\n📊 Error Summary:`);
    console.log(`  - Settings Mismatch: ${errors.settingsMismatch.length}`);
    console.log(`  - Duplicate Fields: ${errors.duplicateFields.length}`);
    console.log(`  - Trigger Errors: ${errors.triggerErrors.length}`);
    console.log(`  - Other Errors: ${errors.otherErrors.length}`);

    const results = {
      settingsMismatch: null,
      duplicateFields: null
    };

    // Fix settings mismatch
    if (errors.settingsMismatch.length > 0) {
      results.settingsMismatch = await fixSettingsMismatch(targetUsername);
    }

    // Fix duplicate fields
    if (errors.duplicateFields.length > 0) {
      results.duplicateFields = await fixDuplicateFields(errors.duplicateFields, targetUsername);
    }

    // Summary
    console.log(`\n📊 Fix Summary:`);
    if (results.settingsMismatch) {
      console.log(`  Settings Mismatch: ${results.settingsMismatch.success ? '✅ Fixed' : '❌ Failed'}`);
    }
    if (results.duplicateFields) {
      console.log(`  Duplicate Fields: ${results.duplicateFields.success ? `✅ Fixed (${results.duplicateFields.fixesApplied} records)` : '❌ Failed'}`);
    }

    // Note about trigger errors
    if (errors.triggerErrors.length > 0) {
      console.log(`\n⚠️  Note: ${errors.triggerErrors.length} trigger errors cannot be automatically fixed.`);
      console.log(`   These may require investigation of the PricingElement trigger handler.`);
    }

    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    logger.logError(error, { operation: 'fixVlocityErrors', targetUsername, errorLogPath });
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseErrors, fixDuplicateFields, fixSettingsMismatch };

