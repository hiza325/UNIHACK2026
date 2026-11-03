/*
 * Builds tests/fixtures/ai-acceptance-tests.json and docs/qa/TEST_CASE_CATALOG.md
 * from the case sources in tests/qa/.
 *
 * Statuses are never invented here: a case only becomes PASS/FAIL if
 * docs/qa/run-evidence.json — written by an actual execution of
 * tests/ai-acceptance.spec.js — reports it. Otherwise it stays DESIGNED,
 * NOT_RUN, BLOCKED or NOT_IMPLEMENTED.
 *
 * Usage: node tests/qa/build-catalog.mjs
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mathGoldCases } from './cases/math-gold.mjs';
import { insufficientGoldCases } from './cases/insufficient-gold.mjs';
import { codeGoldCases } from './cases/code-gold.mjs';
import { securityGoldCases } from './cases/security-gold.mjs';
import { platformCases } from './cases/platform-cases.mjs';
import { systematicVariants } from './cases/systematic-variants.mjs';
import { MUTANT_CLASSES, buildMutants } from './mutants.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const EVIDENCE_PATH = join(repoRoot, 'docs', 'qa', 'run-evidence.json');
const FIXTURE_PATH = join(repoRoot, 'tests', 'fixtures', 'ai-acceptance-tests.json');
const CATALOG_PATH = join(repoRoot, 'docs', 'qa', 'TEST_CASE_CATALOG.md');

const STATUS_LEGEND = {
  DESIGNED: 'Đã thiết kế, chưa đối chiếu với code.',
  NOT_RUN: 'Đã thiết kế và có tiêu chí, chưa chạy.',
  PASS: 'Đã chạy và thỏa toàn bộ tiêu chí bắt buộc (chỉ lấy từ run-evidence.json).',
  FAIL: 'Đã chạy và vi phạm ít nhất một tiêu chí bắt buộc.',
  BLOCKED: 'Không chạy được vì thiếu điều kiện môi trường (provider/DB/Staging).',
  NOT_IMPLEMENTED: 'Chức năng không tồn tại trên checkout đang kiểm thử.',
};

function readEvidence() {
  if (!existsSync(EVIDENCE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(EVIDENCE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function gitInfo() {
  const run = command => {
    try {
      return execSync(command, { cwd: repoRoot, encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  return {
    branch: run('git rev-parse --abbrev-ref HEAD'),
    commit: run('git rev-parse HEAD'),
    subject: run('git log -1 --format=%s'),
    dirty: run('git status --porcelain').length > 0,
  };
}

function providerStatus() {
  return {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ? 'configured' : 'absent',
    ANYROUTER_LEARNING_API_KEY: process.env.ANYROUTER_LEARNING_API_KEY ? 'configured' : 'absent',
    ANYROUTER_LEARNING_MODEL: process.env.ANYROUTER_LEARNING_MODEL ? 'configured' : 'absent',
    ANYROUTER_API_KEY: process.env.ANYROUTER_API_KEY ? 'configured' : 'absent',
    note: 'Chỉ có giá trị của biến ANYROUTER_API_KEY cho widget hỗ trợ; luồng học chưa có key nào.',
  };
}

function goldEntry(item) {
  const selfCheck = typeof item.gold.selfCheck === 'function' ? item.gold.selfCheck : null;
  let goldVerified = null;
  let goldCheckError = null;
  if (selfCheck) {
    try {
      goldVerified = selfCheck() === true;
    } catch (error) {
      goldVerified = false;
      goldCheckError = String(error.message).slice(0, 200);
    }
  }
  return {
    ...item,
    gold: { ...item.gold, selfCheck: undefined, goldVerified, goldCheckError },
    ruleCount: (item.rules || []).length,
    mandatoryRules: (item.rules || []).filter(rule => rule.mandatory !== false).map(rule => rule.rule),
    source: 'E1/E2/E3 gold dataset',
  };
}

function mutantClassEntries() {
  const parents = [...mathGoldCases, ...insufficientGoldCases, ...codeGoldCases, ...securityGoldCases];
  return MUTANT_CLASSES.map(mutantClass => {
    const applicable = parents.filter(parent => buildMutants(parent).some(mutant => mutant.mutantClass === mutantClass.name));
    return {
      testCaseId: mutantClass.variantId,
      category: 'V-grader-metamorphic',
      title: `Metamorphic: ${mutantClass.name}`,
      priority: 'P1',
      severity: 'Major',
      preconditions: 'Evaluator và bộ gold đã được nạp.',
      input: `${applicable.length} bài gold, mỗi bài một bản trả lời bị hỏng theo lớp "${mutantClass.name}".`,
      expectedOutput: 'Evaluator phải từ chối 100% các bản hỏng này; nếu bản nào được chấp nhận thì evaluator có lỗi.',
      evaluationMethod: 'metamorphic_property',
      execution: 'exec',
      requiresProvider: false,
      reviewerStatus: 'PENDING_EXPERT_REVIEW',
      evidence: `Áp dụng cho ${applicable.length}/${parents.length} bài gold (danh sách trong fixture JSON).`,
      parentCaseId: null,
      appliesTo: applicable.map(item => item.testCaseId),
      systematicTechnique: 'metamorphic',
      status: 'DESIGNED',
      mutantClass: mutantClass.name,
      description: mutantClass.description,
    };
  });
}

const evidence = readEvidence();
const baseline = gitInfo();

const cases = [
  ...[...mathGoldCases, ...insufficientGoldCases, ...codeGoldCases, ...securityGoldCases].map(goldEntry),
  ...platformCases,
  ...mutantClassEntries(),
  ...systematicVariants,
].map(item => {
  const reported = evidence?.cases?.[item.testCaseId];
  const status = reported?.status
    || (item.execution === 'absent-check' ? 'NOT_IMPLEMENTED'
      : item.execution === 'provider' ? 'BLOCKED'
        : item.execution === 'staging' ? 'BLOCKED'
          : item.execution === 'manual' ? 'NOT_RUN'
            : 'NOT_RUN');
  return {
    ...item,
    status,
    actualOutput: reported?.actualOutput ?? null,
    latencyMs: Number.isFinite(reported?.latencyMs) ? reported.latencyMs : null,
    attempts: reported?.attempts ?? null,
    retryCount: reported?.retryCount ?? null,
    provider: reported?.provider ?? null,
    model: reported?.model ?? null,
    statusNote: reported?.statusNote ?? (status === 'BLOCKED' ? 'Thiếu điều kiện môi trường, xem RISK_REGISTER R-02/R-01.' : null),
    executedAt: reported?.executedAt ?? null,
    requestId: reported?.requestId ?? null,
  };
});

const byCategory = {};
const byStatus = {};
for (const item of cases) {
  byCategory[item.category] = (byCategory[item.category] || 0) + 1;
  byStatus[item.status] = (byStatus[item.status] || 0) + 1;
}

const fixture = {
  schemaVersion: 'paradox-ai-acceptance-catalog-v1',
  generatedAt: new Date().toISOString(),
  generatedBy: 'tests/qa/build-catalog.mjs',
  baseline,
  providerStatus: providerStatus(),
  evidenceSource: evidence ? 'docs/qa/run-evidence.json' : 'chưa có run-evidence.json — mọi trạng thái là thiết kế chưa chạy',
  evidenceGeneratedAt: evidence?.generatedAt ?? null,
  statusLegend: STATUS_LEGEND,
  counts: { total: cases.length, byCategory, byStatus },
  rules: {
    neverSelfMarkedPass: 'Không có ô nào được đánh PASS thủ công; PASS/FAIL chỉ đến từ run-evidence.json.',
    goldAnswerIndependence: 'Mỗi bài gold có selfCheck tính lại đáp án chuẩn bằng số học JavaScript, không dùng AI.',
    notOnlyFinalAnswer: 'Mỗi bài gold có từ 3 rule trở lên, bắt buộc gồm vị trí lỗi hoặc dấu hiệu phương pháp, không chỉ so đáp án cuối.',
  },
  cases,
};

mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');

/* ------------------------------ markdown -------------------------------- */

