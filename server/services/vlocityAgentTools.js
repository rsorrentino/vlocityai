const { spawn } = require('child_process');
const logger = require('../utils/logger');

// Run a SOQL query against a Salesforce org via the sf CLI
async function runSoql(soql, orgUsername) {
  return new Promise((resolve, reject) => {
    const args = ['data', 'query', '--query', soql, '--target-org', orgUsername, '--json'];
    const child = spawn('sf', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.status === 0 && parsed.result) {
          resolve(parsed.result);
        } else {
          reject(new Error(parsed.message || stderr || 'SOQL query failed'));
        }
      } catch {
        reject(new Error(stderr || stdout || 'Failed to parse sf CLI output'));
      }
    });

    child.on('error', err => reject(new Error(`sf CLI not found: ${err.message}`)));
  });
}

// Format query results into a concise string for the AI
function formatResults(result, label) {
  const records = result.records || [];
  const total = result.totalSize ?? records.length;
  if (total === 0) return `No ${label} found.`;

  const lines = records.slice(0, 20).map(r => {
    const { attributes, Id, ...rest } = r;
    return Object.entries(rest)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' | ');
  });

  const truncated = total > 20 ? ` (showing first 20 of ${total})` : '';
  return `Found ${total} ${label}${truncated}:\n${lines.join('\n')}`;
}

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(toolName, toolInput, orgUsername) {
  const org = toolInput.org_username || orgUsername;

  try {
    switch (toolName) {
      case 'list_catalogs': {
        const result = await runSoql(
          `SELECT Id, Name, vlocity_cmt__Active__c, vlocity_cmt__Description__c FROM vlocity_cmt__Catalog__c ORDER BY Name LIMIT 50`,
          org
        );
        return formatResults(result, 'catalogs');
      }

      case 'get_product': {
        const term = (toolInput.search_term || '').replace(/'/g, "\\'");
        const result = await runSoql(
          `SELECT Id, Name, ProductCode, IsActive, Family, Description FROM Product2 WHERE Name LIKE '%${term}%' ORDER BY Name LIMIT 20`,
          org
        );
        return formatResults(result, 'products');
      }

      case 'list_promotions': {
        const term = toolInput.product_name ? `WHERE Name LIKE '%${toolInput.product_name.replace(/'/g, "\\'")}%'` : '';
        const result = await runSoql(
          `SELECT Id, Name, vlocity_cmt__StartDate__c, vlocity_cmt__EndDate__c, vlocity_cmt__Active__c FROM vlocity_cmt__Promotion__c ${term} ORDER BY Name LIMIT 30`,
          org
        );
        return formatResults(result, 'promotions');
      }

      case 'get_catalog_products': {
        const catalogName = (toolInput.catalog_name || '').replace(/'/g, "\\'");
        const result = await runSoql(
          `SELECT Id, vlocity_cmt__Product__r.Name, vlocity_cmt__Catalog__r.Name, vlocity_cmt__Sequence__c FROM vlocity_cmt__CatalogProductRelationship__c WHERE vlocity_cmt__Catalog__r.Name LIKE '%${catalogName}%' ORDER BY vlocity_cmt__Sequence__c LIMIT 50`,
          org
        );
        return formatResults(result, 'catalog-product relationships');
      }

      case 'get_pricing': {
        const term = (toolInput.product_name || '').replace(/'/g, "\\'");
        const result = await runSoql(
          `SELECT Id, vlocity_cmt__Product__r.Name, vlocity_cmt__PriceList__r.Name, vlocity_cmt__Price__c, CurrencyIsoCode FROM vlocity_cmt__PriceListEntry__c WHERE vlocity_cmt__Product__r.Name LIKE '%${term}%' ORDER BY vlocity_cmt__Product__r.Name LIMIT 30`,
          org
        );
        return formatResults(result, 'price list entries');
      }

      case 'list_price_lists': {
        const result = await runSoql(
          `SELECT Id, Name, vlocity_cmt__Active__c, CurrencyIsoCode FROM vlocity_cmt__PriceList__c ORDER BY Name LIMIT 30`,
          org
        );
        return formatResults(result, 'price lists');
      }

      case 'get_product_attributes': {
        const term = (toolInput.product_name || '').replace(/'/g, "\\'");
        const result = await runSoql(
          `SELECT Id, vlocity_cmt__Product__r.Name, vlocity_cmt__Attribute__r.Name, vlocity_cmt__Value__c FROM vlocity_cmt__AttributeAssignment__c WHERE vlocity_cmt__Product__r.Name LIKE '%${term}%' ORDER BY vlocity_cmt__Attribute__r.Name LIMIT 50`,
          org
        );
        return formatResults(result, 'attribute assignments');
      }

      case 'run_soql': {
        const soql = toolInput.query;
        if (!soql) return 'Error: query parameter is required for run_soql';
        const safePattern = /^\s*SELECT\s/i;
        if (!safePattern.test(soql)) {
          return 'Error: only SELECT queries are allowed for safety';
        }
        const result = await runSoql(soql, org);
        return formatResults(result, 'records');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    logger.warn(`Tool ${toolName} failed`, { error: err.message, org });
    return `Error running ${toolName}: ${err.message}`;
  }
}

// ── Tool definitions (used by AI adapters) ────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'list_catalogs',
    description: 'List all Vlocity catalogs in the connected Salesforce org. Returns catalog names, IDs, and active status.',
    input_schema: {
      type: 'object',
      properties: {
        org_username: { type: 'string', description: 'Salesforce org username to query (optional, defaults to selected org)' },
      },
    },
  },
  {
    name: 'get_product',
    description: 'Search for Salesforce Product2 records by name. Returns product details including code, family, and active status.',
    input_schema: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'Partial or full product name to search for' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
      required: ['search_term'],
    },
  },
  {
    name: 'list_promotions',
    description: 'List Vlocity promotions, optionally filtered by product name. Returns promotion names, dates, and active status.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Optional product name to filter promotions' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
    },
  },
  {
    name: 'get_catalog_products',
    description: 'Get all products belonging to a specific catalog.',
    input_schema: {
      type: 'object',
      properties: {
        catalog_name: { type: 'string', description: 'Partial or full catalog name' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
      required: ['catalog_name'],
    },
  },
  {
    name: 'get_pricing',
    description: 'Get price list entries for a product. Returns price, currency, and price list name.',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Partial or full product name to look up pricing for' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'list_price_lists',
    description: 'List all Vlocity price lists in the org.',
    input_schema: {
      type: 'object',
      properties: {
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
    },
  },
  {
    name: 'get_product_attributes',
    description: 'Get attribute assignments for a product (configuration options, specs, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        product_name: { type: 'string', description: 'Partial or full product name' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
      required: ['product_name'],
    },
  },
  {
    name: 'run_soql',
    description: 'Run a custom SOQL SELECT query against the Salesforce org. Use for any data not covered by the other tools. Only SELECT statements are allowed.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A valid SOQL SELECT query' },
        org_username: { type: 'string', description: 'Salesforce org username to query (optional)' },
      },
      required: ['query'],
    },
  },
];

// Convert to OpenAI function-calling format
function toOpenAITools(definitions) {
  return definitions.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

module.exports = { executeTool, TOOL_DEFINITIONS, toOpenAITools };
