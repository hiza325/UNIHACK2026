/*
 * E4 — platform case definitions (categories E–L).
 *
 * Each case names an `execution` key implemented in tests/ai-acceptance.spec.js.
 * The spec decides the recorded status from what actually happens:
 *   exec          — the behaviour is reachable on this checkout and asserted.
 *   absent-check  — the spec asserts that the capability is NOT present here and
 *                   records NOT_IMPLEMENTED with the grep-level evidence.
 *   provider      — needs a live learning-path provider key; recorded BLOCKED.
 *   staging       — needs Staging data or a real DB; recorded BLOCKED.
 *   manual        — needs a human; recorded NOT_RUN with the procedure.
 */

const CATEGORIES = {
  E: 'E-ai-learning-flow',
  F: 'F-api-backend',
  G: 'G-database-integrity',
  H: 'H-authentication-authorization',
  I: 'I-frontend-ux',
  J: 'J-performance-reliability',
  K: 'K-certificate-verify',
  L: 'L-regression',
};

function c(testCaseId, { title, priority = 'P1', severity = 'Major', pre, input, expected, method, run, evidence, provider = false, review = 'PENDING_EXPERT_REVIEW', parent = null, technique = null }) {
  const category = CATEGORIES[testCaseId[0]];
  return {
    testCaseId,
    category,
    title,
    priority,
    severity,
    preconditions: pre,
    input,
    expectedOutput: expected,
    evaluationMethod: method,
    execution: run,
    requiresProvider: provider,
    reviewerStatus: review,
    evidence,
    parentCaseId: parent,
    systematicTechnique: technique,
    status: 'DESIGNED',
  };
}

