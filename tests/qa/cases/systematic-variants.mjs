/*
 * E4 — systematic-technique variants. Each one names the parent case it
 * generalises so the catalog stays traceable.
 */

const base = {
  priority: 'P2',
  severity: 'Minor',
  evaluationMethod: 'deterministic',
  reviewerStatus: 'PENDING_EXPERT_REVIEW',
  execution: 'exec',
  requiresProvider: false,
  status: 'DESIGNED',
};

function v(variantId, category, title, parent, technique, input, expected, evidence, extra = {}) {
  return { ...base, ...extra, testCaseId: variantId, category, title, parentCaseId: parent, systematicTechnique: technique, input, expectedOutput: expected, evidence };
}

export const systematicVariants = [
  v('V-BND-01', 'E-ai-learning-flow', 'Ranh giới hintLevel', 'E-06', 'boundary',
    'mode=hint với hintLevel = 0, 1, 2, 3, 4, "2", NaN.',
    'Chỉ 1, 2, 3 và chuỗi "2" được chấp nhận; 0, 4, NaN bị từ chối.',
    'Bảng 7 giá trị chạy trong tests/ai-acceptance.spec.js.'),
  v('V-BND-02', 'E-ai-learning-flow', 'Ranh giới độ dài input', 'E-02', 'boundary',
    'problem/solution ở đúng ngưỡng và ngưỡng+1.',
    'Đúng ngưỡng thì đi qua, vượt ngưỡng thì INVALID_INPUT.',
    'api/debate.js:163-164.'),
  v('V-BND-03', 'E-ai-learning-flow', 'Cắt lịch sử hội thoại', 'E-13', 'boundary',
    'conversation 17 lượt, mỗi lượt 1300 ký tự.',
    'Chỉ 16 lượt cuối được giữ, mỗi lượt bị cắt 1200 ký tự.',
    'api/debate.js:170-173.'),
  v('V-BND-04', 'E-ai-learning-flow', 'Giới hạn gợi ý đã đưa', 'E-07', 'boundary',
    'previousHints gồm 4 mục, một mục là object.',
    'Chỉ 3 mục đầu được nhận, object được đọc qua trường content.',
    'api/debate.js:174.'),
  v('V-PAIR-01', 'F-api-backend', 'Pairwise mode × language', 'F-04', 'pairwise',
    '4 mode × 3 ngôn ngữ lấy theo cặp (6 tổ hợp phủ mọi cặp đơn).',
    'Mọi tổ hợp đều được chuẩn hoá và sinh prompt đúng ngôn ngữ.',
    'Bảng pairwise sinh tự động trong spec.'),
  v('V-PAIR-02', 'H-authentication-authorization', 'Pairwise role × action', 'H-01', 'pairwise',
    '(ẩn danh, learner, admin) × (verify, issue, revoke).',
    'Admin được phép; learner chỉ verify; ẩn danh không bao giờ được issue/revoke.',
    '9 tổ hợp chạy qua handler với stub auth.'),
  v('V-PROP-01', 'A-math-verdict', 'Property: điểm luôn trong [0,1]', 'A-01', 'property',
    'Toàn bộ 46 cặp (gold, phân tích) và mọi mutant.',
    'score ∈ [0,1] và passed ⇔ không có mandatory rule nào trượt.',
    'tests/qa/evaluator.mjs gradeCase.'),
  v('V-PROP-02', 'B-insufficient-and-hard', 'Property: evaluator tất định', 'B-01', 'property',
    'Chạy lại 200 lần một tập con các cặp grading.',
    'Kết quả giống hệt nhau từng lần (không phụ thuộc thứ hợp hay đồng hồ).',
    'Không dùng Math.random/Date trong evaluator.'),
  v('V-FUZZ-01', 'F-api-backend', 'Fuzz payload không làm sập bộ chuẩn hoá', 'F-09', 'fuzz',
    '40 payload: rỗng, null, mảng, chuỗi điều khiển, unicode phá định dạng, JSON lồng, 1MB text.',
    'Không lỗi không xác định; mọi payload chỉ hoặc bị từ chối 400 hoặc bị cắt theo hợp đồng.',
    'Danh sách payload nằm trong spec, có seed cố định.'),
  v('V-FUZZ-02', 'D-ai-security', 'Fuzz chuỗi giống bí mật trong payload', 'F-10', 'fuzz',
    'Payload chứa "AIza...", "Bearer ...", "paradox-access=...", OTP giả.',
    'Không chuỗi nào đi vào request log hay báo cáo; chỉ inputHash được ghi.',
    'assertLogSafe + findSecretLeaks.'),
  v('V-STATE-01', 'K-certificate-verify', 'State-transition vòng đời credential', 'G-04', 'state-transition',
    'issue → confirmed → revoke → revoked, cộng hai chuyển đổi trái phép (revoke hai lần, verify mã chưa tồn tại).',
    'Chuyển đổi hợp lệ được ghi nhận; chuyển đổi trái phép bị từ chối và có transaction tương ứng.',
    'Fake store + service api/credentials/_service.js.'),
  v('V-STATE-02', 'F-api-backend', 'State-transition cửa sổ rate limit', 'F-08', 'state-transition',
    '15 request IP A, request 16 IP A, 1 request IP B, chờ hết cửa sổ bằng now ảo.',
    'Chặn đúng cửa sổ, cô lập theo IP, tự mở lại khi hết hạn.',
    'allowRequest dùng now được tiêm.'),
  v('V-STATE-03', 'J-performance-reliability', 'State-transition máy retry/fallback', 'J-01', 'state-transition',
    'provider1 fail → retry → provider2 fail → provider1 success.',
    'attempts/retryCount/fallbackUsed phản ánh đúng chuỗi chuyển trạng thái.',
    'Gateway với fetcher giả có kịch bản.'),
];

export default systematicVariants;
