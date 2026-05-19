const logger = require('../utils/logger');
const salesforceService = require('./salesforceService');
const retryService = require('./retryService');

/**
 * DataPack Chunk Service
 * Handles chunked DataPack processing for large datasets
 * Based on patterns from official Vlocity Build Tool
 */
class DataPackChunkService {
  constructor() {
    this.maxChunkSize = 5000; // Records per chunk
  }

  /**
   * Process chunked DataPack
   * @param {string} dataPackId - DataPack ID
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Complete DataPack data
   */
  async processChunkedDataPack(dataPackId, username) {
    try {
      logger.info('Processing chunked DataPack', { dataPackId, username });

      // Get initial DataPack data
      const initialData = await this.getInitialDataPack(dataPackId, username);
      
      if (!initialData.isChunked) {
        // Not chunked, return as-is
        return initialData;
      }

      const chunks = initialData.chunkKeys || [];
      if (chunks.length === 0) {
        logger.warn('DataPack is marked as chunked but no chunks found', { dataPackId });
        return initialData;
      }

      const allDataPacks = [];
      
      // Process chunks in parallel (with limit to avoid overwhelming API)
      const concurrency = 5;
      const chunkPromises = [];
      
      for (let i = 0; i < chunks.length; i += concurrency) {
        const chunkBatch = chunks.slice(i, i + concurrency);
        
        const batchPromises = chunkBatch.map(chunkKey =>
          this.getChunk(dataPackId, chunkKey, username)
        );
        
        const batchResults = await Promise.all(batchPromises);
        
        batchResults.forEach(result => {
          if (result && result.dataPacks) {
            allDataPacks.push(...result.dataPacks);
          }
        });
      }
      
      logger.info('All chunks retrieved', { 
        dataPackId, 
        totalChunks: chunks.length, 
        totalDataPacks: allDataPacks.length 
      });

      return {
        ...initialData,
        dataPacks: allDataPacks,
        isChunked: false // Mark as fully loaded
      };
    } catch (error) {
      logger.error('Failed to process chunked DataPack', { 
        dataPackId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get initial DataPack data
   * @param {string} dataPackId - DataPack ID
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Initial DataPack data
   */
  async getInitialDataPack(dataPackId, username) {
    await salesforceService.authenticateWithSfdx(username);
    
    const endpoint = `/services/apexrest/v1/VlocityDataPacks/${dataPackId}`;
    
    return retryService.executeWithRetry(
      async () => {
        const response = await salesforceService.jsforceConnection.apex.get(endpoint);
        return JSON.parse(response);
      },
      {
        operation: 'getInitialDataPack',
        dataPackId
      }
    );
  }

  /**
   * Get a specific chunk
   * @param {string} dataPackId - DataPack ID
   * @param {string} chunkKey - Chunk key
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Chunk data
   */
  async getChunk(dataPackId, chunkKey, username) {
    try {
      await salesforceService.authenticateWithSfdx(username);
      
      // Method 1: Try API endpoint
      const endpoint = `/services/apexrest/v1/VlocityDataPacks/${dataPackId}?chunks=${encodeURIComponent(chunkKey)}`;
      
      return retryService.executeWithRetry(
        async () => {
          try {
            const response = await salesforceService.jsforceConnection.apex.get(endpoint);
            return JSON.parse(response);
          } catch (err) {
            // Fallback: Try Attachment method
            if (err.errorCode === 'NOT_FOUND' || err.statusCode === 404) {
              return await this.getChunkFromAttachment(dataPackId, chunkKey, username);
            }
            throw err;
          }
        },
        {
          operation: 'getChunk',
          dataPackId,
          chunkKey
        }
      );
    } catch (error) {
      logger.error('Failed to get chunk', { 
        dataPackId, 
        chunkKey, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Get chunk from Attachment (fallback method)
   * @param {string} dataPackId - DataPack ID
   * @param {string} chunkKey - Chunk key
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Chunk data
   */
  async getChunkFromAttachment(dataPackId, chunkKey, username) {
    await salesforceService.authenticateWithSfdx(username);
    
    const soql = `SELECT Body FROM Attachment WHERE Name = '${chunkKey}' AND ParentId = '${dataPackId}'`;
    
    const queryResult = await salesforceService.query(soql);
    
    if (queryResult.records && queryResult.records[0]) {
      const attachment = queryResult.records[0];
      
      // Request the attachment body
      const bodyUrl = attachment.Body;
      const response = await salesforceService.jsforceConnection.request(bodyUrl);
      
      // Parse and namespace-replace
      const namespace = salesforceService.namespace || '';
      const chunkResult = JSON.parse(
        response.replace(new RegExp(namespace, 'g'), '%vlocity_namespace%')
      );
      
      return chunkResult;
    }
    
    throw new Error(`Chunk not found: ${chunkKey}`);
  }

  /**
   * Check if DataPack needs chunking
   * @param {Object} dataPackData - DataPack data
   * @returns {boolean} True if chunking is needed
   */
  needsChunking(dataPackData) {
    if (!dataPackData || !dataPackData.dataPacks) {
      return false;
    }

    const totalSize = JSON.stringify(dataPackData).length;
    return totalSize > (this.maxChunkSize * 1000); // Rough estimate
  }
}

module.exports = new DataPackChunkService();

