const axios = require('axios');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');
const sfdxAuthService = require('./sfdxAuthService');
const retryService = require('./retryService');
const {
  getObjectTypeFromId,
  describeField,
  createRecord,
  updateRecord,
  deleteRecord,
} = require('./salesforceServiceMethods');

/**
 * Salesforce REST API Service with Graph API Support
 * Uses SFDX/SF CLI for authentication (no Connected App needed!)
 * Handles CRUD operations, Graph API, and batch job execution
 */
class SalesforceService {
  constructor() {
    this.baseUrl = null;
    this.accessToken = null;
    this.instanceUrl = null;
    this.apiVersion = process.env.SALESFORCE_API_VERSION || 'v59.0';
    this.graphApiVersion = process.env.SALESFORCE_GRAPH_API_VERSION || '59.0';
    
    // Cache for org connections
    this.connectionCache = new Map();
  }

  /**
   * Authenticate using SFDX/SF CLI stored credentials
   * This is much better than Username-Password flow!
   * No Connected App needed - uses SF CLI's authentication
   * 
   * @param {string} usernameOrAlias - Salesforce username or alias
   * @returns {Promise<Object>} Authentication info
   */
  async authenticateWithSfdx(usernameOrAlias) {
    try {
      // Check cache first
      const cacheKey = usernameOrAlias;
      const cached = this.connectionCache.get(cacheKey);
      
      if (cached && cached.expiresAt > Date.now()) {
        logger.info('Using cached connection', { org: usernameOrAlias });
        this.accessToken = cached.accessToken;
        this.instanceUrl = cached.instanceUrl;
        this.baseUrl = `${this.instanceUrl}/services/data/${this.apiVersion}`;
        return cached;
      }

      // Get fresh token from SF CLI
      const orgInfo = await sfdxAuthService.getAccessToken(usernameOrAlias);
      
      this.accessToken = orgInfo.accessToken;
      this.instanceUrl = orgInfo.instanceUrl;
      this.baseUrl = `${this.instanceUrl}/services/data/${this.apiVersion}`;

      // Cache for 1 hour
      const authInfo = {
        accessToken: orgInfo.accessToken,
        instanceUrl: orgInfo.instanceUrl,
        orgId: orgInfo.orgId,
        username: orgInfo.username,
        alias: orgInfo.alias,
        expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour
      };
      
      this.connectionCache.set(cacheKey, authInfo);

      logger.info('SFDX authentication successful', { 
        org: usernameOrAlias,
        username: orgInfo.username,
        instanceUrl: orgInfo.instanceUrl 
      });

      return authInfo;
    } catch (error) {
      logger.logError(error, { operation: 'authenticateWithSfdx', org: usernameOrAlias });
      throw new Error(`SFDX authentication failed: ${error.message}`);
    }
  }

