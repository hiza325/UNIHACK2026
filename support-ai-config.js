/*
 * Website-support AI configuration.
 *
 * The bundled /api/support serverless function reads ANYROUTER_API_KEY from
 * the server environment. Never put an API key in this frontend file.
 */
const runtimeConfig = globalThis.PARADOX_SUPPORT_AI_CONFIG || {};

export const SUPPORT_AI_CONFIG = {
  proxyUrl: '/api/support',
  maxHistory: 10,
  ...runtimeConfig,
};
