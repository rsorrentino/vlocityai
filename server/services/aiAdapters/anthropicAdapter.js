const Anthropic = require('@anthropic-ai/sdk');
const { TOOL_DEFINITIONS, executeTool: defaultExecuteTool } = require('../vlocityAgentTools');

// Default model for the chat agent; override per user in the chat settings or
// with DEFAULT_ANTHROPIC_MODEL.
const DEFAULT_MODEL = process.env.DEFAULT_ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_TOOL_ROUNDS = 10;
// Streaming request, so a generous ceiling is safe and avoids truncated answers
const MAX_TOKENS = 32000;

const REFUSAL_MESSAGE = 'Claude declined to answer this request.';

/**
 * Run the Anthropic agentic loop and stream results via SSE.
 *
 * @param {Object} params
 * @param {Array}  params.messages       - Conversation history [{role, content}]
 * @param {string} params.systemPrompt
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.orgUsername    - Default Salesforce org for tool calls
 * @param {Function} params.onToken      - Called with each streamed text token
 * @param {Function} params.onToolStart  - Called when a tool call begins
 * @param {Function} params.onToolEnd    - Called when a tool call completes
 * @param {Array}    [params.tools]       - Tool definitions (defaults to the read-only tools)
 * @param {Function} [params.executeTool] - (name, input, org) => Promise<string>
 * @param {Object}   [params.client]      - test hook: Anthropic-like client
 * @returns {Promise<{content, tokensUsed, inputTokens, outputTokens, model, toolCalls, stopReason}>}
 */
async function runAnthropicStream({
  messages,
  systemPrompt,
  apiKey,
  model,
  orgUsername,
  onToken,
  onToolStart,
  onToolEnd,
  tools = TOOL_DEFINITIONS,
  executeTool = defaultExecuteTool,
  client: injectedClient,
}) {
  const client = injectedClient || new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const usedModel = model || DEFAULT_MODEL;

  // Convert history to Anthropic format (already compatible: [{role, content}])
  let history = messages.map(m => ({ role: m.role, content: m.content }));

  let fullResponse = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = null;
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = client.messages.stream({
      model: usedModel,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages: history,
    });

    let roundText = '';
    stream.on('text', (delta) => {
      roundText += delta;
      onToken(delta);
    });

    const finalMessage = await stream.finalMessage();
    inputTokens += finalMessage.usage?.input_tokens || 0;
    outputTokens += finalMessage.usage?.output_tokens || 0;
    stopReason = finalMessage.stop_reason;
    fullResponse += roundText;

    if (finalMessage.stop_reason === 'refusal') {
      const note = fullResponse ? `\n\n_${REFUSAL_MESSAGE}_` : REFUSAL_MESSAGE;
      onToken(note);
      fullResponse += note;
      break;
    }

    if (finalMessage.stop_reason !== 'tool_use') break;

    const toolUseBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
    const toolResults = [];
    for (const block of toolUseBlocks) {
      onToolStart(block.name, block.input);
      const result = await executeTool(block.name, block.input, orgUsername);
      onToolEnd(block.name, result);

      toolCalls.push({ name: block.name, input: block.input, result });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }

    // Append the complete assistant turn (thinking blocks included, unchanged)
    // and all tool results in a single user message.
    history = [
      ...history,
      { role: 'assistant', content: finalMessage.content },
      { role: 'user', content: toolResults },
    ];
  }

  return {
    content: fullResponse,
    tokensUsed: inputTokens + outputTokens,
    inputTokens,
    outputTokens,
    model: usedModel,
    toolCalls,
    stopReason,
  };
}

module.exports = { runAnthropicStream, DEFAULT_MODEL, REFUSAL_MESSAGE };