  /**
   * Authenticate with Salesforce using OAuth 2.0 Username-Password flow
   * DEPRECATED: Use authenticateWithSfdx() instead
   * @deprecated
   */
  async authenticate(username, password, instanceUrl) {
    logger.warn('Using deprecated authenticate() method. Use authenticateWithSfdx() instead.');
    
    try {
      const clientId = process.env.SALESFORCE_CLIENT_ID;
      const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Salesforce credentials not configured. Use authenticateWithSfdx() instead.');
      }

      const response = await axios.post(`${instanceUrl}/services/oauth2/token`, null, {
        params: {
          grant_type: 'password',
          client_id: clientId,
          client_secret: clientSecret,
          username: username,
          password: password,
        },
      });

      this.accessToken = response.data.access_token;
      this.instanceUrl = response.data.instance_url;
      this.baseUrl = `${this.instanceUrl}/services/data/${this.apiVersion}`;

      logger.info('Salesforce authentication successful', { username, instanceUrl });

      return {
        accessToken: this.accessToken,
        instanceUrl: this.instanceUrl,
      };
    } catch (error) {
      logger.logError(error, { operation: 'salesforceAuthenticate', username });
      throw new Error(`Salesforce authentication failed: ${error.message}`);
    }
  }

  /**
   * Execute SOQL query with retry logic
   * @param {string} soql - SOQL query string
   * @param {Object} options - Query options (retry, etc.)
   * @returns {Promise<Object>} Query results
   */
  async query(soql, options = {}) {
    return retryService.executeWithRetry(
      async () => {
        const response = await axios.get(`${this.baseUrl}/query`, {
          params: { q: soql },
          headers: { Authorization: `Bearer ${this.accessToken}` },
          timeout: options.timeout || 60000, // 60 second timeout for queries
        });

        logger.info('SOQL query executed', { soql, recordCount: response.data.totalSize });
        return response.data;
      },
      {
        operation: 'salesforceQuery',
        soql: soql.substring(0, 100) // Log first 100 chars only
      },
      {
        maxRetries: options.maxRetries || 3,
        baseDelay: options.baseDelay || 1000
      }
    ).catch(error => {
      // Enhanced error message with Salesforce details
      let errorMessage = error.message;
      
      // Handle connection timeout errors
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
        errorMessage = `Connection timeout to Salesforce. The server may be unreachable or the network connection is slow. ` +
          `Instance URL: ${this.instanceUrl || 'not set'}. ` +
          `Please check your network connection and firewall settings.`;
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = `DNS lookup failed for Salesforce hostname. ` +
          `Instance URL: ${this.instanceUrl || 'not set'}. ` +
          `Please verify the instance URL is correct (check for typos or double dashes).`;
      } else if (error.response?.data?.[0]?.message) {
        errorMessage = error.response.data[0].message;
      }
      
      const sfErrorCode = error.response?.data?.[0]?.errorCode;
      const logMeta = {
        operation: 'salesforceQuery',
        soql: soql.substring(0, 100),
        instanceUrl: this.instanceUrl,
        errorCode: error.code,
        sfErrorCode,
        sfErrorMessage: error.response?.data?.[0]?.message
      };
      // INVALID_FIELD / MALFORMED_QUERY are schema-mismatch signals, not runtime errors.
      // Log at warn so they don't clutter error dashboards when tests skip gracefully.
      if (sfErrorCode === 'INVALID_FIELD' || sfErrorCode === 'MALFORMED_QUERY') {
        logger.warn('Salesforce query schema mismatch (field not found in this org)', logMeta);
      } else {
        logger.logError(error, logMeta);
      }
      
      throw new Error(`Salesforce query failed: ${errorMessage}`);
    });
  }

  /**
   * Check if a field exists on an object
   * @param {string} objectName - Salesforce object API name
   * @param {string} fieldName - Field API name
   * @returns {Promise<boolean>} True if field exists
   */
  async fieldExists(objectName, fieldName) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/sobjects/${objectName}/describe`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      
      const field = response.data.fields.find(f => f.name === fieldName);
      return !!field;
    } catch (error) {
      logger.logWarning('Field existence check failed', { objectName, fieldName, error: error.message });
      return false;
    }
  }

  /**
   * Get available fields for an object
   * @param {string} objectName - Salesforce object API name
   * @returns {Promise<Array>} List of field names
   */
  async getObjectFields(objectName) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/sobjects/${objectName}/describe`,
        { headers: { Authorization: `Bearer ${this.accessToken}` } }
      );
      
      return response.data.fields.map(f => ({
        name: f.name,
        type: f.type,
        label: f.label
      }));
    } catch (error) {
      logger.logError(error, { operation: 'getObjectFields', objectName });
      return [];
    }
  }

  /**
   * Retrieve a single record
   * @param {string} objectType - Salesforce object type (e.g., 'Product2')
   * @param {string} recordId - Salesforce record ID
   * @param {string[]} fields - Fields to retrieve
   * @returns {Promise<Object>} Record data
   */
  async retrieve(objectType, recordId, fields = []) {
    try {
      const fieldList = fields.length > 0 ? `?fields=${fields.join(',')}` : '';
      const response = await axios.get(
        `${this.baseUrl}/sobjects/${objectType}/${recordId}${fieldList}`,
        {
          headers: { Authorization: `Bearer ${this.accessToken}` },
        }
      );

      logger.info('Record retrieved', { objectType, recordId });
      return response.data;
    } catch (error) {
      logger.logError(error, { operation: 'salesforceRetrieve', objectType, recordId });
      throw new Error(`Salesforce retrieve failed: ${error.message}`);
    }
  }

  /**
   * Create a new record
   * @param {string} objectType - Salesforce object type
   * @param {Object} data - Record data
   * @returns {Promise<Object>} Created record info
   */
  async create(objectType, data) {
    try {
      const response = await axios.post(`${this.baseUrl}/sobjects/${objectType}`, data, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info('Record created', { objectType, id: response.data.id });
      return response.data;
    } catch (error) {
      logger.logError(error, { operation: 'salesforceCreate', objectType, data });
      throw new Error(`Salesforce create failed: ${error.message}`);
    }
  }

  /**
   * Update an existing record
   * @param {string} objectType - Salesforce object type
   * @param {string} recordId - Record ID to update
   * @param {Object} data - Updated field values
   * @returns {Promise<void>}
   */
  async update(objectType, recordId, data) {
    try {
      await axios.patch(`${this.baseUrl}/sobjects/${objectType}/${recordId}`, data, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info('Record updated', { objectType, recordId });
    } catch (error) {
      logger.logError(error, { operation: 'salesforceUpdate', objectType, recordId, data });
      throw new Error(`Salesforce update failed: ${error.message}`);
    }
  }

  /**
   * Delete a record
   * @param {string} objectType - Salesforce object type
   * @param {string} recordId - Record ID to delete
   * @returns {Promise<void>}
   */
  async delete(objectType, recordId) {
    try {
      await axios.delete(`${this.baseUrl}/sobjects/${objectType}/${recordId}`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      logger.info('Record deleted', { objectType, recordId });
    } catch (error) {
      logger.logError(error, { operation: 'salesforceDelete', objectType, recordId });
      throw new Error(`Salesforce delete failed: ${error.message}`);
    }
  }

  /**
   * Describe a Salesforce object
   * @param {string} objectType - Salesforce object type
   * @returns {Promise<Object>} Object metadata
   */
  async describeObject(objectType) {
    try {
      const response = await axios.get(`${this.baseUrl}/sobjects/${objectType}/describe`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });

      logger.info('Object described', { objectType });
      return response.data;
    } catch (error) {
      logger.logError(error, { operation: 'salesforceDescribe', objectType });
      throw new Error(`Salesforce describe failed: ${error.message}`);
    }
  }

  /**
   * Execute a composite request (batch operations)
   * @param {Array<Object>} requests - Array of sub-requests
   * @returns {Promise<Object>} Composite results
   */
  async composite(requests) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/composite`,
        {
          allOrNone: false,
          compositeRequest: requests,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('Composite request executed', { requestCount: requests.length });
      return response.data;
    } catch (error) {
      logger.logError(error, { operation: 'salesforceComposite', requestCount: requests.length });
      throw new Error(`Salesforce composite failed: ${error.message}`);
    }
  }

  /**
   * Check if authenticated
   * @returns {boolean}
   */
  isAuthenticated() {
    return !!this.accessToken && !!this.instanceUrl;
  }

  /**
   * Get current instance URL
   * @returns {string|null}
   */
  getInstanceUrl() {
    return this.instanceUrl;
  }

  /**
   * Clear authentication
   */
  clearAuth() {
    this.accessToken = null;
    this.instanceUrl = null;
    this.baseUrl = null;
  }

  // ==================== GRAPH API METHODS ====================

  /**
   * Execute a GraphQL query using Salesforce Graph API
   * @param {string} graphqlQuery - GraphQL query string
   * @param {Object} variables - Query variables
   * @returns {Promise<Object>} Query results
   */
  async graphQuery(graphqlQuery, variables = {}) {
    try {
      const response = await axios.post(
        `${this.instanceUrl}/services/data/v${this.graphApiVersion}/graphql`,
        {
          query: graphqlQuery,
          variables: variables,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      logger.info('GraphQL query executed', { hasErrors: !!response.data.errors });
      
      if (response.data.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(response.data.errors)}`);
      }

      return response.data.data;
    } catch (error) {
      logger.logError(error, { operation: 'graphQuery', query: graphqlQuery });
      throw new Error(`Salesforce GraphQL query failed: ${error.message}`);
    }
  }

  /**
   * Get Vlocity Price Lists using REST API
   * @param {Object} filters - Query filters (country, active, etc.)
   * @returns {Promise<Array>} Price lists
   */
  async getVlocityPriceLists(filters = {}) {
    let whereClause = 'WHERE Id != null';
    
    if (filters.country) {
      whereClause += ` AND (vlocity_cmt__Code__c LIKE '%${filters.country}%' OR Name LIKE '%${filters.country}%')`;
    }
    
    if (filters.active !== undefined) {
      whereClause += ` AND vlocity_cmt__IsActive__c = ${filters.active}`;
    }
    
    if (filters.name) {
      whereClause += ` AND Name LIKE '%${filters.name}%'`;
    }
    
    const soql = `
      SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c, 
             vlocity_cmt__CurrencyCode__c, vlocity_cmt__Description__c,
             vlocity_cmt__EffectiveFromDate__c, vlocity_cmt__EffectiveUntilDate__c,
             CreatedDate, LastModifiedDate
      FROM vlocity_cmt__PriceList__c
      ${whereClause}
      ORDER BY Name
      LIMIT 200
    `;

    const result = await this.query(soql);
    
    // Transform to match UI expectations
    return (result.records || []).map(record => ({
      ...record,
      effectiveFromDate: record.vlocity_cmt__EffectiveFromDate__c,
      effectiveUntilDate: record.vlocity_cmt__EffectiveUntilDate__c
    }));
  }

  /**
   * Get Vlocity Promotions using REST API
   * @param {Object} filters - Query filters
   * @returns {Promise<Array>} Promotions
   */
  async getVlocityPromotions(filters = {}) {
    try {
      let whereClause = 'WHERE Id != null';
      
      // Only add country filter if provided (don't filter by default)
      if (filters.country) {
        // Try name-based filtering only
        whereClause += ` AND Name LIKE '%${filters.country}%'`;
      }
      
      if (filters.active !== undefined) {
        whereClause += ` AND vlocity_cmt__IsActive__c = ${filters.active}`;
      }
      
      if (filters.name) {
        whereClause += ` AND Name LIKE '%${filters.name}%'`;
      }
      
      if (filters.code) {
        whereClause += ` AND vlocity_cmt__Code__c LIKE '%${filters.code}%'`;
      }
      
      if (filters.promotionType) {
        whereClause += ` AND GT_Type__c LIKE '%${filters.promotionType}%'`;
      }
      
      // Try to include additional fields if they exist
      const soql = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c, 
               vlocity_cmt__Description__c, vlocity_cmt__GlobalKey__c,
               GT_Type__c, CreatedDate, LastModifiedDate
        FROM vlocity_cmt__Promotion__c
        ${whereClause}
        ORDER BY Name
        LIMIT 200
      `;

      const result = await this.query(soql);
      return result.records || [];
    } catch (error) {
      logger.logWarning('Failed to query promotions, returning empty array', { error: error.message });
      return [];
    }
  }

  /**
   * Build GraphQL where clause from filters
   * @param {Object} filters - Filter object
   * @returns {Object} GraphQL where clause
   */
  buildGraphWhere(filters) {
    const where = {};
    
    if (filters.country) {
      where.GT_CountryCode__c = { eq: filters.country };
    }
    
    if (filters.active !== undefined) {
      where.vlocity_cmt__IsActive__c = { eq: filters.active };
    }
    
    if (filters.name) {
      where.Name = { like: `%${filters.name}%` };
    }

    return where;
  }

  // ==================== BATCH JOB EXECUTION ====================

  /**
   * Execute an Apex batch job in Salesforce
   * @param {string} apexClassName - Name of the Apex batch class
   * @param {number} batchSize - Batch size (default: 200)
   * @returns {Promise<Object>} Job info
   */
  async executeBatchJob(apexClassName, batchSize = 200) {
    try {
      // Create anonymous Apex to execute the batch
      const apexCode = `Database.executeBatch(new ${apexClassName}(), ${batchSize});`;
      
      const response = await axios.post(
        `${this.baseUrl}/tooling/executeAnonymous`,
        {
          anonymousBody: apexCode,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data.success) {
        throw new Error(`Batch execution failed: ${response.data.compileProblem || response.data.exceptionMessage}`);
      }

      logger.info('Batch job initiated', { apexClassName, batchSize });
      
      return {
        success: true,
        apexClassName,
        batchSize,
        message: 'Batch job initiated successfully',
      };
    } catch (error) {
      logger.logError(error, { operation: 'executeBatchJob', apexClassName });
      throw new Error(`Failed to execute batch job: ${error.message}`);
    }
  }

  /**
   * Get batch job status
   * @param {string} jobId - AsyncApexJob ID
   * @returns {Promise<Object>} Job status
   */
  async getBatchJobStatus(jobId) {
    try {
      const soql = `SELECT Id, ApexClass.Name, Status, JobItemsProcessed, TotalJobItems, NumberOfErrors, CreatedDate, CompletedDate 
                    FROM AsyncApexJob 
                    WHERE Id = '${jobId}'`;
      
      const result = await this.query(soql);
      
      if (result.totalSize === 0) {
        throw new Error(`Batch job ${jobId} not found`);
      }

      return result.records[0];
    } catch (error) {
      logger.logError(error, { operation: 'getBatchJobStatus', jobId });
      throw new Error(`Failed to get batch job status: ${error.message}`);
    }
  }

  /**
   * Get running batch jobs
   * @param {string} apexClassName - Optional filter by class name
   * @returns {Promise<Array>} Running jobs
   */
  async getRunningBatchJobs(apexClassName = null) {
    try {
      let soql = `SELECT Id, ApexClass.Name, Status, JobItemsProcessed, TotalJobItems, NumberOfErrors, CreatedDate 
                  FROM AsyncApexJob 
                  WHERE JobType = 'BatchApex' 
                  AND Status IN ('Processing', 'Preparing', 'Queued')`;
      
      if (apexClassName) {
        soql += ` AND ApexClass.Name = '${apexClassName}'`;
      }
      
      soql += ' ORDER BY CreatedDate DESC';
      
      const result = await this.query(soql);
      return result.records;
    } catch (error) {
      logger.logError(error, { operation: 'getRunningBatchJobs', apexClassName });
      throw new Error(`Failed to get running batch jobs: ${error.message}`);
    }
  }

  /**
   * Schedule post-pricing jobs (Vlocity cache refresh, hierarchy, EPC)
   * @returns {Promise<Object>} Job info
   */
  async schedulePostPricingJobs() {
    try {
      // Execute Vlocity TelcoAdminConsole jobs
      const apexCode = `
        vlocity_cmt.TelcoAdminConsoleController telcoCtrl = new vlocity_cmt.TelcoAdminConsoleController();
        telcoCtrl.setParameters('{"methodName":"clearPlatformCache"}');
        telcoCtrl.invokeMethod();
        
        telcoCtrl.setParameters('{"methodName":"refreshPricebook"}');
        telcoCtrl.invokeMethod();
        
        telcoCtrl.setParameters('{"methodName":"startProductHierarchyJob"}');
        telcoCtrl.invokeMethod();
      `;
      
      const response = await axios.post(
        `${this.baseUrl}/tooling/executeAnonymous`,
        { anonymousBody: apexCode },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.data.success) {
        throw new Error(`Post-pricing jobs failed: ${response.data.compileProblem || response.data.exceptionMessage}`);
      }

      logger.info('Post-pricing jobs scheduled');
      
      return {
        success: true,
        message: 'Post-pricing jobs scheduled successfully',
        jobs: ['clearPlatformCache', 'refreshPricebook', 'startProductHierarchyJob'],
      };
    } catch (error) {
      logger.logError(error, { operation: 'schedulePostPricingJobs' });
      throw new Error(`Failed to schedule post-pricing jobs: ${error.message}`);
    }
  }

  // ==================== CUSTOM OBJECT OPERATIONS ====================

  /**
   * Get Staging Area records by country
   * @param {string} countryCode - Country code
   * @param {string} status - Record status (default: 'New')
   * @param {number} limit - Max records (default: 50000)
   * @returns {Promise<Array>} Staging records
   */
  async getStagingAreaRecords(countryCode, status = 'New', limit = 50000) {
    try {
      const soql = `SELECT Id, Name, GT_Description__c, GT_AmplifonClass__c, 
                          GT_AmplifonClassDesc__c, GT_ProductName__c, GT_RecordStatus__c,
                          GT_OrganizationCode__c, GT_Lifecycle__c, GT_BrandCode__c,
                          GT_Platform__c, GT_Color__c, GT_FormFactor__c, GT_ProductType__c
                    FROM GT_StagingArea__c
                    WHERE GT_RecordStatus__c = '${status}'
                    AND GT_OrganizationCode__c LIKE '%${countryCode}%'
                    LIMIT ${limit}`;
      
      const result = await this.query(soql);
      
      logger.info('Staging area records retrieved', { 
        countryCode, 
        status, 
        count: result.totalSize 
      });
      
      return result.records;
    } catch (error) {
      logger.logError(error, { operation: 'getStagingAreaRecords', countryCode });
      throw new Error(`Failed to get staging area records: ${error.message}`);
    }
  }

  /**
   * Get Product SKUs by filters
   * @param {Object} filters - Filter criteria
   * @returns {Promise<Array>} Product SKUs
   */
  async getProductSKUs(filters = {}) {
    try {
      let soql = `SELECT Id, Name, GT_ProductName__c,
                        GT_Color__c, GT_Lifecycle__c, GT_OrganizationCode__c
                  FROM GT_ProductSKU__c`;
      
      const whereClauses = [];
      
      if (filters.countryCode) {
        whereClauses.push(`GT_OrganizationCode__c LIKE '%${filters.countryCode}%'`);
      }
      
      if (filters.itemNumber) {
        whereClauses.push(`Name = '${filters.itemNumber}'`);
      }
      
      if (filters.lifecycle) {
        whereClauses.push(`GT_Lifecycle__c = '${filters.lifecycle}'`);
      }
      
      if (whereClauses.length > 0) {
        soql += ' WHERE ' + whereClauses.join(' AND ');
      }
      
      soql += ' LIMIT 10000';
      
      const result = await this.query(soql);
      return result.records;
    } catch (error) {
      logger.logError(error, { operation: 'getProductSKUs', filters });
      throw new Error(`Failed to get product SKUs: ${error.message}`);
    }
  }
}

const service = new SalesforceService();

// Add CRUD methods to the service instance
service.getObjectTypeFromId = (recordId, username) => getObjectTypeFromId(recordId, username);
service.describeField = (objectName, fieldName, username) => describeField(objectName, fieldName, username, service);
service.createRecord = (objectType, recordData, username) => createRecord(objectType, recordData, username, service);
service.updateRecord = (recordId, recordData, username) => updateRecord(recordId, recordData, username, service);
service.deleteRecord = (recordId, username) => deleteRecord(recordId, username, service);

module.exports = service;

