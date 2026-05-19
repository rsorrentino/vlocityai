const express = require('express');
const router = express.Router();
const vlocityService = require('../services/vlocityService');
const vlocityDataPackService = require('../services/vlocityDataPackService');
const salesforceService = require('../services/salesforceService');
const { asyncHandler, NotFoundError, ValidationError } = require('../middleware/errorHandler');
const { validate, schemas } = require('../utils/configValidator');
const logger = require('../utils/logger');
const PropertiesReader = require('../utils/propertiesReader');
const path = require('path');

// Load properties from environments.properties file
const propertiesPath = path.join(__dirname, '../../environments.properties');
const properties = new PropertiesReader(propertiesPath);

/**
 * @route GET /api/vlocity/metadata-types
 * @desc Get all available Vlocity metadata types
 * @access Public
 */
router.get('/metadata-types', asyncHandler(async (req, res) => {
  const metadataTypes = [
    {
      name: 'OmniScript',
      description: 'Dynamic UI flows and guided experiences',
      category: 'UI',
      icon: 'description',
      examples: ['Checkout Flow', 'Product Configuration', 'Service Request']
    },
    {
      name: 'DataRaptor',
      description: 'Data transformation and manipulation services',
      category: 'Data',
      icon: 'transform',
      examples: ['Product Data', 'Customer Data', 'Order Processing']
    },
    {
      name: 'IntegrationProcedure',
      description: 'API integrations and external system connections',
      category: 'Integration',
      icon: 'api',
      examples: ['ERP Integration', 'Payment Gateway', 'Inventory System']
    },
    {
      name: 'CalculationProcedure',
      description: 'Business logic and calculation engines',
      category: 'Logic',
      icon: 'calculate',
      examples: ['Pricing Engine', 'Discount Calculator', 'Tax Calculation']
    },
    {
      name: 'FlexCard',
      description: 'Dynamic cards and UI components',
      category: 'UI',
      icon: 'view_module',
      examples: ['Product Cards', 'Customer Summary', 'Order Status']
    },
    {
      name: 'VlocityCard',
      description: 'Legacy card components',
      category: 'UI',
      icon: 'view_module',
      examples: ['Product Display', 'Customer Info', 'Order Details']
    },
    {
      name: 'VlocityAction',
      description: 'Custom actions and buttons',
      category: 'UI',
      icon: 'touch_app',
      examples: ['Add to Cart', 'Submit Order', 'Save Quote']
    },
    {
      name: 'VlocityFunction',
      description: 'Custom functions and utilities',
      category: 'Logic',
      icon: 'functions',
      examples: ['Validation Rules', 'Helper Functions', 'Utilities']
    },
    {
      name: 'VlocityUITemplate',
      description: 'Custom UI templates',
      category: 'UI',
      icon: 'web',
      examples: ['Product Templates', 'Layout Templates', 'Component Templates']
    },
    {
      name: 'VlocityPicklist',
      description: 'Custom picklist values',
      category: 'Data',
      icon: 'list',
      examples: ['Product Categories', 'Status Values', 'Priority Levels']
    },
    {
      name: 'VlocityAttachment',
      description: 'File attachments and documents',
      category: 'Data',
      icon: 'attach_file',
      examples: ['Product Images', 'Documents', 'Certificates']
    },
    {
      name: 'VlocityCMT',
      description: 'Catalog Management Tools',
      category: 'Catalog',
      icon: 'inventory',
      examples: ['Product Catalog', 'Pricing Rules', 'Attribute Definitions']
    }
  ];

  res.json({
    metadataTypes,
    count: metadataTypes.length,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/vlocity/metadata/:type
 * @desc Get metadata of a specific type from an org using SOQL queries
 * @access Public
 */
router.get('/metadata/:type', asyncHandler(async (req, res) => {
  const { type } = req.params;
  const { username } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Map metadata types to Salesforce objects
    // Note: IntegrationProcedure uses OmniScript object with IsProcedure__c = true
    const metadataTypeMap = {
      'OmniScript': {
        object: 'vlocity_cmt__OmniScript__c',
        fields: 'Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c, vlocity_cmt__IsActive__c, vlocity_cmt__IsProcedure__c, CreatedDate, LastModifiedDate',
        where: "WHERE vlocity_cmt__IsProcedure__c = false"
      },
      'DataRaptor': {
        object: 'vlocity_cmt__DRBundle__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate',
        where: "WHERE vlocity_cmt__Type__c != 'Migration'"
      },
      'IntegrationProcedure': {
        object: 'vlocity_cmt__OmniScript__c',
        fields: 'Id, vlocity_cmt__Type__c, vlocity_cmt__SubType__c, vlocity_cmt__Language__c, vlocity_cmt__IsActive__c, vlocity_cmt__IsProcedure__c, CreatedDate, LastModifiedDate',
        where: "WHERE vlocity_cmt__IsProcedure__c = true"
      },
      'CalculationProcedure': {
        object: 'vlocity_cmt__CalculationProcedure__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      },
      'FlexCard': {
        object: 'vlocity_cmt__VlocityCard__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate',
        where: "WHERE vlocity_cmt__Type__c = 'FlexCard'"
      },
      'VlocityCard': {
        object: 'vlocity_cmt__VlocityCard__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate',
        where: "WHERE (vlocity_cmt__Type__c != 'FlexCard' OR vlocity_cmt__Type__c = null)"
      },
      'VlocityAction': {
        object: 'vlocity_cmt__VlocityAction__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      },
      'VlocityFunction': {
        object: 'vlocity_cmt__VlocityFunction__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      },
      'VlocityUITemplate': {
        object: 'vlocity_cmt__VlocityUITemplate__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      },
      'VlocityPicklist': {
        object: 'vlocity_cmt__VlocityPicklist__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      },
      'VlocityAttachment': {
        object: 'ContentVersion',
        fields: 'Id, Title, ContentDocumentId, CreatedDate, LastModifiedDate',
        where: "WHERE ContentDocumentId IN (SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN (SELECT Id FROM vlocity_cmt__VlocityDataPack__c))"
      },
      'VlocityCMT': {
        object: 'vlocity_cmt__VlocityDataPack__c',
        fields: 'Id, Name, vlocity_cmt__Type__c, vlocity_cmt__IsActive__c, CreatedDate, LastModifiedDate'
      }
    };

    const typeConfig = metadataTypeMap[type];
    if (!typeConfig) {
      throw new ValidationError(`Unsupported metadata type: ${type}`);
    }

    // Build SOQL query
    let soql = `SELECT ${typeConfig.fields} FROM ${typeConfig.object}`;
    if (typeConfig.where) {
      soql += ' ' + typeConfig.where;
    }
    soql += ' ORDER BY LastModifiedDate DESC LIMIT 1000';

    let queryResult;
    try {
      queryResult = await salesforceService.query(soql);
    } catch (error) {
      // If object doesn't exist, return empty result
        logger.warn(`Object ${typeConfig.object} may not exist or query failed`, { 
          username, 
          type, 
          error: error.message 
        });
      queryResult = { records: [] };
    }
    
    const records = queryResult.records || [];

    // Transform records to match expected format
    const result = records.map(record => {
      // For OmniScript/IntegrationProcedure, construct name from Type/SubType
      let displayName = record.Name || record.Title;
      if (!displayName && (type === 'OmniScript' || type === 'IntegrationProcedure')) {
        const parts = [];
        if (record.vlocity_cmt__Type__c) parts.push(record.vlocity_cmt__Type__c);
        if (record.vlocity_cmt__SubType__c) parts.push(record.vlocity_cmt__SubType__c);
        if (record.vlocity_cmt__Language__c) parts.push(record.vlocity_cmt__Language__c);
        displayName = parts.join(' / ') || record.Id;
      }
      
      return {
        id: record.Id,
        name: displayName,
        fullName: displayName,
        type: record.vlocity_cmt__Type__c || type,
        subType: record.vlocity_cmt__SubType__c,
        language: record.vlocity_cmt__Language__c,
        isActive: record.vlocity_cmt__IsActive__c !== undefined ? record.vlocity_cmt__IsActive__c : (record.IsActive !== false),
        createdDate: record.CreatedDate,
        lastModifiedDate: record.LastModifiedDate
      };
    });

    res.json({
      success: true,
      metadataType: type,
      username,
      result,
      count: result.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getVlocityMetadata', type, username });
    
    res.status(400).json({
      success: false,
      metadataType: type,
      username,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}));

/**
 * @route GET /api/vlocity/metadata/:type/:name
 * @desc Get specific metadata item details
 * @access Public
 */
router.get('/metadata/:type/:name', asyncHandler(async (req, res) => {
  const { type, name } = req.params;
  const { username } = req.query;

  if (!username) {
    throw new ValidationError('Username is required');
  }

  try {
    // Get specific metadata using Salesforce CLI
    const { spawn } = require('child_process');
    
    const result = await new Promise((resolve, reject) => {
      const child = spawn('sfdx', [
        'force:source:retrieve',
        '-u', username,
        '-m', `Vlocity${type}:${name}`,
        '--json'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (parseError) {
            reject(new Error('Failed to parse metadata result'));
          }
        } else {
          reject(new Error(`Failed to retrieve metadata: ${stderr}`));
        }
      });
    });

    res.json({
      success: true,
      metadataType: type,
      metadataName: name,
      username,
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'getVlocityMetadataItem', type, name, username });
    
    res.status(400).json({
      success: false,
      metadataType: type,
      metadataName: name,
      username,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}));

/**
 * @route POST /api/vlocity/deploy-metadata
 * @desc Deploy Vlocity metadata to target org using Vlocity CLI export/import
 * @access Public
 */
router.post('/deploy-metadata', asyncHandler(async (req, res) => {
  const { sourceOrg, targetOrg, metadataType, metadataName } = req.body;

  if (!sourceOrg || !targetOrg) {
    throw new ValidationError('Source and target orgs are required');
  }

  if (!metadataType) {
    throw new ValidationError('Metadata type is required');
  }

  try {
    logger.logOperation('Starting Vlocity metadata deployment', {
      sourceOrg,
      targetOrg,
      metadataType,
      metadataName
    });

    // Use Vlocity CLI to export from source and import to target
    // This is a simplified approach - for production, you'd want to use DataPack export/import
    throw new ValidationError('Metadata deployment via this endpoint is not yet fully implemented. Use Export/Deploy Jobs instead for reliable metadata transfer.');

  } catch (error) {
    logger.logError(error, { 
      operation: 'deployVlocityMetadata', 
      sourceOrg, 
      targetOrg, 
      metadataType, 
      metadataName 
    });
    throw error;
  }
}));

/**
 * @route GET /api/vlocity/org-analysis/:username
 * @desc Analyze Vlocity configuration in an org
 * @access Public
 */
router.get('/org-analysis/:username', asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { environment = 'dev' } = req.query;

  try {
    logger.logOperation('Starting Vlocity org analysis', { username, environment });

    // Analyze different aspects of Vlocity configuration
    const analysis = {
      orgInfo: await getOrgInfo(username),
      metadataCounts: await getMetadataCounts(username),
      dependencies: await analyzeDependencies(username),
      configurations: await analyzeConfigurations(username),
      recommendations: await generateRecommendations(username)
    };

    res.json({
      success: true,
      username,
      environment,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.logError(error, { operation: 'analyzeVlocityOrg', username });
    throw error;
  }
}));

// Helper functions removed - functionality moved to use Vlocity CLI export/import via Export/Deploy Jobs

async function getOrgInfo(username) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Get org info using Salesforce CLI
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const child = spawn('sf', [
        'org', 'display', '--target-org', username, '--json'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            const orgInfo = result.result || {};
            resolve({
              username,
              orgId: orgInfo.id,
              orgType: orgInfo.instanceUrl?.includes('sandbox') ? 'Sandbox' : 'Production',
              instanceUrl: orgInfo.instanceUrl,
              accessToken: orgInfo.accessToken ? '***' : null,
              lastModified: new Date().toISOString()
            });
          } catch (parseError) {
            // If parsing fails, return basic info
            resolve({
              username,
              orgType: 'Unknown',
              lastModified: new Date().toISOString()
            });
          }
        } else {
          // If CLI fails, return basic info
          resolve({
            username,
            orgType: 'Unknown',
            lastModified: new Date().toISOString()
          });
        }
      });
    });
  } catch (error) {
    logger.logError(error, { operation: 'getOrgInfo', username });
    return {
      username,
      orgType: 'Unknown',
      lastModified: new Date().toISOString()
    };
  }
}

async function getMetadataCounts(username) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Query actual counts from Salesforce
    const queries = {
      omniScripts: `SELECT COUNT() FROM vlocity_cmt__OmniScript__c`,
      dataRaptors: `SELECT COUNT() FROM vlocity_cmt__DRBundle__c`,
      integrationProcedures: `SELECT COUNT() FROM vlocity_cmt__OmniScript__c WHERE vlocity_cmt__IsProcedure__c = true`,
      calculationProcedures: `SELECT COUNT() FROM vlocity_cmt__CalculationProcedure__c`,
      flexCards: `SELECT COUNT() FROM vlocity_cmt__VlocityCard__c WHERE vlocity_cmt__Type__c = 'FlexCard'`,
      vlocityCards: `SELECT COUNT() FROM vlocity_cmt__VlocityCard__c WHERE vlocity_cmt__Type__c != 'FlexCard' OR vlocity_cmt__Type__c = null`,
      vlocityActions: `SELECT COUNT() FROM vlocity_cmt__VlocityAction__c`,
      vlocityFunctions: `SELECT COUNT() FROM vlocity_cmt__VlocityFunction__c`,
      vlocityUITemplates: `SELECT COUNT() FROM vlocity_cmt__VlocityUITemplate__c`,
      // vlocityPicklists: `SELECT COUNT() FROM vlocity_cmt__VlocityPicklist__c` // Object doesn't exist in all orgs
    };

    const counts = {};
    let total = 0;

    for (const [key, soql] of Object.entries(queries)) {
      try {
        const result = await salesforceService.query(soql);
        const count = result.totalSize || 0;
        counts[key] = count;
        total += count;
      } catch (error) {
        // If object doesn't exist or query fails, set to 0
        counts[key] = 0;
        logger.warn(`Failed to query ${key}`, { username, error: error.message });
      }
    }

    counts.total = total;
    return counts;
  } catch (error) {
    logger.logError(error, { operation: 'getMetadataCounts', username });
    // Return empty counts on error
    return {
      omniScripts: 0,
      dataRaptors: 0,
      integrationProcedures: 0,
      calculationProcedures: 0,
      flexCards: 0,
      vlocityCards: 0,
      vlocityActions: 0,
      vlocityFunctions: 0,
      vlocityUITemplates: 0,
      // vlocityPicklists: 0, // Object doesn't exist in all orgs
      total: 0
    };
  }
}

async function analyzeDependencies(username) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Query for OmniScript dependencies
    // Note: OmniScript dependencies are stored in JSON, not direct field references
    // We can only query for DataRaptor dependencies as direct field references
    // IntegrationProcedure and CalculationProcedure dependencies are stored in JSON
    const omniScriptSoql = `SELECT Id, Name, vlocity_cmt__DataRaptorBundleId__c
                            FROM vlocity_cmt__OmniScript__c
                            WHERE vlocity_cmt__DataRaptorBundleId__c != null
                            LIMIT 100`;
    
    const omniScripts = await salesforceService.query(omniScriptSoql);
    
    const criticalDependencies = [];
    const missingDependencies = [];

    if (omniScripts.records) {
      omniScripts.records.forEach(script => {
        if (script.vlocity_cmt__DataRaptorBundleId__c) {
          criticalDependencies.push(`${script.Name || script.Id} → DataRaptor`);
        }
        // Note: IntegrationProcedure and CalculationProcedure dependencies are stored in JSON,
        // not as direct field references, so we cannot query them directly via SOQL
      });
    }

    return {
      criticalDependencies: criticalDependencies.slice(0, 20), // Limit to 20
      circularDependencies: [],
      missingDependencies: missingDependencies.slice(0, 10)
    };
  } catch (error) {
    logger.logError(error, { operation: 'analyzeDependencies', username });
    return {
      criticalDependencies: [],
      circularDependencies: [],
      missingDependencies: []
    };
  }
}

async function analyzeConfigurations(username) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Query product catalog
    const productCountResult = await salesforceService.query('SELECT COUNT() FROM Product2 WHERE IsActive = true AND GT_IsTechnicalProduct__c = false');
    // vlocity_cmt__Attribute__c doesn't have IsActive__c field, use standard query
    const attributeCountResult = await salesforceService.query('SELECT COUNT() FROM vlocity_cmt__Attribute__c');
    
    const productCatalog = {
      configured: (productCountResult.totalSize || 0) > 0,
      products: productCountResult.totalSize || 0,
      attributes: attributeCountResult.totalSize || 0
    };

    // Query pricing configuration
    const priceListCountResult = await salesforceService.query('SELECT COUNT() FROM vlocity_cmt__PriceList__c WHERE vlocity_cmt__IsActive__c = true');
    
    const pricing = {
      configured: (priceListCountResult.totalSize || 0) > 0,
      priceLists: priceListCountResult.totalSize || 0
    };

    // Check for contract management (vlocity_cmt__Contract__c)
    // Note: This object may not exist in all orgs, so we handle it gracefully
    let contractManagement = { configured: false, needsSetup: true };
    try {
      const contractCountResult = await salesforceService.query('SELECT COUNT() FROM vlocity_cmt__Contract__c');
      contractManagement = {
        configured: (contractCountResult.totalSize || 0) > 0,
        contracts: contractCountResult.totalSize || 0,
        needsSetup: (contractCountResult.totalSize || 0) === 0
      };
    } catch (error) {
      // Object doesn't exist in this org - this is expected and not an error
      // Check if it's an INVALID_TYPE error (object doesn't exist) or a generic "not supported" error
      const isInvalidTypeError = error.response?.data?.sfErrorCode === 'INVALID_TYPE' ||
                                error.message?.includes('INVALID_TYPE') ||
                                error.message?.includes('not supported') ||
                                error.message?.includes('sObject type');
      
      // Only log if it's a different type of error
      if (!isInvalidTypeError) {
        logger.warn('Contract object query failed', { username, error: error.message });
      }
      contractManagement = { configured: false, needsSetup: true };
    }

    return {
      productCatalog,
      pricing,
      contractManagement
    };
  } catch (error) {
    logger.logError(error, { operation: 'analyzeConfigurations', username });
    return {
      productCatalog: { configured: false, products: 0, attributes: 0 },
      pricing: { configured: false, priceLists: 0 },
      contractManagement: { configured: false, needsSetup: true }
    };
  }
}

async function generateRecommendations(username) {
  try {
    const recommendations = [];
    
    const counts = await getMetadataCounts(username);
    const configs = await analyzeConfigurations(username);

    // Check for inactive components
    if (counts.omniScripts > 0) {
      recommendations.push(`Found ${counts.omniScripts} OmniScripts - Review inactive ones for optimization`);
    }

    if (counts.dataRaptors > 50) {
      recommendations.push(`Large number of DataRaptors (${counts.dataRaptors}) - Consider consolidating similar transformations`);
    }

    if (!configs.productCatalog.configured) {
      recommendations.push('Product Catalog not configured - Set up Product2 and Attribute definitions');
    }

    if (!configs.pricing.configured) {
      recommendations.push('Pricing not configured - Set up Price Lists and Price List Entries');
    }

    if (configs.contractManagement.needsSetup) {
      recommendations.push('Contract Management not configured - Consider implementing for complete lifecycle coverage');
    }

    if (recommendations.length === 0) {
      recommendations.push('Vlocity configuration looks good - Continue monitoring for optimization opportunities');
    }

    return recommendations;
  } catch (error) {
    logger.logError(error, { operation: 'generateRecommendations', username });
    return [
      'Unable to generate recommendations - Check Vlocity configuration manually'
    ];
  }
}

module.exports = router;
