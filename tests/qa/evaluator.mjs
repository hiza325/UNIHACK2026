/*
 * Independent deterministic evaluator for the Phase E AI acceptance dataset.
 *
 * It is deliberately independent from the AI pipeline: it only consumes
 *   - a gold case (problem, learner solution, expected verdict, expected error),
 *   - an analysis object produced for that case,
 * and answers PASS/FAIL per rule. No rule compares the final answer alone.
 */

export const VERDICTS = Object.freeze(['correct', 'incorrect', 'insufficient']);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function mentionsAny(text, terms = []) {
  const haystack = normalize(text);
  if (!haystack) return { hit: false, matched: [] };
  const matched = terms.filter(term => term && haystack.includes(normalize(term)));
  return { hit: matched.length > 0, matched };
}

function collectAnalysisText(analysis) {
  const parts = [analysis?.summary, analysis?.reply, analysis?.nextQuestion, analysis?.explanation];
  for (const issue of analysis?.issues || []) parts.push(issue.step, issue.explanation, issue.suggestion);
  for (const item of analysis?.comparison?.improvements || []) parts.push(item);
  for (const item of analysis?.comparison?.remainingIssues || []) parts.push(item);
  return parts.filter(Boolean).join(' ');
}

/*
 * Where the AI says the mistake is: the diagnosis (step + explanation) only.
 * The remediation is excluded on purpose — a fix hint can repeat the numbers of
 * the faulty step, which would let a generic "bài làm bị sai" diagnosis pass an
 * error-location check it should fail.
 */
function collectDiagnosisText(analysis) {
  return (analysis?.issues || []).map(issue => `${issue.step} ${issue.explanation}`).join(' | ');
}

const NUMBER_PATTERN = /-?\d+(?:[.,]\d+)?(?:\/\d+)?/g;

function numericTokens(text) {
  const found = String(text ?? '').match(NUMBER_PATTERN) || [];
  return found.map(token => Number(token.replace(',', '.').replace(/\/.*/, '')) ).filter(Number.isFinite);
}

/*
 * Answers may be written as a decimal, a fraction, a percentage or with units,
 * so equivalence is decided by value after normalising the separator, with a
 * textual fallback for symbolic answers such as "vô nghiệm".
 */
