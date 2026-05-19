const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const { ValidationError } = require('../middleware/errorHandler');
const { spawn } = require('child_process');

/**
 * SF CLI Reference Updater Service
 * Updates external key references in exported JSON files before deployment
 * Maps source org IDs to target org IDs using external keys
 */
class SfCliReferenceUpdater {
  constructor() {
    this.timeout = parseInt(process.env.SF_CLI_TIMEOUT) || 300000; // 5 minutes
  }

  /**
   * Execute SF CLI command to query records
   * @param {string} soql - SOQL query
   * @param {string} username - Salesforce username
   * @returns {Promise<Array>} Array of records
   */
  async queryRecords(soql, username) {
    return new Promise((resolve, reject) => {
      // Determine which SF CLI command to use
      let cliCommand = 'sf';
      const args = ['data', 'query', '--query', soql, '--target-org', username, '--result-format', 'json'];
      
      // On Windows with shell mode, construct full command string for better compatibility
      // This avoids issues with SOQL queries containing spaces being parsed incorrectly
      let child;
      if (process.platform === 'win32') {
        // For Windows, use command string approach with proper quoting
        const commandString = `${cliCommand} ${args.map(arg => {
          // Properly escape and quote arguments that contain spaces or special characters
          if (typeof arg === 'string' && (arg.includes(' ') || arg.includes(',') || arg.includes('!') || arg.includes('='))) {
            // Escape internal quotes and wrap in quotes
            return `"${arg.replace(/"/g, '\\"')}"`;
          }
          return arg;
        }).join(' ')}`;
        
        logger.info(`Executing SF CLI query on Windows: ${commandString}`);
        
        child = spawn(commandString, [], {
          shell: true,
          windowsHide: true
        });
      } else {
        // Use standard spawn with args array for non-Windows
        child = spawn(cliCommand, args, {
          shell: false,
          windowsHide: true
        });
      }

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          // Strip ANSI codes from stderr for error extraction
          let cleanStderr = stderr.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
          let cleanStdout = stdout.replace(/\u001b\[[0-9;]*m/g, '').replace(/\x1b\[[0-9;]*m/g, '');
          
          // Check if stderr contains actual errors (not just warnings)
          const stderrLower = cleanStderr.toLowerCase();
          const isError = !stderrLower.includes('warning') && 
                          !stderrLower.includes('could not find typescript') &&
                          !stderrLower.includes('error plugin') &&
                          !stderrLower.includes('could not find package.json');
          
          // Try to extract error from stdout (might contain JSON error response)
          let errorMessage = '';
          if (cleanStdout) {
            try {
              // Look for JSON error response
              const jsonStart = cleanStdout.search(/[\{\[]/);
              if (jsonStart >= 0) {
                const jsonEnd = Math.max(cleanStdout.lastIndexOf('}'), cleanStdout.lastIndexOf(']'));
                if (jsonEnd > jsonStart) {
                  const jsonStr = cleanStdout.substring(jsonStart, jsonEnd + 1);
                  try {
                    const errorJson = JSON.parse(jsonStr);
                    if (errorJson.result && errorJson.result.errors) {
                      errorMessage = errorJson.result.errors.map(e => e.message || e.errorCode || e).join('; ');
                    } else if (errorJson.message) {
                      errorMessage = errorJson.message;
                    }
                  } catch (e) {
                    // Not valid JSON, continue
                  }
                }
              }
              
              // Look for text error patterns
              if (!errorMessage) {
                const errorPatterns = [
                  /Error\s*\([^)]+\):\s*(.+)/i,
                  /We couldn't process[^\n]+/i,
                  /INVALID_FIELD[^\n]+/i,
                  /REQUIRED_FIELD_MISSING[^\n]+/i
                ];
                
                for (const pattern of errorPatterns) {
                  const match = cleanStdout.match(pattern);
                  if (match) {
                    errorMessage = match[0].trim();
                    break;
                  }
                }
              }
            } catch (e) {
              // Error extracting from stdout
            }
          }
          
          // Use extracted error message or stderr
          const finalError = errorMessage || cleanStderr || stderr || 'Unknown error';
          
          if (isError || finalError !== 'Unknown error') {
            logger.error(`SF CLI query failed`, {
              exitCode: code,
              stderr: cleanStderr.substring(0, 500),
              stdout: cleanStdout.substring(0, 500),
              soql: soql.substring(0, 200),
              username
            });
            reject(new Error(`SF CLI query failed: ${finalError}`));
            return;
          }
          // If it's just warnings, continue parsing stdout
        }

        try {
          // Clean stdout - remove any non-JSON content (warnings, etc.)
          // Try to find JSON content in stdout
          let jsonContent = stdout.trim();
          
          // Strip ANSI color codes (escape sequences like \u001b[94m, \u001b[39m, etc.)
          // Pattern: \u001b[ or ESC[ followed by numbers and letters ending with m
          jsonContent = jsonContent.replace(/\u001b\[[0-9;]*m/g, '');
          // Also handle literal escape sequences
          jsonContent = jsonContent.replace(/\x1b\[[0-9;]*m/g, '');
          
          // Remove any leading non-JSON text (warnings, etc.)
          // Look for first { or [ character
          const jsonStart = jsonContent.search(/[\{\[]/);
          if (jsonStart > 0) {
            jsonContent = jsonContent.substring(jsonStart);
          }
          
          // Remove any trailing non-JSON text
          // Find last } or ] character
          const lastBrace = jsonContent.lastIndexOf('}');
          const lastBracket = jsonContent.lastIndexOf(']');
          const jsonEnd = Math.max(lastBrace, lastBracket);
          if (jsonEnd >= 0 && jsonEnd < jsonContent.length - 1) {
            jsonContent = jsonContent.substring(0, jsonEnd + 1);
          }
          
          // If stdout is empty or doesn't contain JSON, try to parse stderr for JSON
          if (!jsonContent || jsonContent.length === 0) {
            let stderrContent = stderr.trim();
            // Strip ANSI codes from stderr too
            stderrContent = stderrContent.replace(/\u001b\[[0-9;]*m/g, '');
            stderrContent = stderrContent.replace(/\x1b\[[0-9;]*m/g, '');
            
            const stderrJsonStart = stderrContent.search(/[\{\[]/);
            if (stderrJsonStart >= 0) {
              jsonContent = stderrContent.substring(stderrJsonStart);
              const stderrLastBrace = jsonContent.lastIndexOf('}');
              const stderrLastBracket = jsonContent.lastIndexOf(']');
              const stderrJsonEnd = Math.max(stderrLastBrace, stderrLastBracket);
              if (stderrJsonEnd >= 0) {
                jsonContent = jsonContent.substring(0, stderrJsonEnd + 1);
              }
            }
          }
          
          if (!jsonContent || jsonContent.length === 0) {
            logger.warn('No JSON content found in SF CLI output', {
              stdoutLength: stdout.length,
              stderrLength: stderr.length,
              stdoutPreview: stdout.substring(0, 200),
              stderrPreview: stderr.substring(0, 200)
            });
            resolve([]);
            return;
          }
          
          const result = JSON.parse(jsonContent);
          
          // Handle different response formats
          if (result.result && result.result.records) {
            resolve(result.result.records);
          } else if (result.records) {
            resolve(result.records);
          } else if (Array.isArray(result)) {
            resolve(result);
          } else {
            logger.warn('Unexpected SF CLI response format', { result });
            resolve([]);
          }
        } catch (error) {
          logger.error('Failed to parse SF CLI output', {
            error: error.message,
            stdoutLength: stdout.length,
            stderrLength: stderr.length,
            stdoutPreview: stdout.substring(0, 500),
            stderrPreview: stderr.substring(0, 500)
          });
          reject(new Error(`Failed to parse SF CLI output: ${error.message}. Output preview: ${stdout.substring(0, 200)}`));
        }
      });

      child.on('error', (error) => {
        reject(new Error(`SF CLI spawn error: ${error.message}`));
      });
    });
  }

  /**
   * Build a lookup map from external key to Salesforce ID
   * @param {string} objectName - Object API name (e.g., 'Product2')
   * @param {string} externalKeyField - External key field (e.g., 'GT_GlobalKey__c')
   * @param {string} username - Salesforce username
   * @returns {Promise<Map>} Map of externalKey -> Salesforce ID
   */
  async buildExternalKeyMap(objectName, externalKeyField, username) {
    try {
      // Add GT_IsTechnicalProduct__c filter for Product2 queries
      let whereClause = `${externalKeyField} != null`;
      if (objectName === 'Product2') {
        whereClause += ` AND GT_IsTechnicalProduct__c = false`;
      }
      const soql = `SELECT Id, ${externalKeyField} FROM ${objectName} WHERE ${whereClause}`;
      logger.info(`Building external key map for ${objectName} using ${externalKeyField}`, {
        soql,
        username
      });
      
      const records = await this.queryRecords(soql, username);
      const keyMap = new Map();
      
      for (const record of records) {
        const externalKey = record[externalKeyField];
        if (externalKey) {
          keyMap.set(externalKey, record.Id);
        }
      }
      
      logger.info(`Built map with ${keyMap.size} ${objectName} records`);
      return keyMap;
    } catch (error) {
      logger.error(`Failed to build external key map for ${objectName}: ${error.message}`, {
        objectName,
        externalKeyField,
        username,
        error: error.stack
      });
      // If the query fails, return empty map instead of throwing (allows deployment to continue)
      // The reference updater will log warnings but won't fail the entire deployment
      logger.warn(`Returning empty key map for ${objectName} - references may not be updated correctly`);
      return new Map();
    }
  }

  /**
   * Update references in a JSON file
   * @param {string} jsonFilePath - Path to JSON file
   * @param {Array} referenceMappings - Array of reference mapping configurations
   * @param {string} targetUsername - Target Salesforce username
   * @returns {Promise<Object>} Update result with statistics
   */
  async updateReferencesInFile(jsonFilePath, referenceMappings, targetUsername) {
    try {
      if (!await fs.pathExists(jsonFilePath)) {
        throw new ValidationError(`JSON file not found: ${jsonFilePath}`);
      }

      // Read the JSON file
      const jsonContent = await fs.readFile(jsonFilePath, 'utf8');
      const data = JSON.parse(jsonContent);

      let totalUpdates = 0;
      const updateDetails = [];

      // Build external key maps for all referenced objects
      const keyMaps = {};
      for (const mapping of referenceMappings) {
        if (!keyMaps[mapping.referencedObject]) {
          const keyMap = await this.buildExternalKeyMap(
            mapping.referencedObject,
            mapping.externalKeyField,
            targetUsername
          );
          keyMaps[mapping.referencedObject] = keyMap;
          
          logger.info(`Built external key map for ${mapping.referencedObject}`, {
            objectName: mapping.referencedObject,
            externalKeyField: mapping.externalKeyField,
            mapSize: keyMap.size,
            sampleKeys: Array.from(keyMap.keys()).slice(0, 3)
          });
        }
      }

      // Handle data tree export format - can be array of records or object with records array
      let records = [];
      if (Array.isArray(data)) {
        records = data;
      } else if (data.records && Array.isArray(data.records)) {
        records = data.records;
      } else if (data.records && typeof data.records === 'object') {
        // Data tree export might have nested structure
        // Try to extract records from the structure
        records = Object.values(data.records).flat();
      } else {
        // Single record
        records = [data];
      }
      
      logger.info(`Processing ${records.length} records for reference updates`, {
        jsonFilePath,
        referenceMappingsCount: referenceMappings.length
      });
      
      // First pass: Extract all external keys and source IDs for bulk lookup
      // Group by mapping to batch queries efficiently
      const bulkLookupData = {}; // mapping index -> { sourceIds: Set, records: [] }
      
      for (let i = 0; i < referenceMappings.length; i++) {
        bulkLookupData[i] = {
          sourceIds: new Set(),
          records: []
        };
      }
      
      // Process each record in the JSON
      let recordsWithExternalKeys = 0;
      let recordsWithoutExternalKeys = 0;
      
      for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        
        for (let mappingIndex = 0; mappingIndex < referenceMappings.length; mappingIndex++) {
          const mapping = referenceMappings[mappingIndex];
          const referenceField = mapping.referenceField; // e.g., 'Product__c'
          const relationshipField = mapping.relationshipField; // e.g., 'Product__r.GT_GlobalKey__c'
          
          // Always try to extract the external key from the relationship field
          // The lookup field (Product__c) may not exist yet, but we'll add it
          const relationshipParts = relationshipField.split('.');
          
          // Navigate through the relationship to get the external key
          let externalKey = null;
          let sourceRecordId = null; // Fallback: extract ID from relationship URL
          
          if (relationshipParts.length === 2) {
            // Handle relationship traversal (e.g., Product__r.GT_GlobalKey__c)
            const relationshipName = relationshipParts[0]; // e.g., 'Product__r'
            const fieldName = relationshipParts[1]; // e.g., 'GT_GlobalKey__c'
            
            // Check if we have the relationship data in the record
            // Data tree export includes relationship data as nested objects
            if (record[relationshipName]) {
              if (typeof record[relationshipName] === 'object') {
                // Try to get the external key field
                if (record[relationshipName][fieldName] !== undefined && record[relationshipName][fieldName] !== null) {
                  externalKey = record[relationshipName][fieldName];
                }
                
                // Fallback: Extract Product2 ID from attributes.url if external key is null
                // Format: /services/data/v65.0/sobjects/Product2/01t9r00000AqK05AAF
                if (!externalKey && record[relationshipName].attributes && record[relationshipName].attributes.url) {
                  const url = record[relationshipName].attributes.url;
                  const idMatch = url.match(/\/([a-zA-Z0-9]{15,18})$/);
                  if (idMatch) {
                    sourceRecordId = idMatch[1];
                    logger.debug(`Extracted source record ID from URL: ${sourceRecordId} for ${relationshipName}`);
                  }
                }
              } else if (typeof record[relationshipName] === 'string') {
                // Sometimes relationship fields are just the field name directly
                // Try alternative field name
                const altFieldName = relationshipName.replace('__r', '__c');
                if (record[altFieldName]) {
                  // This might be the external key field directly
                  externalKey = record[altFieldName];
                }
              }
            }
            
            // If we still don't have the external key, try to extract from attributes
            // Data tree export might store it in attributes
            if (!externalKey && record.attributes) {
              const relationshipAttr = record.attributes[relationshipName];
              if (relationshipAttr && relationshipAttr[fieldName]) {
                externalKey = relationshipAttr[fieldName];
              }
            }
          } else {
            // Direct field reference
            externalKey = record[relationshipField];
          }
          
          // If external key is null but we have a source record ID, try to use the ID directly
          // This works if the same record exists in both orgs (same ID)
          if (!externalKey && sourceRecordId) {
            // Try to find the record in target org using the ID directly
            // This is a fallback when external keys are not available
            logger.debug(`Using source record ID as fallback: ${sourceRecordId}`);
            // We'll handle this in the lookup logic below
          }

          if (externalKey) {
            recordsWithExternalKeys++;
            const keyMap = keyMaps[mapping.referencedObject];
            const newId = keyMap.get(externalKey);
            
            if (newId) {
              const oldId = record[referenceField] || null;
              // Always set the lookup field, even if it didn't exist before
              record[referenceField] = newId;
              totalUpdates++;
              updateDetails.push({
                recordId: record.Id || record.attributes?.referenceId || 'unknown',
                field: referenceField,
                oldId,
                newId,
                externalKey
              });
              
              logger.debug(`Updated ${referenceField} in record ${record.Id || record.attributes?.referenceId || 'unknown'}: ${oldId || 'null'} -> ${newId} (external key: ${externalKey})`);
            } else {
              // External key not found - collect source ID for bulk lookup
              const relationshipName = relationshipParts[0];
              if (record[relationshipName] && record[relationshipName].attributes && record[relationshipName].attributes.url) {
                const url = record[relationshipName].attributes.url;
                const idMatch = url.match(/\/([a-zA-Z0-9]{15,18})$/);
                if (idMatch) {
                  const sourceId = idMatch[1];
                  bulkLookupData[mappingIndex].sourceIds.add(sourceId);
                  bulkLookupData[mappingIndex].records.push({
                    record,
                    referenceField,
                    sourceId,
                    externalKey
                  });
                }
              }
              
              if (bulkLookupData[mappingIndex].records.length === 0) {
                logger.warn(`Could not find target ${mapping.referencedObject} record with external key: ${externalKey}`, {
                  keyMapSize: keyMap.size,
                  referencedObject: mapping.referencedObject,
                  externalKeyField: mapping.externalKeyField,
                  sampleKeys: Array.from(keyMap.keys()).slice(0, 5)
                });
              }
            }
          } else if (sourceRecordId) {
            // No external key but we have source ID - collect for bulk lookup
            bulkLookupData[mappingIndex].sourceIds.add(sourceRecordId);
            bulkLookupData[mappingIndex].records.push({
              record,
              referenceField,
              sourceId: sourceRecordId,
              externalKey: null
            });
          } else {
            recordsWithoutExternalKeys++;
            logger.debug(`Could not extract external key or source ID from relationship field ${relationshipField} in record ${record.Id || record.attributes?.referenceId || 'unknown'}`);
          }
        }
      }
      
      // Bulk lookup: Query all source IDs in batches
      const bulkIdMaps = {}; // mapping index -> Map<sourceId, targetId>
      
      for (let mappingIndex = 0; mappingIndex < referenceMappings.length; mappingIndex++) {
        const mapping = referenceMappings[mappingIndex];
        const lookupData = bulkLookupData[mappingIndex];
        
        if (lookupData.sourceIds.size === 0) {
          bulkIdMaps[mappingIndex] = new Map();
          continue;
        }
        
        logger.info(`Bulk lookup for ${mapping.referencedObject}: ${lookupData.sourceIds.size} source IDs to query`, {
          referencedObject: mapping.referencedObject,
          sourceIdCount: lookupData.sourceIds.size
        });
        
        // Query in batches of 100 IDs (SOQL IN clause limit)
        const batchSize = 100;
        const sourceIdsArray = Array.from(lookupData.sourceIds);
        const idMap = new Map();
        
        for (let i = 0; i < sourceIdsArray.length; i += batchSize) {
          const batch = sourceIdsArray.slice(i, i + batchSize);
          const idList = batch.map(id => `'${id}'`).join(',');
          const soql = `SELECT Id FROM ${mapping.referencedObject} WHERE Id IN (${idList})`;
          
          try {
            const matchingRecords = await this.queryRecords(soql, targetUsername);
            if (matchingRecords && matchingRecords.length > 0) {
              for (const matchedRecord of matchingRecords) {
                // Note: This assumes the source ID matches the target ID (same org deployment scenario)
                // For cross-org, we'd need to match differently
                idMap.set(matchedRecord.Id, matchedRecord.Id);
              }
            }
          } catch (queryError) {
            logger.warn(`Failed to query batch for ${mapping.referencedObject}: ${queryError.message}`, {
              batchStart: i,
              batchSize: batch.length
            });
          }
        }
        
        bulkIdMaps[mappingIndex] = idMap;
        logger.info(`Bulk lookup completed for ${mapping.referencedObject}: ${idMap.size} matches found`, {
          totalQueried: sourceIdsArray.length,
          matchesFound: idMap.size
        });
      }
      
      // Second pass: Update records using bulk lookup results
      for (let mappingIndex = 0; mappingIndex < referenceMappings.length; mappingIndex++) {
        const mapping = referenceMappings[mappingIndex];
        const lookupData = bulkLookupData[mappingIndex];
        const idMap = bulkIdMaps[mappingIndex];
        
        for (const { record, referenceField, sourceId, externalKey } of lookupData.records) {
          const targetId = idMap.get(sourceId);
          
          if (targetId) {
            const oldId = record[referenceField] || null;
            record[referenceField] = targetId;
            totalUpdates++;
            updateDetails.push({
              recordId: record.Id || record.attributes?.referenceId || 'unknown',
              field: referenceField,
              oldId,
              newId: targetId,
              externalKey: externalKey || `ID fallback: ${sourceId}`
            });
            
            logger.debug(`Updated ${referenceField} using bulk ID lookup: ${sourceId} -> ${targetId}`);
          } else {
            logger.debug(`Source record ID ${sourceId} not found in target org for ${mapping.referencedObject}`);
          }
        }
      }
      
      logger.info(`Reference update statistics`, {
        totalRecords: records.length,
        recordsWithExternalKeys,
        recordsWithoutExternalKeys,
        totalUpdates,
        referenceMappings: referenceMappings.map(m => ({
          field: m.referenceField,
          relationship: m.relationshipField,
          object: m.referencedObject
        }))
      });

      // Write updated JSON back to file
      await fs.writeFile(jsonFilePath, JSON.stringify(data, null, 2), 'utf8');

      return {
        success: true,
        file: jsonFilePath,
        totalUpdates,
        updateDetails,
        recordsProcessed: records.length
      };
    } catch (error) {
      logger.error(`Failed to update references in ${jsonFilePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update references for Product SKU -> Product2 relationship
   * @param {string} sourcePath - Path to exported JSON files
   * @param {string} targetUsername - Target Salesforce username
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<Object>} Update result
   */
  async updateProductSKUReferences(sourcePath, targetUsername, jobId = null) {
    try {
      const resolvedPath = path.resolve(sourcePath);
      
      if (!await fs.pathExists(resolvedPath)) {
        throw new ValidationError(`Source path does not exist: ${resolvedPath}`);
      }

      // Find Product SKU JSON file
      const productSkuFile = path.join(resolvedPath, 'GT_ProductSKU__c.json');
      
      if (!await fs.pathExists(productSkuFile)) {
        logger.warn(`Product SKU file not found: ${productSkuFile}`);
        return {
          success: true,
          message: 'Product SKU file not found, skipping reference update',
          updates: 0
        };
      }

      if (jobId) {
        logger.logJobVerbose(jobId, 'Updating Product SKU -> Product2 references', {
          sourcePath: resolvedPath,
          targetUsername
        });
      }

      // Define reference mapping for Product SKU -> Product2
      const referenceMappings = [
        {
          referenceField: 'Product__c', // The ID field in Product SKU
          relationshipField: 'Product__r.vlocity_cmt__GlobalKey__c', // The relationship field with Vlocity GlobalKey
          referencedObject: 'Product2', // The object being referenced
          externalKeyField: 'vlocity_cmt__GlobalKey__c' // The Vlocity GlobalKey field in Product2
        }
      ];

      const result = await this.updateReferencesInFile(
        productSkuFile,
        referenceMappings,
        targetUsername
      );

      if (jobId) {
        logger.logJobVerbose(jobId, `Updated ${result.totalUpdates} Product SKU references`, {
          recordsProcessed: result.recordsProcessed,
          updates: result.totalUpdates
        });
      }

      return {
        success: true,
        ...result,
        message: `Updated ${result.totalUpdates} Product SKU -> Product2 references`
      };
    } catch (error) {
      logger.error(`Failed to update Product SKU references: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update references for Rate Table -> Product2 and RateCode relationships
   * @param {string} sourcePath - Path to exported JSON files
   * @param {string} targetUsername - Target Salesforce username
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<Object>} Update result
   */
  async updateRateTableReferences(sourcePath, targetUsername, jobId = null) {
    try {
      const resolvedPath = path.resolve(sourcePath);
      
      if (!await fs.pathExists(resolvedPath)) {
        throw new ValidationError(`Source path does not exist: ${resolvedPath}`);
      }

      // Find Rate Table JSON file
      const rateTableFile = path.join(resolvedPath, 'GT_RateTable__c.json');
      
      if (!await fs.pathExists(rateTableFile)) {
        logger.warn(`Rate Table file not found: ${rateTableFile}`);
        return {
          success: true,
          message: 'Rate Table file not found, skipping reference update',
          updates: 0
        };
      }

      if (jobId) {
        logger.logJobVerbose(jobId, 'Updating Rate Table references', {
          sourcePath: resolvedPath,
          targetUsername
        });
      }

      // Define reference mappings for Rate Table
      const referenceMappings = [
        {
          referenceField: 'Product__c',
          relationshipField: 'Product__r.vlocity_cmt__GlobalKey__c',
          referencedObject: 'Product2',
          externalKeyField: 'vlocity_cmt__GlobalKey__c'
        },
        {
          referenceField: 'GT_RateCode__c',
          relationshipField: 'GT_RateCode__r.GT_GlobalKey__c',
          referencedObject: 'GT_RateCode__c',
          externalKeyField: 'GT_GlobalKey__c'
        }
      ];

      const result = await this.updateReferencesInFile(
        rateTableFile,
        referenceMappings,
        targetUsername
      );

      if (jobId) {
        logger.logJobVerbose(jobId, `Updated ${result.totalUpdates} Rate Table references`, {
          recordsProcessed: result.recordsProcessed,
          updates: result.totalUpdates
        });
      }

      return {
        success: true,
        ...result,
        message: `Updated ${result.totalUpdates} Rate Table references`
      };
    } catch (error) {
      logger.error(`Failed to update Rate Table references: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update references for Catalog Product Relationship -> Product2 and Catalog relationships
   * @param {string} sourcePath - Path to exported JSON files
   * @param {string} targetUsername - Target Salesforce username
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<Object>} Update result
   */
  async updateCatalogProductRelationshipReferences(sourcePath, targetUsername, jobId = null) {
    try {
      const resolvedPath = path.resolve(sourcePath);
      
      if (!await fs.pathExists(resolvedPath)) {
        throw new ValidationError(`Source path does not exist: ${resolvedPath}`);
      }

      // Find Catalog Product Relationship JSON file
      // Vlocity exports might use different folder structures, so search recursively
      let catalogProductRelFile = null;
      
      // First try direct paths
      const directPaths = [
        path.join(resolvedPath, 'vlocity_cmt__CatalogProductRelationship__c.json'),
        path.join(resolvedPath, 'SObject_CatalogProductRelationship', 'vlocity_cmt__CatalogProductRelationship__c.json'),
        path.join(resolvedPath, 'SObject', 'vlocity_cmt__CatalogProductRelationship__c.json')
      ];
      
      for (const directPath of directPaths) {
        if (await fs.pathExists(directPath)) {
          catalogProductRelFile = directPath;
          break;
        }
      }
      
      // If not found, search recursively
      if (!catalogProductRelFile) {
        const searchRecursively = async (dir, targetFileName) => {
          try {
            const items = await fs.readdir(dir);
            for (const item of items) {
              const itemPath = path.join(dir, item);
              const stats = await fs.stat(itemPath);
              
              if (stats.isFile() && item === targetFileName) {
                return itemPath;
              } else if (stats.isDirectory()) {
                // Search in subdirectories, but limit depth to avoid infinite loops
                const subResult = await searchRecursively(itemPath, targetFileName);
                if (subResult) return subResult;
              }
            }
          } catch (error) {
            // Continue searching other directories
            logger.debug(`Error searching in ${dir}: ${error.message}`);
          }
          return null;
        };
        
        catalogProductRelFile = await searchRecursively(resolvedPath, 'vlocity_cmt__CatalogProductRelationship__c.json');
      }
      
      if (!catalogProductRelFile) {
        logger.warn(`Catalog Product Relationship file not found in any expected location`, {
          searchPath: resolvedPath
        });
        return {
          success: true,
          message: 'Catalog Product Relationship file not found, skipping reference update',
          updates: 0
        };
      }

      if (jobId) {
        logger.logJobVerbose(jobId, 'Updating Catalog Product Relationship references', {
          sourcePath: resolvedPath,
          targetUsername,
          filePath: catalogProductRelFile
        });
      }

      // Define reference mappings for Catalog Product Relationship
      // It has relationships to both Product2 and Catalog
      const referenceMappings = [
        {
          referenceField: 'vlocity_cmt__Product2Id__c',
          relationshipField: 'vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c',
          referencedObject: 'Product2',
          externalKeyField: 'vlocity_cmt__GlobalKey__c'
        },
        {
          referenceField: 'vlocity_cmt__CatalogId__c',
          relationshipField: 'vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c',
          referencedObject: 'vlocity_cmt__Catalog__c',
          externalKeyField: 'vlocity_cmt__GlobalKey__c'
        }
      ];

      const result = await this.updateReferencesInFile(
        catalogProductRelFile,
        referenceMappings,
        targetUsername
      );

      if (jobId) {
        logger.logJobVerbose(jobId, `Updated ${result.totalUpdates} Catalog Product Relationship references`, {
          recordsProcessed: result.recordsProcessed,
          updates: result.totalUpdates
        });
      }

      return {
        success: true,
        ...result,
        message: `Updated ${result.totalUpdates} Catalog Product Relationship references`
      };
    } catch (error) {
      logger.error(`Failed to update Catalog Product Relationship references: ${error.message}`);
      throw error;
    }
  }

  /**
   * Update all references in exported JSON files
   * @param {string} sourcePath - Path to exported JSON files
   * @param {string} targetUsername - Target Salesforce username
   * @param {string} jobId - Optional job ID for logging
   * @returns {Promise<Object>} Combined update result
   */
  async updateAllReferences(sourcePath, targetUsername, jobId = null) {
    try {
      const results = [];
      
      // Update Product SKU references
      try {
        const productSkuResult = await this.updateProductSKUReferences(sourcePath, targetUsername, jobId);
        results.push(productSkuResult);
      } catch (error) {
        logger.error(`Failed to update Product SKU references: ${error.message}`);
        results.push({
          success: false,
          type: 'ProductSKU',
          error: error.message
        });
      }

      // Update Rate Table references
      try {
        const rateTableResult = await this.updateRateTableReferences(sourcePath, targetUsername, jobId);
        results.push(rateTableResult);
      } catch (error) {
        logger.error(`Failed to update Rate Table references: ${error.message}`);
        results.push({
          success: false,
          type: 'RateTable',
          error: error.message
        });
      }

      // Update Catalog Product Relationship references
      try {
        const catalogProductRelResult = await this.updateCatalogProductRelationshipReferences(sourcePath, targetUsername, jobId);
        results.push(catalogProductRelResult);
      } catch (error) {
        logger.error(`Failed to update Catalog Product Relationship references: ${error.message}`);
        results.push({
          success: false,
          type: 'CatalogProductRelationship',
          error: error.message
        });
      }

      const totalUpdates = results.reduce((sum, r) => sum + (r.totalUpdates || 0), 0);
      const hasErrors = results.some(r => !r.success);

      return {
        success: !hasErrors,
        totalUpdates,
        results,
        message: `Updated ${totalUpdates} references across ${results.length} object types`
      };
    } catch (error) {
      logger.error(`Failed to update all references: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new SfCliReferenceUpdater();

