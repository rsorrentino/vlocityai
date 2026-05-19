const countryConfigService = require('../services/countryConfigService');

describe('CountryConfigService', () => {
  beforeEach(() => {
    // Reset to default state
    countryConfigService.countries.clear();
    countryConfigService.initializeDefaultCountries();
  });

  describe('Country Configuration', () => {
    it('should get country configuration', () => {
      const config = countryConfigService.getCountryConfig('US');
      
      expect(config).toBeDefined();
      expect(config.code).toBe('US');
      expect(config.name).toBe('United States');
    });

    it('should return default country config when code not found', () => {
      const config = countryConfigService.getCountryConfig('XX');
      
      expect(config).toBeDefined();
      expect(config.code).toBe(countryConfigService.defaultCountry);
    });

    it('should get all available countries', () => {
      const countries = countryConfigService.getAllCountries();
      
      expect(Array.isArray(countries)).toBe(true);
      expect(countries.length).toBeGreaterThan(0);
    });

    it('should get country codes', () => {
      const codes = countryConfigService.getCountryCodes();
      
      expect(Array.isArray(codes)).toBe(true);
      expect(codes.length).toBeGreaterThan(0);
    });
  });

  describe('Country Management', () => {
    it('should add country configuration', () => {
      const countryCode = 'XX';
      const config = {
        name: 'Test Country',
        currency: 'XXX',
        timezone: 'UTC',
        locale: 'en',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard'],
          defaultProjectPath: './vlocity/xx'
        },
        salesforceSettings: {
          apiVersion: 'v58.0'
        }
      };
      
      const addedConfig = countryConfigService.addCountryConfig(countryCode, config);
      
      expect(addedConfig.code).toBe(countryCode.toUpperCase());
      expect(countryConfigService.getCountryConfig(countryCode)).toBeDefined();
    });

    it('should remove country configuration', () => {
      const countryCode = 'XX';
      const config = {
        name: 'Test Country',
        currency: 'XXX',
        timezone: 'UTC',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard'],
          defaultProjectPath: './vlocity/xx'
        },
        salesforceSettings: {
          apiVersion: 'v58.0'
        }
      };
      
      countryConfigService.addCountryConfig(countryCode, config);
      
      const removed = countryConfigService.removeCountryConfig(countryCode);
      expect(removed).toBe(true);
    });

    it('should not remove default country', () => {
      const defaultCountry = countryConfigService.defaultCountry;
      
      expect(() => {
        countryConfigService.removeCountryConfig(defaultCountry);
      }).toThrow();
    });
  });

  describe('Country Settings', () => {
    it('should get Vlocity settings for a country', () => {
      const settings = countryConfigService.getVlocitySettings('US');
      
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty('dataPackTypes');
      expect(settings).toHaveProperty('defaultProjectPath');
    });

    it('should get Salesforce settings for a country', () => {
      const settings = countryConfigService.getSalesforceSettings('US');
      
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty('apiVersion');
    });

    it('should get locale settings for a country', () => {
      const settings = countryConfigService.getLocaleSettings('US');
      
      expect(settings).toBeDefined();
      expect(settings).toHaveProperty('locale');
      expect(settings).toHaveProperty('dateFormat');
      expect(settings).toHaveProperty('numberFormat');
      expect(settings).toHaveProperty('currency');
      expect(settings).toHaveProperty('timezone');
    });

    it('should get project path for a country', () => {
      const projectPath = countryConfigService.getProjectPath('US');
      
      expect(projectPath).toBeDefined();
      expect(typeof projectPath).toBe('string');
    });

    it('should get data pack types for a country', () => {
      const dataPackTypes = countryConfigService.getDataPackTypes('US');
      
      expect(Array.isArray(dataPackTypes)).toBe(true);
      expect(dataPackTypes.length).toBeGreaterThan(0);
    });
  });

  describe('Country Validation', () => {
    it('should validate country configuration', () => {
      const validConfig = {
        code: 'XX',
        name: 'Test Country',
        currency: 'XXX',
        timezone: 'UTC',
        vlocitySettings: {
          dataPackTypes: ['VlocityCard'],
          defaultProjectPath: './vlocity/xx'
        },
        salesforceSettings: {
          apiVersion: 'v58.0'
        }
      };
      
      const validation = countryConfigService.validateCountryConfig(validConfig);
      
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });

    it('should invalidate configuration with missing required fields', () => {
      const invalidConfig = {
        code: 'XX'
        // Missing name, currency, timezone
      };
      
      const validation = countryConfigService.validateCountryConfig(invalidConfig);
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Country Search', () => {
    it('should search countries by criteria', () => {
      const results = countryConfigService.searchCountries({ currency: 'USD' });
      
      expect(Array.isArray(results)).toBe(true);
    });

    it('should get countries by currency', () => {
      const countries = countryConfigService.getCountriesByCurrency('USD');
      
      expect(Array.isArray(countries)).toBe(true);
    });

    it('should get countries by timezone', () => {
      const countries = countryConfigService.getCountriesByTimezone('America/New_York');
      
      expect(Array.isArray(countries)).toBe(true);
    });
  });

  describe('Country Statistics', () => {
    it('should get country statistics', () => {
      const stats = countryConfigService.getCountryStats();
      
      expect(stats).toHaveProperty('totalCountries');
      expect(stats).toHaveProperty('defaultCountry');
      expect(stats).toHaveProperty('countryCodes');
    });
  });
});
