const { spawn } = require('child_process');
const logger = require('../utils/logger');

/**
 * Service for querying Salesforce metadata and resolving object information
 */
class SalesforceMetadataService {
  /**
   * Resolve Salesforce ID prefixes to SObject API names
   * @param {Array<string>} ids - Array of Salesforce IDs
   * @param {string} username - Salesforce username
   * @returns {Promise<Map>} Map of prefix -> objectName
   */
  async resolveIdPrefixes(ids, username) {
    try {
      if (!ids || ids.length === 0) {
        return new Map();
      }

      // Extract unique 3-char prefixes
      const prefixes = new Set();
      ids.forEach(id => {
        if (id && id.length >= 3) {
          prefixes.add(id.substring(0, 3));
        }
      });

      logger.info(`Resolving ${prefixes.size} unique ID prefixes for ${ids.length} IDs`);

      // Query Salesforce in chunks of 200 prefixes (SOQL IN clause limit)
      const prefixArray = Array.from(prefixes);
      const prefixMap = new Map();
      const chunkSize = 200;

      for (let i = 0; i < prefixArray.length; i += chunkSize) {
        const chunk = prefixArray.slice(i, i + chunkSize);
        const chunkResults = await this.queryPrefixChunk(chunk, username);
        
        chunkResults.forEach((objectName, prefix) => {
          prefixMap.set(prefix, objectName);
        });
      }

      logger.info(`Resolved ${prefixMap.size} prefixes to object names`);
      return prefixMap;
    } catch (error) {
      logger.logError(error, { operation: 'resolveIdPrefixes', username, idCount: ids.length });
      throw error;
    }
  }

  /**
   * Query a chunk of prefixes using Salesforce CLI
   * @param {Array<string>} prefixes - Array of 3-char prefixes
   * @param {string} username - Salesforce username
   * @returns {Promise<Map>} Map of prefix -> objectName
   */
  async queryPrefixChunk(prefixes, username) {
    return new Promise((resolve, reject) => {
      // Build SOQL query
      const prefixList = prefixes.map(p => `'${p}'`).join(',');
      const soql = `SELECT QualifiedApiName, KeyPrefix FROM EntityDefinition WHERE KeyPrefix IN (${prefixList})`;

      logger.info(`Querying ${prefixes.length} prefixes via SF CLI`);

      // Execute SF CLI query — pass SOQL as a quoted shell string to avoid
      // Windows splitting on spaces/commas inside the value
      const quotedSoql = `"${soql.replace(/"/g, '\\"')}"`;
      const cmd = `sf data query --query ${quotedSoql} --target-org ${username} --result-format json`;

      const child = spawn(cmd, [], {
        cwd: process.cwd(),
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
        if (code !== 0) {
          logger.error(`SF CLI query failed with code ${code}`, { stderr });
          reject(new Error(`SF CLI query failed: ${stderr}`));
          return;
        }

        try {
          // Strip ANSI color codes before parsing — SF CLI colorizes output even with --result-format json
          // eslint-disable-next-line no-control-regex
          const cleanStdout = stdout.replace(/\x1b\[[0-9;]*m/g, '').replace(/\u001b\[[0-9;]*m/g, '');
          const result = JSON.parse(cleanStdout);
          const prefixMap = new Map();

          if (result.result && result.result.records) {
            result.result.records.forEach(record => {
              if (record.KeyPrefix && record.QualifiedApiName) {
                prefixMap.set(record.KeyPrefix, record.QualifiedApiName);
              }
            });
          }

          logger.info(`Resolved ${prefixMap.size} prefixes in chunk`);
          resolve(prefixMap);
        } catch (error) {
          logger.logError(error, { operation: 'parsePrefixQueryResult', stdout });
          reject(error);
        }
      });

      child.on('error', (error) => {
        logger.logError(error, { operation: 'queryPrefixChunk' });
        reject(error);
      });
    });
  }

  /**
   * Map Salesforce IDs to their object types
   * @param {Array<string>} ids - Array of Salesforce IDs
   * @param {Map} prefixMap - Map of prefix -> objectName
   * @returns {Map} Map of objectName -> Array of IDs
   */
  mapIdsToObjects(ids, prefixMap) {
    const objectMap = new Map();

    ids.forEach(id => {
      if (!id || id.length < 3) return;

      const prefix = id.substring(0, 3);
      const objectName = prefixMap.get(prefix);

      if (objectName) {
        if (!objectMap.has(objectName)) {
          objectMap.set(objectName, []);
        }
        objectMap.get(objectName).push(id);
      } else {
        logger.warn(`No object mapping found for prefix: ${prefix} (ID: ${id})`);
      }
    });

    logger.info(`Mapped ${ids.length} IDs to ${objectMap.size} object types`);
    return objectMap;
  }

  /**
   * Query Salesforce for record information
   * @param {string} objectName - SObject API name
   * @param {Array<string>} ids - Array of record IDs
   * @param {string} username - Salesforce username
   * @param {Array<string>} fields - Fields to query (default: ['Id', 'Name'])
   * @returns {Promise<Array>} Array of records
   */
  async queryRecords(objectName, ids, username, fields = ['Id', 'Name']) {
    return new Promise((resolve, reject) => {
      if (!ids || ids.length === 0) {
        resolve([]);
        return;
      }

      // Chunk IDs to avoid SOQL IN clause limits (1000 max)
      const chunkSize = 1000;
      const allRecords = [];

      const processChunk = async (chunk) => {
        const idList = chunk.map(id => `'${id}'`).join(',');
        const fieldList = fields.join(', ');
        const soql = `SELECT ${fieldList} FROM ${objectName} WHERE Id IN (${idList})`;

        const args = ['data', 'query', '--query', soql, '--target-org', username, '--result-format', 'json'];
        
        const child = spawn('sf', args, {
          cwd: process.cwd(),
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
          if (code !== 0) {
            logger.error(`SF CLI query failed for ${objectName}`, { stderr });
            resolve([]);
            return;
          }

          try {
            const result = JSON.parse(stdout);
            if (result.result && result.result.records) {
              allRecords.push(...result.result.records);
            }
          } catch (error) {
            logger.logError(error, { operation: 'queryRecords', objectName });
          }
        });
      };

      // Process all chunks
      (async () => {
        for (let i = 0; i < ids.length; i += chunkSize) {
          const chunk = ids.slice(i, i + chunkSize);
          await processChunk(chunk);
        }
        resolve(allRecords);
      })();
    });
  }

  /**
   * Get object information from Salesforce
   * @param {string} objectName - SObject API name
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Object metadata
   */
  async getObjectInfo(objectName, username) {
    return new Promise((resolve, reject) => {
      const soql = `SELECT QualifiedApiName, Label, KeyPrefix, IsCustomizable FROM EntityDefinition WHERE QualifiedApiName = '${objectName}'`;

      const args = ['data', 'query', '--query', soql, '--target-org', username, '--result-format', 'json'];
      
      const child = spawn('sf', args, {
        cwd: process.cwd(),
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
        if (code !== 0) {
          reject(new Error(`SF CLI query failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          if (result.result && result.result.records && result.result.records.length > 0) {
            resolve(result.result.records[0]);
          } else {
            resolve(null);
          }
        } catch (error) {
          reject(error);
        }
      });

      child.on('error', (error) => {
        reject(error);
      });
    });
  }
}

module.exports = new SalesforceMetadataService();