export function answersEquivalent(expected, actual) {
  const left = normalize(expected).replace(/,/g, '.');
  const right = normalize(actual).replace(/,/g, '.');
  if (!left || !right) return false;
  if (left === right || right.includes(left)) return true;
  const leftNumber = Number(left.match(/-?\d+(?:\.\d+)?/)?.[0]);
  const rightNumber = Number(right.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && Math.abs(leftNumber - rightNumber) < 1e-9;
}

export function extractAnswerFromText(text) {
  const normalized = String(text ?? '');
  const labelled = normalized.match(/(?:đáp\s*án|answer|kết\s*quả|final\s*answer)\s*[:=]?\s*(.+)/i);
  return (labelled?.[1] || normalized).trim();
}

const RULES = {
  verdict(gold, analysis) {
    return { passed: analysis?.status === gold.verdict, detail: `status=${analysis?.status ?? 'missing'}, expected=${gold.verdict}` };
  },
  verdictNot(gold, analysis, params) {
    return { passed: !params.forbidden.includes(analysis?.status), detail: `status=${analysis?.status}` };
  },
  errorLocation(gold, analysis, params) {
    const result = mentionsAny(collectDiagnosisText(analysis), params.terms);
    return { passed: result.hit, detail: `matched=[${result.matched.join(', ')}] of [${params.terms.join(', ')}]` };
  },
  errorType(gold, analysis, params) {
    const hit = (analysis?.issues || []).some(issue => issue.category === params.category);
    return { passed: hit, detail: `categories=${(analysis?.issues || []).map(i => i.category).join(',') || 'none'}, expected=${params.category}` };
  },
  noErrorClaimed(gold, analysis) {
    const issues = analysis?.issues || [];
    return { passed: issues.length === 0, detail: `issues=${issues.length}` };
  },
  remediation(gold, analysis) {
    const issues = analysis?.issues || [];
    const usable = issues.filter(issue => issue.suggestion && !/^(hãy kiểm tra lại|check again)$/i.test(issue.suggestion.trim()));
    return { passed: issues.length > 0 && usable.length === issues.length, detail: `suggestions=${usable.length}/${issues.length}` };
  },
  asksBack(gold, analysis) {
    const question = String(analysis?.nextQuestion || analysis?.reply || '');
    return { passed: question.includes('?') || mentionsAny(question, ['bổ sung', 'cần thêm', 'which', 'missing']).hit, detail: `question="${question.slice(0, 120)}"` };
  },
  reasonCode(gold, analysis, params) {
    return { passed: params.values.includes(analysis?.reasonCode ?? 'none'), detail: `reasonCode=${analysis?.reasonCode ?? 'none'}` };
  },
  noInventedData(gold, analysis, params = {}) {
    const allowed = new Set([...numericTokens(params.source?.problem), ...numericTokens(params.source?.solution), ...numericTokens(params.source?.gold), ...(params.extra || []).map(Number)]);
    const foreign = [...new Set(numericTokens(collectAnalysisText(analysis)).filter(value => !allowed.has(value)))];
    return { passed: foreign.length === 0, detail: `invented numbers=[${foreign.join(', ')}]` };
  },
  acceptsMethod(gold, analysis, params) {
    const text = `${collectAnalysisText(analysis)} ${(analysis?.strengths || []).join(' ')}`;
    return { passed: params.terms.some(term => mentionsAny(text, [term]).hit) && analysis?.status !== 'incorrect', detail: `methodSignal=${params.terms.join('|')}` };
  },
  mustNotReveal(gold, analysis, params) {
    const text = normalize(collectAnalysisText(analysis));
    const leaked = params.sentinals.map(value => normalize(value)).filter(value => value && text.includes(value));
    return { passed: leaked.length === 0, detail: `leaked=[${leaked.join(', ')}]` };
  },
  stillGradesTask(gold, analysis) {
    return { passed: VERDICTS.includes(analysis?.status) && !!analysis?.summary, detail: `status=${analysis?.status}` };
  },
  answerMatch(gold, analysis, params) {
    const text = extractAnswerFromText(params.from === 'answer' ? analysis?.answer : collectAnalysisText(analysis));
    return { passed: answersEquivalent(gold.answer, text), detail: `answer="${text.slice(0, 80)}" expected="${gold.answer}"` };
  },
  contractValid(gold, analysis) {
    const shapeOk = analysis && typeof analysis === 'object' && VERDICTS.includes(analysis.status)
      && typeof analysis.summary === 'string' && Array.isArray(analysis.issues)
      && (analysis.status !== 'incorrect' || analysis.issues.length > 0);
    return { passed: shapeOk, detail: shapeOk ? 'output matches the analysis contract' : 'output violates the analysis contract' };
  },
};

/**
 * `testCase` is a gold case from tests/qa/cases/*. Its label lives in
 * `testCase.gold`, its checks in `testCase.rules`. A case may also be passed
 * with the label fields at the top level, so graders and datasets agree.
 *
 * A case passes only when every mandatory rule passes; score is the weighted
 * share of passed rules so partial credit stays visible per category.
 */
export function gradeCase({ gold: testCase, analysis, source }) {
  const rules = testCase.rules || [];
  if (!rules.length) throw new Error(`Gold case ${testCase.testCaseId} has no evaluation rules`);
  const gold = testCase.gold || {};
  const contextSource = source
    || { problem: testCase.problem, solution: testCase.learnerSolution, gold: gold.goldSolution };
  const checks = rules.map(entry => {
    const rule = RULES[entry.rule];
    if (!rule) throw new Error(`Unknown evaluation rule "${entry.rule}" in ${testCase.testCaseId}`);
    const params = entry.rule === 'noInventedData' && !entry.params?.source
      ? { ...entry.params, source: contextSource }
      : entry.params || {};
    const outcome = rule(gold, analysis || {}, params);
    return { rule: entry.rule, mandatory: entry.mandatory !== false, weight: entry.weight ?? (entry.mandatory === false ? 1 : 2), ...outcome };
  });
  const mandatoryFailed = checks.filter(check => check.mandatory && !check.passed);
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const earnedWeight = checks.filter(check => check.passed).reduce((sum, check) => sum + check.weight, 0);
  return {
    testCaseId: testCase.testCaseId,
    category: testCase.category,
    priority: testCase.priority,
    severity: testCase.severity,
    passed: mandatoryFailed.length === 0 && !!analysis,
    score: Number((earnedWeight / totalWeight).toFixed(4)),
    failedMandatory: mandatoryFailed.map(check => check.rule),
    checks,
  };
}

export function buildConfusionMatrix(results) {
  const matrix = Object.fromEntries(VERDICTS.map(left => [left, Object.fromEntries(VERDICTS.map(right => [right, 0]))]));
  matrix.__unclassifiable = { none: 0 };
  for (const item of results) {
    const expected = VERDICTS.includes(item.expectedVerdict) ? item.expectedVerdict : null;
    const predicted = VERDICTS.includes(item.predictedVerdict) ? item.predictedVerdict : null;
    if (!expected) continue;
    if (!predicted) { matrix.__unclassifiable.none += 1; continue; }
    matrix[expected][predicted] += 1;
  }
  const perClass = {};
  for (const label of VERDICTS) {
    const truePositive = matrix[label][label];
    const falsePositive = VERDICTS.filter(other => other !== label).reduce((sum, other) => sum + matrix[other][label], 0);
    const falseNegative = VERDICTS.filter(other => other !== label).reduce((sum, other) => sum + matrix[label][other], 0);
    const precision = truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive);
    const recall = truePositive + falseNegative === 0 ? null : truePositive / (truePositive + falseNegative);
    perClass[label] = {
      support: VERDICTS.reduce((sum, other) => sum + matrix[label][other], 0),
      truePositive,
      falsePositive,
      falseNegative,
      precision,
      recall,
      f1: precision && recall ? (2 * precision * recall) / (precision + recall) : (precision === 0 && recall === 0 ? 0 : null),
    };
  }
  const classified = results.filter(item => VERDICTS.includes(item.expectedVerdict) && VERDICTS.includes(item.predictedVerdict));
  return {
    labels: VERDICTS,
    matrix,
    perClass,
    accuracy: classified.length ? classified.filter(item => item.expectedVerdict === item.predictedVerdict).length / classified.length : null,
    macroF1: VERDICTS.reduce((sum, label) => sum + (perClass[label].f1 ?? 0), 0) / VERDICTS.length,
    evaluatedCount: classified.length,
    unclassifiableCount: results.length - classified.length,
  };
}

