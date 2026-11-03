/*
 * Website-support AI configuration.
 *
 * The bundled /api/support serverless function uses the shared AI gateway, and
 * provider keys live only in the server environment. Never put an API key in
 * this frontend file.
 */
const runtimeConfig = globalThis.PARADOX_SUPPORT_AI_CONFIG || {};

export const SUPPORT_AI_CONFIG = {
  proxyUrl: '/api/support',
  maxHistory: 10,
  ...runtimeConfig,
};
