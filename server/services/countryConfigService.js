const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Country Configuration Service
 * Handles multi-country support and country-specific configurations
 */
class CountryConfigService {
  constructor() {
    this.countries = new Map();
    this.defaultCountry = process.env.DEFAULT_COUNTRY || 'AU';
    // Removed configDir creation - not used
    this.initializeDefaultCountries();
  }

  /**
   * Initialize default country configurations
   */
  initializeDefaultCountries() {
    const defaultCountries = {
      'AU': {
        code: 'AU',
        name: 'Australia',
        currency: 'AUD',
        timezone: 'Australia/Sydney',
        locale: 'en_AU',
        dateFormat: 'dd/MM/yyyy',
        numberFormat: '1,234.56',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard', 'VlocityOmniScript', 'VlocityDataRaptor'],
          defaultProjectPath: './vlocity/au',
          environment: 'production'
        },
        salesforceSettings: {
          orgType: 'production',
          apiVersion: 'v58.0',
          timeout: 30000
        },
        validation: {
          // Value substituted into {{countryCode}} in YAML test queries
          stagingFilter: 'AU',
          // Expected primary price list code (GT_CountryCode__c = 'AU', GT_IsPrimary__c = true)
          priceListCode: 'AU_STD',
          // Expected catalog name for country-scoped products
          catalogName: 'AU Product Catalog',
          // Expected pricing plan name
          pricingPlanName: 'AU Pricing Plan',
          // Org code used on GT custom objects (GT_OrgCode__c)
          orgCode: 'AU',
          // Expected number of primary price lists per country (used in price list completeness check)
          expectedPrimaryPriceLists: 1,
          // SKU format regex — AU uses 8 numeric digits with leading zeros
          skuPattern: '^\\d{8}$',
          skuPatternDescription: '8 numeric digits with leading zeros (e.g. 00012345)',
          // Attributes required on every product for this country
          requiredAttributes: ['Ear Side', 'Color', 'Supplier'],
          // Product2 fields required for this country (beyond the platform defaults)
          requiredProductFields: ['Name', 'ProductCode', 'vlocity_cmt__Type__c', 'Description'],
          // Currency code expected on price lists and pricebook entries
          expectedCurrency: 'AUD'
        }
      },
      'BE': {
        code: 'BE',
        name: 'Belgium',
        currency: 'EUR',
        timezone: 'Europe/Brussels',
        locale: 'fr_BE',
        dateFormat: 'dd/MM/yyyy',
        numberFormat: '1.234,56',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard', 'VlocityOmniScript', 'VlocityDataRaptor', 'VlocityIntegrationProcedure'],
          defaultProjectPath: './vlocity/be',
          environment: 'production'
        },
        salesforceSettings: {
          orgType: 'production',
          apiVersion: 'v58.0',
          timeout: 30000
        },
        validation: {
          stagingFilter: 'BE',
          priceListCode: 'BE_STD',
          catalogName: 'BE Product Catalog',
          pricingPlanName: 'BE Pricing Plan',
          orgCode: 'BE',
          expectedPrimaryPriceLists: 1,
          skuPattern: '^BE-\\d{6}$',
          skuPatternDescription: 'Prefix BE- followed by 6 digits (e.g. BE-001234)',
          requiredAttributes: ['Ear Side', 'Color', 'Supplier'],
          requiredProductFields: ['Name', 'ProductCode', 'vlocity_cmt__Type__c', 'Description'],
          expectedCurrency: 'EUR'
        }
      },
      'ES': {
        code: 'ES',
        name: 'Spain',
        currency: 'EUR',
        timezone: 'Europe/Madrid',
        locale: 'es_ES',
        dateFormat: 'dd/MM/yyyy',
        numberFormat: '1.234,56',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard', 'VlocityOmniScript', 'VlocityDataRaptor'],
          defaultProjectPath: './vlocity/es',
          environment: 'production'
        },
        salesforceSettings: {
          orgType: 'production',
          apiVersion: 'v58.0',
          timeout: 30000
        },
        validation: {
          stagingFilter: 'ES',
          priceListCode: 'ES_STD',
          catalogName: 'ES Product Catalog',
          pricingPlanName: 'ES Pricing Plan',
          orgCode: 'ES',
          expectedPrimaryPriceLists: 1,
          skuPattern: '^ES-[A-Z0-9]{6}$',
          skuPatternDescription: 'Prefix ES- followed by 6 alphanumeric characters (e.g. ES-AB1234)',
          requiredAttributes: ['Ear Side', 'Color', 'Supplier'],
          requiredProductFields: ['Name', 'ProductCode', 'vlocity_cmt__Type__c', 'Description'],
          expectedCurrency: 'EUR'
        }
      }
    };

    // Load default countries
    for (const [code, config] of Object.entries(defaultCountries)) {
      this.countries.set(code, config);
    }

    logger.log('info', `Initialized ${this.countries.size} default country configurations`, {
      countries: Array.from(this.countries.keys()),
      service: 'countryConfigService'
    });
  }

  /**
   * Get country configuration
   */
  getCountryConfig(countryCode) {
    const normalizedCode = countryCode?.toUpperCase();
    return this.countries.get(normalizedCode) || this.countries.get(this.defaultCountry);
  }

  /**
   * Get all available countries
   */
  getAllCountries() {
    return Array.from(this.countries.values());
  }

  /**
   * Get country codes
   */
  getCountryCodes() {
    return Array.from(this.countries.keys());
  }

  /**
   * Add or update country configuration
   */
  addCountryConfig(countryCode, config) {
    const normalizedCode = countryCode.toUpperCase();
    
    // Validate required fields
    if (!config.name || !config.currency || !config.timezone) {
      throw new Error('Country configuration must include name, currency, and timezone');
    }

    const countryConfig = {
      code: normalizedCode,
      name: config.name,
      currency: config.currency,
      timezone: config.timezone,
      locale: config.locale || 'en_US',
      dateFormat: config.dateFormat || 'MM/dd/yyyy',
      numberFormat: config.numberFormat || '1,234.56',
      vlocitySettings: {
        dataPackTypes: config.vlocitySettings?.dataPackTypes || ['VlocityCard', 'VlocityOmniScript', 'VlocityDataRaptor'],
        defaultProjectPath: config.vlocitySettings?.defaultProjectPath || `./vlocity/${normalizedCode.toLowerCase()}`,
        environment: config.vlocitySettings?.environment || 'production',
        ...config.vlocitySettings
      },
      salesforceSettings: {
        orgType: config.salesforceSettings?.orgType || 'production',
        apiVersion: config.salesforceSettings?.apiVersion || 'v58.0',
        timeout: config.salesforceSettings?.timeout || 30000,
        ...config.salesforceSettings
      },
      ...config
    };

    this.countries.set(normalizedCode, countryConfig);
    
    logger.log('info', `Country configuration added/updated: ${normalizedCode}`, {
      countryCode: normalizedCode,
      countryName: config.name,
      service: 'countryConfigService'
    });

    return countryConfig;
  }

  /**
   * Remove country configuration
   */
  removeCountryConfig(countryCode) {
    const normalizedCode = countryCode.toUpperCase();
    
    if (normalizedCode === this.defaultCountry) {
      throw new Error('Cannot remove default country configuration');
    }

    const removed = this.countries.delete(normalizedCode);
    
    if (removed) {
      logger.log('info', `Country configuration removed: ${normalizedCode}`, {
        countryCode: normalizedCode,
        service: 'countryConfigService'
      });
    }

    return removed;
  }

  /**
   * Load country configuration from file
   * @deprecated - File-based loading removed, using in-memory config only
   */
  async loadCountryConfigFromFile(countryCode) {
    const normalizedCode = countryCode.toUpperCase();
    // Removed file path - not used
    const filePath = null;
    
    try {
      if (await fs.pathExists(filePath)) {
        const config = await fs.readJson(filePath);
        this.addCountryConfig(normalizedCode, config);
        
        logger.log('info', `Country configuration loaded from file: ${normalizedCode}`, {
          countryCode: normalizedCode,
          filePath,
          service: 'countryConfigService'
        });
        
        return config;
      }
    } catch (error) {
      logger.logError(error, {
        operation: 'loadCountryConfigFromFile',
        countryCode: normalizedCode,
        filePath,
        service: 'countryConfigService'
      });
    }
    
    return null;
  }

  /**
   * Save country configuration to file
   * @deprecated - File-based saving removed, using in-memory config only
   */
  async saveCountryConfigToFile(countryCode) {
    const normalizedCode = countryCode.toUpperCase();
    const config = this.getCountryConfig(normalizedCode);
    
    if (!config) {
      throw new Error(`Country configuration not found: ${normalizedCode}`);
    }

    // Removed file saving - not used
    logger.log('info', `Country configuration save skipped (in-memory only): ${normalizedCode}`, {
      countryCode: normalizedCode,
      service: 'countryConfigService'
    });
    
    return null;
  }

  /**
   * Load all country configurations from files
   * @deprecated - File-based loading removed, using in-memory config only
   */
  async loadAllCountryConfigsFromFiles() {
    // Removed file loading - not used
    logger.log('info', 'Country configurations loaded from memory (file loading removed)', {
      loadedCount: this.countries.size,
      service: 'countryConfigService'
    });
    
    return this.countries.size;
  }

  /**
   * Get validation configuration for a country.
   * Returns the `validation` block from the country config, or null if not found.
   */
  getValidationConfig(countryCode) {
    const config = this.getCountryConfig(countryCode);
    return config?.validation || null;
  }

  /**
   * Get Vlocity settings for a country
   */
  getVlocitySettings(countryCode) {
    const config = this.getCountryConfig(countryCode);
    return config.vlocitySettings;
  }

  /**
   * Get Salesforce settings for a country
   */
  getSalesforceSettings(countryCode) {
    const config = this.getCountryConfig(countryCode);
    return config.salesforceSettings;
  }

  /**
   * Get project path for a country
   */
  getProjectPath(countryCode, environment = null) {
    const vlocitySettings = this.getVlocitySettings(countryCode);
    const basePath = vlocitySettings.defaultProjectPath;
    
    if (environment) {
      return path.join(basePath, environment);
    }
    
    return basePath;
  }

  /**
   * Get data pack types for a country
   */
  getDataPackTypes(countryCode) {
    const vlocitySettings = this.getVlocitySettings(countryCode);
    return vlocitySettings.dataPackTypes;
  }

  /**
   * Get locale settings for a country
   */
  getLocaleSettings(countryCode) {
    const config = this.getCountryConfig(countryCode);
    return {
      locale: config.locale,
      dateFormat: config.dateFormat,
      numberFormat: config.numberFormat,
      currency: config.currency,
      timezone: config.timezone
    };
  }

  /**
   * Validate country configuration
   */
  validateCountryConfig(config) {
    const errors = [];
    
    if (!config.code) {
      errors.push('Country code is required');
    }
    
    if (!config.name) {
      errors.push('Country name is required');
    }
    
    if (!config.currency) {
      errors.push('Currency is required');
    }
    
    if (!config.timezone) {
      errors.push('Timezone is required');
    }
    
    if (config.vlocitySettings) {
      if (!Array.isArray(config.vlocitySettings.dataPackTypes)) {
        errors.push('Vlocity dataPackTypes must be an array');
      }
      
      if (!config.vlocitySettings.defaultProjectPath) {
        errors.push('Vlocity defaultProjectPath is required');
      }
    }
    
    if (config.salesforceSettings) {
      if (!config.salesforceSettings.apiVersion) {
        errors.push('Salesforce API version is required');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get country statistics
   */
  getCountryStats() {
    return {
      totalCountries: this.countries.size,
      defaultCountry: this.defaultCountry,
      countryCodes: this.getCountryCodes(),
      service: 'countryConfigService'
    };
  }

  /**
   * Search countries by criteria
   */
  searchCountries(criteria) {
    const { name, currency, timezone, locale } = criteria;
    const results = [];
    
    for (const country of this.countries.values()) {
      let matches = true;
      
      if (name && !country.name.toLowerCase().includes(name.toLowerCase())) {
        matches = false;
      }
      
      if (currency && country.currency !== currency) {
        matches = false;
      }
      
      if (timezone && country.timezone !== timezone) {
        matches = false;
      }
      
      if (locale && country.locale !== locale) {
        matches = false;
      }
      
      if (matches) {
        results.push(country);
      }
    }
    
    return results;
  }

  /**
   * Get countries by currency
   */
  getCountriesByCurrency(currency) {
    return this.searchCountries({ currency });
  }

  /**
   * Get countries by timezone
   */
  getCountriesByTimezone(timezone) {
    return this.searchCountries({ timezone });
  }

  /**
   * Export country configurations
   * @deprecated - File export removed, using in-memory config only
   */
  async exportCountryConfigs(exportPath = null) {
    // Removed file export - not used
    const exportDir = null;
    
    const exportData = {
      exportDate: new Date().toISOString(),
      defaultCountry: this.defaultCountry,
      countries: Object.fromEntries(this.countries)
    };
    
    const exportFilePath = path.join(exportDir, `countries-export-${Date.now()}.json`);
    await fs.writeJson(exportFilePath, exportData, { spaces: 2 });
    
    logger.log('info', `Country configurations exported`, {
      exportFilePath,
      countryCount: this.countries.size,
      service: 'countryConfigService'
    });
    
    return exportFilePath;
  }

  /**
   * Import country configurations
   */
  async importCountryConfigs(importFilePath) {
    try {
      const importData = await fs.readJson(importFilePath);
      
      if (importData.countries) {
        let importedCount = 0;
        
        for (const [code, config] of Object.entries(importData.countries)) {
          const validation = this.validateCountryConfig(config);
          
          if (validation.valid) {
            this.addCountryConfig(code, config);
            importedCount++;
          } else {
            logger.log('warn', `Invalid country configuration skipped: ${code}`, {
              countryCode: code,
              errors: validation.errors,
              service: 'countryConfigService'
            });
          }
        }
        
        logger.log('info', `Country configurations imported`, {
          importFilePath,
          importedCount,
          totalInFile: Object.keys(importData.countries).length,
          service: 'countryConfigService'
        });
        
        return importedCount;
      }
    } catch (error) {
      logger.logError(error, {
        operation: 'importCountryConfigs',
        importFilePath,
        service: 'countryConfigService'
      });
      throw error;
    }
    
    return 0;
  }
}

// Create singleton instance
const countryConfigService = new CountryConfigService();

module.exports = countryConfigService;
