const Anthropic = require('@anthropic-ai/sdk');
const { TOOL_DEFINITIONS, executeTool } = require('../vlocityAgentTools');

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 10;

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
 * @returns {Promise<{content: string, tokensUsed: number, toolCalls: Array}>}
 */
async function runAnthropicStream({ messages, systemPrompt, apiKey, model, orgUsername, onToken, onToolStart, onToolEnd }) {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const usedModel = model || DEFAULT_MODEL;

  // Convert history to Anthropic format (already compatible: [{role, content}])
  let history = messages.map(m => ({ role: m.role, content: m.content }));

  let fullResponse = '';
  let tokensUsed = 0;
  const toolCalls = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await client.messages.stream({
      model: usedModel,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages: history,
    });

    let roundText = '';
    const roundToolUse = [];

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          roundText += event.delta.text;
          onToken(event.delta.text);
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    tokensUsed += finalMessage.usage?.input_tokens + finalMessage.usage?.output_tokens || 0;

    // Check stop reason
    if (finalMessage.stop_reason === 'end_turn') {
      fullResponse += roundText;
      break;
    }

    if (finalMessage.stop_reason === 'tool_use') {
      fullResponse += roundText;

      // Collect tool use blocks
      const toolUseBlocks = finalMessage.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const block of toolUseBlocks) {
        onToolStart(block.name, block.input);
        const result = await executeTool(block.name, block.input, orgUsername);
        onToolEnd(block.name, result);

        toolCalls.push({ name: block.name, input: block.input, result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      // Append assistant turn + tool results to history
      history = [
        ...history,
        { role: 'assistant', content: finalMessage.content },
        { role: 'user', content: toolResults },
      ];
    } else {
      fullResponse += roundText;
      break;
    }
  }

  return { content: fullResponse, tokensUsed, toolCalls };
}

module.exports = { runAnthropicStream };