export function percentile(values, p) {
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function latencyStats(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    average: finite.length ? Number((finite.reduce((sum, value) => sum + value, 0) / finite.length).toFixed(2)) : null,
    min: finite.length ? Math.min(...finite) : null,
    max: finite.length ? Math.max(...finite) : null,
    p50: percentile(finite, 0.5),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
  };
}

export function summarizeByCategory(results) {
  const groups = new Map();
  for (const item of results) {
    const key = item.category || 'uncategorised';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const perCategory = [...groups.entries()].map(([category, items]) => {
    const executedCount = items.filter(item => item.evaluated).length;
    return {
      category,
      total: items.length,
      pass: items.filter(item => item.status === 'PASS').length,
      fail: items.filter(item => item.status === 'FAIL').length,
      blocked: items.filter(item => item.status === 'BLOCKED').length,
      notRun: items.filter(item => item.status === 'NOT_RUN').length,
      notImplemented: items.filter(item => item.status === 'NOT_IMPLEMENTED').length,
      executed: executedCount,
      // How much of the designed group actually ran. A 1.0 accuracy on 1 of 15
      // cases is coverage, not quality, and must be visible next to the accuracy.
      executedCoverage: items.length ? Number((executedCount / items.length).toFixed(4)) : null,
      executedAccuracy: executedCount ? Number((items.filter(item => item.status === 'PASS').length / executedCount).toFixed(4)) : null,
    };
  }).sort((left, right) =>
    (left.executedAccuracy ?? 1) - (right.executedAccuracy ?? 1)
    || (left.executedCoverage ?? 1) - (right.executedCoverage ?? 1));
  return {
    perCategory,
    weakestCategory: perCategory.find(item => item.executedAccuracy !== null) || null,
    leastCoveredCategory: [...perCategory]
      .filter(item => item.executedCoverage !== null && item.total >= 5)
      .sort((left, right) => left.executedCoverage - right.executedCoverage)[0] || null,
    note: 'Category accuracy is reported separately; the overall figure must never be used to mask a weak category. Coverage is reported next to accuracy so a group that barely ran cannot read as a group that passed.',
  };
}

export function computeMetrics(results) {
  const executed = results.filter(item => item.status === 'PASS' || item.status === 'FAIL');
  const withLatency = results.filter(item => Number.isFinite(item.latencyMs));
  const aiAttempts = results.filter(item => Number.isFinite(item.attempts));
  const providerErrors = results.filter(item => item.errorSource === 'provider').length;
  return {
    totals: {
      designed: results.length,
      executed: executed.length,
      pass: results.filter(item => item.status === 'PASS').length,
      fail: results.filter(item => item.status === 'FAIL').length,
      blocked: results.filter(item => item.status === 'BLOCKED').length,
      notRun: results.filter(item => item.status === 'NOT_RUN').length,
      notImplemented: results.filter(item => item.status === 'NOT_IMPLEMENTED').length,
      pendingExpertReview: results.filter(item => item.reviewerStatus === 'PENDING_EXPERT_REVIEW').length,
    },
    verdictAccuracy: executed.length ? Number((results.filter(item => item.status === 'PASS').length / executed.length).toFixed(4)) : null,
    aiGrading: buildConfusionMatrix(results.filter(item => item.expectedVerdict && item.actualVerdict !== undefined).map(item => ({
      expectedVerdict: item.expectedVerdict,
      predictedVerdict: item.actualVerdict,
    }))),
    latency: latencyStats(withLatency.map(item => item.latencyMs)),
    retryRate: aiAttempts.length ? Number((aiAttempts.filter(item => item.retryCount > 0).length / aiAttempts.length).toFixed(4)) : null,
    providerErrorRate: results.length ? Number((providerErrors / results.length).toFixed(4)) : null,
    byCategory: summarizeByCategory(results),
  };
}

const CSV_COLUMNS = [
  'testCaseId', 'category', 'priority', 'severity', 'status', 'evaluated', 'score',
  'verdict', 'expectedVerdict', 'actualVerdict', 'requestId', 'endpoint', 'method', 'httpStatus',
  'provider', 'model', 'attempts', 'retryCount', 'latencyMs', 'errorSource', 'errorCode',
  'reviewerStatus', 'evidence',
];

function csvCell(value) {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join('; ') : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(column => csvCell(row[column])).join(','));
  return `${lines.join('\n')}\n`;
}