function table(title, rows, columns) {
  const lines = [`## ${title}`, '', `| ${columns.map(column => column.header).join(' | ')} |`,
    `| ${columns.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${columns.map(column => column.cell(row)).join(' | ')} |`);
  return `${lines.join('\n')}\n`;
}

const short = (value, length = 90) => {
  const text = String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return text.length > length ? `${text.slice(0, length)}…` : text || '—';
};

const goldRows = cases.filter(item => item.source === 'E1/E2/E3 gold dataset');
const platformRows = cases.filter(item => item.source === undefined && !item.testCaseId.startsWith('V-'));
const variantRows = cases.filter(item => item.testCaseId.startsWith('V-') && !item.category.startsWith('V-grader'));
const graderRows = cases.filter(item => item.category === 'V-grader-metamorphic');

const markdown = [`# E4 — Test case catalog (${cases.length} cases)`, '',
  `Baseline: \`${baseline.branch}\` @ \`${baseline.commit.slice(0, 12)}\` (${baseline.subject})${baseline.dirty ? ' — working tree có thay đổi' : ''}.`,
  `Nguồn trạng thái: ${fixture.evidenceSource}${evidence ? ` (chạy lúc ${evidence.generatedAt})` : ''}.`,
  '',
  '> Trạng thái `PASS`/`FAIL` **không** được ghi tay. Chúng chỉ xuất hiện khi',
  '> `tests/ai-acceptance.spec.js` chạy và ghi `docs/qa/run-evidence.json`, sau đó file này được',
  '> sinh lại. Chưa chạy → `NOT_RUN`; thiếu provider/DB → `BLOCKED`; chức năng không có ở',
  '> checkout → `NOT_IMPLEMENTED`.',
  '',
  `**Phân bổ:** ${Object.entries(byCategory).map(([key, value]) => `${key} = ${value}`).join(' · ')}`,
  '',
  `**Trạng thái:** ${Object.entries(byStatus).map(([key, value]) => `${key} = ${value}`).join(' · ')}`,
  '',
  '### Legend',
  '',
  ...Object.entries(STATUS_LEGEND).map(([key, value]) => `- **${key}** — ${value}`),
  '',
  '### E1/E2/E3 — gold datasets (đáp án chuẩn đã được kiểm tra bằng số học độc lập)',
  '',
  '| ID | Category | Verdict chuẩn | Đáp án chuẩn | Vị trí lỗi kỳ vọng | Rules bắt buộc | Gold self-check | Status |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...goldRows.map(item => `| ${item.testCaseId} | ${item.category} | ${item.gold.verdict} | \`${short(item.gold.answer, 40)}\` | ${short(item.gold.errorLocation || item.rules.find(r => r.rule === 'errorLocation')?.params?.terms?.join(' / '), 60)} | ${item.mandatoryRules.join(', ')} | ${item.gold.goldVerified === true ? 'PASS' : item.gold.goldVerified === false ? `FAIL (${item.gold.goldCheckError || 'false'})` : '—'} | ${item.status} |`),
  '',
  table('E4 — platform cases (categories E–L)', platformRows, [
    { header: 'ID', cell: row => row.testCaseId },
    { header: 'Category', cell: row => row.category },
    { header: 'Tiêu đề', cell: row => short(row.title, 70) },
    { header: 'P/S', cell: row => `${row.priority}/${row.severity}` },
    { header: 'Evaluation method', cell: row => row.evaluationMethod },
    { header: 'Cách chạy', cell: row => row.execution },
    { header: 'Status', cell: row => row.status },
    { header: 'Evidence', cell: row => short(row.evidence, 60) },
  ]),
  table('E4 — systematic variants (traceability)', variantRows, [
    { header: 'ID', cell: row => row.testCaseId },
    { header: 'Technique', cell: row => row.systematicTechnique },
    { header: 'Parent', cell: row => row.parentCaseId },
    { header: 'Mô tả', cell: row => short(row.title, 60) },
    { header: 'Input', cell: row => short(row.input, 60) },
    { header: 'Expected', cell: row => short(row.expectedOutput, 60) },
    { header: 'Status', cell: row => row.status },
  ]),
  table('E4 — evaluator self-validation (metamorphic mutant classes)', graderRows, [
    { header: 'ID', cell: row => row.testCaseId },
    { header: 'Mutant class', cell: row => row.mutantClass },
    { header: 'Mô tả', cell: row => short(row.description, 70) },
    { header: 'Áp dụng cho', cell: row => `${row.appliesTo.length} bài gold` },
    { header: 'Expected', cell: () => 'evaluator từ chối 100%' },
    { header: 'Status', cell: row => row.status },
  ]),
  '## Ghi chú truy vết', '',
  '- Mỗi bài gold mang đủ trường: `ID · đề bài · lời giải chuẩn · đáp án chuẩn · phân loại · vị trí lỗi · loại lỗi · lỗi kỳ vọng AI phát hiện · expected behavior · tiêu chí PASS/FAIL`.',
  '- Bài nào chưa có chuyên gia độc lập rà soát mang `reviewerStatus = PENDING_EXPERT_REVIEW` (toàn bộ 46 bài gold và toàn bộ platform case).',
  '- Bài gold có `requiresProvider = true` đo **chất lượng câu trả lời của model** → `BLOCKED` trên checkout này; phần **hợp đồng và pipeline** của cùng bài đó vẫn chạy được và được ghi ở dòng riêng trong run-evidence.',
  ''].join('\n');

mkdirSync(dirname(CATALOG_PATH), { recursive: true });
writeFileSync(CATALOG_PATH, markdown, 'utf8');

console.log(`cases=${cases.length} gold=${goldRows.length} platform=${platformRows.length} variants=${variantRows.length} grader=${graderRows.length}`);
console.log('status:', JSON.stringify(byStatus));
console.log(`wrote ${FIXTURE_PATH}`);
console.log(`wrote ${CATALOG_PATH}`);
