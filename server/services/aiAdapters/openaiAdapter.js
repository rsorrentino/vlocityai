const OpenAI = require('openai');
const { toOpenAITools, executeTool: defaultExecuteTool, TOOL_DEFINITIONS } = require('../vlocityAgentTools');
const copilot = require('./githubCopilot');

const MAX_TOOL_ROUNDS = 10;

function normalizeOllamaBase(url) {
  const base = String(url || 'http://localhost:11434').replace(/\/+$/, '');
  return /\/v1$/.test(base) ? base : `${base}/v1`;
}

const ADAPTER_DEFAULTS = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  copilot: {
    // Real base URL comes from the Copilot token exchange (individual/business/enterprise)
    baseURL: copilot.DEFAULT_COPILOT_API,
    model: process.env.COPILOT_DEFAULT_MODEL || 'gpt-4.1',
    apiKeyEnv: 'GITHUB_COPILOT_TOKEN',
  },
  'github-models': {
    // GitHub Models: official OpenAI-compatible endpoint, works with a
    // fine-grained PAT that has the "models:read" permission.
    baseURL: process.env.GITHUB_MODELS_BASE_URL || 'https://models.github.ai/inference',
    model: process.env.GITHUB_MODELS_DEFAULT_MODEL || 'openai/gpt-4.1',
    apiKeyEnv: 'GITHUB_MODELS_TOKEN',
  },
  ollama: {
    baseURL: normalizeOllamaBase(process.env.OLLAMA_BASE_URL),
    model: process.env.OLLAMA_DEFAULT_MODEL || 'llama3.2',
    apiKeyEnv: null,
  },
};

const SUPPORTED_ADAPTERS = Object.keys(ADAPTER_DEFAULTS);

/**
 * Resolve the GitHub OAuth token used for Copilot, in priority order:
 *   1. token supplied with the request (advanced users)
 *   2. token stored for this user via "Sign in with GitHub"
 *   3. GITHUB_COPILOT_TOKEN on the server
 *   4. the local Copilot IDE plugin token (only if COPILOT_USE_LOCAL_TOKEN=true)
 * GITHUB_TOKEN is deliberately not used: it is normally a PAT or CI token,
 * which Copilot rejects (use the GitHub Models adapter for PATs).
 * @returns {Promise<{token:string|null, source:string|null, accountLogin?:string|null}>}
 */
async function resolveCopilotGitHubToken({ apiKey, userId, credentialStore } = {}) {
  if (apiKey) return { token: apiKey, source: 'request' };
  const store = credentialStore || require('../aiCredentialStore');
  if (userId) {
    try {
      const stored = await store.getCredential(userId, 'copilot');
      if (stored?.token) return { token: stored.token, source: 'user', accountLogin: stored.accountLogin };
    } catch {
      /* table not ready – fall through */
    }
  }
  if (process.env.GITHUB_COPILOT_TOKEN) return { token: process.env.GITHUB_COPILOT_TOKEN, source: 'env' };
  if (process.env.COPILOT_USE_LOCAL_TOKEN === 'true') {
    const local = copilot.discoverLocalCopilotToken();
    if (local) return { token: local, source: 'local' };
  }
  return { token: null, source: null };
}

/**
 * Build the OpenAI client options for an adapter.
 * Server-side API keys are never sent to a caller-supplied base URL.
 */
async function resolveClientOptions({ adapterType, apiKey, baseURL, userId, credentialStore, fetchImpl }) {
  const defaults = ADAPTER_DEFAULTS[adapterType];
  if (!defaults) throw new Error(`Unknown adapter: ${adapterType}`);

  if (adapterType === 'copilot') {
    const { token } = await resolveCopilotGitHubToken({ apiKey, userId, credentialStore });
    const session = await copilot.getCopilotSession(token, { fetchImpl });
    return {
      apiKey: session.token,
      baseURL: session.apiBase,
      defaultHeaders: copilot.copilotHeaders(),
    };
  }

  if (adapterType === 'ollama') {
    return { apiKey: 'ollama', baseURL: baseURL ? normalizeOllamaBase(baseURL) : defaults.baseURL };
  }

  // openai / github-models: a custom base URL is only honoured together with
  // a caller-supplied key, so the server's own key can't be exfiltrated.
  const envKey = defaults.apiKeyEnv ? process.env[defaults.apiKeyEnv]
    || (adapterType === 'github-models' ? process.env.GITHUB_TOKEN : undefined) : undefined;
  const key = apiKey || envKey;
  if (!key) {
    throw new Error(`No API key configured for ${adapterType}. Add one in the chat settings or set ${defaults.apiKeyEnv} on the server.`);
  }
  return {
    apiKey: key,
    baseURL: apiKey && baseURL ? baseURL : defaults.baseURL,
  };
}

