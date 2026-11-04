/*
 * Website-support configuration.
 *
 * The bundled /api/support serverless function performs a local FAQ lookup and
 * does not call an AI provider. No provider key belongs in this frontend file.
 */
const runtimeConfig = globalThis.PARADOX_SUPPORT_AI_CONFIG || {};

export const SUPPORT_AI_CONFIG = {
  proxyUrl: '/api/support',
  maxHistory: 10,
  ...runtimeConfig,
};
