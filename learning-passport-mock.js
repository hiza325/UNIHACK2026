/* Clearly labelled frontend fixtures for the Phase 5 Learning Passport UI. */
const content = {
  vi: {
    level: 'Người học phản biện · Cấp 3', cohort: 'UniHack 2026 · Nhóm thử nghiệm',
    skills: [
      ['reasoning', 'Lập luận logic', 'Xây dựng chuỗi lập luận nhất quán và có căn cứ.'],
      ['error-remediation', 'Tự sửa lỗi', 'Nhận diện nguyên nhân và khắc phục lỗi trong lần nộp sau.'],
      ['knowledge-accuracy', 'Độ chính xác kiến thức', 'Áp dụng đúng khái niệm, quy tắc và điều kiện.'],
      ['solution-completeness', 'Trình bày đầy đủ', 'Bao quát các bước, điều kiện và kết luận cần thiết.'],
    ],
    assessments: [
      ['Đại số · Phương trình tuyến tính', 'Đại số'],
      ['Logic · Điều kiện cần và đủ', 'Logic'],
      ['Python · Xử lý danh sách', 'Lập trình'],
    ],
    credentials: [
      ['Năng lực lập luận đại số', 'Lập luận logic'],
      ['Tự sửa lỗi trong bài toán', 'Tự sửa lỗi'],
      ['Thử thách Python cơ bản', 'Lập trình'],
    ],
  },
  en: {
    level: 'Reflective learner · Level 3', cohort: 'UniHack 2026 · Pilot cohort',
    skills: [
      ['reasoning', 'Logical reasoning', 'Build consistent, evidence-based reasoning chains.'],
      ['error-remediation', 'Error remediation', 'Identify root causes and correct errors in a later attempt.'],
      ['knowledge-accuracy', 'Knowledge accuracy', 'Apply concepts, rules, and conditions correctly.'],
      ['solution-completeness', 'Solution completeness', 'Cover the required steps, conditions, and conclusion.'],
    ],
    assessments: [
      ['Algebra · Linear equations', 'Algebra'],
      ['Logic · Necessary and sufficient', 'Logic'],
      ['Python · List operations', 'Programming'],
    ],
    credentials: [
      ['Algebraic reasoning competency', 'Logical reasoning'],
      ['Error remediation in problem solving', 'Error remediation'],
      ['Python foundations challenge', 'Programming'],
    ],
  },
  jp: {
    level: '振り返り学習者・レベル3', cohort: 'UniHack 2026・パイロット',
    skills: [
      ['reasoning', '論理的推論', '根拠に基づく一貫した推論を組み立てます。'],
      ['error-remediation', '誤りの修正', '原因を特定し、次の提出で誤りを修正します。'],
      ['knowledge-accuracy', '知識の正確さ', '概念、規則、条件を正しく適用します。'],
      ['solution-completeness', '解答の完全性', '必要な手順、条件、結論を含めます。'],
    ],
    assessments: [
      ['代数・一次方程式', '代数'],
      ['論理・必要条件と十分条件', '論理'],
      ['Python・リスト操作', 'プログラミング'],
    ],
    credentials: [
      ['代数的推論能力', '論理的推論'],
      ['問題解決における誤りの修正', '誤りの修正'],
      ['Python基礎チャレンジ', 'プログラミング'],
    ],
  },
};

export function createMockLearningPassport(user, language = 'vi') {
  const copy = content[language] || content.vi;
  const displayName = String(user?.name || user?.email || 'Demo Learner');
  const email = String(user?.email || 'learner@example.com');
  const learnerId = String(user?.id || `demo-${email.toLowerCase()}`);
  const scores = [91, 86, 82, 78];
  const progress = [100, 92, 86, 74];
  return {
    schemaVersion: 'paradox-learning-passport-v1',
    passportId: `PLP-DEMO-${learnerId.replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase() || 'LEARNER'}`,
    source: { type: 'mock', isReal: false, label: 'MOCK DATA', generatedAt: '2026-10-27T00:00:00.000Z' },
    learner: { id: learnerId, displayName, email, level: copy.level, cohort: copy.cohort },
    summary: { overallScore: 84, progress: 81, completedAssessments: 12, learningHours: 18 },
    skills: copy.skills.map(([id, name, description], index) => ({
      id, name, description, score: scores[index], progress: progress[index], achieved: index < 3,
      evidenceCount: [5, 4, 4, 3][index], lastAssessedAt: ['2026-10-25', '2026-10-24', '2026-10-22', '2026-10-20'][index], source: 'mock',
    })),
    assessments: copy.assessments.map(([name, skill], index) => ({
      id: `mock-assessment-${index + 1}`, name, skill, score: [91, 86, 82][index],
      completedAt: ['2026-10-25', '2026-10-24', '2026-10-22'][index], evaluationStatus: 'pass', source: 'mock',
    })),
    credentials: copy.credentials.map(([name, skill], index) => ({
      id: `mock-credential-${index + 1}`,
      code: ['PXP-2026-ALG-0001', 'PXP-2026-REM-0002', 'PXP-2026-PYT-0003'][index],
      name,
      skill,
      issuedAt: ['2026-10-25', '2026-10-24', '2026-10-22'][index],
      issuer: 'PARADOX AI · EduDefend.OS',
      assessmentScore: [91, 86, 82][index],
      status: ['pending', 'unverified', 'revoked'][index],
      source: 'mock',
      evidenceHash: `sha256:${['a1', 'b2', 'c3'][index].repeat(32)}`,
      transactionHash: index === 0 ? `0x${'a1'.repeat(32)}` : null,
      network: index === 0 ? 'avalanche-fuji' : null,
      verification: { checked: false, valid: false, source: 'mock', checkedAt: null },
    })),
  };
}
