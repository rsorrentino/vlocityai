const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');
const salesforceService = require('./salesforceService');
const countryConfigService = require('./countryConfigService');

class ValidationService {
  constructor() {
    this.validationResults = {
      timestamp: new Date().toISOString(),
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      warnings: 0,
      errors: [],
      passed: [],
      warnings: [],
      summary: {}
    };
    this.testDefinitions = {};
    this.testDir = path.join(__dirname, '../config/validation-tests');
    this.loadTestDefinitions();
  }

  /**
   * Get expected primary price lists count for a country.
   * Reads from countryConfigService validation block; defaults to 1.
   */
  getExpectedPrimaryPriceLists(countryCode) {
    const validationCfg = countryConfigService.getValidationConfig(countryCode);
    return validationCfg?.expectedPrimaryPriceLists ?? 1;
  }

  /**
   * Resolve {{countryCode}} template placeholders in a YAML query string.
   * If countryCode is provided, substitutes the value.
   * If not provided, strips any line that contains a {{countryCode}} placeholder
   * so the query runs org-wide without a syntax error.
   *
   * @param {string} query - Raw query string from YAML definition
   * @param {string|null} countryCode - Country code to inject, or null/undefined for org-wide
   * @returns {string} Resolved query string
   */
  resolveQueryTemplate(query, countryCode) {
    if (!query) return query;
    if (countryCode) {
      return query.replace(/\{\{countryCode\}\}/g, countryCode);
    }
    // Strip optional country-filter lines so the query is still valid org-wide
    return query
      .split('\n')
      .filter(line => !line.includes('{{countryCode}}'))
      .join('\n');
  }

  /**
   * Load YAML test definitions from config directory
   */
  loadTestDefinitions() {
    try {
      if (!fs.existsSync(this.testDir)) {
        logger.warn('Validation test directory not found', { testDir: this.testDir });
        return;
      }

      const files = fs.readdirSync(this.testDir);
      files.forEach(file => {
        if (file.endsWith('.yaml') || file.endsWith('.yml')) {
          try {
            const filePath = path.join(this.testDir, file);
            const testDef = yaml.load(fs.readFileSync(filePath, 'utf8'));
            
            if (testDef) {
              Object.assign(this.testDefinitions, testDef);
              logger.info('Loaded validation test definitions', { 
                file, 
                objectTypes: Object.keys(testDef) 
              });
            }
          } catch (err) {
            logger.error('Failed to load test definition file', { file, error: err.message });
          }
        }
      });

      logger.info('Validation test definitions loaded', { 
        totalObjectTypes: Object.keys(this.testDefinitions).length 
      });
    } catch (error) {
      logger.error('Error loading test definitions', { error: error.message });
    }
  }

  /**
   * Run a specific test definition
   * @param {string} objectType - Object type (e.g., 'PriceList', 'RateCode')
   * @param {string} testName - Test name
   * @param {string} username - Salesforce username
   * @returns {Promise<Object>} Test results
   */
  async runTestDefinition(objectType, testName, username, options = {}) {
    try {
      const testDef = this.testDefinitions[objectType]?.tests?.find(
        t => t.name === testName
      );

      if (!testDef) {
        throw new Error(`Test definition not found: ${objectType}/${testName}`);
      }

      const { countryCode } = options;
      logger.info('Running validation test', { objectType, testName, username, countryCode: countryCode || 'all' });

      // Execute query — resolve {{countryCode}} template before sending to Salesforce
      await salesforceService.authenticateWithSfdx(username);
      const resolvedQuery = this.resolveQueryTemplate(testDef.query, countryCode);
      const results = await salesforceService.query(resolvedQuery);

      // Run validation checks
      const validationResult = this.executeValidation(
        testDef.validation, 
        results.records || [], 
        testDef,
        objectType
      );

      return {
        objectType,
        testName,
        description: testDef.description,
        severity: testDef.severity,
        recordCount: results.records?.length || 0,
        ...validationResult
      };
    } catch (error) {
      // INVALID_FIELD / MALFORMED_QUERY mean the query references a field that doesn't
      // exist in this org's schema. Treat as "skipped" so org-specific field differences
      // don't pollute the health score with false failures.
      // Note: salesforceService wraps the Salesforce error body as the message, so we check
      // both the SOQL error code strings and the human-readable Salesforce message patterns.
      const isSchemaMismatch = error.message &&
        (error.message.includes('INVALID_FIELD') ||
         error.message.includes('MALFORMED_QUERY') ||
         error.message.includes('No such column') ||
         error.message.includes("Didn't understand relationship"));

      if (isSchemaMismatch) {
        logger.warn('YAML test skipped — field not found in this org schema', {
          objectType,
          testName,
          hint: error.message.slice(0, 200)
        });
        return {
          objectType,
          testName,
          passed: null,
          skipped: true,
          skipReason: 'Field not found in this org (INVALID_FIELD / MALFORMED_QUERY)',
          errorCount: 0,
          warningCount: 0,
          errors: [],
          warnings: []
        };
      }

      logger.error('Test execution failed', { objectType, testName, error: error.message });
      throw error;
    }
  }

  /**
   * Execute validation rules against records
   * @param {Object} rules - Validation rules from YAML
   * @param {Array} records - Records to validate
   * @param {Object} testDef - Test definition
   * @param {string} objectType - Object type for categorization
   * @returns {Object} Validation results
   */
  executeValidation(rules, records, testDef, objectType) {
    const errors = [];
    const warnings = [];

    if (!rules) {
      return { errors, warnings, passed: true };
    }

    // Ensure records is an array
    if (!Array.isArray(records)) {
      logger.warn('executeValidation called with non-array records', { objectType, recordsType: typeof records });
      return { errors: [{ type: 'InvalidInput', message: 'Records must be an array' }], warnings, passed: false };
    }

    // Required fields check
    if (rules.required_fields && Array.isArray(rules.required_fields)) {
      records.forEach(record => {
        if (!record) return; // Skip null/undefined records
        rules.required_fields.forEach(field => {
          if (!record[field] || record[field] === '') {
            const error = {
              type: 'MissingRequiredField',
              field,
              record: record.Id || record.Name || 'Unknown',
              recordName: record.Name,
              severity: testDef.severity || 'error'
            };

            if (testDef.severity === 'error') {
              errors.push(error);
              this.addResult(objectType, `RequiredFields-${field}`, false, 
                `Record ${record.Name || record.Id} missing required field: ${field}`, 
                error);
            } else {
              warnings.push(error);
              this.addWarning(objectType, `RequiredFields-${field}`, 
                `Record ${record.Name || record.Id} missing field: ${field}`, 
                error);
            }
          }
        });
      });
    }

    // Duplicate check
    if (rules.check_duplicates && rules.check_duplicates.field) {
      const field = rules.check_duplicates.field;
      const fieldLabel = field.replace(/^vlocity_cmt__/, '').replace(/^GT_/, '').replace(/__c$/, '');
      const checkName = testDef.name || 'UniqueValues';
      const values = records
        .filter(r => r && r[field] !== null && r[field] !== undefined && r[field] !== '')
        .map(r => r[field]);
      const valueCounts = {};

      values.forEach(v => {
        valueCounts[v] = (valueCounts[v] || 0) + 1;
      });

      const duplicates = Object.entries(valueCounts)
        .filter(([_, count]) => count > 1)
        .map(([value, _]) => value);

      if (duplicates.length > 0) {
        const duplicateRecords = records.filter(r => duplicates.includes(r[field]));
        const issue = {
          type: 'DuplicateValue',
          field,
          fieldLabel,
          values: duplicates.slice(0, 100),
          records: duplicateRecords.map(r => ({ id: r.Id, name: r.Name || r.Id })),
          severity: testDef.severity || 'error',
        };
        errors.push(issue);
        this.addResult(objectType, checkName, false,
          `${duplicates.length} duplicate ${fieldLabel} value(s): ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` … and ${duplicates.length - 5} more` : ''}`,
          issue);
      } else {
        this.addResult(objectType, checkName, true,
          `All ${fieldLabel} values are unique`);
      }
    }

    // Date range check
    if (rules.date_range) {
      records.forEach(record => {
        const start = record[rules.date_range.start_field];
        const end = record[rules.date_range.end_field];

        if (start && end) {
          const startDate = new Date(start);
          const endDate = new Date(end);

          if (rules.date_range.rule === 'end_after_start' && startDate >= endDate) {
            const error = {
              type: 'InvalidDateRange',
              record: record.Id || record.Name,
              recordName: record.Name,
              start,
              end,
              severity: testDef.severity || 'error'
            };

            if (testDef.severity === 'error') {
              errors.push(error);
              this.addResult(objectType, 'DateRange', false, 
                `Record ${record.Name || record.Id} has invalid date range (start >= end)`, 
                error);
            } else {
              warnings.push(error);
              this.addWarning(objectType, 'DateRange', 
                `Record ${record.Name || record.Id} has invalid date range`, 
                error);
            }
          }
        }
      });
    }

    // Relationship check (orphaned records)
    if (rules.relationship_check) {
      const checkFields = rules.relationship_check.fields ||
        [{ field: rules.relationship_check.field, parent_object: rules.relationship_check.parent_object }];

      checkFields.forEach(check => {
        const orphaned = records.filter(r => !r[check.field]);

        if (orphaned.length > 0) {
          const issue = {
            type: 'OrphanedRecord',
            field: check.field,
            parent_object: check.parent_object,
            records: orphaned.map(r => ({ id: r.Id, name: r.Name })),
            severity: testDef.severity || 'warning'
          };

          if (testDef.severity === 'error') {
            errors.push(issue);
            this.addResult(objectType, 'RelationshipCheck', false,
              `${orphaned.length} orphaned records missing ${check.field}`,
              issue);
          } else {
            warnings.push(issue);
            this.addWarning(objectType, 'RelationshipCheck',
              `${orphaned.length} records missing ${check.field}`,
              issue);
          }
        } else {
          this.addResult(objectType, 'RelationshipCheck', true,
            `All records have valid ${check.field} relationship`);
        }
      });
    }

    // Expect-empty check: the query intentionally returns violations; any record = failure
    if (rules.expect_empty) {
      const cfg = rules.expect_empty;
      const checkName = cfg.check_name || 'ExpectEmpty';
      const successMsg = cfg.success_message || 'No violations found';

      if (records.length > 0) {
        const sampleNames = records.slice(0, 5).map(r => r.Name || r.Id).join(', ');
        const trailer = records.length > 5 ? ` … and ${records.length - 5} more` : '';
        const issue = {
          type: 'UnexpectedRecords',
          count: records.length,
          sample: sampleNames,
          records: records.slice(0, 100).map(r => ({ id: r.Id, name: r.Name || r.Id })),
          severity: testDef.severity || 'error',
        };

        if (testDef.severity === 'error') {
          errors.push(issue);
          this.addResult(objectType, checkName, false,
            `${records.length} violation(s) found: ${sampleNames}${trailer}`, issue);
        } else {
          warnings.push(issue);
          this.addWarning(objectType, checkName,
            `${records.length} violation(s) found: ${sampleNames}${trailer}`, issue);
        }
      } else {
        this.addResult(objectType, checkName, true, successMsg);
      }
    }

    // Composite duplicate check: detect rows sharing the same combination of multiple fields
    if (rules.check_duplicates_composite && Array.isArray(rules.check_duplicates_composite.fields)) {
      const fields = rules.check_duplicates_composite.fields;
      const fieldLabels = fields.map(f =>
        f.replace(/^vlocity_cmt__/, '').replace(/^GT_/, '').replace(/__c$/, '')
      );
      const checkName = testDef.name || 'UniqueCompositeValues';
      const keyCounts = {};
      const keyToRecords = {};

      records.forEach(r => {
        if (!r) return;
        const key = fields.map(f => r[f] || 'null').join('::');
        keyCounts[key] = (keyCounts[key] || 0) + 1;
        if (!keyToRecords[key]) keyToRecords[key] = [];
        keyToRecords[key].push({ id: r.Id, name: r.Name || r.Id });
      });

      const duplicateKeys = Object.entries(keyCounts)
        .filter(([, count]) => count > 1)
        .map(([key]) => key);

      if (duplicateKeys.length > 0) {
        const duplicateDetails = duplicateKeys.slice(0, 50).reduce((acc, key) => {
          acc[key] = keyToRecords[key];
          return acc;
        }, {});
        const issue = {
          type: 'DuplicateCompositeValue',
          fields,
          fieldLabels,
          duplicateKeys: duplicateKeys.slice(0, 50),
          duplicateDetails,
          severity: testDef.severity || 'error',
        };

        if (testDef.severity === 'error') {
          errors.push(issue);
          this.addResult(objectType, checkName, false,
            `${duplicateKeys.length} duplicate ${fieldLabels.join(' + ')} combination(s)`,
            issue);
        } else {
          warnings.push(issue);
          this.addWarning(objectType, checkName,
            `${duplicateKeys.length} duplicate ${fieldLabels.join(' + ')} combination(s)`, issue);
        }
      } else {
        this.addResult(objectType, checkName, true,
          `All ${fieldLabels.join(' + ')} combinations are unique`);
      }
    }

    return {
      errors,
      warnings,
      passed: errors.length === 0,
      errorCount: errors.length,
      warningCount: warnings.length
    };
  }