/**
 * Run the OpenAI-compatible agentic loop and stream results via SSE.
 * Works for OpenAI, GitHub Copilot, GitHub Models and Ollama.
 *
 * @param {Object} params
 * @param {string} params.adapterType    - 'openai' | 'copilot' | 'github-models' | 'ollama'
 * @param {Array}  params.messages       - Conversation history [{role, content}]
 * @param {string} params.systemPrompt
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.baseURL        - Optional override (ignored for copilot)
 * @param {string} params.userId         - Used to look up stored credentials
 * @param {string} params.orgUsername
 * @param {Function} params.onToken
 * @param {Function} params.onToolStart
 * @param {Function} params.onToolEnd
 * @param {Function} [params.clientFactory] - test hook: (options) => OpenAI-like client
 * @returns {Promise<{content: string, tokensUsed: number, toolCalls: Array}>}
 */
async function runOpenAIStream({
  adapterType = 'openai',
  messages,
  systemPrompt,
  apiKey,
  model,
  baseURL,
  userId,
  orgUsername,
  onToken,
  onToolStart,
  onToolEnd,
  clientFactory,
  credentialStore,
  tools = TOOL_DEFINITIONS,
  executeTool = defaultExecuteTool,
}) {
  const defaults = ADAPTER_DEFAULTS[adapterType] || ADAPTER_DEFAULTS.openai;
  const resolvedModel = model || defaults.model;
  const makeClient = (opts) => (clientFactory ? clientFactory(opts) : new OpenAI(opts));

  let client = makeClient(await resolveClientOptions({ adapterType, apiKey, baseURL, userId, credentialStore }));

  // Copilot session tokens are short-lived: if one expires mid-conversation,
  // fetch a fresh one and retry the request once.
  const createCompletion = async (params) => {
    try {
      return await client.chat.completions.create(params);
    } catch (error) {
      if (adapterType !== 'copilot' || error?.status !== 401) throw error;
      const { token } = await resolveCopilotGitHubToken({ apiKey, userId, credentialStore });
      const session = await copilot.getCopilotSession(token, { force: true });
      client = makeClient({ apiKey: session.token, baseURL: session.apiBase, defaultHeaders: copilot.copilotHeaders() });
      return client.chat.completions.create(params);
    }
  };

  const openaiTools = toOpenAITools(tools);

  // Build initial message array
  let history = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  let fullResponse = '';
  let inputTokens = 0;
  let outputTokens = 0;
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await createCompletion({
      model: resolvedModel,
      messages: history,
      tools: openaiTools,
      tool_choice: 'auto',
      stream: true,
      // Ask for token usage in the final chunk (not sent to Copilot, whose
      // API does not document the option)
      ...(adapterType === 'copilot' ? {} : { stream_options: { include_usage: true } }),
    });

    let roundText = '';
    const pendingToolCalls = {};

    for await (const chunk of stream) {
      // Copilot can proxy non-OpenAI models that spread a turn over several
      // choices, so look at every choice instead of only choices[0].
      for (const choice of chunk.choices || []) {
        const delta = choice?.delta;
        if (!delta) continue;

        if (delta.content) {
          roundText += delta.content;
          onToken(delta.content);
        }

        // Accumulate tool call deltas
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            let idx = tc.index;
            if (idx === undefined || idx === null) {
              const existing = tc.id && Object.entries(pendingToolCalls).find(([, p]) => p.id === tc.id);
              idx = existing ? existing[0] : Object.keys(pendingToolCalls).length;
            }
            if (!pendingToolCalls[idx]) {
              pendingToolCalls[idx] = { id: '', name: '', arguments: '' };
            }
            const pending = pendingToolCalls[idx];
            // ids/names arrive once (OpenAI) or repeated on every chunk (some proxies)
            if (tc.id && !pending.id) pending.id = tc.id;
            if (tc.function?.name && !pending.name) pending.name = tc.function.name;
            if (tc.function?.arguments) pending.arguments += tc.function.arguments;
          }
        }
      }

      if (chunk.usage) {
        inputTokens += chunk.usage.prompt_tokens || 0;
        outputTokens += chunk.usage.completion_tokens || 0;
      }
    }

    const hasToolCalls = Object.keys(pendingToolCalls).length > 0;

    if (!hasToolCalls) {
      fullResponse += roundText;
      break;
    }

    // Add assistant message with tool calls
    const assistantToolCalls = Object.values(pendingToolCalls).map((tc, i) => ({
      id: tc.id || `call_${round}_${i}`,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    }));

    history.push({
      role: 'assistant',
      content: roundText || null,
      tool_calls: assistantToolCalls,
    });

    fullResponse += roundText;

    // Execute each tool and collect results
    const toolMessages = [];
    for (const tc of assistantToolCalls) {
      let parsedArgs = {};
      try { parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { parsedArgs = {}; }

      onToolStart(tc.function.name, parsedArgs);
      const result = await executeTool(tc.function.name, parsedArgs, orgUsername);
      onToolEnd(tc.function.name, result);

      toolCalls.push({ name: tc.function.name, input: parsedArgs, result });
      toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }

    history = [...history, ...toolMessages];
  }

  return {
    content: fullResponse,
    tokensUsed: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    model: resolvedModel,
    toolCalls,
  };
}

module.exports = {
  runOpenAIStream,
  resolveClientOptions,
  resolveCopilotGitHubToken,
  normalizeOllamaBase,
  ADAPTER_DEFAULTS,
  SUPPORTED_ADAPTERS,
};
