import { AI_PROVIDERS } from './_ai/providers.js';

// Support-only adapters: do not change Learning/Debate parsing or validation.
export function supportProviders() {
  const completions = new Map();
  const providers = AI_PROVIDERS.map(provider => ({
    ...provider,
    extractText(data) {
      const gemini = provider.id === 'gemini';
      const candidate = gemini ? data?.candidates?.[0] : data?.choices?.[0];
      const reason = gemini ? candidate?.finishReason : candidate?.finish_reason;
      const complete = gemini ? reason === 'STOP' : reason === 'stop';
      const limited = reason === 'MAX_TOKENS' || reason === 'length';
      completions.set(provider.id, {
        status: complete ? 'complete' : 'incomplete',
        ...(!complete ? { code: limited ? 'OUTPUT_LIMIT' : 'INCOMPLETE_OUTPUT' } : {}),
      });
      if (gemini) {
        return (candidate?.content?.parts || [])
          .filter(part => !part.thought && typeof part.text === 'string')
          .map(part => part.text).join('');
      }
      const content = candidate?.message?.content;
      return typeof content === 'string' ? content : Array.isArray(content)
        ? content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('')
        : '';
    },
  }));
  return { providers, completions };
}
