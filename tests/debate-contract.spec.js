/*
 * Server-side debate contract checks added in the AI upgrade round.
 *
 * The gateway here is a deterministic stub whose only job is to feed a canned
 * JSON text through the real server validator (validateDebateAnalysis). It is
 * NOT a claim that any AI provider works; provider behaviour is probed
 * separately against the real gateway.
 */
import { expect, test } from '@playwright/test';
import { createDebateAnalysisWithMeta } from '../api/debate.js';

const BASE = {
  mode: 'analyze',
  problem: 'Solve for x: 2x + 5 = 13',
  solution: '2x = 13 - 5\n2x = 8\nx = 8 - 2 = 6',
  language: 'en',
};

function validAnalysis(nextQuestion) {
  return {
    status: 'incorrect',
    summary: 'The first step is right but the last step is wrong.',
    confidence: 0.9,
    issues: [{
      category: 'method',
      step: 'x = 8 - 2 = 6',
      explanation: 'To undo a multiplication by 2 you must divide by 2, not subtract 2.',
      suggestion: 'Divide both sides by 2 and check the result.',
    }],
    strengths: ['2x = 13 - 5 is correct'],
    nextQuestion,
    reply: '',
    hint: null,
    comparison: null,
    evaluation: null,
  };
}

function stubGateway(captured, produce) {
  return {
    async complete(options) {
      captured.push(options);
      const value = produce(options);
      const text = JSON.stringify(value);
      return {
        value: options.validate ? options.validate(text) : value,
        text,
        provider: 'stub',
        providerModel: 'stub-model',
        attempts: 1,
        retryCount: 0,
        fallbackUsed: false,
        latencyMs: 1,
        trace: [],
      };
    },
  };
}

test.describe.configure({ mode: 'serial' });

test('rejects a nextQuestion that repeats a prior question', async () => {
  const question = 'What operation undoes multiplying by 2?';
  const captured = [];
  const gateway = stubGateway(captured, () => validAnalysis(question));
  await expect(createDebateAnalysisWithMeta({ ...BASE, previousQuestions: [question] }, { gateway }))
    .rejects.toMatchObject({ code: 'INVALID_OUTPUT', message: 'AI output repeated a previous question' });
  expect(captured).toHaveLength(1);
});

test('accepts a fresh nextQuestion after prior questions', async () => {
  const captured = [];
  const gateway = stubGateway(captured, () => validAnalysis('Divide both sides by what value?'));
  const result = await createDebateAnalysisWithMeta(
    { ...BASE, previousQuestions: ['What operation undoes multiplying by 2?'] },
    { gateway },
  );
  expect(result.analysis.nextQuestion).toBe('Divide both sides by what value?');
});

test('rejects a nextQuestion repeated from the previous analysis', async () => {
  const question = 'Which inverse operation applies to the last line?';
  const previousAnalysis = { ...validAnalysis(question) };
  const captured = [];
  const gateway = stubGateway(captured, () => validAnalysis(question));
  await expect(createDebateAnalysisWithMeta({
    ...BASE,
    mode: 'discuss',
    question: 'I am stuck, can you help?',
    previousAnalysis,
  }, { gateway })).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
});

test('resubmit requests a larger output budget than the other modes', async () => {
  const resubmitAnalysis = {
    ...validAnalysis('Can you fix the last step now?'),
    comparison: { summary: 'Still the same last step.', improvements: [], remainingIssues: ['Last step'] },
    evaluation: {
      evidenceSufficient: true,
      comment: 'Improved but not fixed.',
      criteria: {
        knowledgeAccuracy: { score: 20, evidence: 'Concepts are right.' },
        reasoningLogic: { score: 20, evidence: 'Logic holds.' },
        solutionCompleteness: { score: 20, evidence: 'Complete.' },
        errorRemediation: { score: 20, evidence: 'Not fixed.' },
      },
      correctedIssues: [],
      remainingIssues: ['Last step'],
    },
  };
  const captured = [];
  const gateway = stubGateway(captured, () => resubmitAnalysis);
  await createDebateAnalysisWithMeta({ ...BASE, mode: 'resubmit', previousSolution: 'x = 4' }, { gateway });
  expect(captured[0].maxOutputTokens).toBe(3000);

  const analyzeCaptured = [];
  const analyzeGateway = stubGateway(analyzeCaptured, () => validAnalysis('q'));
  await createDebateAnalysisWithMeta({ ...BASE }, { gateway: analyzeGateway });
  expect(analyzeCaptured[0].maxOutputTokens).toBe(2200);
});