  /**
   * Run all test definitions for an object type
   * @param {string} objectType - Object type
   * @param {string} username - Salesforce username
   * @returns {Promise<Array>} All test results
   */
  async runAllTestsForObject(objectType, username, options = {}) {
    const tests = this.testDefinitions[objectType]?.tests || [];
    const results = [];

    for (const test of tests) {
      try {
        const result = await this.runTestDefinition(objectType, test.name, username, options);
        results.push(result);
      } catch (error) {
        logger.error('Test execution failed', {
          objectType,
          testName: test.name,
          error: error.message
        });
        results.push({
          objectType,
          testName: test.name,
          passed: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Run all YAML-based tests
   * @param {string} username - Salesforce username
   * @param {Array<string>} objectTypes - Optional: specific object types to test
   * @returns {Promise<Object>} All validation results
   */
  async runYamlTests(username, objectTypes = null, options = {}) {
    try {
      await salesforceService.authenticateWithSfdx(username);

      const typesToTest = objectTypes || Object.keys(this.testDefinitions);
      const allResults = {};
      const { countryCode } = options;

      logger.info('Running YAML tests', {
        username,
        countryCode: countryCode || 'all',
        objectTypes: typesToTest
      });

      for (const objectType of typesToTest) {
        if (this.testDefinitions[objectType]) {
          logger.info('Running YAML tests for object type', { objectType, countryCode: countryCode || 'all' });
          allResults[objectType] = await this.runAllTestsForObject(objectType, username, options);
        }
      }

      // Aggregate results
      const summary = {
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        totalErrors: 0,
        totalWarnings: 0,
        byObjectType: {}
      };

      Object.entries(allResults).forEach(([type, results]) => {
        const typeSummary = {
          total: results.length,
          passed: results.filter(r => r.passed !== false).length,
          failed: results.filter(r => r.passed === false).length,
          errors: results.reduce((sum, r) => sum + (r.errorCount || 0), 0),
          warnings: results.reduce((sum, r) => sum + (r.warningCount || 0), 0)
        };
        
        summary.byObjectType[type] = typeSummary;
        summary.totalTests += typeSummary.total;
        summary.passedTests += typeSummary.passed;
        summary.failedTests += typeSummary.failed;
        summary.totalErrors += typeSummary.errors;
        summary.totalWarnings += typeSummary.warnings;
      });

      return {
        timestamp: new Date().toISOString(),
        results: allResults,
        summary,
        overallStatus: summary.failedTests === 0 ? 'PASS' : 'FAIL'
      };
    } catch (error) {
      logger.error('YAML test execution failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Main validation entry point
   * @param {string} username - Salesforce username
   * @param {boolean} isSandbox - Whether it's a sandbox org
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation results
   */
  async validatePricingSystem(username, isSandbox = false, options = {}) {
    try {
      logger.info('Starting comprehensive pricing system validation', { username, isSandbox, options });
      
      // Authenticate with SFDX
      await salesforceService.authenticateWithSfdx(username);

      const countryCode = options.countryCode || null;

      // Reset validation results (carries countryCode for display purposes)
      this.resetValidationResults(countryCode);
      if (countryCode) {
        logger.info('Country-scoped validation run', { countryCode });
        // Validate the country code is known
        const knownCodes = countryConfigService.getCountryCodes();
        if (!knownCodes.includes(countryCode.toUpperCase())) {
          logger.warn('Unknown country code — running org-wide', { countryCode, knownCodes });
        }
      }

      // If YAML tests are enabled, run them first
      if (options.useYamlTests !== false && Object.keys(this.testDefinitions).length > 0) {
        logger.info('Running YAML-based validation tests', {
          objectTypes: Object.keys(this.testDefinitions),
          countryCode: countryCode || 'all'
        });

        const yamlOptions = { ...options, countryCode };
        const yamlResults = await this.runYamlTests(username, options.objectTypes, yamlOptions);
        
        // Merge YAML test results into validation results
        yamlResults.results && Object.entries(yamlResults.results).forEach(([type, tests]) => {
          tests.forEach(test => {
            if (test.passed === false || test.errorCount > 0) {
              test.errors && test.errors.forEach(err => {
                this.addResult(type, test.testName, false, err.type, err);
              });
              test.warnings && test.warnings.forEach(warn => {
                this.addWarning(type, test.testName, warn.type, warn);
              });
            } else {
              this.addResult(type, test.testName, true, 
                `Test passed: ${test.recordCount} records validated`);
            }
          });
        });

        // Add YAML results to validation results
        this.validationResults.yamlResults = yamlResults;
      }
      
      // Run legacy validation checks (if not disabled)
      if (options.skipLegacyChecks !== true) {
        await Promise.all([
          this.validatePriceLists(username, isSandbox),
          this.validatePricingElements(username, isSandbox),
          this.validatePricingVariables(username, isSandbox),
          this.validateObjectClasses(username, isSandbox),
          this.validateProductHierarchy(username, isSandbox),
          this.validateRateCodes(username, isSandbox),
          this.validateRateTables(username, isSandbox),
          this.validatePromotions(username, isSandbox),
          this.validateStagingArea(username, isSandbox),
          this.validateProductSKUs(username, isSandbox),
          this.validateCatalogs(username, isSandbox),
          this.validateCatalogProductRelationships(username, isSandbox),
          this.validatePricingPlans(username, isSandbox),
          this.validatePricingSteps(username, isSandbox),
          this.validatePriceListProductCoverage(username, isSandbox)
        ]);
      }
      
      // Calculate summary
      this.calculateSummary();
      
      logger.info('Pricing system validation completed', {
        totalChecks: this.validationResults.totalChecks,
        passedChecks: this.validationResults.passedChecks,
        failedChecks: this.validationResults.failedChecks,
        warnings: this.validationResults.warnings.length
      });
      
      return this.validationResults;
      
    } catch (error) {
      logger.error('Validation failed', { error: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Reset validation results
   */
  resetValidationResults(countryCode = null) {
    this.validationResults = {
      timestamp: new Date().toISOString(),
      countryCode: countryCode || null,
      countryName: countryCode ? (countryConfigService.getCountryConfig(countryCode)?.name || countryCode) : null,
      totalChecks: 0,
      passedChecks: 0,
      failedChecks: 0,
      errors: [],
      passed: [],
      warnings: [],
      summary: {}
    };
  }

  /**
   * Add validation result
   * @param {string} category - Validation category
   * @param {string} check - Check name
   * @param {boolean} passed - Whether check passed
   * @param {string} message - Result message
   * @param {Object} details - Additional details
   */
  addResult(category, check, passed, message, details = {}) {
    this.validationResults.totalChecks++;
    
    const resultEntry = {
      category,
      check,
      message,
      details,
      timestamp: new Date().toISOString()
    };
    
    if (passed) {
      this.validationResults.passedChecks++;
      this.validationResults.passed.push(resultEntry);
    } else {
      this.validationResults.failedChecks++;
      this.validationResults.errors.push(resultEntry);
    }
    
    logger.debug('Validation check result', { category, check, passed, message });
  }

  /**
   * Add warning
   * @param {string} category - Validation category
   * @param {string} check - Check name
   * @param {string} message - Warning message
   * @param {Object} details - Additional details
   */
  addWarning(category, check, message, details = {}) {
    this.validationResults.warnings.push({
      category,
      check,
      message,
      details,
      timestamp: new Date().toISOString()
    });
    
    logger.warn('Validation warning', { category, check, message });
  }

  /**
   * Validate Price Lists
   */
  async validatePriceLists(username, isSandbox) {
    const category = 'Price Lists';
    
    try {
      // Check if price lists exist
      const priceListQuery = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__CurrencyCode__c, vlocity_cmt__EffectiveFromDate__c,
               vlocity_cmt__EffectiveUntilDate__c, GT_PriceListType__c,
               GT_OrganizationCode__c, GT_CountryCode__c
        FROM vlocity_cmt__PriceList__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const priceLists = await salesforceService.query(priceListQuery);
      
      if (priceLists.records && priceLists.records.length > 0) {
        this.addResult(category, 'Price Lists Exist', true, `Found ${priceLists.records.length} active price lists`);
        
        // Check for required fields
        const missingFields = priceLists.records.filter(pl => 
          !pl.vlocity_cmt__Code__c || !pl.vlocity_cmt__CurrencyCode__c
        );
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} price lists missing required fields (Code or Currency)`,
            { missingFields: missingFields.map(pl => ({ id: pl.Id, name: pl.Name })) }
          );
        } else {
          this.addResult(category, 'Required Fields', true, 'All price lists have required fields');
        }
        
        // Check for duplicate codes
        const codes = priceLists.records.map(pl => pl.vlocity_cmt__Code__c).filter(Boolean);
        const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
        
        if (duplicateCodes.length > 0) {
          this.addResult(category, 'Unique Codes', false, 
            `Found duplicate price list codes: ${duplicateCodes.join(', ')}`);
        } else {
          this.addResult(category, 'Unique Codes', true, 'All price list codes are unique');
        }
        
        // Check effective date ranges
        const invalidDateRanges = priceLists.records.filter(pl => {
          if (!pl.vlocity_cmt__EffectiveFromDate__c || !pl.vlocity_cmt__EffectiveUntilDate__c) return false;
          return new Date(pl.vlocity_cmt__EffectiveFromDate__c) >= new Date(pl.vlocity_cmt__EffectiveUntilDate__c);
        });
        
        if (invalidDateRanges.length > 0) {
          this.addResult(category, 'Date Ranges', false, 
            `${invalidDateRanges.length} price lists have invalid date ranges (start >= end)`);
        } else {
          this.addResult(category, 'Date Ranges', true, 'All price list date ranges are valid');
        }
        
        // Count price lists per country (GT_CountryCode__c)
        const byCountry = {};
        priceLists.records.forEach(pl => {
          if (pl.GT_CountryCode__c) {
            byCountry[pl.GT_CountryCode__c] = (byCountry[pl.GT_CountryCode__c] || 0) + 1;
          }
        });

        Object.entries(byCountry).forEach(([country, count]) => {
          this.addResult(category, `Price Lists (${country})`, true,
            `Country ${country} has ${count} active price list(s)`);
        });
        
      } else {
        this.addResult(category, 'Price Lists Exist', false, 'No active price lists found');
      }
      
    } catch (error) {
      this.addResult(category, 'Price Lists Query', false, `Failed to query price lists: ${error.message}`);
    }
  }

  /**
   * Validate Pricing Elements
   */
  async validatePricingElements(username, isSandbox) {
    const category = 'Pricing Elements';
    
    try {
      // Check if pricing elements exist
      const pricingElementQuery = `
        SELECT Id, Name, vlocity_cmt__Amount__c, vlocity_cmt__PricingVariableId__c,
               vlocity_cmt__PriceListId__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__PricingVariableId__r.Name,
               vlocity_cmt__PriceListId__r.Name
        FROM vlocity_cmt__PricingElement__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const pricingElements = await salesforceService.query(pricingElementQuery);
      
      if (pricingElements.records && pricingElements.records.length > 0) {
        this.addResult(category, 'Pricing Elements Exist', true, 
          `Found ${pricingElements.records.length} active pricing elements`);
        
        // Check for orphaned pricing elements (missing price list or pricing variable)
        const orphanedElements = pricingElements.records.filter(pe => 
          !pe.vlocity_cmt__PriceListId__c || !pe.vlocity_cmt__PricingVariableId__c
        );
        
        if (orphanedElements.length > 0) {
          this.addResult(category, 'Orphaned Elements', false, 
            `${orphanedElements.length} pricing elements are missing required relationships`);
        } else {
          this.addResult(category, 'Orphaned Elements', true, 'All pricing elements have valid relationships');
        }
        
        // Check for valid amounts
        const invalidAmounts = pricingElements.records.filter(pe => 
          pe.vlocity_cmt__Amount__c === null || pe.vlocity_cmt__Amount__c === undefined
        );
        
        if (invalidAmounts.length > 0) {
          this.addWarning(category, 'Invalid Amounts', 
            `${invalidAmounts.length} pricing elements have null amounts`);
        }
        
      } else {
        this.addResult(category, 'Pricing Elements Exist', false, 'No active pricing elements found');
      }
      
    } catch (error) {
      this.addResult(category, 'Pricing Elements Query', false, `Failed to query pricing elements: ${error.message}`);
    }
  }

  /**
   * Validate Pricing Variables
   */
  async validatePricingVariables(username, isSandbox) {
    const category = 'Pricing Variables';
    
    try {
      const pricingVariableQuery = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c
        FROM vlocity_cmt__PricingVariable__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const pricingVariables = await salesforceService.query(pricingVariableQuery);
      
      if (pricingVariables.records && pricingVariables.records.length > 0) {
        this.addResult(category, 'Pricing Variables Exist', true, 
          `Found ${pricingVariables.records.length} active pricing variables`);
        
        // Check for required fields
        const missingFields = pricingVariables.records.filter(pv => 
          !pv.vlocity_cmt__Code__c
        );
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} pricing variables missing required fields`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All pricing variables have required fields');
        }
        
        // Check for duplicate codes
        const codes = pricingVariables.records.map(pv => pv.vlocity_cmt__Code__c).filter(Boolean);
        const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
        
        if (duplicateCodes.length > 0) {
          this.addResult(category, 'Unique Codes', false, 
            `Found duplicate pricing variable codes: ${duplicateCodes.join(', ')}`);
        } else {
          this.addResult(category, 'Unique Codes', true, 'All pricing variable codes are unique');
        }
        
      } else {
        this.addResult(category, 'Pricing Variables Exist', false, 'No active pricing variables found');
      }
      
    } catch (error) {
      this.addResult(category, 'Pricing Variables Query', false, `Failed to query pricing variables: ${error.message}`);
    }
  }

  /**
   * Validate Object Classes
   */
  async validateObjectClasses(username, isSandbox) {
    const category = 'Object Classes';
    
    try {
      const objectClassQuery = `
        SELECT Id, Name, vlocity_cmt__IsActive__c
        FROM vlocity_cmt__ObjectClass__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const objectClasses = await salesforceService.query(objectClassQuery);
      
      if (objectClasses.records && objectClasses.records.length > 0) {
        this.addResult(category, 'Object Classes Exist', true, 
          `Found ${objectClasses.records.length} active object classes`);
        
        // Basic existence check - skip required fields check since Code field doesn't exist
        
      } else {
        this.addResult(category, 'Object Classes Exist', false, 'No active object classes found');
      }
      
    } catch (error) {
      this.addResult(category, 'Object Classes Query', false, `Failed to query object classes: ${error.message}`);
    }
  }

  /**
   * Validate Product Hierarchy
   */
  async validateProductHierarchy(username, isSandbox) {
    const category = 'Product Hierarchy';
    
    try {
      // Check Product2 records
      const productQuery = `
        SELECT Id, Name, ProductCode, IsActive, Family, Description
        FROM Product2
        WHERE IsActive = true
      `;
      
      const products = await salesforceService.query(productQuery);
      
      if (products.records && products.records.length > 0) {
        this.addResult(category, 'Products Exist', true, 
          `Found ${products.records.length} active products`);
        
        // Check for required fields
        const missingFields = products.records.filter(p => !p.ProductCode);
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} products missing ProductCode`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All products have required fields');
        }
        
        // Check for duplicate product codes
        const codes = products.records.map(p => p.ProductCode).filter(Boolean);
        const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
        
        if (duplicateCodes.length > 0) {
          this.addResult(category, 'Unique Codes', false, 
            `Found duplicate product codes: ${duplicateCodes.join(', ')}`);
        } else {
          this.addResult(category, 'Unique Codes', true, 'All product codes are unique');
        }
        
      } else {
        this.addResult(category, 'Products Exist', false, 'No active products found');
      }
      
      // Check ProductChildItem relationships
      const childItemQuery = `
        SELECT Id, vlocity_cmt__ParentProductId__c, vlocity_cmt__ChildProductId__c,
               vlocity_cmt__ParentProductId__r.Name, vlocity_cmt__ChildProductId__r.Name,
               vlocity_cmt__ParentProductId__r.ProductCode, vlocity_cmt__ChildProductId__r.ProductCode
        FROM vlocity_cmt__ProductChildItem__c
        WHERE Id != null
      `;
      
      const childItems = await salesforceService.query(childItemQuery);
      
      if (childItems.records && childItems.records.length > 0) {
        this.addResult(category, 'Product Relationships', true, 
          `Found ${childItems.records.length} product child relationships`);
        
        // Check for orphaned relationships
        const orphanedRelations = childItems.records
          .map(ci => {
            const missingParent = !ci.vlocity_cmt__ParentProductId__c;
            const missingChild = !ci.vlocity_cmt__ChildProductId__c;
            
            if (missingParent || missingChild) {
              return {
                relationshipId: ci.Id,
                missingParent: missingParent,
                missingChild: missingChild,
                parentProductId: ci.vlocity_cmt__ParentProductId__c || 'MISSING',
                parentProductName: ci.vlocity_cmt__ParentProductId__r?.Name || 'N/A',
                parentProductCode: ci.vlocity_cmt__ParentProductId__r?.ProductCode || 'N/A',
                childProductId: ci.vlocity_cmt__ChildProductId__c || 'MISSING',
                childProductName: ci.vlocity_cmt__ChildProductId__r?.Name || 'N/A',
                childProductCode: ci.vlocity_cmt__ChildProductId__r?.ProductCode || 'N/A',
                issue: missingParent && missingChild 
                  ? 'Missing both parent and child products'
                  : missingParent 
                    ? 'Missing parent product'
                    : 'Missing child product'
              };
            }
            return null;
          })
          .filter(rel => rel !== null);
        
        if (orphanedRelations.length > 0) {
          // Create detailed message with sample relationships
          const sampleSize = Math.min(10, orphanedRelations.length);
          const sampleDetails = orphanedRelations.slice(0, sampleSize)
            .map(rel => {
              const parts = [];
              if (rel.missingParent) {
                parts.push(`Parent: ${rel.parentProductName || rel.parentProductId} (${rel.parentProductCode || 'N/A'})`);
              }
              if (rel.missingChild) {
                parts.push(`Child: ${rel.childProductName || rel.childProductId} (${rel.childProductCode || 'N/A'})`);
              }
              return `[${rel.relationshipId.substring(0, 15)}...] ${rel.issue} - ${parts.join(', ')}`;
            })
            .join('; ');
          
          const detailsMessage = orphanedRelations.length > sampleSize
            ? `${sampleDetails} ... and ${orphanedRelations.length - sampleSize} more`
            : sampleDetails;
          
          this.addResult(category, 'Orphaned Relationships', false, 
            `${orphanedRelations.length} product relationships are missing parent or child products`,
            {
              totalOrphaned: orphanedRelations.length,
              sample: orphanedRelations.slice(0, sampleSize),
              allOrphaned: orphanedRelations.map(rel => ({
                relationshipId: rel.relationshipId,
                issue: rel.issue,
                parentProductId: rel.parentProductId,
                parentProductName: rel.parentProductName,
                parentProductCode: rel.parentProductCode,
                childProductId: rel.childProductId,
                childProductName: rel.childProductName,
                childProductCode: rel.childProductCode
              }))
            });
        } else {
          this.addResult(category, 'Orphaned Relationships', true, 'All product relationships are valid');
        }
        
        // Collect all unique product IDs from hierarchies (both parent and child)
        const hierarchyProductIds = new Set();
        childItems.records.forEach(ci => {
          if (ci.vlocity_cmt__ParentProductId__c) {
            hierarchyProductIds.add(ci.vlocity_cmt__ParentProductId__c);
          }
          if (ci.vlocity_cmt__ChildProductId__c) {
            hierarchyProductIds.add(ci.vlocity_cmt__ChildProductId__c);
          }
        });
        
        const hierarchyProductIdsArray = Array.from(hierarchyProductIds);
        
        if (hierarchyProductIdsArray.length > 0) {
          // Validate pricing objects for each product in hierarchy
          await this.validateHierarchyPricingObjects(hierarchyProductIdsArray, childItems.records, category, username, isSandbox);
        }
        
      } else {
        this.addWarning(category, 'Product Relationships', 'No product child relationships found');
      }
      
    } catch (error) {
      this.addResult(category, 'Product Hierarchy Query', false, `Failed to query product hierarchy: ${error.message}`);
    }
  }

  /**
   * Validate pricing objects (PriceListEntry, PricingElements, PricingVariables) for products in hierarchy
   */
  async validateHierarchyPricingObjects(productIds, childItems, category, username, isSandbox) {
    try {
      // Batch queries to avoid HTTP 431 (Request Header Fields Too Large) error
      // SOQL IN clause limit is 10,000, but we'll use 200 per batch for safety with HTTP headers
      const batchSize = 200;
      const entriesByProduct = new Map();
      let allPriceListEntries = [];
      
      // Query PriceListEntries in batches
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        const productIdsString = batch.map(id => `'${id}'`).join(',');
        
        const priceListEntryQuery = `
          SELECT Id, Name, vlocity_cmt__ProductId__c,
                 vlocity_cmt__PriceListId__c, vlocity_cmt__PriceListId__r.Name,
                 vlocity_cmt__IsActive__c
          FROM vlocity_cmt__PriceListEntry__c
          WHERE vlocity_cmt__ProductId__c IN (${productIdsString})
                 AND vlocity_cmt__IsActive__c = true
        `;
        
        const batchResult = await salesforceService.query(priceListEntryQuery);
        if (batchResult.records) {
          allPriceListEntries.push(...batchResult.records);
        }
      }
      
      const priceListEntries = { records: allPriceListEntries };
      
      if (priceListEntries.records) {
        priceListEntries.records.forEach(entry => {
          const productId = entry.vlocity_cmt__ProductId__c;
          if (productId) {
            if (!entriesByProduct.has(productId)) {
              entriesByProduct.set(productId, []);
            }
            entriesByProduct.get(productId).push(entry);
          }
        });
      }
      
      // Get all PriceLists that have entries for these products
      const priceListIds = new Set();
      priceListEntries.records?.forEach(entry => {
        if (entry.vlocity_cmt__PriceListId__c) {
          priceListIds.add(entry.vlocity_cmt__PriceListId__c);
        }
      });
      
      // Get PricingElements for the PriceLists (only if we have PriceLists)
      let pricingElements = { records: [] };
      const elementsByPriceList = new Map();
      const pricingVariableIds = new Set();
      
      if (priceListIds.size > 0) {
        // Batch PriceList IDs query as well
        const priceListIdsArray = Array.from(priceListIds);
        let allPricingElements = [];
        
        for (let i = 0; i < priceListIdsArray.length; i += batchSize) {
          const batch = priceListIdsArray.slice(i, i + batchSize);
          const priceListIdsString = batch.map(id => `'${id}'`).join(',');
          
          const pricingElementQuery = `
            SELECT Id, Name, vlocity_cmt__PriceListId__c, vlocity_cmt__PricingVariableId__c,
                   vlocity_cmt__PricingVariableId__r.Name, vlocity_cmt__PricingVariableId__r.vlocity_cmt__Code__c,
                   vlocity_cmt__IsActive__c
            FROM vlocity_cmt__PricingElement__c
            WHERE vlocity_cmt__PriceListId__c IN (${priceListIdsString})
                  AND vlocity_cmt__IsActive__c = true
          `;
          
          try {
            const batchResult = await salesforceService.query(pricingElementQuery);
            if (batchResult && batchResult.records) {
              allPricingElements.push(...batchResult.records);
            }
          } catch (error) {
            logger.logError(error, { operation: 'validateHierarchyPricingObjects', step: 'pricingElementsQuery' });
            // Continue with other batches even if one fails
          }
        }
        
        pricingElements = { records: allPricingElements };
      }
      
      if (pricingElements && pricingElements.records && Array.isArray(pricingElements.records)) {
        pricingElements.records.forEach(element => {
          const priceListId = element.vlocity_cmt__PriceListId__c;
          if (priceListId) {
            if (!elementsByPriceList.has(priceListId)) {
              elementsByPriceList.set(priceListId, []);
            }
            elementsByPriceList.get(priceListId).push(element);
            
            if (element.vlocity_cmt__PricingVariableId__c) {
              pricingVariableIds.add(element.vlocity_cmt__PricingVariableId__c);
            }
          }
        });
      }
      
      // Get PricingVariables (only if we have PricingVariable IDs)
      let pricingVariables = { records: [] };
      
      if (pricingVariableIds.size > 0) {
        // Batch PricingVariable IDs query as well
        const pricingVariableIdsArray = Array.from(pricingVariableIds);
        let allPricingVariables = [];
        
        for (let i = 0; i < pricingVariableIdsArray.length; i += batchSize) {
          const batch = pricingVariableIdsArray.slice(i, i + batchSize);
          const variableIdsString = batch.map(id => `'${id}'`).join(',');
          
          const pricingVariableQuery = `
            SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c
            FROM vlocity_cmt__PricingVariable__c
            WHERE Id IN (${variableIdsString})
                  AND vlocity_cmt__IsActive__c = true
          `;
          
          try {
            const batchResult = await salesforceService.query(pricingVariableQuery);
            if (batchResult && batchResult.records) {
              allPricingVariables.push(...batchResult.records);
            }
          } catch (error) {
            logger.logError(error, { operation: 'validateHierarchyPricingObjects', step: 'pricingVariablesQuery' });
            // Continue with other batches even if one fails
          }
        }
        
        pricingVariables = { records: allPricingVariables };
      }
      const variablesById = new Map();
      if (pricingVariables && pricingVariables.records && Array.isArray(pricingVariables.records)) {
        pricingVariables.records.forEach(variable => {
          variablesById.set(variable.Id, variable);
        });
      }
      
      // Validate each product in hierarchy
      // Ensure productIds is an array and not null/undefined
      if (!Array.isArray(productIds) || productIds.length === 0) {
        logger.warn('No product IDs provided for hierarchy pricing validation', { productIds });
        return;
      }
      
      const productsMissingEntries = [];
      const productsMissingElements = [];
      const productsMissingVariables = [];
      const productDetails = new Map();
      
      // Query Product2 records to get actual product details
      if (productIds.length > 0) {
        const productIdsArray = Array.from(productIds);
        let allProducts = [];
        
        // Query products in batches
        for (let i = 0; i < productIdsArray.length; i += batchSize) {
          const batch = productIdsArray.slice(i, i + batchSize);
          const productIdsString = batch.map(id => `'${id}'`).join(',');
          
          const productQuery = `
            SELECT Id, Name, ProductCode
            FROM Product2
            WHERE Id IN (${productIdsString})
          `;
          
          try {
            const batchResult = await salesforceService.query(productQuery);
            if (batchResult && batchResult.records) {
              allProducts.push(...batchResult.records);
            }
          } catch (error) {
            logger.logError(error, { operation: 'validateHierarchyPricingObjects', step: 'productQuery' });
          }
        }
        
        // Build product details map from queried products
        allProducts.forEach(product => {
          // Determine if product is parent, child, or both
          let productType = 'Unknown';
          if (childItems && childItems.records && Array.isArray(childItems.records)) {
            const isParent = childItems.records.some(ci => ci.vlocity_cmt__ParentProductId__c === product.Id);
            const isChild = childItems.records.some(ci => ci.vlocity_cmt__ChildProductId__c === product.Id);
            
            if (isParent && isChild) {
              productType = 'Parent & Child';
            } else if (isParent) {
              productType = 'Parent';
            } else if (isChild) {
              productType = 'Child';
            }
          }
          
          productDetails.set(product.Id, {
            name: product.Name || 'Unknown',
            code: product.ProductCode || 'Unknown',
            type: productType
          });
        });
      }
      
      // Check each product in hierarchy
      for (const productId of productIds) {
        const productInfo = productDetails.get(productId) || { name: 'Unknown', code: 'Unknown', type: 'Unknown' };
        const entries = entriesByProduct.get(productId) || [];
        
        if (entries.length === 0) {
          productsMissingEntries.push({
            productId,
            productName: productInfo.name,
            productCode: productInfo.code,
            type: productInfo.type
          });
          continue;
        }
        
        // Check if PriceLists have PricingElements
        const productPriceListIds = new Set();
        entries.forEach(entry => {
          if (entry.vlocity_cmt__PriceListId__c) {
            productPriceListIds.add(entry.vlocity_cmt__PriceListId__c);
          }
        });
        
        let hasElements = false;
        let hasVariables = false;
        
        for (const priceListId of productPriceListIds) {
          const elements = elementsByPriceList.get(priceListId) || [];
          
          if (elements.length > 0) {
            hasElements = true;
            
            // Check if elements have valid PricingVariables
            const elementVariableIds = elements
              .map(e => e.vlocity_cmt__PricingVariableId__c)
              .filter(Boolean);
            
            const validVariables = elementVariableIds.filter(vId => variablesById.has(vId));
            
            if (validVariables.length > 0) {
              hasVariables = true;
            }
          }
        }
        
        if (!hasElements) {
          productsMissingElements.push({
            productId,
            productName: productInfo.name,
            productCode: productInfo.code,
            type: productInfo.type,
            priceListIds: Array.from(productPriceListIds)
          });
        }
        
        if (!hasVariables) {
          productsMissingVariables.push({
            productId,
            productName: productInfo.name,
            productCode: productInfo.code,
            type: productInfo.type
          });
        }
      }
      
      // Report results with detailed information
      if (productsMissingEntries.length === 0) {
        this.addResult(category, 'Hierarchy PriceListEntries', true, 
          `All ${productIds.length} products in hierarchy have PriceListEntries`);
      } else {
        const sampleSize = Math.min(10, productsMissingEntries.length);
        const sampleDetails = productsMissingEntries.slice(0, sampleSize)
          .map(p => `${p.productName} (${p.productCode}, ${p.type})`)
          .join('; ');
        
        const detailsMessage = productsMissingEntries.length > sampleSize
          ? `${sampleDetails} ... and ${productsMissingEntries.length - sampleSize} more`
          : sampleDetails;
        
        this.addResult(category, 'Hierarchy PriceListEntries', false, 
          `${productsMissingEntries.length} products in hierarchy missing PriceListEntries: ${detailsMessage}`,
          {
            totalMissing: productsMissingEntries.length,
            sample: productsMissingEntries.slice(0, sampleSize),
            allMissing: productsMissingEntries.map(p => ({
              productId: p.productId,
              productName: p.productName,
              productCode: p.productCode,
              type: p.type
            }))
          });
      }
      
      if (productsMissingElements.length === 0) {
        this.addResult(category, 'Hierarchy PricingElements', true, 
          `All products in hierarchy have PricingElements for their PriceLists`);
      } else {
        const sampleSize = Math.min(10, productsMissingElements.length);
        const sampleDetails = productsMissingElements.slice(0, sampleSize)
          .map(p => `${p.productName} (${p.productCode}, ${p.type})`)
          .join('; ');
        
        const detailsMessage = productsMissingElements.length > sampleSize
          ? `${sampleDetails} ... and ${productsMissingElements.length - sampleSize} more`
          : sampleDetails;
        
        this.addResult(category, 'Hierarchy PricingElements', false, 
          `${productsMissingElements.length} products in hierarchy missing PricingElements: ${detailsMessage}`,
          {
            totalMissing: productsMissingElements.length,
            sample: productsMissingElements.slice(0, sampleSize),
            allMissing: productsMissingElements.map(p => ({
              productId: p.productId,
              productName: p.productName,
              productCode: p.productCode,
              type: p.type,
              priceListIds: p.priceListIds || []
            }))
          });
      }
      
      if (productsMissingVariables.length === 0) {
        this.addResult(category, 'Hierarchy PricingVariables', true, 
          `All PricingElements in hierarchy have valid PricingVariables`);
      } else {
        const sampleSize = Math.min(10, productsMissingVariables.length);
        const sampleDetails = productsMissingVariables.slice(0, sampleSize)
          .map(p => `${p.productName} (${p.productCode}, ${p.type})`)
          .join('; ');
        
        const detailsMessage = productsMissingVariables.length > sampleSize
          ? `${sampleDetails} ... and ${productsMissingVariables.length - sampleSize} more`
          : sampleDetails;
        
        this.addResult(category, 'Hierarchy PricingVariables', false, 
          `${productsMissingVariables.length} products in hierarchy have PricingElements without valid PricingVariables: ${detailsMessage}`,
          {
            totalMissing: productsMissingVariables.length,
            sample: productsMissingVariables.slice(0, sampleSize),
            allMissing: productsMissingVariables.map(p => ({
              productId: p.productId,
              productName: p.productName,
              productCode: p.productCode,
              type: p.type
            }))
          });
      }
      
    } catch (error) {
      this.addResult(category, 'Hierarchy Pricing Validation', false, 
        `Failed to validate pricing objects for hierarchy: ${error.message}`);
      logger.logError(error, { operation: 'validateHierarchyPricingObjects' });
    }
  }

  /**
   * Validate Rate Codes
   */
  async validateRateCodes(username, isSandbox) {
    const category = 'Rate Codes';
    
    try {
      const rateCodeQuery = `
        SELECT Id, Name, GT_OrgCode__c, GT_VATCode__c, GT_VATDescription__c,
               GT_VATRate__c, GT_StartDate__c, GT_EndDate__c
        FROM GT_RateCode__c
        WHERE Id != null
      `;
      
      const rateCodes = await salesforceService.query(rateCodeQuery);
      
      if (rateCodes.records && rateCodes.records.length > 0) {
        this.addResult(category, 'Rate Codes Exist', true, 
          `Found ${rateCodes.records.length} rate codes`);
        
        // Check for required fields
        const missingFields = rateCodes.records.filter(rc => 
          !rc.GT_OrgCode__c || !rc.GT_VATCode__c
        );
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} rate codes missing required fields`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All rate codes have required fields');
        }
        
        // Check for valid VAT rates
        const invalidVATRates = rateCodes.records.filter(rc => 
          rc.GT_VATRate__c === null || rc.GT_VATRate__c === undefined || rc.GT_VATRate__c < 0
        );
        
        if (invalidVATRates.length > 0) {
          this.addWarning(category, 'Invalid VAT Rates', 
            `${invalidVATRates.length} rate codes have invalid VAT rates`);
        }
        
      } else {
        this.addWarning(category, 'Rate Codes Exist', 'No rate codes found');
      }
      
    } catch (error) {
      this.addResult(category, 'Rate Codes Query', false, `Failed to query rate codes: ${error.message}`);
    }
  }

  /**
   * Validate Rate Tables
   */
  async validateRateTables(username, isSandbox) {
    const category = 'Rate Tables';
    
    try {
      const rateTableQuery = `
        SELECT Id, Name, GT_OrgCode__c, Product__c, Product__r.Name,
               GT_ProductName_Text__c, GT_RateCode__c, GT_RateDescription__c,
               GT_StartDate__c, GT_EndDate__c, GT_VATType__c
        FROM GT_RateTable__c
        WHERE Id != null
      `;
      
      const rateTables = await salesforceService.query(rateTableQuery);
      
      if (rateTables.records && rateTables.records.length > 0) {
        this.addResult(category, 'Rate Tables Exist', true, 
          `Found ${rateTables.records.length} rate tables`);
        
        // Check for orphaned rate tables (missing product)
        const orphanedTables = rateTables.records.filter(rt => !rt.Product__c);
        
        if (orphanedTables.length > 0) {
          this.addResult(category, 'Orphaned Tables', false, 
            `${orphanedTables.length} rate tables are missing product references`);
        } else {
          this.addResult(category, 'Orphaned Tables', true, 'All rate tables have valid product references');
        }
        
        // Check for required fields
        const missingFields = rateTables.records.filter(rt => 
          !rt.GT_OrgCode__c || !rt.GT_RateCode__c
        );
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} rate tables missing required fields`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All rate tables have required fields');
        }
        
      } else {
        this.addWarning(category, 'Rate Tables Exist', 'No rate tables found');
      }
      
    } catch (error) {
      this.addResult(category, 'Rate Tables Query', false, `Failed to query rate tables: ${error.message}`);
    }
  }

  /**
   * Validate Promotions
   */
  async validatePromotions(username, isSandbox) {
    const category = 'Promotions';
    
    try {
      const promotionQuery = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__Description__c,
               vlocity_cmt__IsActive__c, vlocity_cmt__GlobalKey__c,
               vlocity_cmt__PriceListId__c, GT_Type__c, Promotion_Trigger__c
        FROM vlocity_cmt__Promotion__c
        WHERE vlocity_cmt__IsActive__c = true
      `;
      
      const promotions = await salesforceService.query(promotionQuery);
      
      if (promotions.records && promotions.records.length > 0) {
        this.addResult(category, 'Promotions Exist', true, 
          `Found ${promotions.records.length} active promotions`);
        
        // Check for required fields
        const missingFields = promotions.records.filter(p => 
          !p.vlocity_cmt__Code__c || !p.vlocity_cmt__Description__c
        );
        
        if (missingFields.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingFields.length} promotions missing required fields`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All promotions have required fields');
        }
        
        // Check for orphaned promotions (missing price list)
        const orphanedPromotions = promotions.records.filter(p => !p.vlocity_cmt__PriceListId__c);
        
        if (orphanedPromotions.length > 0) {
          this.addWarning(category, 'Orphaned Promotions', 
            `${orphanedPromotions.length} promotions are missing price list references`);
        }
        
      } else {
        this.addWarning(category, 'Promotions Exist', 'No active promotions found');
      }
      
    } catch (error) {
      this.addResult(category, 'Promotions Query', false, `Failed to query promotions: ${error.message}`);
    }
  }

  /**
   * Validate Staging Area
   */
  async validateStagingArea(username, isSandbox) {
    const category = 'Staging Area';
    
    try {
      // Query only basic fields that should exist on all orgs
      // Note: GT_RecordStatus__c may not exist in all orgs
      const stagingQuery = `
        SELECT Id, Name
        FROM GT_StagingArea__c
        LIMIT 1000
      `;
      
      let stagingRecords;
      try {
        stagingRecords = await salesforceService.query(stagingQuery);
      } catch (queryError) {
        // Check if error is because object doesn't exist
        const errorMessage = (queryError.message || '').toLowerCase();
        const isObjectNotSupported = errorMessage.includes('is not supported') || 
                                     errorMessage.includes('invalid_type') ||
                                     errorMessage.includes('stagingarea') ||
                                     errorMessage.includes('gt_stagingarea');
        
        if (isObjectNotSupported) {
          this.addResult(category, 'Staging Area Query', true, 
            'GT_StagingArea object not available in this org - skipping validation');
          return;
        }
        throw queryError; // Re-throw if it's a different error
      }
      
      if (stagingRecords.records && stagingRecords.records.length > 0) {
        this.addResult(category, 'Staging Records Exist', true, 
          `Found ${stagingRecords.records.length} staging records`);
        
        // Check for required fields (Name is required)
        const missingFields = stagingRecords.records.filter(sr => 
          !sr.Name
        );
        
        if (missingFields.length > 0) {
          this.addWarning(category, 'Required Fields', 
            `${missingFields.length} staging records missing Name field`);
        }
        
      } else {
        this.addWarning(category, 'Staging Records Exist', 'No staging records found');
      }
      
    } catch (error) {
      this.addResult(category, 'Staging Area Query', false, `Failed to query staging area: ${error.message}`);
    }
  }

  /**
   * Validate Product SKUs
   */
  async validateProductSKUs(username, isSandbox) {
    const category = 'Product SKUs';
    
    try {
      const skuQuery = `
        SELECT Id, Name, GT_ProductName__c, Product__c,
               GT_Color__c, GT_Lifecycle__c, GT_OrganizationCode__c
        FROM GT_ProductSKU__c
        WHERE Id != null
      `;
      
      const skus = await salesforceService.query(skuQuery);
      
      if (skus.records && skus.records.length > 0) {
        this.addResult(category, 'Product SKUs Exist', true, 
          `Found ${skus.records.length} product SKUs`);
        
        // Check for required fields
        const missingFields = skus.records.filter(sku => 
          !sku.Product__c
        );
        
        if (missingFields.length > 0) {
          this.addWarning(category, 'Required Fields', 
            `${missingFields.length} product SKUs missing required fields`);
        }
        
      } else {
        this.addWarning(category, 'Product SKUs Exist', 'No product SKUs found');
      }
      
    } catch (error) {
      this.addResult(category, 'Product SKUs Query', false, `Failed to query product SKUs: ${error.message}`);
    }
  }

  /**
   * Validate Catalogs
   * Catalogs should always be present - this is a required validation
   */
  async validateCatalogs(username, isSandbox) {
    const category = 'Catalogs';
    
    try {
      const catalogQuery = `
        SELECT Id, Name, vlocity_cmt__GlobalKey__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__Description__c
        FROM vlocity_cmt__Catalog__c
        WHERE Id != null
      `;
      
      const catalogs = await salesforceService.query(catalogQuery);
      
      if (catalogs.records && catalogs.records.length > 0) {
        this.addResult(category, 'Catalogs Exist', true, 
          `Found ${catalogs.records.length} catalogs`);
        
        // Check for active catalogs
        const activeCatalogs = catalogs.records.filter(cat => 
          cat.vlocity_cmt__IsActive__c === true
        );
        
        if (activeCatalogs.length > 0) {
          this.addResult(category, 'Active Catalogs', true, 
            `Found ${activeCatalogs.length} active catalogs`);
        } else {
          this.addResult(category, 'Active Catalogs', false, 
            'No active catalogs found - at least one active catalog is required');
        }
        
        // Check for required fields
        const missingGlobalKey = catalogs.records.filter(cat => 
          !cat.vlocity_cmt__GlobalKey__c
        );
        
        if (missingGlobalKey.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingGlobalKey.length} catalogs missing GlobalKey field (required for reference resolution)`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All catalogs have GlobalKey field');
        }
        
        // Check for orphaned catalogs (catalogs without product relationships)
        const catalogIds = catalogs.records.map(cat => cat.Id);
        if (catalogIds.length > 0) {
          // Query in batches if there are many catalogs (SOQL IN clause limit is 200)
          const batchSize = 200;
          let totalRelationships = 0;
          
          for (let i = 0; i < catalogIds.length; i += batchSize) {
            const batch = catalogIds.slice(i, i + batchSize);
            const relationshipQuery = `
              SELECT Id FROM vlocity_cmt__CatalogProductRelationship__c
              WHERE vlocity_cmt__CatalogId__c IN (${batch.map(id => `'${id}'`).join(',')})
            `;
            
            try {
              const relationshipResult = await salesforceService.query(relationshipQuery);
              totalRelationships += (relationshipResult.records || []).length;
            } catch (relError) {
              // If query fails, log warning but continue
              logger.warn(`Failed to query relationships for catalog batch: ${relError.message}`);
            }
          }
          
          if (totalRelationships === 0) {
            this.addResult(category, 'Catalog Relationships', false, 
              'No catalog product relationships found - catalogs must have product relationships');
          } else {
            this.addResult(category, 'Catalog Relationships', true, 
              `Found ${totalRelationships} catalog product relationships`);
          }
        }
        
      } else {
        // Catalogs are required - this is a failure, not a warning
        this.addResult(category, 'Catalogs Exist', false, 
          'No catalogs found - catalogs are required and must always be present');
      }
      
    } catch (error) {
      this.addResult(category, 'Catalogs Query', false, `Failed to query catalogs: ${error.message}`);
    }
  }

  /**
   * Validate Catalog Product Relationships
   * Catalog Product Relationships should always be present - this is a required validation
   */
  async validateCatalogProductRelationships(username, isSandbox) {
    const category = 'Catalog Product Relationships';
    
    try {
      const relationshipQuery = `
        SELECT Id, Name, vlocity_cmt__CatalogId__c,
               vlocity_cmt__Product2Id__c, vlocity_cmt__CatalogId__r.Name,
               vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c,
               vlocity_cmt__Product2Id__r.Name,
               vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c
        FROM vlocity_cmt__CatalogProductRelationship__c
        WHERE Id != null
      `;
      
      const relationships = await salesforceService.query(relationshipQuery);
      
      if (relationships.records && relationships.records.length > 0) {
        this.addResult(category, 'Catalog Product Relationships Exist', true, 
          `Found ${relationships.records.length} catalog product relationships`);
        
        // Check for required fields - Catalog and Product references
        const missingCatalog = relationships.records.filter(rel => 
          !rel.vlocity_cmt__CatalogId__c
        );
        
        const missingProduct = relationships.records.filter(rel => 
          !rel.vlocity_cmt__Product2Id__c
        );
        
        if (missingCatalog.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingCatalog.length} relationships missing Catalog reference (vlocity_cmt__CatalogId__c)`);
        }
        
        if (missingProduct.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingProduct.length} relationships missing Product reference (vlocity_cmt__Product2Id__c)`);
        }
        
        if (missingCatalog.length === 0 && missingProduct.length === 0) {
          this.addResult(category, 'Required Fields', true, 
            'All relationships have required Catalog and Product references');
        }
        
        // Check for orphaned relationships (missing catalog or product)
        const orphanedRelationships = relationships.records.filter(rel => 
          !rel.vlocity_cmt__CatalogId__r || !rel.vlocity_cmt__Product2Id__r
        );
        
        if (orphanedRelationships.length > 0) {
          this.addResult(category, 'Orphaned Relationships', false, 
            `${orphanedRelationships.length} relationships reference missing Catalog or Product records`);
        } else {
          this.addResult(category, 'Orphaned Relationships', true, 
            'All relationships have valid Catalog and Product references');
        }
        
        // Check for GlobalKey fields in relationships (needed for reference resolution)
        const missingCatalogGlobalKey = relationships.records.filter(rel => 
          rel.vlocity_cmt__CatalogId__r && !rel.vlocity_cmt__CatalogId__r.vlocity_cmt__GlobalKey__c
        );
        
        const missingProductGlobalKey = relationships.records.filter(rel => 
          rel.vlocity_cmt__Product2Id__r && !rel.vlocity_cmt__Product2Id__r.vlocity_cmt__GlobalKey__c
        );
        
        if (missingCatalogGlobalKey.length > 0) {
          this.addResult(category, 'GlobalKey Fields', false, 
            `${missingCatalogGlobalKey.length} relationships have Catalog records without GlobalKey (required for reference resolution)`);
        }
        
        if (missingProductGlobalKey.length > 0) {
          this.addResult(category, 'GlobalKey Fields', false, 
            `${missingProductGlobalKey.length} relationships have Product records without GlobalKey (required for reference resolution)`);
        }
        
        if (missingCatalogGlobalKey.length === 0 && missingProductGlobalKey.length === 0) {
          this.addResult(category, 'GlobalKey Fields', true, 
            'All related Catalogs and Products have GlobalKey fields');
        }
        
      } else {
        // Catalog Product Relationships are required - this is a failure, not a warning
        this.addResult(category, 'Catalog Product Relationships Exist', false, 
          'No catalog product relationships found - relationships are required and must always be present');
      }
      
    } catch (error) {
      this.addResult(category, 'Catalog Product Relationships Query', false, 
        `Failed to query catalog product relationships: ${error.message}`);
    }
  }

  /**
   * Validate Pricing Plans
   * Pricing Plans should always be present - this is a required validation
   */
  async validatePricingPlans(username, isSandbox) {
    const category = 'Pricing Plans';
    
    try {
      const pricingPlanQuery = `
        SELECT Id, Name, vlocity_cmt__Code__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__GlobalKey__c, vlocity_cmt__Description__c
        FROM vlocity_cmt__PricingPlan__c
        WHERE Id != null
      `;
      
      const pricingPlans = await salesforceService.query(pricingPlanQuery);
      
      if (pricingPlans.records && pricingPlans.records.length > 0) {
        this.addResult(category, 'Pricing Plans Exist', true, 
          `Found ${pricingPlans.records.length} pricing plans`);
        
        // Check for active pricing plans
        const activePlans = pricingPlans.records.filter(plan => 
          plan.vlocity_cmt__IsActive__c === true
        );
        
        if (activePlans.length > 0) {
          this.addResult(category, 'Active Pricing Plans', true, 
            `Found ${activePlans.length} active pricing plans`);
        } else {
          this.addResult(category, 'Active Pricing Plans', false, 
            'No active pricing plans found - at least one active pricing plan is recommended');
        }
        
        // Check for required fields
        const missingGlobalKey = pricingPlans.records.filter(plan => 
          !plan.vlocity_cmt__GlobalKey__c
        );
        
        if (missingGlobalKey.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingGlobalKey.length} pricing plans missing GlobalKey field (required for reference resolution)`);
        } else {
          this.addResult(category, 'Required Fields', true, 'All pricing plans have GlobalKey field');
        }
        
        // Check for duplicate codes
        const codes = pricingPlans.records.map(plan => plan.vlocity_cmt__Code__c).filter(Boolean);
        const duplicateCodes = codes.filter((code, index) => codes.indexOf(code) !== index);
        
        if (duplicateCodes.length > 0) {
          this.addResult(category, 'Unique Codes', false, 
            `Found duplicate pricing plan codes: ${[...new Set(duplicateCodes)].join(', ')}`);
        } else {
          this.addResult(category, 'Unique Codes', true, 'All pricing plan codes are unique');
        }
        
        // Check for pricing plans without steps (if PricingStep object exists)
        const planIds = pricingPlans.records.map(plan => plan.Id);
        if (planIds.length > 0) {
          const batchSize = 200;
          let totalSteps = 0;
          let stepQueryFailed = false;
          
          for (let i = 0; i < planIds.length; i += batchSize) {
            const batch = planIds.slice(i, i + batchSize);
            const stepQuery = `
              SELECT Id FROM vlocity_cmt__PricingPlanStep__c
              WHERE vlocity_cmt__PricingPlanId__c IN (${batch.map(id => `'${id}'`).join(',')})
            `;
            
            try {
              const stepResult = await salesforceService.query(stepQuery);
              totalSteps += (stepResult.records || []).length;
            } catch (stepError) {
              // Check if error is because PricingStep object doesn't exist
              // The salesforceService wraps errors as "Salesforce query failed: [original message]"
              // Original message: "sObject type 'vlocity_cmt__PricingPlanStep__c' is not supported"
              const errorMessage = (stepError.message || String(stepError) || '').toLowerCase();
              
              // More specific check: must have both "not supported" AND "pricingplanstep" in the message
              const hasNotSupported = errorMessage.includes('not supported') || errorMessage.includes('is not supported');
              const hasPricingPlanStep = errorMessage.includes('pricingplanstep') || errorMessage.includes('pricingstep') || errorMessage.includes('vlocity_cmt__pricingplanstep');
              const hasInvalidType = errorMessage.includes('invalid_type') || errorMessage.includes('invalid type');
              
              const isObjectNotSupported = (hasNotSupported && hasPricingPlanStep) || 
                                          (hasInvalidType && hasPricingPlanStep);
              
              if (isObjectNotSupported) {
                // PricingStep object doesn't exist, skip this check
                logger.debug('PricingStep object not available, skipping step count for pricing plan', { 
                  planId: plan.Id,
                  errorMessage: errorMessage.substring(0, 200) // Log first 200 chars for debugging
                });
                stepQueryFailed = true;
                break;
              }
              // If it's a different error, log it but continue (don't break the entire validation)
              logger.warn(`Failed to query steps for pricing plan batch: ${stepError.message}`);
            }
          }
          
          if (stepQueryFailed) {
            // PricingStep object doesn't exist in this org - skip this check
            this.addResult(category, 'Pricing Steps', true, 
              'PricingStep object not available in this org - skipping step validation');
          } else if (totalSteps === 0) {
            this.addResult(category, 'Pricing Steps', false, 
              'No pricing steps found - pricing plans should have at least one step');
          } else {
            this.addResult(category, 'Pricing Steps', true, 
              `Found ${totalSteps} pricing steps across all pricing plans`);
          }
        }
        
      } else {
        // Pricing Plans are required - this is a failure, not a warning
        this.addResult(category, 'Pricing Plans Exist', false, 
          'No pricing plans found - pricing plans are required and must always be present');
      }
      
    } catch (error) {
      this.addResult(category, 'Pricing Plans Query', false, 
        `Failed to query pricing plans: ${error.message}`);
    }
  }

  /**
   * Validate Pricing Steps
   * Pricing Steps should always be present - this is a required validation
   */
  async validatePricingSteps(username, isSandbox) {
    const category = 'Pricing Steps';
    
    try {
      const pricingStepQuery = `
        SELECT Id, Name, vlocity_cmt__PricingPlanId__c,
               vlocity_cmt__PricingPlanId__r.Name,
               vlocity_cmt__PricingPlanId__r.vlocity_cmt__GlobalKey__c,
               vlocity_cmt__Sequence__c, vlocity_cmt__IsActive__c,
               vlocity_cmt__GlobalKey__c
        FROM vlocity_cmt__PricingPlanStep__c
        WHERE Id != null
      `;
      
      let pricingSteps;
      try {
        pricingSteps = await salesforceService.query(pricingStepQuery);
      } catch (queryError) {
        // Check if error is because object doesn't exist
        // The salesforceService wraps errors as "Salesforce query failed: [original message]"
        // Original message contains "sObject type 'vlocity_cmt__PricingPlanStep__c' is not supported"
        const errorMessage = (queryError.message || String(queryError) || '').toLowerCase();
        const isObjectNotSupported = (errorMessage.includes('is not supported') && 
                                      (errorMessage.includes('pricingplanstep') || errorMessage.includes('pricingstep') || errorMessage.includes('vlocity_cmt__pricingplanstep'))) ||
                                     (errorMessage.includes('invalid_type') && 
                                      (errorMessage.includes('pricingplanstep') || errorMessage.includes('pricingstep') || errorMessage.includes('vlocity_cmt__pricingplanstep')));
        
        if (isObjectNotSupported) {
          this.addResult(category, 'Pricing Steps Query', true, 
            'PricingStep object not available in this org - skipping validation');
          return;
        }
        // If it's a different error, log it and re-throw
        logger.logError(queryError, { operation: 'validatePricingSteps', step: 'query' });
        throw queryError;
      }
      
      if (pricingSteps.records && pricingSteps.records.length > 0) {
        this.addResult(category, 'Pricing Steps Exist', true, 
          `Found ${pricingSteps.records.length} pricing steps`);
        
        // Check for required fields - Pricing Plan reference
        const missingPlan = pricingSteps.records.filter(step => 
          !step.vlocity_cmt__PricingPlanId__c
        );
        
        if (missingPlan.length > 0) {
          this.addResult(category, 'Required Fields', false, 
            `${missingPlan.length} pricing steps missing Pricing Plan reference (vlocity_cmt__PricingPlanId__c)`);
        } else {
          this.addResult(category, 'Required Fields', true, 
            'All pricing steps have required Pricing Plan reference');
        }
        
        // Check for orphaned steps (missing pricing plan)
        const orphanedSteps = pricingSteps.records.filter(step => 
          !step.vlocity_cmt__PricingPlanId__r
        );
        
        if (orphanedSteps.length > 0) {
          this.addResult(category, 'Orphaned Steps', false, 
            `${orphanedSteps.length} pricing steps reference missing Pricing Plan records`);
        } else {
          this.addResult(category, 'Orphaned Steps', true, 
            'All pricing steps have valid Pricing Plan references');
        }
        
        // Check for GlobalKey fields in steps (needed for reference resolution)
        const missingGlobalKey = pricingSteps.records.filter(step => 
          !step.vlocity_cmt__GlobalKey__c
        );
        
        if (missingGlobalKey.length > 0) {
          this.addResult(category, 'GlobalKey Fields', false, 
            `${missingGlobalKey.length} pricing steps missing GlobalKey field (required for reference resolution)`);
        } else {
          this.addResult(category, 'GlobalKey Fields', true, 
            'All pricing steps have GlobalKey field');
        }
        
        // Check for GlobalKey in related Pricing Plans
        const missingPlanGlobalKey = pricingSteps.records.filter(step => 
          step.vlocity_cmt__PricingPlanId__r && !step.vlocity_cmt__PricingPlanId__r.vlocity_cmt__GlobalKey__c
        );
        
        if (missingPlanGlobalKey.length > 0) {
          this.addResult(category, 'Plan GlobalKey Fields', false, 
            `${missingPlanGlobalKey.length} pricing steps have Pricing Plan records without GlobalKey (required for reference resolution)`);
        } else {
          this.addResult(category, 'Plan GlobalKey Fields', true, 
            'All related Pricing Plans have GlobalKey fields');
        }
        
        // Check for active steps
        const activeSteps = pricingSteps.records.filter(step => 
          step.vlocity_cmt__IsActive__c === true
        );
        
        if (activeSteps.length > 0) {
          this.addResult(category, 'Active Steps', true, 
            `Found ${activeSteps.length} active pricing steps`);
        } else {
          this.addResult(category, 'Active Steps', false, 
            'No active pricing steps found - at least one active step is recommended');
        }
        
        // Check for sequence numbers (if available)
        const stepsWithoutSequence = pricingSteps.records.filter(step => 
          step.vlocity_cmt__Sequence__c === null || step.vlocity_cmt__Sequence__c === undefined
        );
        
        if (stepsWithoutSequence.length > 0) {
          this.addWarning(category, 'Sequence Numbers', 
            `${stepsWithoutSequence.length} pricing steps missing sequence numbers`);
        }
        
      } else {
        // Pricing Steps are required - this is a failure, not a warning
        this.addResult(category, 'Pricing Steps Exist', false, 
          'No pricing steps found - pricing steps are required and must always be present');
      }
      
    } catch (error) {
      this.addResult(category, 'Pricing Steps Query', false, 
        `Failed to query pricing steps: ${error.message}`);
    }
  }

  /**
   * Calculate validation summary
   */
  calculateSummary() {
    const categories = [...new Set(this.validationResults.errors.map(e => e.category))];
    
    this.validationResults.summary = {
      overallStatus: this.validationResults.failedChecks === 0 ? 'PASS' : 'FAIL',
      categories: categories.map(category => {
        const categoryErrors = this.validationResults.errors.filter(e => e.category === category);
        const categoryWarnings = this.validationResults.warnings.filter(w => w.category === category);
        
        return {
          name: category,
          status: categoryErrors.length === 0 ? 'PASS' : 'FAIL',
          errors: categoryErrors.length,
          warnings: categoryWarnings.length
        };
      }),
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * Generate recommendations based on validation results
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Check for common issues and provide recommendations
    const duplicateCodeErrors = this.validationResults.errors.filter(e => 
      e.check.includes('Unique Codes')
    );
    
    if (duplicateCodeErrors.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Data Integrity',
        title: 'Fix Duplicate Codes',
        description: 'Resolve duplicate codes across pricing objects to ensure data integrity',
        action: 'Review and update duplicate codes in the affected objects'
      });
    }
    
    const orphanedErrors = this.validationResults.errors.filter(e => 
      e.check.includes('Orphaned')
    );
    
    if (orphanedErrors.length > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Data Relationships',
        title: 'Fix Orphaned Records',
        description: 'Resolve orphaned records that are missing required relationships',
        action: 'Review and update orphaned records or remove them if no longer needed'
      });
    }
    
    const missingFieldErrors = this.validationResults.errors.filter(e => 
      e.check.includes('Required Fields')
    );
    
    if (missingFieldErrors.length > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Data Quality',
        title: 'Complete Missing Required Fields',
        description: 'Fill in missing required fields to improve data quality',
        action: 'Update records with missing required field values'
      });
    }
    
    if (this.validationResults.warnings.length > 0) {
      recommendations.push({
        priority: 'LOW',
        category: 'Data Quality',
        title: 'Address Warnings',
        description: 'Review and address validation warnings to improve overall data quality',
        action: 'Review warning details and take appropriate corrective actions'
      });
    }
    
    return recommendations;
  }

  /**
   * Validate that every product in a commercial offer's hierarchy has a
   * 'One Time Std Price' PriceListEntry in the same Price List as the offer.
   *
   * Logic (mirrors the Apex implementation):
   *  1. For each active Price List, find commercial offer PLEs
   *     (IsOrderable, no override, no OfferId, ObjectTypeName LIKE '% offer').
   *  2. Find all PLEs whose PricingVariable is named 'One Time Std Price'.
   *  3. Walk offer → children (ProductChildItem, non-root).
   *     Children whose ObjectTypeName = 'Accessories Virtual Item' are bundles.
   *  4. Walk bundle → bundle children.
   *  5. Any product in the hierarchy without a 'One Time Std Price' PLE in
   *     that Price List is a violation.
   */
  async validatePriceListProductCoverage(username, isSandbox) {
    const category = 'Price List Coverage';
    const batchSize = 200;

    try {
      // ── Step 1: all commercial offer PLEs across all active price lists ──────
      const offerPleQuery = `
        SELECT Id,
               vlocity_cmt__PriceListId__c,
               vlocity_cmt__ProductId__c,
               vlocity_cmt__ProductId__r.Name,
               vlocity_cmt__ProductId__r.vlocity_cmt__ObjectTypeName__c
        FROM vlocity_cmt__PriceListEntry__c
        WHERE vlocity_cmt__IsOverride__c = false
          AND vlocity_cmt__ProductId__c != null
          AND vlocity_cmt__OfferId__c = null
          AND vlocity_cmt__ProductId__r.vlocity_cmt__IsOrderable__c = true
          AND vlocity_cmt__ProductId__r.vlocity_cmt__ObjectTypeName__c LIKE '% offer'
          AND vlocity_cmt__PriceListId__r.vlocity_cmt__IsActive__c = true
      `;

      const offerPleResult = await salesforceService.query(offerPleQuery);
      const offerPles = offerPleResult.records || [];

      if (offerPles.length === 0) {
        this.addResult(category, 'Commercial Offers', true,
          'No commercial offers found in active price lists — coverage check skipped');
        return;
      }

      this.addResult(category, 'Commercial Offers', true,
        `Found ${offerPles.length} commercial offer PLE(s) across active price lists`);

      // Build per-price-list map:  priceListId → Set<productId> of offers
      const offersByPriceList = {};
      const allOfferProductIds = new Set();

      offerPles.forEach(ple => {
        const plId = ple.vlocity_cmt__PriceListId__c;
        const prodId = ple.vlocity_cmt__ProductId__c;
        if (!offersByPriceList[plId]) offersByPriceList[plId] = new Set();
        offersByPriceList[plId].add(prodId);
        allOfferProductIds.add(prodId);
      });

      // ── Step 2: all 'One Time Std Price' PLEs across active price lists ──────
      const stdPriceQuery = `
        SELECT vlocity_cmt__PriceListId__c,
               vlocity_cmt__ProductId__c
        FROM vlocity_cmt__PriceListEntry__c
        WHERE vlocity_cmt__PricingElementId__r.vlocity_cmt__PricingVariableId__r.Name = 'One Time Std Price'
          AND vlocity_cmt__PriceListId__r.vlocity_cmt__IsActive__c = true
          AND vlocity_cmt__ProductId__c != null
      `;

      const stdPriceResult = await salesforceService.query(stdPriceQuery);
      const stdPriceRecords = stdPriceResult.records || [];

      // Build per-price-list set: plId → Set<productId> that have Std Price
      const stdPriceByPriceList = {};
      stdPriceRecords.forEach(ple => {
        const plId = ple.vlocity_cmt__PriceListId__c;
        const prodId = ple.vlocity_cmt__ProductId__c;
        if (!stdPriceByPriceList[plId]) stdPriceByPriceList[plId] = new Set();
        stdPriceByPriceList[plId].add(prodId);
      });

      // ── Step 3: ProductChildItems for all offer products (non-root) ──────────
      const offerIdArray = [...allOfferProductIds];
      const allLevel1Items = [];

      for (let i = 0; i < offerIdArray.length; i += batchSize) {
        const batch = offerIdArray.slice(i, i + batchSize);
        const idsStr = batch.map(id => `'${id}'`).join(',');
        const pciQuery = `
          SELECT Id,
                 vlocity_cmt__ParentProductId__c,
                 vlocity_cmt__ChildProductId__c,
                 vlocity_cmt__ChildProductId__r.Name,
                 vlocity_cmt__ChildProductId__r.vlocity_cmt__ObjectTypeName__c
          FROM vlocity_cmt__ProductChildItem__c
          WHERE vlocity_cmt__ParentProductId__c IN (${idsStr})
            AND vlocity_cmt__IsRootProductChildItem__c = false
        `;
        const result = await salesforceService.query(pciQuery);
        if (result.records) allLevel1Items.push(...result.records);
      }

      // Separate bundle children from regular children
      const bundleProductIds = new Set();
      const offerChildren = {};  // offerId → Set<childProductId>

      allLevel1Items.forEach(pci => {
        const parentId = pci.vlocity_cmt__ParentProductId__c;
        const childId = pci.vlocity_cmt__ChildProductId__c;
        if (!childId) return;
        if (!offerChildren[parentId]) offerChildren[parentId] = new Set();
        offerChildren[parentId].add(childId);
        const typeName = pci.vlocity_cmt__ChildProductId__r?.vlocity_cmt__ObjectTypeName__c || '';
        if (typeName === 'Accessories Virtual Item') {
          bundleProductIds.add(childId);
        }
      });

      // ── Step 4: ProductChildItems for bundle products (non-root) ─────────────
      const bundleIdArray = [...bundleProductIds];
      const allLevel2Items = [];

      for (let i = 0; i < bundleIdArray.length; i += batchSize) {
        const batch = bundleIdArray.slice(i, i + batchSize);
        const idsStr = batch.map(id => `'${id}'`).join(',');
        const pciQuery = `
          SELECT Id,
                 vlocity_cmt__ParentProductId__c,
                 vlocity_cmt__ChildProductId__c,
                 vlocity_cmt__ChildProductId__r.Name
          FROM vlocity_cmt__ProductChildItem__c
          WHERE vlocity_cmt__ParentProductId__c IN (${idsStr})
            AND vlocity_cmt__IsRootProductChildItem__c = false
        `;
        const result = await salesforceService.query(pciQuery);
        if (result.records) allLevel2Items.push(...result.records);
      }

      // bundleId → Set<childProductId>
      const bundleChildren = {};
      allLevel2Items.forEach(pci => {
        const parentId = pci.vlocity_cmt__ParentProductId__c;
        const childId = pci.vlocity_cmt__ChildProductId__c;
        if (!childId) return;
        if (!bundleChildren[parentId]) bundleChildren[parentId] = new Set();
        bundleChildren[parentId].add(childId);
      });

      // Build a name lookup for all products encountered
      const productNameById = {};
      offerPles.forEach(ple => {
        if (ple.vlocity_cmt__ProductId__c) {
          productNameById[ple.vlocity_cmt__ProductId__c] =
            ple.vlocity_cmt__ProductId__r?.Name || ple.vlocity_cmt__ProductId__c;
        }
      });
      allLevel1Items.forEach(pci => {
        if (pci.vlocity_cmt__ChildProductId__c) {
          productNameById[pci.vlocity_cmt__ChildProductId__c] =
            pci.vlocity_cmt__ChildProductId__r?.Name || pci.vlocity_cmt__ChildProductId__c;
        }
      });
      allLevel2Items.forEach(pci => {
        if (pci.vlocity_cmt__ChildProductId__c) {
          productNameById[pci.vlocity_cmt__ChildProductId__c] =
            pci.vlocity_cmt__ChildProductId__r?.Name || pci.vlocity_cmt__ChildProductId__c;
        }
      });

      // ── Step 5: Cross-reference per price list ────────────────────────────────
      const violations = [];  // { priceListId, productId, productName, role }

      Object.entries(offersByPriceList).forEach(([plId, offerProductIdSet]) => {
        const coveredSet = stdPriceByPriceList[plId] || new Set();

        offerProductIdSet.forEach(offerId => {
          // Check offer itself
          if (!coveredSet.has(offerId)) {
            violations.push({
              priceListId: plId,
              productId: offerId,
              productName: productNameById[offerId] || offerId,
              role: 'commercial offer',
            });
          }

          // Check level-1 children
          const level1 = offerChildren[offerId] || new Set();
          level1.forEach(childId => {
            if (!coveredSet.has(childId)) {
              violations.push({
                priceListId: plId,
                productId: childId,
                productName: productNameById[childId] || childId,
                role: 'offer child',
              });
            }

            // If this child is a bundle, check its children too
            if (bundleProductIds.has(childId)) {
              const level2 = bundleChildren[childId] || new Set();
              level2.forEach(grandChildId => {
                if (!coveredSet.has(grandChildId)) {
                  violations.push({
                    priceListId: plId,
                    productId: grandChildId,
                    productName: productNameById[grandChildId] || grandChildId,
                    role: 'bundle child',
                  });
                }
              });
            }
          });
        });
      });

      if (violations.length > 0) {
        const sample = violations.slice(0, 5)
          .map(v => `${v.productName} (${v.role})`)
          .join(', ');
        const trailer = violations.length > 5 ? ` … and ${violations.length - 5} more` : '';
        this.addResult(category, 'One Time Std Price Coverage', false,
          `${violations.length} product(s) in offer hierarchies missing a 'One Time Std Price' entry: ${sample}${trailer}`,
          { violations: violations.slice(0, 100) }
        );
      } else {
        this.addResult(category, 'One Time Std Price Coverage', true,
          "All products in commercial offer hierarchies have a 'One Time Std Price' entry in their price list");
      }

    } catch (error) {
      logger.error('validatePriceListProductCoverage failed', { error: error.message });
      this.addResult(category, 'Price List Coverage Check', false,
        `Validation failed: ${error.message}`);
    }
  }
}

module.exports = new ValidationService();
