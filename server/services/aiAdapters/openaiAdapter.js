const OpenAI = require('openai');
const { toOpenAITools, executeTool } = require('../vlocityAgentTools');

const MAX_TOOL_ROUNDS = 10;

const ADAPTER_DEFAULTS = {
  openai: {
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  copilot: {
    baseURL: 'https://api.githubcopilot.com',
    model: 'gpt-4o',
    apiKeyEnv: 'GITHUB_TOKEN',
  },
  ollama: {
    baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
    model: 'llama3.2',
    apiKeyEnv: null,
  },
};

/**
 * Run the OpenAI-compatible agentic loop and stream results via SSE.
 * Works for OpenAI, GitHub Copilot, and Ollama (all share the same API shape).
 *
 * @param {Object} params
 * @param {string} params.adapterType    - 'openai' | 'copilot' | 'ollama'
 * @param {Array}  params.messages       - Conversation history [{role, content}]
 * @param {string} params.systemPrompt
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.baseURL        - Optional override
 * @param {string} params.orgUsername
 * @param {Function} params.onToken
 * @param {Function} params.onToolStart
 * @param {Function} params.onToolEnd
 * @returns {Promise<{content: string, tokensUsed: number, toolCalls: Array}>}
 */
async function runOpenAIStream({
  adapterType = 'openai',
  messages,
  systemPrompt,
  apiKey,
  model,
  baseURL,
  orgUsername,
  onToken,
  onToolStart,
  onToolEnd,
}) {
  const defaults = ADAPTER_DEFAULTS[adapterType] || ADAPTER_DEFAULTS.openai;
  const resolvedKey = apiKey || (defaults.apiKeyEnv ? process.env[defaults.apiKeyEnv] : 'ollama');
  const resolvedBase = baseURL || defaults.baseURL;
  const resolvedModel = model || defaults.model;

  const client = new OpenAI({
    apiKey: resolvedKey || 'ollama',
    baseURL: resolvedBase,
  });

  const openaiTools = toOpenAITools(require('../vlocityAgentTools').TOOL_DEFINITIONS);

  // Build initial message array
  let history = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  let fullResponse = '';
  let tokensUsed = 0;
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await client.chat.completions.create({
      model: resolvedModel,
      messages: history,
      tools: openaiTools,
      tool_choice: 'auto',
      stream: true,
    });

    let roundText = '';
    const pendingToolCalls = {};

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        roundText += delta.content;
        onToken(delta.content);
      }

      // Accumulate tool call deltas
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!pendingToolCalls[idx]) {
            pendingToolCalls[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) pendingToolCalls[idx].id += tc.id;
          if (tc.function?.name) pendingToolCalls[idx].name += tc.function.name;
          if (tc.function?.arguments) pendingToolCalls[idx].arguments += tc.function.arguments;
        }
      }

      if (chunk.usage) {
        tokensUsed += (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0);
      }
    }

    const hasToolCalls = Object.keys(pendingToolCalls).length > 0;

    if (!hasToolCalls) {
      fullResponse += roundText;
      break;
    }

    // Add assistant message with tool calls
    const assistantToolCalls = Object.values(pendingToolCalls).map(tc => ({
      id: tc.id,
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
      try { parsedArgs = JSON.parse(tc.function.arguments); } catch {}

      onToolStart(tc.function.name, parsedArgs);
      const result = await executeTool(tc.function.name, parsedArgs, orgUsername);
      onToolEnd(tc.function.name, result);

      toolCalls.push({ name: tc.function.name, input: parsedArgs, result });
      toolMessages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }

    history = [...history, ...toolMessages];
  }

  return { content: fullResponse, tokensUsed, toolCalls };
}

module.exports = { runOpenAIStream };
