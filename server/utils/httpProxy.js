/**
 * Make Node's built-in fetch (used by the OpenAI, Anthropic and GitHub
 * Copilot clients) honour HTTPS_PROXY / HTTP_PROXY / NO_PROXY.
 *
 * Node's fetch ignores proxy environment variables by default, which breaks
 * AI adapters on corporate networks (common on managed Windows and macOS
 * laptops). Set AI_HTTP_PROXY=false to opt out.
 */
function configureHttpProxy(logger = console) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
    || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy || process.env.AI_HTTP_PROXY === 'false') return false;

  try {
    // eslint-disable-next-line global-require
    const { setGlobalDispatcher, EnvHttpProxyAgent } = require('undici');
    const originalEmitWarning = process.emitWarning;
    // EnvHttpProxyAgent prints an "experimental" warning once – keep logs clean
    process.emitWarning = (warning, ...rest) => {
      const text = typeof warning === 'string' ? warning : warning?.message;
      if (text && text.includes('EnvHttpProxyAgent')) return;
      originalEmitWarning.call(process, warning, ...rest);
    };
    try {
      setGlobalDispatcher(new EnvHttpProxyAgent());
    } finally {
      process.emitWarning = originalEmitWarning;
    }
    logger.info('Outbound HTTP proxy configured from environment');
    return true;
  } catch (error) {
    logger.warn(`Could not configure outbound HTTP proxy: ${error.message}`);
    return false;
  }
}

module.exports = { configureHttpProxy };
