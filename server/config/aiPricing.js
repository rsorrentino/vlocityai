/**
 * Estimated AI usage cost.
 *
 * Prices are USD per 1M tokens (input / output). Anthropic prices are the
 * first-party API list prices as of November 2026. Prices change and
 * contracts differ, so administrators can override or extend this table with
 * a JSON file at <DATA_DIR>/ai-pricing.json (or AI_PRICING_FILE):
 *
 *   { "claude-opus-5-5": { "input": 4, "output": 20 },
 *     "gpt-4.1": { "input": 2, "output": 8 } }
 *
 * Models without a price show token counts only (cost "unknown").
 * GitHub Copilot and Ollama are not billed per token by this app: Copilot is
 * covered by the user's Copilot plan, Ollama runs locally.
 */
const fs = require('fs');
const path = require('path');

const ANTHROPIC_PRICES = {
  'claude-fable-5-2': { input: 8, output: 40 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const FLAT_RATE_ADAPTERS = {
  copilot: 'Included in the GitHub Copilot plan',
  ollama: 'Local model (no per-token cost)',
};

let overrides = null;
let overridesLoadedFrom = null;

function overridesFile() {
  if (process.env.AI_PRICING_FILE) return path.resolve(process.env.AI_PRICING_FILE);
  const { getDataDir } = require('../utils/secrets');
  return path.join(getDataDir(), 'ai-pricing.json');
}

function loadOverrides() {
  const file = overridesFile();
  if (overrides && overridesLoadedFrom === file) return overrides;
  overridesLoadedFrom = file;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    overrides = Object.fromEntries(
      Object.entries(parsed || {}).filter(([, p]) => p && Number.isFinite(p.input) && Number.isFinite(p.output))
    );
  } catch {
    overrides = {};
  }
  return overrides;
}

/** Price per 1M tokens for a model, or null when unknown. */
function priceFor(model) {
  if (!model) return null;
  const table = { ...ANTHROPIC_PRICES, ...loadOverrides() };
  if (table[model]) return table[model];
  // Tolerate provider prefixes (e.g. GitHub Models "openai/gpt-4.1")
  const bare = String(model).split('/').pop();
  return table[bare] || null;
}

/**
 * @returns {{costUsd: number|null, note: string|null}}
 */
function estimateCost({ adapter, model, inputTokens = 0, outputTokens = 0 }) {
  if (FLAT_RATE_ADAPTERS[adapter]) return { costUsd: 0, note: FLAT_RATE_ADAPTERS[adapter] };
  const price = priceFor(model);
  if (!price) return { costUsd: null, note: 'No price configured for this model' };
  const cost = ((inputTokens || 0) * price.input + (outputTokens || 0) * price.output) / 1_000_000;
  return { costUsd: Math.round(cost * 1e6) / 1e6, note: null };
}

function _resetForTests() {
  overrides = null;
  overridesLoadedFrom = null;
}

module.exports = { estimateCost, priceFor, ANTHROPIC_PRICES, FLAT_RATE_ADAPTERS, _resetForTests };
