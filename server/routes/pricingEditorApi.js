const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const salesforceService = require('../services/salesforceService');
const vlocityCommandsService = require('../services/vlocityCommandsService');
const validationService = require('../services/validationService');
const logger = require('../utils/logger');

/**
 * @swagger
 * /api/pricing/objects/{objectType}/{objectId}:
 *   get:
 *     operationId: getPricingObject
 *     summary: Get a pricing object for editing
 *     description: Fetches a single Vlocity pricing object record from Salesforce using FIELDS(ALL) so the UI can render all available fields for editing. Supported objectTypes are PriceList, PriceListEntry, PricingElement, PricingVariable, and Promotion.
 *     tags:
 *       - Pricing Editor
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: objectType
 *         required: true
 *         schema:
 *           type: string
 *           enum:
 *             - PriceList
 *             - PriceListEntry
 *             - PricingElement
 *             - PricingVariable
 *             - Promotion
 *         description: Logical object type to fetch
 *       - in: path
 *         name: objectId
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce record ID
 *       - in: query
 *         name: username
 *         required: true
 *         schema:
 *           type: string
 *         description: Salesforce org username (SFDX alias or full username)
 *     responses:
 *       200:
 *         description: Pricing object retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 object:
 *                   type: object
 *                   description: Full Salesforce record
 *                 objectType:
 *                   type: string
 *                 apiName:
 *                   type: string
 *                   description: Salesforce API name of the object (e.g. vlocity_cmt__PriceList__c)
 *       400:
 *         description: Validation error — unknown objectType, missing username, or object not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Object not found in Salesforce
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/objects/:objectType/:objectId', asyncHandler(async (req, res) => {
  const { objectType, objectId } = req.params;
  const { username } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  logger.info('Loading pricing object for editing', { objectType, objectId, username });

  try {
    // Map object types to API names
    const objectTypeMap = {
      'PriceList': 'vlocity_cmt__PriceList__c',
      'PriceListEntry': 'vlocity_cmt__PriceListEntry__c',
      'PricingElement': 'vlocity_cmt__PricingElement__c',
      'PricingVariable': 'vlocity_cmt__PricingVariable__c',
      'Promotion': 'vlocity_cmt__Promotion__c',
    };

    const apiName = objectTypeMap[objectType];
    if (!apiName) {
      throw new ValidationError(`Unknown object type: ${objectType}`);
    }

    // Query Salesforce for the object
    await salesforceService.authenticateWithSfdx(username);
    const query = `SELECT FIELDS(ALL) FROM ${apiName} WHERE Id = '${objectId}' LIMIT 1`;
    const result = await salesforceService.query(query);

    if (!result.records || result.records.length === 0) {
      throw new ValidationError(`Object not found: ${objectId}`);
    }

    res.json({
      success: true,
      object: result.records[0],
      objectType: objectType,
      apiName: apiName
    });
  } catch (error) {
    logger.error('Failed to load pricing object', { error: error.message, objectType, objectId });
    throw error;
  }
}));

/**
 * @swagger
 * /api/pricing/validate-object:
 *   post:
 *     operationId: validatePricingObject
 *     summary: Validate pricing object data before saving
 *     description: Runs server-side validation on a pricing object's field values, checking required fields and verifying related object references in Salesforce. Returns a list of errors and warnings without persisting any data.
 *     tags:
 *       - Pricing Editor
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - objectType
 *               - objectData
 *               - orgUsername
 *             properties:
 *               objectType:
 *                 type: string
 *                 enum:
 *                   - PriceList
 *                   - PriceListEntry
 *                   - PricingElement
 *                   - PricingVariable
 *                   - Promotion
 *                 description: Logical object type being validated
 *               objectData:
 *                 type: object
 *                 description: Field values to validate
 *               orgUsername:
 *                 type: string
 *                 description: Salesforce org username
 *               orgType:
 *                 type: string
 *                 description: Optional org type descriptor (e.g. production, sandbox)
 *     responses:
 *       200:
 *         description: Validation completed (result may contain errors or warnings)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 validation:
 *                   type: object
 *                   properties:
 *                     errors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           field:
 *                             type: string
 *                           message:
 *                             type: string
 *                           type:
 *                             type: string
 *                     warnings:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           message:
 *                             type: string
 *                           type:
 *                             type: string
 *                           relatedObject:
 *                             type: string
 *                           relatedId:
 *                             type: string
 *                     isValid:
 *                       type: boolean
 *       400:
 *         description: Validation error — missing required body fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/validate-object', asyncHandler(async (req, res) => {
  const { objectType, objectData, orgUsername, orgType } = req.body;

  if (!objectType || !objectData || !orgUsername) {
    throw new ValidationError('objectType, objectData, and orgUsername are required');
  }

  logger.info('Validating pricing object', { objectType, orgUsername });

  try {
    const errors = [];
    const warnings = [];

    // Required fields validation
    const requiredFieldsMap = {
      'PriceList': ['Name', 'vlocity_cmt__IsActive__c'],
      'PriceListEntry': ['vlocity_cmt__PriceListId__c', 'vlocity_cmt__ProductId__c', 'vlocity_cmt__Price__c'],
      'PricingElement': ['Name', 'vlocity_cmt__PricingVariableId__c'],
      'PricingVariable': ['Name', 'vlocity_cmt__Code__c'],
      'Promotion': ['Name', 'vlocity_cmt__IsActive__c'],
    };

    const requiredFields = requiredFieldsMap[objectType] || [];
    for (const field of requiredFields) {
      if (!objectData[field] && objectData[field] !== false && objectData[field] !== 0) {
        errors.push({
          field: field,
          message: `Required field '${field}' is missing or empty`,
          type: 'required_field'
        });
      }
    }

    // Validate related object references
    if (objectData.vlocity_cmt__PriceListId__c) {
      try {
        await salesforceService.authenticateWithSfdx(orgUsername);
        const priceListCheck = await salesforceService.query(
          `SELECT Id FROM vlocity_cmt__PriceList__c WHERE Id = '${objectData.vlocity_cmt__PriceListId__c}' LIMIT 1`
        );
        if (!priceListCheck.records || priceListCheck.records.length === 0) {
          warnings.push({
            message: `Referenced Price List '${objectData.vlocity_cmt__PriceListId__c}' does not exist. Will be created.`,
            type: 'missing_related',
            relatedObject: 'PriceList',
            relatedId: objectData.vlocity_cmt__PriceListId__c
          });
        }
      } catch (err) {
        warnings.push({
          message: `Could not verify Price List reference: ${err.message}`,
          type: 'verification_failed'
        });
      }
    }

    if (objectData.vlocity_cmt__ProductId__c) {
      try {
        await salesforceService.authenticateWithSfdx(orgUsername);
        const productCheck = await salesforceService.query(
          `SELECT Id FROM Product2 WHERE Id = '${objectData.vlocity_cmt__ProductId__c}' LIMIT 1`
        );
        if (!productCheck.records || productCheck.records.length === 0) {
          warnings.push({
            message: `Referenced Product '${objectData.vlocity_cmt__ProductId__c}' does not exist. Will be created.`,
            type: 'missing_related',
            relatedObject: 'Product2',
            relatedId: objectData.vlocity_cmt__ProductId__c
          });
        }
      } catch (err) {
        warnings.push({
          message: `Could not verify Product reference: ${err.message}`,
          type: 'verification_failed'
        });
      }
    }

    // Validate data types
    if (objectData.vlocity_cmt__Price__c !== undefined) {
      const price = parseFloat(objectData.vlocity_cmt__Price__c);
      if (isNaN(price) || price < 0) {
        errors.push({
          field: 'vlocity_cmt__Price__c',
          message: 'Price must be a valid positive number',
          type: 'invalid_type'
        });
      }
    }

    res.json({
      success: true,
      validation: {
        errors: errors,
        warnings: warnings,
        isValid: errors.length === 0
      }
    });
  } catch (error) {
    logger.error('Validation failed', { error: error.message, objectType });
    throw error;
  }
}));

/**
 * @swagger
 * /api/pricing/create-related-objects:
 *   post:
 *     operationId: createRelatedPricingObjects
 *     summary: Create missing related objects
 *     description: Creates any missing related records (e.g. PriceList, Product2) in Salesforce that are referenced by the provided object data. Intended to be called after validate-object reports missing_related warnings.
 *     tags:
 *       - Pricing Editor
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - objectType
 *               - objectData
 *               - orgUsername
 *             properties:
 *               objectType:
 *                 type: string
 *                 enum:
 *                   - PriceList
 *                   - PriceListEntry
 *                   - PricingElement
 *                   - PricingVariable
 *                   - Promotion
 *                 description: Logical object type whose related objects should be created
 *               objectData:
 *                 type: object
 *                 description: Field values containing the related object IDs to check and create
 *               orgUsername:
 *                 type: string
 *                 description: Salesforce org username
 *               orgType:
 *                 type: string
 *                 description: Optional org type descriptor
 *     responses:
 *       200:
 *         description: Related objects creation attempted (check created array for results)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 created:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       type:
 *                         type: string
 *                         description: Object type that was created
 *                       id:
 *                         type: string
 *                         description: Salesforce ID of the newly created record
 *                 createdCount:
 *                   type: integer
 *       400:
 *         description: Validation error — missing required body fields
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/create-related-objects', asyncHandler(async (req, res) => {
  const { objectType, objectData, orgUsername, orgType } = req.body;

  if (!objectType || !objectData || !orgUsername) {
    throw new ValidationError('objectType, objectData, and orgUsername are required');
  }

  logger.info('Creating related objects', { objectType, orgUsername });

  try {
    const created = [];
    let createdCount = 0;

    // Create missing Price List if referenced
    if (objectData.vlocity_cmt__PriceListId__c) {
      try {
        await salesforceService.authenticateWithSfdx(orgUsername);
        const check = await salesforceService.query(
          `SELECT Id FROM vlocity_cmt__PriceList__c WHERE Id = '${objectData.vlocity_cmt__PriceListId__c}' LIMIT 1`
        );
        if (!check.records || check.records.length === 0) {
          const priceList = await salesforceService.createRecord(
            'vlocity_cmt__PriceList__c',
            {
              Name: `Auto-created Price List ${new Date().toISOString()}`,
              vlocity_cmt__IsActive__c: true,
            },
            orgUsername
          );
          created.push({ type: 'PriceList', id: priceList.id });
          createdCount++;
        }
      } catch (err) {
        logger.warn('Failed to create Price List', { error: err.message });
      }
    }

    // Create missing Product if referenced
    if (objectData.vlocity_cmt__ProductId__c) {
      try {
        await salesforceService.authenticateWithSfdx(orgUsername);
        const check = await salesforceService.query(
          `SELECT Id FROM Product2 WHERE Id = '${objectData.vlocity_cmt__ProductId__c}' LIMIT 1`
        );
        if (!check.records || check.records.length === 0) {
          const product = await salesforceService.createRecord(
            'Product2',
            {
              Name: `Auto-created Product ${new Date().toISOString()}`,
              IsActive: true,
            },
            orgUsername
          );
          created.push({ type: 'Product2', id: product.id });
          createdCount++;
        }
      } catch (err) {
        logger.warn('Failed to create Product', { error: err.message });
      }
    }

    res.json({
      success: true,
      created: created,
      createdCount: createdCount
    });
  } catch (error) {
    logger.error('Failed to create related objects', { error: error.message, objectType });
    throw error;
  }
}));

/**
 * @swagger
 * /api/pricing/save-object:
 *   post:
 *     operationId: savePricingObject
 *     summary: Save a pricing object to Salesforce
 *     description: Creates or updates a Vlocity pricing object in Salesforce. When objectId is omitted or set to "new" a new record is created; otherwise the existing record is updated. Pass commit=true to explicitly log that changes are committed (Salesforce API commits automatically).
 *     tags:
 *       - Pricing Editor
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - objectType
 *               - objectData
 *               - orgUsername
 *             properties:
 *               objectType:
 *                 type: string
 *                 enum:
 *                   - PriceList
 *                   - PriceListEntry
 *                   - PricingElement
 *                   - PricingVariable
 *                   - Promotion
 *                 description: Logical object type to save
 *               objectId:
 *                 type: string
 *                 description: Existing Salesforce record ID for updates; omit or pass "new" to create
 *               objectData:
 *                 type: object
 *                 description: Field values to persist (metadata fields like attributes and Id are stripped automatically)
 *               orgUsername:
 *                 type: string
 *                 description: Salesforce org username
 *               orgType:
 *                 type: string
 *                 description: Optional org type descriptor
 *               commit:
 *                 type: boolean
 *                 description: If true, logs that the save is treated as a committed change
 *     responses:
 *       200:
 *         description: Pricing object saved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 objectId:
 *                   type: string
 *                   description: Salesforce record ID of the saved object
 *                 message:
 *                   type: string
 *                 committed:
 *                   type: boolean
 *       400:
 *         description: Validation error — missing required fields or unknown objectType
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Object not found (update of non-existent record)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/save-object', asyncHandler(async (req, res) => {
  const { objectType, objectId, objectData, orgUsername, orgType, commit } = req.body;

  if (!objectType || !objectData || !orgUsername) {
    throw new ValidationError('objectType, objectData, and orgUsername are required');
  }

  logger.info('Saving pricing object', { objectType, objectId, orgUsername, commit });

  try {
    const objectTypeMap = {
      'PriceList': 'vlocity_cmt__PriceList__c',
      'PriceListEntry': 'vlocity_cmt__PriceListEntry__c',
      'PricingElement': 'vlocity_cmt__PricingElement__c',
      'PricingVariable': 'vlocity_cmt__PricingVariable__c',
      'Promotion': 'vlocity_cmt__Promotion__c',
    };

    const apiName = objectTypeMap[objectType];
    if (!apiName) {
      throw new ValidationError(`Unknown object type: ${objectType}`);
    }

    // Prepare data for Salesforce (remove metadata fields)
    const cleanData = { ...objectData };
    delete cleanData.attributes;
    delete cleanData.Id; // Will be set separately for updates

    let result;
    if (objectId && objectId !== 'new') {
      // Update existing record
      result = await salesforceService.updateRecord(
        objectId,
        cleanData,
        orgUsername
      );
    } else {
      // Create new record
      result = await salesforceService.createRecord(
        apiName,
        cleanData,
        orgUsername
      );
    }

    // If commit is requested, ensure changes are persisted
    if (commit) {
      // Changes are automatically committed in Salesforce via API
      logger.info('Pricing object saved and committed', {
        objectType,
        objectId: result.id || objectId,
        orgUsername,
        orgType
      });
    }

    res.json({
      success: true,
      objectId: result.id || objectId,
      message: `${objectType} saved and committed successfully`,
      committed: commit || false
    });
  } catch (error) {
    logger.error('Failed to save pricing object', { error: error.message, objectType, objectId });
    throw error;
  }
}));

module.exports = router;
