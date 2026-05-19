const express = require('express');
const router = express.Router();
const { asyncHandler, ValidationError } = require('../middleware/errorHandler');
const countryConfigService = require('../services/countryConfigService');

/**
 * @swagger
 * /api/countries:
 *   get:
 *     summary: Get all available countries
 *     description: Retrieve list of all configured country configurations
 *     tags: [Countries]
 *     responses:
 *       200:
 *         description: Countries retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     countries:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/CountryConfig'
 *                     totalCountries:
 *                       type: number
 *                     defaultCountry:
 *                       type: string
 */
router.get('/', asyncHandler(async (req, res) => {
  const countries = countryConfigService.getAllCountries();
  
  res.json({
    success: true,
    data: {
      countries,
      totalCountries: countries.length,
      defaultCountry: countryConfigService.defaultCountry
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode
 * @desc Get specific country configuration
 * @access Public
 */
router.get('/:countryCode', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const config = countryConfigService.getCountryConfig(countryCode);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      config
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/countries
 * @desc Add or update country configuration
 * @access Public
 */
router.post('/', asyncHandler(async (req, res) => {
  const { countryCode, config } = req.body;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  if (!config) {
    throw new ValidationError('Country configuration is required');
  }
  
  // Validate configuration
  const validation = countryConfigService.validateCountryConfig(config);
  if (!validation.valid) {
    throw new ValidationError(`Invalid country configuration: ${validation.errors.join(', ')}`);
  }
  
  const addedConfig = countryConfigService.addCountryConfig(countryCode, config);
  
  res.json({
    success: true,
    message: `Country configuration ${countryCode.toUpperCase()} added/updated successfully`,
    data: {
      countryCode: countryCode.toUpperCase(),
      config: addedConfig
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route PUT /api/countries/:countryCode
 * @desc Update country configuration
 * @access Public
 */
router.put('/:countryCode', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  const { config } = req.body;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  if (!config) {
    throw new ValidationError('Country configuration is required');
  }
  
  // Validate configuration
  const validation = countryConfigService.validateCountryConfig(config);
  if (!validation.valid) {
    throw new ValidationError(`Invalid country configuration: ${validation.errors.join(', ')}`);
  }
  
  const updatedConfig = countryConfigService.addCountryConfig(countryCode, config);
  
  res.json({
    success: true,
    message: `Country configuration ${countryCode.toUpperCase()} updated successfully`,
    data: {
      countryCode: countryCode.toUpperCase(),
      config: updatedConfig
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route DELETE /api/countries/:countryCode
 * @desc Remove country configuration
 * @access Public
 */
router.delete('/:countryCode', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const removed = countryConfigService.removeCountryConfig(countryCode);
  
  if (!removed) {
    throw new ValidationError(`Country configuration ${countryCode.toUpperCase()} not found`);
  }
  
  res.json({
    success: true,
    message: `Country configuration ${countryCode.toUpperCase()} removed successfully`,
    data: {
      countryCode: countryCode.toUpperCase()
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode/vlocity-settings
 * @desc Get Vlocity settings for a country
 * @access Public
 */
router.get('/:countryCode/vlocity-settings', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const settings = countryConfigService.getVlocitySettings(countryCode);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      vlocitySettings: settings
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode/salesforce-settings
 * @desc Get Salesforce settings for a country
 * @access Public
 */
router.get('/:countryCode/salesforce-settings', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const settings = countryConfigService.getSalesforceSettings(countryCode);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      salesforceSettings: settings
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode/locale-settings
 * @desc Get locale settings for a country
 * @access Public
 */
router.get('/:countryCode/locale-settings', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const settings = countryConfigService.getLocaleSettings(countryCode);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      localeSettings: settings
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode/project-path
 * @desc Get project path for a country
 * @access Public
 */
router.get('/:countryCode/project-path', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  const { environment = null } = req.query;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const projectPath = countryConfigService.getProjectPath(countryCode, environment);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      environment,
      projectPath
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/:countryCode/datapack-types
 * @desc Get data pack types for a country
 * @access Public
 */
router.get('/:countryCode/datapack-types', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const dataPackTypes = countryConfigService.getDataPackTypes(countryCode);
  
  res.json({
    success: true,
    data: {
      countryCode: countryCode.toUpperCase(),
      dataPackTypes
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/search
 * @desc Search countries by criteria
 * @access Public
 */
router.get('/search', asyncHandler(async (req, res) => {
  const { name, currency, timezone, locale } = req.query;
  
  const criteria = {};
  if (name) criteria.name = name;
  if (currency) criteria.currency = currency;
  if (timezone) criteria.timezone = timezone;
  if (locale) criteria.locale = locale;
  
  const results = countryConfigService.searchCountries(criteria);
  
  res.json({
    success: true,
    data: {
      results,
      totalResults: results.length,
      criteria
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/by-currency/:currency
 * @desc Get countries by currency
 * @access Public
 */
router.get('/by-currency/:currency', asyncHandler(async (req, res) => {
  const { currency } = req.params;
  
  if (!currency) {
    throw new ValidationError('Currency is required');
  }
  
  const countries = countryConfigService.getCountriesByCurrency(currency);
  
  res.json({
    success: true,
    data: {
      currency,
      countries,
      totalCountries: countries.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/by-timezone/:timezone
 * @desc Get countries by timezone
 * @access Public
 */
router.get('/by-timezone/:timezone', asyncHandler(async (req, res) => {
  const { timezone } = req.params;
  
  if (!timezone) {
    throw new ValidationError('Timezone is required');
  }
  
  const countries = countryConfigService.getCountriesByTimezone(timezone);
  
  res.json({
    success: true,
    data: {
      timezone,
      countries,
      totalCountries: countries.length
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route GET /api/countries/stats
 * @desc Get country statistics
 * @access Public
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = countryConfigService.getCountryStats();
  
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/countries/load-from-files
 * @desc Load country configurations from files
 * @access Public
 */
router.post('/load-from-files', asyncHandler(async (req, res) => {
  const loadedCount = await countryConfigService.loadAllCountryConfigsFromFiles();
  
  res.json({
    success: true,
    message: `Loaded ${loadedCount} country configurations from files`,
    data: {
      loadedCount
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/countries/:countryCode/save-to-file
 * @desc Save country configuration to file
 * @access Public
 */
router.post('/:countryCode/save-to-file', asyncHandler(async (req, res) => {
  const { countryCode } = req.params;
  
  if (!countryCode) {
    throw new ValidationError('Country code is required');
  }
  
  const filePath = await countryConfigService.saveCountryConfigToFile(countryCode);
  
  res.json({
    success: true,
    message: `Country configuration ${countryCode.toUpperCase()} saved to file`,
    data: {
      countryCode: countryCode.toUpperCase(),
      filePath
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/countries/export
 * @desc Export all country configurations
 * @access Public
 */
router.post('/export', asyncHandler(async (req, res) => {
  const { exportPath = null } = req.body;
  
  const exportFilePath = await countryConfigService.exportCountryConfigs(exportPath);
  
  res.json({
    success: true,
    message: 'Country configurations exported successfully',
    data: {
      exportFilePath
    },
    timestamp: new Date().toISOString(),
  });
}));

/**
 * @route POST /api/countries/import
 * @desc Import country configurations from file
 * @access Public
 */
router.post('/import', asyncHandler(async (req, res) => {
  const { importFilePath } = req.body;
  
  if (!importFilePath) {
    throw new ValidationError('Import file path is required');
  }
  
  const importedCount = await countryConfigService.importCountryConfigs(importFilePath);
  
  res.json({
    success: true,
    message: `Imported ${importedCount} country configurations`,
    data: {
      importedCount,
      importFilePath
    },
    timestamp: new Date().toISOString(),
  });
}));

module.exports = router;
