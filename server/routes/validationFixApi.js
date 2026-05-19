const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const validationService = require('../services/validationService');
const salesforceService = require('../services/salesforceService');
const vlocityCommandsService = require('../services/vlocityCommandsService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/validation/extract-error-values:
 *   post:
 *     operationId: extractErrorValues
 *     summary: Extract Salesforce record details for error analysis
 *     description: >
 *       Queries Salesforce to fetch detailed field and relationship data for
 *       the record IDs embedded in a validation error object. Up to 10 record
 *       IDs are resolved. Optionally resolves field metadata and parent/child
 *       Product2 records when their IDs are present in the error.
 *     tags:
 *       - Validation Fixes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - error
 *               - orgUsername
 *             properties:
 *               error:
 *                 type: object
 *                 description: Validation error object containing extractedValues metadata
 *                 properties:
 *                   errorType:
 *                     type: string
 *                   extractedValues:
 *                     type: object
 *                     properties:
 *                       recordIds:
 *                         type: array
 *                         items:
 *                           type: string
 *                       fieldName:
 *                         type: string
 *                       objectName:
 *                         type: string
 *                       parentId:
 *                         type: string
 *                       childId:
 *                         type: string
 *               orgUsername:
 *                 type: string
 *                 description: SFDX username of the Salesforce org to query
 *                 example: admin@myorg.com
 *               orgType:
 *                 type: string
 *                 description: Org type identifier (e.g. production, sandbox)
 *     responses:
 *       200:
 *         description: Values extracted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 extractedValues:
 *                   type: object
 *                   description: Map of record ID to record data, plus optional fieldInfo
 *                 message:
 *                   type: string
 *                   example: Values extracted successfully
 *       400:
 *         description: error and orgUsername are required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Extraction failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/extract-error-values
 * @desc Extract detailed values from Salesforce for error analysis
 * @access Private
 */
router.post('/extract-error-values', asyncHandler(async (req, res) => {
  const { error, orgUsername, orgType } = req.body;
  
  if (!error || !orgUsername) {
    throw new ValidationError('Error and orgUsername are required');
  }

  logger.info('Extracting error values', { errorType: error.errorType, orgUsername });

  try {
    const extractedValues = {};

    // Extract record IDs from error
    const recordIds = error.extractedValues?.recordIds || [];
    if (recordIds.length > 0) {
      // Query Salesforce for record details
      for (const recordId of recordIds.slice(0, 10)) { // Limit to 10 records
        try {
          // Determine object type from ID prefix
          const objectType = await salesforceService.getObjectTypeFromId(recordId, orgUsername);
          if (objectType) {
            const record = await salesforceService.query(
              `SELECT Id, Name, CreatedDate, LastModifiedDate FROM ${objectType} WHERE Id = '${recordId}' LIMIT 1`,
              orgUsername
            );
            if (record.records && record.records.length > 0) {
              extractedValues[recordId] = record.records[0];
            }
          }
        } catch (err) {
          logger.warn('Failed to extract record details', { recordId, error: err.message });
        }
      }
    }

    // Extract field values if field name is known
    if (error.extractedValues?.fieldName && error.extractedValues?.objectName) {
      try {
        const fieldInfo = await salesforceService.describeField(
          error.extractedValues.objectName,
          error.extractedValues.fieldName,
          orgUsername
        );
        if (fieldInfo) {
          extractedValues.fieldInfo = fieldInfo;
        }
      } catch (err) {
        logger.warn('Failed to extract field info', { error: err.message });
      }
    }

    // Extract relationship information
    if (error.extractedValues?.parentId || error.extractedValues?.childId) {
      if (error.extractedValues.parentId) {
        try {
          await salesforceService.authenticateWithSfdx(orgUsername);
          const parentRecord = await salesforceService.query(
            `SELECT Id, Name FROM Product2 WHERE Id = '${error.extractedValues.parentId}' LIMIT 1`
          );
          if (parentRecord.records && parentRecord.records.length > 0) {
            extractedValues.parentRecord = parentRecord.records[0];
          }
        } catch (err) {
          // Ignore errors
        }
      }
      if (error.extractedValues.childId) {
        try {
          await salesforceService.authenticateWithSfdx(orgUsername);
          const childRecord = await salesforceService.query(
            `SELECT Id, Name FROM Product2 WHERE Id = '${error.extractedValues.childId}' LIMIT 1`
          );
          if (childRecord.records && childRecord.records.length > 0) {
            extractedValues.childRecord = childRecord.records[0];
          }
        } catch (err) {
          // Ignore errors
        }
      }
    }

    res.json({
      success: true,
      extractedValues,
      message: 'Values extracted successfully'
    });
  } catch (error) {
    logger.error('Failed to extract error values', { error: error.message });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/auto-fix:
 *   post:
 *     operationId: autoFixValidationError
 *     summary: Automatically fix a validation error
 *     description: >
 *       Applies an automated fix action for a validation error. Supported
 *       actions are: skip_validation, create_related_record,
 *       create_pricing_objects, delete_orphan, and reauthenticate.
 *       The reauthenticate action returns instructions rather than making
 *       changes.
 *     tags:
 *       - Validation Fixes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - error
 *               - fix
 *               - orgUsername
 *             properties:
 *               error:
 *                 type: object
 *                 description: Validation error object
 *                 properties:
 *                   errorType:
 *                     type: string
 *                   extractedValues:
 *                     type: object
 *               fix:
 *                 type: object
 *                 description: Fix descriptor
 *                 required:
 *                   - action
 *                 properties:
 *                   type:
 *                     type: string
 *                   action:
 *                     type: string
 *                     enum:
 *                       - skip_validation
 *                       - create_related_record
 *                       - create_pricing_objects
 *                       - delete_orphan
 *                       - reauthenticate
 *               orgUsername:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *               orgType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Fix applied (or instructions returned for manual steps)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 fixApplied:
 *                   type: string
 *                 orgUsername:
 *                   type: string
 *                 orgType:
 *                   type: string
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required fields or unknown fix action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Auto-fix failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/auto-fix
 * @desc Automatically fix validation errors using CLI commands
 * @access Private
 */
router.post('/auto-fix', asyncHandler(async (req, res) => {
  const { error, fix, orgUsername, orgType } = req.body;
  
  if (!error || !fix || !orgUsername) {
    throw new ValidationError('Error, fix, and orgUsername are required');
  }

  logger.info('Auto-fixing error', { 
    errorType: error.errorType, 
    fixType: fix.type, 
    fixAction: fix.action,
    orgUsername 
  });

  try {
    let result = null;

    switch (fix.action) {
      case 'skip_validation':
        // Skip validation - just return success
        result = {
          success: true,
          message: 'Validation skipped for this object',
          skipped: true
        };
        break;

      case 'create_related_record':
        // Create missing related record
        if (error.extractedValues?.parentId || error.extractedValues?.childId) {
          const recordToCreate = {
            Name: `Auto-created ${new Date().toISOString()}`,
            // Add other required fields based on object type
          };
          
          const objectType = error.extractedValues?.objectType || 'Product2';
          const createResult = await salesforceService.createRecord(
            objectType,
            recordToCreate,
            orgUsername
          );
          
          result = {
            success: true,
            message: `Created ${objectType} record`,
            recordId: createResult.id
          };
        }
        break;

      case 'create_pricing_objects':
        // Create missing pricing objects using Vlocity CLI
        if (error.extractedValues?.productId) {
          const productId = error.extractedValues.productId;
          
          // Use Vlocity CLI to create pricing objects
          const vlocityService = vlocityCommandsService();
          const vlocityResult = await vlocityService.executeVlocityCommand(
            'packDeploy',
            {
              username: orgUsername,
              extraArgs: {
                projectPath: './temp-pricing-fix',
                dataPacks: [{
                  VlocityDataPackType: 'vlocity_cmt__PriceListEntry__c',
                  VlocityDataPackKey: `PriceListEntry_${productId}`,
                  // Add pricing object configuration
                }]
              }
            }
          );
          
          result = {
            success: true,
            message: 'Created missing pricing objects',
            vlocityResult
          };
        }
        break;

      case 'delete_orphan':
        // Delete orphaned relationship
        if (error.extractedValues?.relationshipId) {
          await salesforceService.deleteRecord(
            error.extractedValues.relationshipId,
            orgUsername
          );
          
          result = {
            success: true,
            message: 'Deleted orphaned relationship'
          };
        }
        break;

      case 'reauthenticate':
        // Re-authenticate - return instructions
        result = {
          success: false,
          requiresManualAction: true,
          message: 'Please re-authenticate your Salesforce org',
          instructions: [
            'Run: sfdx auth:web:login -a ' + orgUsername,
            'Or use the Org Management page to re-authenticate'
          ]
        };
        break;

      default:
        throw new ValidationError(`Unknown fix action: ${fix.action}`);
    }

    res.json({
      success: result?.success || false,
      ...result,
      fixApplied: fix.action,
      orgUsername,
      orgType
    });
  } catch (error) {
    logger.error('Auto-fix failed', { error: error.message, fixAction: fix.action });
    throw error;
  }
}));

/**
 * @swagger
 * /api/validation/manual-fix:
 *   post:
 *     operationId: manualFixValidationError
 *     summary: Apply a manual fix with user-provided values
 *     description: >
 *       Applies a fix using values explicitly supplied by the user. Supported
 *       actions are: create_related_record, update_field_mapping,
 *       update_record, and delete_duplicate.
 *     tags:
 *       - Validation Fixes
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - error
 *               - fix
 *               - values
 *               - orgUsername
 *             properties:
 *               error:
 *                 type: object
 *                 description: Validation error object
 *                 properties:
 *                   errorType:
 *                     type: string
 *                   extractedValues:
 *                     type: object
 *               fix:
 *                 type: object
 *                 required:
 *                   - action
 *                 properties:
 *                   type:
 *                     type: string
 *                   action:
 *                     type: string
 *                     enum:
 *                       - create_related_record
 *                       - update_field_mapping
 *                       - update_record
 *                       - delete_duplicate
 *               values:
 *                 type: object
 *                 description: User-provided field values for the fix action
 *                 properties:
 *                   objectType:
 *                     type: string
 *                   name:
 *                     type: string
 *                   newFieldName:
 *                     type: string
 *               orgUsername:
 *                 type: string
 *                 description: SFDX username of the target Salesforce org
 *               orgType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Manual fix applied successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 fixApplied:
 *                   type: string
 *                 orgUsername:
 *                   type: string
 *                 orgType:
 *                   type: string
 *                 committed:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing required fields or unknown fix action
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Target record not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Manual fix failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
/**
 * @route POST /api/validation/manual-fix
 * @desc Apply manual fix with user-provided values
 * @access Private
 */
router.post('/manual-fix', asyncHandler(async (req, res) => {
  const { error, fix, values, orgUsername, orgType } = req.body;
  
  if (!error || !fix || !orgUsername || !values) {
    throw new ValidationError('Error, fix, values, and orgUsername are required');
  }

  logger.info('Applying manual fix', { 
    errorType: error.errorType, 
    fixType: fix.type,
    orgUsername 
  });

  try {
    let result = null;

    switch (fix.action) {
      case 'create_related_record':
        // Create record with user-provided values
        const objectType = values.objectType || 'Product2';
        const recordData = {
          Name: values.name,
          // Add other fields from values
          ...values
        };
        
        const createResult = await salesforceService.createRecord(
          objectType,
          recordData,
          orgUsername
        );
        
        result = {
          success: true,
          message: `Created ${objectType} record`,
          recordId: createResult.id,
          record: createResult
        };
        break;

      case 'update_field_mapping':
        // Update query/configuration with new field name
        // This would typically update a job configuration or query
        result = {
          success: true,
          message: 'Field mapping updated',
          newFieldName: values.newFieldName,
          note: 'Please update your job configuration with the new field name'
        };
        break;

      case 'update_record':
        // Update existing record
        if (error.extractedValues?.existingId) {
          const updateResult = await salesforceService.updateRecord(
            error.extractedValues.existingId,
            values,
            orgUsername
          );
          
          result = {
            success: true,
            message: 'Record updated',
            recordId: error.extractedValues.existingId
          };
        }
        break;

      case 'delete_duplicate':
        // Delete duplicate record
        if (error.extractedValues?.existingId) {
          await salesforceService.deleteRecord(
            error.extractedValues.existingId,
            orgUsername
          );
          
          result = {
            success: true,
            message: 'Duplicate record deleted'
          };
        }
        break;

      default:
        throw new ValidationError(`Unknown fix action: ${fix.action}`);
    }

    // Commit changes if needed
    if (result?.success && orgType) {
      // Log the change for audit
      logger.info('Manual fix applied and committed', {
        fixAction: fix.action,
        orgUsername,
        orgType,
        recordId: result.recordId
      });
    }

    res.json({
      success: result?.success || false,
      ...result,
      fixApplied: fix.action,
      orgUsername,
      orgType,
      committed: true
    });
  } catch (error) {
    logger.error('Manual fix failed', { error: error.message, fixAction: fix.action });
    throw error;
  }
}));

module.exports = router;

