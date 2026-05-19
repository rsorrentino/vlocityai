const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Salesforce API Service
 * Handles core Salesforce API integration and authentication
 */
class SalesforceApiService {
  constructor() {
    this.baseUrl = process.env.SALESFORCE_BASE_URL || 'https://login.salesforce.com';
    this.apiVersion = process.env.SALESFORCE_API_VERSION || 'v58.0';
    this.timeout = parseInt(process.env.SALESFORCE_API_TIMEOUT) || 30000;
    this.retryAttempts = parseInt(process.env.SALESFORCE_RETRY_ATTEMPTS) || 3;
    this.retryDelay = parseInt(process.env.SALESFORCE_RETRY_DELAY) || 1000;
    
    // Token cache
    this.tokenCache = new Map();
    this.tokenExpiry = new Map();
  }

  /**
   * Get access token for a username
   */
  async getAccessToken(username, password, securityToken = null, isSandbox = false) {
    const cacheKey = `${username}_${isSandbox ? 'sandbox' : 'production'}`;
    
    // Check cache first
    if (this.tokenCache.has(cacheKey) && this.isTokenValid(cacheKey)) {
      return this.tokenCache.get(cacheKey);
    }

    try {
      const loginUrl = isSandbox ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
      const authData = {
        grant_type: 'password',
        client_id: process.env.SALESFORCE_CLIENT_ID,
        client_secret: process.env.SALESFORCE_CLIENT_SECRET,
        username: username,
        password: password + (securityToken || '')
      };

      const response = await axios.post(`${loginUrl}/services/oauth2/token`, authData, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.timeout
      });

      const tokenData = response.data;
      
      // Cache the token
      this.tokenCache.set(cacheKey, tokenData);
      this.tokenExpiry.set(cacheKey, Date.now() + (tokenData.expires_in * 1000));
      
      logger.log('info', 'Salesforce access token obtained', {
        username,
        isSandbox,
        expiresIn: tokenData.expires_in,
        service: 'salesforceApiService'
      });

      return tokenData;
    } catch (error) {
      logger.logError(error, {
        operation: 'getAccessToken',
        username,
        isSandbox,
        service: 'salesforceApiService'
      });
      throw new Error(`Failed to get access token: ${error.response?.data?.error_description || error.message}`);
    }
  }

  /**
   * Check if cached token is still valid
   */
  isTokenValid(cacheKey) {
    const expiry = this.tokenExpiry.get(cacheKey);
    return expiry && Date.now() < expiry - 60000; // 1 minute buffer
  }

  /**
   * Get API headers with authentication
   */
  async getApiHeaders(username, isSandbox = false) {
    const tokenData = await this.getCachedToken(username, isSandbox);
    
    return {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Get cached token or refresh if needed
   */
  async getCachedToken(username, isSandbox = false) {
    const cacheKey = `${username}_${isSandbox ? 'sandbox' : 'production'}`;
    
    if (this.tokenCache.has(cacheKey) && this.isTokenValid(cacheKey)) {
      return this.tokenCache.get(cacheKey);
    }
    
    throw new Error('No valid token found. Please authenticate first.');
  }

  /**
   * Make authenticated API request with retry logic
   */
  async makeApiRequest(method, endpoint, data = null, username = null, isSandbox = false, retryCount = 0) {
    try {
      const headers = username ? await this.getApiHeaders(username, isSandbox) : {};
      const instanceUrl = username ? await this.getInstanceUrl(username, isSandbox) : this.baseUrl;
      
      const config = {
        method,
        url: `${instanceUrl}${endpoint}`,
        headers,
        timeout: this.timeout
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      
      logger.logDebug('Salesforce API request successful', {
        method,
        endpoint,
        status: response.status,
        username,
        service: 'salesforceApiService'
      });

      return response.data;
    } catch (error) {
      if (error.response?.status === 401 && retryCount < this.retryAttempts) {
        // Token might be expired, clear cache and retry
        const cacheKey = `${username}_${isSandbox ? 'sandbox' : 'production'}`;
        this.tokenCache.delete(cacheKey);
        this.tokenExpiry.delete(cacheKey);
        
        logger.log('info', 'Token expired, retrying request', {
          method,
          endpoint,
          retryCount: retryCount + 1,
          username,
          service: 'salesforceApiService'
        });
        
        return this.makeApiRequest(method, endpoint, data, username, isSandbox, retryCount + 1);
      }
      
      logger.logError(error, {
        operation: 'makeApiRequest',
        method,
        endpoint,
        username,
        retryCount,
        service: 'salesforceApiService'
      });
      
      throw error;
    }
  }

  /**
   * Get instance URL for a username
   */
  async getInstanceUrl(username, isSandbox = false) {
    const tokenData = await this.getCachedToken(username, isSandbox);
    return tokenData.instance_url;
  }

  /**
   * Query Salesforce records
   */
  async query(soql, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/query/?q=${encodeURIComponent(soql)}`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce query executed', {
      soql,
      recordCount: result.records?.length || 0,
      totalSize: result.totalSize,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Get Salesforce object metadata
   */
  async getObjectMetadata(objectName, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/sobjects/${objectName}/describe/`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce object metadata retrieved', {
      objectName,
      fieldCount: result.fields?.length || 0,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Create Salesforce record
   */
  async createRecord(objectName, recordData, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/sobjects/${objectName}/`;
    
    const result = await this.makeApiRequest('POST', endpoint, recordData, username, isSandbox);
    
    logger.log('info', 'Salesforce record created', {
      objectName,
      recordId: result.id,
      success: result.success,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Update Salesforce record
   */
  async updateRecord(objectName, recordId, recordData, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/sobjects/${objectName}/${recordId}`;
    
    const result = await this.makeApiRequest('PATCH', endpoint, recordData, username, isSandbox);
    
    logger.log('info', 'Salesforce record updated', {
      objectName,
      recordId,
      success: result.success,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Delete Salesforce record
   */
  async deleteRecord(objectName, recordId, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/sobjects/${objectName}/${recordId}`;
    
    const result = await this.makeApiRequest('DELETE', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce record deleted', {
      objectName,
      recordId,
      success: result.success,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Get Salesforce user info
   */
  async getUserInfo(username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/identity`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce user info retrieved', {
      userId: result.user_id,
      organizationId: result.organization_id,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Get Salesforce organization info
   */
  async getOrganizationInfo(username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/sobjects/Organization/describe/`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce organization info retrieved', {
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Execute Salesforce Apex
   */
  async executeApex(apexCode, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/tooling/executeAnonymous/?anonymousBody=${encodeURIComponent(apexCode)}`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce Apex executed', {
      apexCode: apexCode.substring(0, 100) + '...',
      success: result.success,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Get Salesforce limits
   */
  async getLimits(username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/limits/`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce limits retrieved', {
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Search Salesforce using SOSL
   */
  async search(sosl, username, isSandbox = false) {
    const endpoint = `/services/data/${this.apiVersion}/search/?q=${encodeURIComponent(sosl)}`;
    
    const result = await this.makeApiRequest('GET', endpoint, null, username, isSandbox);
    
    logger.log('info', 'Salesforce search executed', {
      sosl,
      recordCount: result.searchRecords?.length || 0,
      username,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Get Salesforce API versions
   */
  async getApiVersions() {
    const endpoint = '/services/data/';
    
    const result = await this.makeApiRequest('GET', endpoint);
    
    logger.log('info', 'Salesforce API versions retrieved', {
      versionCount: result.length,
      service: 'salesforceApiService'
    });

    return result;
  }

  /**
   * Validate Salesforce connection
   */
  async validateConnection(username, isSandbox = false) {
    try {
      const userInfo = await this.getUserInfo(username, isSandbox);
      const limits = await this.getLimits(username, isSandbox);
      
      return {
        valid: true,
        userInfo,
        limits,
        message: 'Connection validated successfully'
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        message: 'Connection validation failed'
      };
    }
  }

  /**
   * Clear token cache
   */
  clearTokenCache() {
    this.tokenCache.clear();
    this.tokenExpiry.clear();
    
    logger.log('info', 'Salesforce token cache cleared', {
      service: 'salesforceApiService'
    });
  }

  /**
   * Get service statistics
   */
  getServiceStats() {
    return {
      cachedTokens: this.tokenCache.size,
      apiVersion: this.apiVersion,
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      service: 'salesforceApiService'
    };
  }
}

// Create singleton instance
const salesforceApiService = new SalesforceApiService();

module.exports = salesforceApiService;
