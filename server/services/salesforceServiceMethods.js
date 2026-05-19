/**
 * Additional Salesforce Service Methods
 * These methods extend the salesforceService with CRUD operations
 */

const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Get object type from Salesforce ID
 * Salesforce IDs have prefixes that indicate the object type
 */
async function getObjectTypeFromId(recordId, username) {
  try {
    // Use Salesforce's UI API or Tooling API to get object type
    // For now, we'll use a simple approach with describe calls
    // In production, you might want to use the Tooling API's sObjectType endpoint
    
    // Common object prefixes (first 3 characters)
    const prefixMap = {
      '001': 'Account',
      '003': 'Contact',
      '00Q': 'Lead',
      '006': 'Opportunity',
      '01u': 'Campaign',
      '01p': 'Product2',
      'a0X': 'vlocity_cmt__PriceList__c',
      'a0Y': 'vlocity_cmt__PriceListEntry__c',
      'a0Z': 'vlocity_cmt__PricingElement__c',
      'a10': 'vlocity_cmt__PricingVariable__c',
      'a11': 'vlocity_cmt__Promotion__c',
    };

    const prefix = recordId.substring(0, 3);
    return prefixMap[prefix] || null;
  } catch (error) {
    logger.warn('Failed to get object type from ID', { recordId, error: error.message });
    return null;
  }
}

/**
 * Describe a field on an object
 */
async function describeField(objectName, fieldName, username, salesforceService) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    const response = await axios.get(
      `${salesforceService.baseUrl}/sobjects/${objectName}/describe`,
      { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
    );
    
    const field = response.data.fields.find(f => f.name === fieldName);
    return field || null;
  } catch (error) {
    logger.warn('Failed to describe field', { objectName, fieldName, error: error.message });
    return null;
  }
}

/**
 * Create a Salesforce record
 */
async function createRecord(objectType, recordData, username, salesforceService) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    const response = await axios.post(
      `${salesforceService.baseUrl}/sobjects/${objectType}/`,
      recordData,
      { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
    );
    
    logger.info('Record created', { objectType, recordId: response.data.id, username });
    return { id: response.data.id, success: response.data.success };
  } catch (error) {
    logger.error('Failed to create record', { 
      objectType, 
      error: error.response?.data || error.message,
      username 
    });
    throw new Error(`Failed to create ${objectType}: ${error.response?.data?.[0]?.message || error.message}`);
  }
}

/**
 * Update a Salesforce record
 */
async function updateRecord(recordId, recordData, username, salesforceService) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Determine object type from ID or use describe
    const objectType = await getObjectTypeFromId(recordId, username);
    if (!objectType) {
      throw new Error(`Cannot determine object type for record ID: ${recordId}`);
    }
    
    const response = await axios.patch(
      `${salesforceService.baseUrl}/sobjects/${objectType}/${recordId}`,
      recordData,
      { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
    );
    
    logger.info('Record updated', { objectType, recordId, username });
    return { id: recordId, success: true };
  } catch (error) {
    logger.error('Failed to update record', { 
      recordId, 
      error: error.response?.data || error.message,
      username 
    });
    throw new Error(`Failed to update record: ${error.response?.data?.[0]?.message || error.message}`);
  }
}

/**
 * Delete a Salesforce record
 */
async function deleteRecord(recordId, username, salesforceService) {
  try {
    await salesforceService.authenticateWithSfdx(username);
    
    // Determine object type from ID
    const objectType = await getObjectTypeFromId(recordId, username);
    if (!objectType) {
      throw new Error(`Cannot determine object type for record ID: ${recordId}`);
    }
    
    const response = await axios.delete(
      `${salesforceService.baseUrl}/sobjects/${objectType}/${recordId}`,
      { headers: { Authorization: `Bearer ${salesforceService.accessToken}` } }
    );
    
    logger.info('Record deleted', { objectType, recordId, username });
    return { id: recordId, success: true };
  } catch (error) {
    logger.error('Failed to delete record', { 
      recordId, 
      error: error.response?.data || error.message,
      username 
    });
    throw new Error(`Failed to delete record: ${error.response?.data?.[0]?.message || error.message}`);
  }
}

module.exports = {
  getObjectTypeFromId,
  describeField,
  createRecord,
  updateRecord,
  deleteRecord,
};