export const platformCases = [
  /* ---------------- E — AI learning flow (7 business steps) --------------- */
  c('E-01', {
    title: 'Bước 1 (intake): đề bài và lời giải bắt buộc có mặt',
    pre: 'Không cần đăng nhập để gọi hàm chuẩn hoá.',
    input: 'payload thiếu "solution"; payload problem dài hơn 12000 ký tự.',
    expected: ' INVALID_INPUT 400, thông báo nêu đúng trường thiếu/dài quá giới hạn.',
    run: 'exec',
    method: 'deterministic_exception',
    evidence: 'normalizeDebatePayload (api/debate.js:161) và boundary variants E-01-a/b.',
  }),
  c('E-02', {
    title: 'Bước 1 (intake): tổng độ dài problem+solution bị chặn',
    pre: 'Như trên.',
    input: 'problem 12000 ký tự + solution 12000 ký tự.',
    expected: 'Bị từ chối với INVALID_INPUT, không gửi lên provider.',
    run: 'exec',
    method: 'deterministic_exception',
    evidence: 'api/debate.js:164.',
  }),
  c('E-03', {
    title: 'Máy trạng thái 7 bước do server quyết định (allowedActions)',
    pre: 'Cần api/learning-records/_state.js.',
    input: 'Gọi publicState/allowedActions cho từng STEP 0..6.',
    expected: 'Server trả về allowedActions, client không tự quyết định bước.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'Rủi ro R-01: tệp và hàm không tồn tại trên checkout này (chỉ có ở p0/ai-flow-v2).',
  }),
  c('E-04', {
    title: 'Bước 2–3: lời giải sai chuyển người học sang phản biện (REFLECT)',
    pre: 'Cần transitionFor của máy trạng thái.',
    input: 'analyze với status incorrect.',
    expected: 'Bước chuyển sang REFLECT, không bỏ qua bước gợi ý.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'R-01.',
  }),
  c('E-05', {
    title: 'Bước 2–3: lời giải đúng bỏ qua các bước hint/rescue/practice',
    pre: 'Cần transitionFor.',
    input: 'analyze với status correct.',
    expected: 'skipped = [2,3,4,5] và cho phép finish.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'R-01.',
  }),
  c('E-06', {
    title: 'Bước 4: gợi ý tăng dần chỉ nhận mức 1..3',
    pre: 'Gọi trực tiếp hàm chuẩn hoá.',
    input: 'mode=hint với hintLevel = 0, 1, 2, 3, 4.',
    expected: '1..3 chấp nhận; 0 và 4 bị INVALID_INPUT.',
    run: 'exec',
    method: 'boundary_table',
    evidence: 'api/debate.js:167 + biến thể ranh giới E-06-a..e.',
  }),
  c('E-07', {
    title: 'Bước 4: không được lặp lại gợi ý đã đưa',
    pre: 'Gateway giả lập trả về gợi ý trùng previousHints.',
    input: 'mode=hint, previousHints chứa đúng nội dung gợi ý trả về.',
    expected: 'MODEL_OUTPUT_INVALID/INVALID_OUTPUT, không lưu gợi ý trùng.',
    run: 'exec',
    method: 'deterministic_validation',
    evidence: 'api/debate.js:135 normalizedComparableText.',
  }),
  c('E-08', {
    title: 'Bước 3: câu hỏi phản biện xuất hiện trong kết quả phân tích',
    pre: 'Cần provider thật cho luồng học.',
    input: 'Bài A-02 chạy qua /api/debate mode=analyze.',
    expected: 'nextQuestion là một câu hỏi mở, không phải đáp án cho sẵn.',
    run: 'provider',
    provider: true,
    method: 'rubric_plus_llm_judge',
    evidence: 'R-02: GEMINI_API_KEY/ANYROUTER_LEARNING_API_KEY chưa cấu hình.',
  }),
  c('E-09', {
    title: 'Bước 5: resubmit bắt buộc có lời giải trước',
    pre: 'Hàm chuẩn hoá.',
    input: 'mode=resubmit không có previousSolution.',
    expected: 'INVALID_INPUT.',
    run: 'exec',
    method: 'deterministic_exception',
    evidence: 'api/debate.js:175.',
  }),
  c('E-10', {
    title: 'Bước 5: rubric 4 tiêu chí, mỗi tiêu chí 0..25, suy ra trạng thái đánh giá',
    pre: 'validateDebateAnalysis với raw hợp lệ.',
    input: 'criteria điểm 22/21/20/23 (tổng 86) với evidenceSufficient true; và bộ điểm dưới 75.',
    expected: 'score = tổng, status = pass khi ≥75 và không còn remainingIssues; needs_improvement ngược lại; insufficient khi evidence thiếu.',
    run: 'exec',
    method: 'deterministic_table',
    evidence: 'api/debate.js:79-110.',
  }),
  c('E-11', {
    title: 'Bước 6: chế độ explain trả về giải thích kèm nguồn',
    pre: 'Cần contract.js được nối vào /api/debate.',
    input: 'mode=explain.',
    expected: 'explanation + sources, giữ nguyên verdict đã lưu.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'MODES trên main chỉ có analyze/discuss/hint/resubmit (api/debate.js:11); explain/exercise thuộc api/_ai/contract.js chưa được nối.',
  }),
  c('E-12', {
    title: 'Bước 7: tạo bài luyện tập kỹ năng tương tự (exercise)',
    pre: 'Như E-11.',
    input: 'mode=exercise với payload thiếu successCriteria.',
    expected: 'Mô-đun hợp đồng từ chối; endpoint chưa hỗ trợ trên checkout này.',
    run: 'exec',
    method: 'module_contract_probe',
    evidence: 'validateDebateAnalysis của api/_ai/contract.js được gọi trực tiếp (module-level, chưa phải HTTP endpoint).',
  }),
  c('E-13', {
    title: 'Client không thể giả mạo bước / hintLevel / trạng thái',
    pre: 'normalizeClientEnvelope của contract.js.',
    input: 'payload chứa step/hintLevel/status/state/analysis giả.',
    expected: 'Các trường ấy bị bỏ qua; buildAnalysisInput chỉ nhận dữ liệu từ server.',
    run: 'exec',
    method: 'module_contract_probe',
    evidence: 'api/_ai/contract.js:174-213, 245-272.',
  }),
  c('E-14', {
    title: 'Khôi phục tác vụ treo (lease 10 phút + abort/refund)',
    pre: 'Cần claim_ai_action/finish_ai_action/abort_ai_action.',
    input: 'Claim rồi không finish; claim lại sau khi lease hết hạn.',
    expected: 'Yêu cầu thứ hai được phục vụ; usage event refund.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'R-01: migration 202610290002 chỉ tồn tại trên p0/ai-flow-v2.',
  }),
  c('E-15', {
    title: 'Idempotency theo clientRequestId (replay không tốn quota)',
    pre: 'Cần ai_usage_events + getAiReplay.',
    input: 'Gửi hai lần cùng clientRequestId.',
    expected: 'Lần hai trả về kết quả đã lưu, không gọi provider lần nữa.',
    run: 'absent-check',
    method: 'capability_probe',
    evidence: 'R-01. API-level test F-09 chứng minh phía HTTP handler vẫn trả về 400 khi action lạ.',
  }),

  /* ---------------- F — API & backend ------------------------------------- */
  c('F-01', { title: 'Method not allowed trên /api/credentials', pre: 'Handler độc lập.', input: 'DELETE /api/credentials', expected: '405 kèm Allow: GET, POST.', run: 'exec', method: 'http_status', evidence: 'api/credentials/index.js:29.' }),
  c('F-02', { title: 'Action không hỗ trợ trên /api/credentials', pre: 'Người dùng đã đăng nhập.', input: 'POST action="drop-table"', expected: '400 INVALID_CREDENTIAL_ACTION.', run: 'exec', method: 'http_status', evidence: 'api/credentials/index.js:60.' }),
  c('F-03', { title: 'Action không hỗ trợ trên /api/learning-records', pre: 'Có session.', input: 'POST action="deleteAll"', expected: '400 INVALID_LEARNING_RECORD_ACTION.', run: 'exec', method: 'http_status', evidence: 'api/learning-records/index.js:61.' }),
  c('F-04', { title: 'Language fallback an toàn', pre: 'Hàm chuẩn hoá.', input: 'language="xx"', expected: 'Trả về "vi", không ném lỗi.', run: 'exec', method: 'deterministic_value', evidence: 'api/debate.js:182.' }),
  c('F-05', { title: 'Mode lạ quy về analyze', pre: 'Hàm chuẩn hoá.', input: 'mode="rm-rf"', expected: 'mode = analyze.', run: 'exec', method: 'deterministic_value', evidence: 'api/debate.js:166.' }),
  c('F-06', { title: 'Fail-closed khi DB chưa cấu hình', pre: 'SUPABASE_URL rỗng.', input: 'GET /api/credentials', expected: '503 với mã CREDENTIAL_DATABASE_NOT_CONFIGURED, không rò chuỗi nội bộ.', run: 'exec', method: 'http_status_plus_leak_scan', evidence: 'api/credentials/_store.js credentialStoreConfig.', priority: 'P0', severity: 'Critical' }),
  c('F-07', { title: 'Lỗi 5xx lạ được che thông báo', pre: 'service ném Error không có code.', input: 'POST /api/credentials action=verify', expected: '500 với thông báo chung "Credential service is temporarily unavailable".', run: 'exec', method: 'http_status_plus_message', evidence: 'sendCredentialError api/credentials/index.js:19-24.' }),
  c('F-08', { title: 'Rate limit cục bộ của /api/debate trả 429 kèm Retry-After', pre: 'Giới hạn 15/phút/IP, env test.', input: '16 request liên tiếp cùng IP.', expected: 'Request thứ 16 → 429 RATE_LIMIT; request IP khác vẫn được phục vụ.', run: 'exec', method: 'http_status', evidence: 'allowRequest api/debate.js:43-54. Biến thể state-transition F-08-a.', priority: 'P0' }),
  c('F-09', { title: 'Hợp đồng request: body không phải object', pre: 'Handler debate.', input: 'payload "string"', expected: '400 INVALID_INPUT.', run: 'exec', method: 'http_status', evidence: 'normalizeClientEnvelope/normalizeDebatePayload.' }),
  c('F-10', { title: '/api/ai/status mô tả cấu hình provider mà không lộ key', pre: 'env test.', input: 'GET /api/ai/status', expected: 'JSON trạng thái provider, không chứa giá trị key.', run: 'exec', method: 'schema_plus_leak_scan', evidence: 'describeAiProviderStatus api/_ai/gateway.js. Biến thể boundary F-10-a.', priority: 'P0' }),
  c('F-11', {
    title: 'Chuỗi input cực dài bị chặn trước khi tới provider',
    priority: 'P2', severity: 'Minor',
    pre: 'Hàm chuẩn hoá.', input: 'solution 16001 ký tự.',
    expected: 'INVALID_INPUT và gateway không được gọi.',
    run: 'exec', method: 'fuzz_table',
    evidence: 'Fuzz qua 6 độ dài biên.', technique: 'fuzz', parent: 'F-02',
  }),

  /* ---------------- G — database & data integrity ------------------------- */
  c('G-01', { title: 'RLS bật trên learning_credentials và credential_transactions', pre: 'Đọc migration 202610280001.', input: 'Nội dung SQL.', expected: 'ALTER TABLE ... ENABLE ROW LEVEL SECURITY cho cả hai bảng.', run: 'exec', method: 'migration_static_analysis', evidence: 'Static check trên text migration (DB sống thuộc phạm vi Staging).' }),
  c('G-02', { title: 'Quyền truy cập công khai bị thu hồi', pre: 'Như G-01.', input: 'GRANT/REVOKE statements.', expected: 'revoke từ anon và authenticated; chỉ service_role có quyền.', run: 'exec', method: 'migration_static_analysis', evidence: 'api-privilege statement trong migration.' }),
  c('G-03', { title: 'Ràng buộc enum trạng thái on-chain', pre: 'Như G-01.', input: 'CHECK (blockchain_status IN ...).', expected: 'Chỉ chấp nhận submitting/pending/confirmed/failed/revoke_pending/revoked.', run: 'exec', method: 'migration_static_analysis', evidence: 'CHECK constraint.' }),
  c('G-04', { title: 'Một credential có đúng một transaction cho mỗi operation', pre: 'Service với store giả.', input: 'issue rồi revoke.', expected: 'credential_transactions có 2 dòng, operation issue và revoke, trạng thái xác định.', run: 'exec', method: 'fake_store_state', evidence: 'tests/credentials.spec.js pattern tái sử dụng.' }),
  c('G-05', { title: 'Không cho phép phát hành bằng chứng mock', pre: 'Service.', input: 'issue với source="mock" hoặc isMock true.', expected: 'MOCK_CREDENTIAL_FORBIDDEN 400, không có dòng nào được ghi.', run: 'exec', method: 'deterministic_exception', evidence: 'api/credentials/_service.js:19,168. Priority P0 vì liên quan cấp chứng nhận trái phép.', priority: 'P0', severity: 'Critical' }),
  c('G-06', { title: 'Bằng chứng phải thuộc về người học được cấp', pre: 'Service + store giả.', input: 'issue với learnerId khác chủ sở hữu submission.', expected: 'Bị từ chối (fix ở HEAD 3378f22).', run: 'exec', method: 'deterministic_exception', evidence: 'commit 3378f22 fix(security): verify credential evidence ownership.', priority: 'P0', severity: 'Critical' }),
  c('G-07', { title: 'Ràng buộc not-null và mặc định an toàn', pre: 'Đọc migration.', input: 'Cột created_by, assessment_score range 0..100.', expected: 'created_by not-null; điểm bị chặn trong khoảng hợp lệ.', run: 'exec', method: 'migration_static_analysis', evidence: 'migration column definitions.' }),
  c('G-08', { title: 'Kiểm tra dữ liệu Staging thật (số dòng, tính nhất quán)', pre: 'Cần kết nối Staging được phê duyệt.', input: 'SELECT count + đối chiếu trạng thái transaction.', expected: 'Báo cáo số dòng và không có trạng thái cô lập.', run: 'staging', method: 'sql_readonly', evidence: 'Package D D2 vẫn chờ phê duyệt; xem docs/STAGING-BACKUP-RUNBOOK.md.', priority: 'P2' }),

  /* ---------------- H — authentication & authorization -------------------- */
  c('H-01', { title: 'Học sinh không thể issue credential', pre: 'Stub Supabase auth.', input: 'POST action=issue với token người học.', expected: '403 Administrator access required; service.issue không được gọi.', run: 'exec', method: 'http_status_plus_spy', evidence: 'requireAdmin api/auth/_supabase.js:136.', priority: 'P0', severity: 'Critical' }),
  c('H-02', { title: 'Học sinh không thể revoke credential', pre: 'Như H-01.', input: 'POST action=revoke.', expected: '403 và không có transaction revoke nào.', run: 'exec', method: 'http_status_plus_spy', evidence: 'api/credentials/index.js:56.', priority: 'P0', severity: 'Critical' }),
  c('H-03', { title: 'Người dùng thường không đọc được danh sách admin', pre: 'Stub auth.', input: 'GET /api/admin/users với token learner.', expected: '403.', run: 'exec', method: 'http_status', evidence: 'api/admin/users.js.', priority: 'P0' }),
  c('H-04', { title: 'Admin đọc được danh sách và PATCH hợp lệ', pre: 'Stub auth + fetch spy.', input: 'GET rồi PATCH reason=account_sharing.', expected: '200/200 với status suspended; reason sai → 400.', run: 'exec', method: 'http_status', evidence: 'api/admin/users.js.' }),
  c('H-05', { title: 'Phiên của tài khoản bị đình chỉ bị xóa cookie', pre: 'Stub fetch trả banned_until tương lai.', input: 'GET /api/auth/session với cookie hợp lệ.', expected: '403 ACCOUNT_SUSPENDED và Set-Cookie Max-Age=0.', run: 'exec', method: 'http_status_plus_header', evidence: 'api/auth/session.js + _supabase.js authoritativeUser.' }),
  c('H-06', { title: 'Không lộ hồ sơ người dùng khác (ownership filter)', pre: 'Service + store giả.', input: 'getSession của người dùng B với sessionId thuộc A.', expected: '404/KHÔNG tìm thấy, không trả dữ liệu.', run: 'exec', method: 'deterministic_exception', evidence: 'api/learning-records/_service.js ownership filter.', priority: 'P0', severity: 'Critical' }),
  c('H-07', { title: 'Request ẩn danh phải nhận 401/403 chứ không phải 503', pre: 'Không có session, DB chưa cấu hình (mặc định production).', input: 'POST /api/credentials action=issue.', expected: '401/403 và store không được khởi tạo.', run: 'exec', method: 'http_status', evidence: 'Kiểm tra thứ tự auth-trước-store. R-03: trên checkout này store được tạo trước khi kiểm tra quyền → kết quả dự kiến là FAIL, được ghi trung thực.', priority: 'P0', severity: 'Critical' }),

  /* ---------------- I — frontend & UX ------------------------------------- */
  c('I-01', { title: 'Lỗi AI được bản địa hoá và không làm mất dữ liệu người dùng', pre: 'app-actions.js import được.', input: 'debateErrorText với các mã NOT_CONFIGURED/TIMEOUT/RATE_LIMIT/AI_CONTRACT_BROKEN.', expected: 'Chuỗi thông báo cho người dùng, không lộ stack trace.', run: 'exec', method: 'deterministic_value', evidence: 'app-actions.js:427.' }),
  c('I-02', { title: 'View admin ẩn với người dùng không phải admin (chỉ là lớp UI)', pre: 'views/admin.js.', input: 'render với user.role = learner.', expected: 'Không render nội dung admin; UI guard không thay thế server check.', run: 'exec', method: 'render_probe', evidence: 'views/admin.js:12.' }),
  c('I-03', { title: 'Màn hình Verify phân biệt not-found / network-error / revoked', pre: 'views/passport.js.', input: 'Các trạng thái checking/not-found/network-error/valid/revoked.', expected: 'Sai trạng thái → sai thông điệp; network-error cho phép thử lại.', run: 'exec', method: 'render_probe', evidence: 'views/passport.js.' }),
  c('I-04', { title: 'Bàn phím và tương phản (a11y cơ bản)', pre: 'Cần chạy trình duyệt.', input: 'axe scan trên các màn hình chính.', expected: 'Không có vi phạm serious.', run: 'manual', method: 'accessibility_scan', evidence: 'tests/app.spec.js đã dùng @axe-core/playwright; mở rộng thủ công.', priority: 'P2' }),
  c('I-05', { title: 'Chỉ báo "đang phân tích" khoá input để tránh spam', pre: 'Chạy UI thật.', input: 'Bấm phân tích 2 lần liên tiếp.', expected: 'Input bị disable; không gửi request trùng.', run: 'manual', method: 'browser walkthrough', evidence: 'setAnalyzing trong app-actions.js.', priority: 'P2' }),

  /* ---------------- J — performance & reliability ------------------------- */
  c('J-01', { title: 'Gateway retry có giới hạn và báo đúng số lần thử', pre: 'Fetcher giả trả 429 rồi thành công.', input: 'maxRetries=2.', expected: 'attempts=2..3, retryCount truy vết được, fallbackUsed xác định.', run: 'exec', method: 'deterministic_trace', evidence: 'api/_ai/gateway.js retry loop. Biến thể state-transition J-01-a.' }),
  c('J-02', { title: 'Timeout provider cắt chuỗi gọi', pre: 'Fetcher giả treo.', input: 'timeoutMs nhỏ.', expected: 'TIMEOUT 504, không treo request vô hạn.', run: 'exec', method: 'latency_bound', evidence: 'gateway timeout handling.' }),
  c('J-03', { title: 'Fallback sang provider thứ hai khi provider một lỗi', pre: 'Fetcher giả: gemini 500, anyrouter OK.', input: 'providerOrder mặc định.', expected: 'provider = anyrouter, fallbackUsed = true.', run: 'exec', method: 'deterministic_value', evidence: 'gateway provider order + tests/ai-gateway.spec.js.' }),
  c('J-04', { title: 'Phân tách lỗi provider và lỗi nghiệp vụ', pre: 'contract.js error taxonomy.', input: 'classifyAiError cho RATE_LIMITED/RATE_LIMIT/AI_CONTRACT_BROKEN/INVALID_OUTPUT.', expected: 'source = provider/client/server và kind = model/schema/system đúng bảng.', run: 'exec', method: 'deterministic_table', evidence: 'api/_ai/contract.js:60-105.', priority: 'P0' }),
  c('J-05', { title: 'Báo cáo latency p50/p95/p99 từ log thật', pre: 'Chạy suite acceptance.', input: 'mảng latencyMs các request đã ghi.', expected: 'Thống kê tính đúng và ghi vào run-evidence.json.', run: 'exec', method: 'statistical', evidence: 'tests/qa/evaluator.mjs latencyStats.' }),
  c('J-06', { title: 'Không có trạng thái chia sẻ bị hỏng khi gọi đồng thời', pre: 'Handler debate + rate limiter in-memory.', input: '8 request song song từ 8 IP khác nhau.', expected: 'Không request nào lỗi do lẫn window; mỗi IP có cửa riêng.', run: 'exec', method: 'concurrency', evidence: 'allowRequest keyed by IP.' }),
  c('J-07', { title: 'Cold start làm mất bộ đếm in-memory', pre: 'Không thể kiểm tự động trên nhiều instance.', input: 'Mô tả rủi ro R-07 + kiểm thử một instance.', expected: 'Tài liệu ghi nhận giới hạn; cần limiter tập trung.', run: 'manual', method: 'documented limitation', evidence: 'api/auth/_rate-limit.js module state.', priority: 'P2' }),
  c('J-08', { title: 'Latency với provider thật (p95/p99)', pre: 'Cần key provider luồng học.', input: '20 request thật.', expected: 'p95/p99 thực đo.', run: 'provider', provider: true, method: 'statistical', evidence: 'R-02 → BLOCKED.', priority: 'P2' }),

  /* ---------------- K — certificate & verify ------------------------------ */
  c('K-01', { title: 'Verify mã hợp lệ trả về credential đã xác minh', pre: 'Service + store giả có dòng confirmed.', input: 'verify(code).', expected: 'Trả về public credential với trạng thái hợp lệ.', run: 'exec', method: 'deterministic_value', evidence: 'api/credentials/_service.js verify.' }),
  c('K-02', { title: 'Verify mã không tồn tại trả 404', pre: 'Store giả rỗng.', input: 'GET /api/credentials?code=PXP-TEST-NOPE.', expected: '404 CREDENTIAL_NOT_FOUND.', run: 'exec', method: 'http_status', evidence: 'api/credentials/index.js:37.' }),
  c('K-03', { title: 'Credential đã thu hồi không còn được báo cáo hợp lệ', pre: 'Store giả có dòng revoked.', input: 'verify(code revoked).', expected: 'Trạng thái revoked, không còn onchain_valid.', run: 'exec', method: 'deterministic_value', evidence: 'toPublicCredential status mapping.' }),
  c('K-04', { title: 'Xác minh on-chain thật trên Fuji', pre: 'Cần RPC + registry address + chain sống.', input: 'Đối chiếu tokenId với registry.', expected: 'on-chain truth khớp với bản ghi; mismatch phải báo.', run: 'staging', method: 'chain_read', evidence: 'CHAIN-01 được ghi nhận FAIL trong docs/CHAIN-01-REPORT.md; cần chạy lại.', priority: 'P1', severity: 'Major' }),

  /* ---------------- L — regression ---------------------------------------- */
  c('L-01', { title: 'Sửa lỗi: không phát hành credential bằng chứng của người khác', pre: 'Service + store giả.', input: 'Như G-06.', expected: 'Vẫn bị từ chối sau các thay đổi Phase E.', run: 'exec', method: 'deterministic_exception', evidence: 'Commit 3378f22.', priority: 'P0', severity: 'Critical' }),
  c('L-02', { title: 'Sửa lỗi: achievement summary không tính trùng/nhầm trạng thái', pre: 'Learning record service + store giả.', input: 'Hai session, một completed, một abandoned.', expected: 'Đếm đúng theo trạng thái, không cộng dồn dòng abandoned.', run: 'exec', method: 'deterministic_value', evidence: 'getAchievementSummary api/learning-records/_service.js.' }),
  c('L-03', { title: 'Không hồi quy: toàn bộ suite hiện có vẫn xanh', pre: 'npm test.', input: 'Chạy Playwright suite.', expected: '0 failed.', run: 'exec', method: 'full_suite', evidence: 'Kết quả ghi tại docs/qa/run-evidence.json (không sao chép tay).', priority: 'P0' }),
];

export default platformCases;