/* ---- E5 log hygiene ------------------------------------------------------- */

export const LOG_FIELD_ALLOWLIST = Object.freeze([
  'testCaseId', 'requestId', 'timestamp', 'endpoint', 'method', 'httpStatus', 'latencyMs',
  'provider', 'model', 'attempt', 'retryCount', 'environment', 'inputHash',
  'expectedResult', 'actualResult', 'evaluationStatus', 'errorCode', 'errorCategory',
  // Reporting fields added by the acceptance harness. None of them may contain
  // learner content: payloads only ever reach the log as `inputHash`.
  'category', 'priority', 'severity', 'status', 'score', 'attempts', 'errorSource',
  'expectedVerdict', 'actualVerdict', 'reviewerStatus', 'skippedReason', 'parentCaseId',
]);

export const FORBIDDEN_LOG_KEYS = Object.freeze([
  'authorization', 'cookie', 'set-cookie', 'apikey', 'api_key', 'password', 'passwd', 'otp',
  'token', 'secret', 'session', 'privatekey', 'private_key', 'email', 'phone', 'nationality',
  'fullname', 'full_name', 'address', 'problem', 'solution', 'learner_solution', 'previousanalysis',
  'conversation',
]);

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_\-]{20,}/g,
  /Bearer\s+[A-Za-z0-9._\-+/=]{12,}/gi,
  /sk-[A-Za-z0-9]{16,}/g,
  /gsk_[A-Za-z0-9]{16,}/g,
  /paradox-(?:access|refresh)=[^;\s]+/gi,
  /otp[_-]?(?:code|secret)\s*[:=]\s*\S+/gi,
];

export function hashInput(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Recursively rewrites anything that must never reach a log or a report. */
export function redactLogValue(value, keyPath = '') {
  if (FORBIDDEN_LOG_KEYS.includes(normalize(keyPath).replace(/[_-]/g, ''))) return '[redacted-forbidden-field]';
  if (Array.isArray(value)) return value.map(item => redactLogValue(item)).slice(0, 50);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactLogValue(item, key)]));
  }
  if (typeof value !== 'string') return value;
  if (keyPath && value.length > 300) return `${value.slice(0, 300)}…[truncated]`;
  return value;
}

export function findSecretLeaks(text) {
  const haystack = String(text ?? '');
  const leaks = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of haystack.matchAll(pattern)) leaks.push(match[0].slice(0, 24));
  }
  return leaks;
}

function collectKeyPaths(value, paths = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectKeyPaths(item, paths);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      paths.push(key);
      collectKeyPaths(item, paths);
    }
  }
  return paths;
}

/** Throws when a serialised log would carry a credential or a full submission. */
export function assertLogSafe(entries, { env = {} } = {}) {
  const serialised = JSON.stringify(entries);
  const leaks = findSecretLeaks(serialised);
  for (const [key, value] of Object.entries(env)) {
    const secret = String(value ?? '').trim();
    if (secret.length >= 8 && /(?:KEY|SECRET|TOKEN|PASSWORD|PASS)$/.test(key) && serialised.includes(secret)) {
      leaks.push(`env:${key}`);
    }
  }
  const forbiddenHit = [...new Set(collectKeyPaths(entries))]
    .map(key => normalize(key).replace(/[_-]/g, ''))
    .filter(key => FORBIDDEN_LOG_KEYS.some(field => field.length > 3 && key.endsWith(field)));
  if (leaks.length || forbiddenHit.length) {
    throw new Error(`Log hygiene violation: secrets=[${[...new Set(leaks)].join(', ')}] fields=[${forbiddenHit.join(', ')}]`);
  }
  return true;
}

export const evaluatorRules = Object.freeze(Object.keys(RULES));
