const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Vlocity DataPack Manager API',
      version: '3.0.0',
      description: 'Enterprise-grade API for managing Salesforce Vlocity DataPack exports and deployments with intelligent error handling, export recovery, and file-based log storage',
      contact: {
        name: 'DataPack Manager Support',
        email: 'support@datapackmanager.com',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'http://localhost:3001',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false,
            },
            error: {
              type: 'object',
              properties: {
                message: {
                  type: 'string',
                  example: 'Error message',
                },
                statusCode: {
                  type: 'number',
                  example: 400,
                },
              },
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            message: {
              type: 'string',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            username: {
              type: 'string',
            },
            email: {
              type: 'string',
              format: 'email',
            },
            role: {
              type: 'string',
              enum: ['admin', 'user', 'viewer'],
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
            },
            name: {
              type: 'string',
            },
            type: {
              type: 'string',
              enum: ['export', 'deploy'],
            },
            status: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'aborted'],
            },
            progress: {
              type: 'number',
              minimum: 0,
              maximum: 100,
            },
            configuration: {
              type: 'object',
            },
            username: {
              type: 'string',
            },
            filePath: {
              type: 'string',
            },
            projectPath: {
              type: 'string',
            },
            environment: {
              type: 'string',
            },
            startedAt: {
              type: 'string',
              format: 'date-time',
            },
            completedAt: {
              type: 'string',
              format: 'date-time',
            },
            duration: {
              type: 'number',
            },
          },
        },
        LogEntry: {
          type: 'object',
          properties: {
            timestamp: {
              type: 'string',
              format: 'date-time',
              example: '2025-10-28T17:12:06.127Z',
            },
            level: {
              type: 'string',
              enum: ['info', 'warn', 'error', 'debug'],
              example: 'info',
            },
            message: {
              type: 'string',
              example: 'Export operation completed successfully',
            },
          },
        },
        LogsResponse: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            logs: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/LogEntry',
              },
            },
            total: {
              type: 'number',
              description: 'Total number of log entries',
              example: 5432,
            },
            offset: {
              type: 'number',
              description: 'Starting position',
              example: 0,
            },
            limit: {
              type: 'number',
              description: 'Maximum entries returned',
              example: 1000,
            },
            hasMore: {
              type: 'boolean',
              description: 'Whether more logs are available',
              example: true,
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        LogStats: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true,
            },
            stats: {
              type: 'object',
              properties: {
                exists: {
                  type: 'boolean',
                  example: true,
                },
                size: {
                  type: 'number',
                  description: 'File size in bytes',
                  example: 1048576,
                },
                sizeFormatted: {
                  type: 'string',
                  description: 'Human-readable file size',
                  example: '1 MB',
                },
                lines: {
                  type: 'number',
                  description: 'Number of log lines',
                  example: 5432,
                },
                created: {
                  type: 'string',
                  format: 'date-time',
                  description: 'File creation timestamp',
                },
                modified: {
                  type: 'string',
                  format: 'date-time',
                  description: 'Last modification timestamp',
                },
              },
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        ExportJob: {
          type: 'object',
          required: ['name', 'queries'],
          properties: {
            name: {
              type: 'string',
              description: 'Job name',
              example: 'Product Catalog Export',
            },
            projectPath: {
              type: 'string',
              description: 'Export directory path',
              example: './export',
              default: './export',
            },
            defaultMaxParallel: {
              type: 'number',
              description: 'Max parallel operations',
              example: 10,
              default: 10,
            },
            exportPacksMaxSize: {
              type: 'number',
              description: 'Max pack size',
              example: 5000,
              default: 5000,
            },
            removeInvalidMatchingKeyFields: {
              type: 'boolean',
              example: true,
              default: true,
            },
            maxDepth: {
              type: 'number',
              example: 0,
              default: 0,
            },
            queries: {
              type: 'array',
              description: 'SOQL queries for export',
              items: {
                type: 'object',
                properties: {
                  VlocityDataPackType: {
                    type: 'string',
                    example: 'SObject',
                  },
                  query: {
                    type: 'string',
                    example: 'SELECT Id FROM Product2 WHERE LastModifiedDate >= 2025-01-01T00:00:00.000+0000 AND GT_IsTechnicalProduct__c = false',
                  },
                },
              },
            },
            username: {
              type: 'string',
              description: 'Salesforce username',
            },
            environment: {
              type: 'string',
              description: 'Environment (dev, uat, prod)',
              example: 'dev',
            },
          },
        },
        DeployJob: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {
              type: 'string',
              description: 'Job name',
              example: 'Product Catalog Deploy',
            },
            projectPath: {
              type: 'string',
              description: 'Deploy directory path',
              example: './deploy',
              default: './deploy',
            },
            sourceUsername: {
              type: 'string',
              description: 'Source Salesforce org username',
            },
            targetUsername: {
              type: 'string',
              description: 'Target Salesforce org username',
            },
            attempts: {
              type: 'number',
              description: 'Number of retry attempts',
              example: 3,
              default: 3,
            },
            queries: {
              type: 'array',
              description: 'SOQL queries for deploy',
              items: {
                type: 'object',
                properties: {
                  VlocityDataPackType: {
                    type: 'string',
                    example: 'SObject',
                  },
                  query: {
                    type: 'string',
                    example: 'SELECT Id FROM Product2 WHERE GT_IsTechnicalProduct__c = false',
                  },
                },
              },
            },
            environment: {
              type: 'string',
              description: 'Environment (dev, uat, prod)',
              example: 'dev',
            },
          },
        },
        LoggingConfig: {
          type: 'object',
          properties: {
            verboseMode: {
              type: 'boolean',
              description: 'Verbose logging enabled',
              example: false,
            },
            debugMode: {
              type: 'boolean',
              description: 'Debug logging enabled',
              example: false,
            },
            logLevel: {
              type: 'string',
              enum: ['info', 'verbose', 'debug'],
              example: 'info',
            },
            activeJobLoggers: {
              type: 'number',
              description: 'Number of active job loggers',
              example: 5,
            },
            logsDirectory: {
              type: 'string',
              description: 'Logs directory path',
              example: './logs',
            },
          },
        },
        TempFileConfig: {
          type: 'object',
          properties: {
            keepTmpMode: {
              type: 'boolean',
              description: 'KEEP_TMP mode enabled',
              example: false,
            },
            tempDir: {
              type: 'string',
              description: 'Temporary directory path',
              example: './temp',
            },
          },
        },
        VersionInfo: {
          type: 'object',
          properties: {
            version: {
              type: 'string',
              description: 'Vlocity version',
              example: '1.17.18',
            },
            command: {
              type: 'string',
              description: 'Vlocity command to use',
              example: 'vlocity',
            },
            isAvailable: {
              type: 'boolean',
              description: 'Whether version is available',
              example: true,
            },
            isDefault: {
              type: 'boolean',
              description: 'Whether this is the default version',
              example: true,
            },
          },
        },
        PropertiesConfig: {
          type: 'object',
          properties: {
            properties: {
              type: 'object',
              description: 'Properties key-value pairs',
              additionalProperties: {
                type: 'string',
              },
            },
            loadedFiles: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
            environment: {
              type: 'string',
              example: 'dev',
            },
            fallbackOrder: {
              type: 'array',
              items: {
                type: 'string',
              },
            },
          },
        },
        SalesforceAuth: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'OAuth access token',
            },
            instanceUrl: {
              type: 'string',
              description: 'Salesforce instance URL',
            },
            id: {
              type: 'string',
              description: 'User ID',
            },
            tokenType: {
              type: 'string',
              example: 'Bearer',
            },
            expiresIn: {
              type: 'number',
              description: 'Token expiration in seconds',
            },
            isSandbox: {
              type: 'boolean',
              description: 'Whether this is a sandbox org',
            },
          },
        },
        CountryConfig: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Country code (ISO 3166-1 alpha-2)',
              example: 'US',
            },
            name: {
              type: 'string',
              description: 'Country name',
              example: 'United States',
            },
            currency: {
              type: 'string',
              description: 'Currency code (ISO 4217)',
              example: 'USD',
            },
            timezone: {
              type: 'string',
              description: 'Timezone (IANA)',
              example: 'America/New_York',
            },
            locale: {
              type: 'string',
              description: 'Locale code',
              example: 'en_US',
            },
            dateFormat: {
              type: 'string',
              description: 'Date format',
              example: 'MM/dd/yyyy',
            },
            vlocitySettings: {
              type: 'object',
              properties: {
                dataPackTypes: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                },
                defaultProjectPath: {
                  type: 'string',
                  example: './vlocity/us',
                },
                environment: {
                  type: 'string',
                  example: 'production',
                },
              },
            },
          },
        },
        PriceList: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Salesforce ID',
            },
            name: {
              type: 'string',
              description: 'Price list name',
            },
            description: {
              type: 'string',
            },
            effectiveDate: {
              type: 'string',
              format: 'date',
            },
            expirationDate: {
              type: 'string',
              format: 'date',
            },
            status: {
              type: 'string',
              enum: ['Draft', 'Active', 'Inactive'],
            },
            currency: {
              type: 'string',
              example: 'USD',
            },
            country: {
              type: 'string',
              example: 'US',
            },
            region: {
              type: 'string',
              example: 'North America',
            },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                  },
                  productId: {
                    type: 'string',
                  },
                  productName: {
                    type: 'string',
                  },
                  unitPrice: {
                    type: 'number',
                  },
                  listPrice: {
                    type: 'number',
                  },
                },
              },
            },
          },
        },
        Promotion: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Salesforce ID',
            },
            name: {
              type: 'string',
              description: 'Promotion name',
            },
            description: {
              type: 'string',
            },
            startDate: {
              type: 'string',
              format: 'date',
            },
            endDate: {
              type: 'string',
              format: 'date',
            },
            status: {
              type: 'string',
              enum: ['Draft', 'Active', 'Inactive', 'Expired'],
            },
            discountPercentage: {
              type: 'number',
              description: 'Discount percentage (0-100)',
              example: 10,
            },
            discountAmount: {
              type: 'number',
              description: 'Fixed discount amount',
              example: 5.99,
            },
            currency: {
              type: 'string',
              example: 'USD',
            },
            country: {
              type: 'string',
              example: 'US',
            },
            region: {
              type: 'string',
              example: 'North America',
            },
            productFamily: {
              type: 'string',
              example: 'Products',
            },
            category: {
              type: 'string',
              example: 'Electronics',
            },
            minQuantity: {
              type: 'number',
              description: 'Minimum quantity required',
            },
            maxQuantity: {
              type: 'number',
              description: 'Maximum quantity allowed',
            },
            isActive: {
              type: 'boolean',
            },
          },
        },
        DiscountCalculation: {
          type: 'object',
          properties: {
            originalPrice: {
              type: 'number',
              description: 'Original product price',
            },
            quantity: {
              type: 'number',
              description: 'Product quantity',
            },
            discount: {
              type: 'number',
              description: 'Calculated discount amount',
            },
            finalPrice: {
              type: 'number',
              description: 'Final price after discount',
            },
            discountPercentage: {
              type: 'number',
              description: 'Discount percentage applied',
            },
            discountAmount: {
              type: 'number',
              description: 'Fixed discount amount',
            },
            promotionId: {
              type: 'string',
              description: 'Promotion ID',
            },
            promotionName: {
              type: 'string',
              description: 'Promotion name',
            },
          },
        },
        Pipeline: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique pipeline identifier',
              example: 'pip_abc123',
            },
            name: {
              type: 'string',
              description: 'Pipeline name',
              example: 'Production Deployment',
            },
            description: {
              type: 'string',
              description: 'Optional description',
            },
            status: {
              type: 'string',
              enum: ['idle', 'running', 'completed', 'failed', 'aborted'],
              description: 'Current pipeline execution status',
              example: 'idle',
            },
            stages: {
              type: 'array',
              description: 'Ordered list of pipeline stages',
              items: {
                type: 'object',
                properties: {
                  name: {
                    type: 'string',
                    example: 'Export from DEV',
                  },
                  type: {
                    type: 'string',
                    enum: ['export', 'deploy', 'approval'],
                    example: 'export',
                  },
                  status: {
                    type: 'string',
                    enum: ['pending', 'running', 'completed', 'failed', 'awaiting_approval'],
                    example: 'pending',
                  },
                  config: {
                    type: 'object',
                    description: 'Stage-specific configuration',
                  },
                },
              },
            },
            currentStage: {
              type: 'integer',
              description: 'Zero-based index of the currently executing stage',
              example: 1,
            },
            createdBy: {
              type: 'string',
              description: 'ID of the user who created the pipeline',
            },
            startedBy: {
              type: 'string',
              description: 'ID of the user who last started the pipeline',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        Notification: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Unique notification identifier',
              example: 'notif_xyz789',
            },
            userId: {
              type: 'string',
              description: 'ID of the user this notification belongs to',
            },
            type: {
              type: 'string',
              description: 'Notification category',
              enum: ['info', 'success', 'warning', 'error'],
              example: 'success',
            },
            title: {
              type: 'string',
              description: 'Short notification title',
              example: 'Export completed',
            },
            message: {
              type: 'string',
              description: 'Full notification message',
              example: 'Export job job_20260315_abc123 completed successfully.',
            },
            read: {
              type: 'boolean',
              description: 'Whether the notification has been read',
              example: false,
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
        ExportHealthReport: {
          type: 'object',
          properties: {
            exportPath: {
              type: 'string',
              description: 'The scanned export directory path',
              example: '/var/app/export',
            },
            totalFiles: {
              type: 'integer',
              description: 'Total number of DataPack files found',
              example: 320,
            },
            coverage: {
              type: 'array',
              description: 'Per-DataPack-type coverage breakdown',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    example: 'Product2',
                  },
                  count: {
                    type: 'integer',
                    example: 150,
                  },
                  status: {
                    type: 'string',
                    enum: ['ok', 'warning', 'error'],
                    example: 'ok',
                  },
                  isExpectedType: {
                    type: 'boolean',
                    example: true,
                  },
                },
              },
            },
            crossRefIssues: {
              type: 'array',
              description: 'List of cross-reference integrity issues detected',
              items: {
                type: 'object',
                properties: {
                  source: {
                    type: 'string',
                    description: 'DataPack key of the file with the broken reference',
                    example: 'Product2/SKU-001',
                  },
                  target: {
                    type: 'string',
                    description: 'Missing reference target',
                  },
                  severity: {
                    type: 'string',
                    enum: ['warning', 'error'],
                    example: 'warning',
                  },
                },
              },
            },
            summary: {
              type: 'object',
              properties: {
                healthy: {
                  type: 'boolean',
                  example: true,
                },
                issueCount: {
                  type: 'integer',
                  example: 0,
                },
              },
            },
            scannedAt: {
              type: 'string',
              format: 'date-time',
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
    ],
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization',
      },
      {
        name: 'Catalog Manager',
        description: 'Salesforce Vlocity catalog object management (products, price lists, promotions, rate codes, snapshots)',
      },
      {
        name: 'Vlocity Commands',
        description: 'Execute and monitor Vlocity DataPack CLI commands',
      },
      {
        name: 'Export Jobs',
        description: 'Vlocity DataPack export operations',
      },
      {
        name: 'Deploy Jobs',
        description: 'Vlocity DataPack deployment operations',
      },
      {
        name: 'Job History',
        description: 'Job execution history and monitoring',
      },
      {
        name: 'Job Logs',
        description: 'File-based job log operations',
      },
      {
        name: 'System',
        description: 'System health and status',
      },
      {
        name: 'Salesforce Orgs',
        description: 'Salesforce org management',
      },
      {
        name: 'YAML Configuration',
        description: 'YAML job configuration management',
      },
      {
        name: 'Pricing',
        description: 'Vlocity pricing management',
      },
      {
        name: 'Promotions',
        description: 'Vlocity promotions management',
      },
      {
        name: 'Logging',
        description: 'Logging configuration and control',
      },
      {
        name: 'Temp Files',
        description: 'Temporary file management',
      },
      {
        name: 'Versions',
        description: 'Vlocity version management',
      },
      {
        name: 'Properties',
        description: 'Properties file management',
      },
      {
        name: 'Salesforce API',
        description: 'Salesforce API integration',
      },
      {
        name: 'Countries',
        description: 'Country configuration management',
      },
      {
        name: 'Environments',
        description: 'Environment-based configuration',
      },
      {
        name: 'Deployment Pipelines',
        description: 'Multi-stage deployment pipeline orchestration',
      },
      {
        name: 'Notifications',
        description: 'In-app notification management',
      },
      {
        name: 'Export Analysis',
        description: 'Vlocity build artifact analysis for export jobs',
      },
      {
        name: 'Export Health',
        description: 'Export directory health scanning and reporting',
      },
      {
        name: 'SFDMU',
        description: 'Salesforce Data Move Utility operations and configurations',
      },
      {
        name: 'Validation',
        description: 'Salesforce org and DataPack validation checks',
      },
      {
        name: 'Validation Fixes',
        description: 'Automated and manual fix operations for validation errors',
      },
      {
        name: 'Service Creation',
        description: 'Service creation ingestion, staging comparison and gap fix operations',
      },
      {
        name: 'Environment Comparison',
        description: 'Cross-org DataPack object comparison and sync',
      },
      {
        name: 'Pricing API',
        description: 'Vlocity price list and pricing entry management',
      },
      {
        name: 'Promotions API',
        description: 'Vlocity promotions management and discount calculation',
      },
      {
        name: 'Pricing Editor',
        description: 'Advanced pricing object editing and validation',
      },
      {
        name: 'Enhanced Exports',
        description: 'Enhanced export and deploy operations with validation',
      },
      {
        name: 'Enhanced Pricing',
        description: 'Enhanced price list, rate codes and rate table operations',
      },
    ],
  },
  apis: [
    require('path').join(__dirname, '../routes/*.js'), // Path to the API routes
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

