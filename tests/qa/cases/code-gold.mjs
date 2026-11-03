/*
 * E3 / category C — C++ review cases.
 *
 * The learner solution is code; the gold answer names the defect class, the
 * position of the defect and the reasoning an analysis must show. The code is
 * treated strictly as data: it is never compiled or executed by this harness
 * (E3 rule: "Không thực thi code không đáng tin cậy trên production"). Gold
 * numeric claims (overflow limits, sums) are recomputed in JavaScript instead.
 */

const base = {
  priority: 'P1',
  severity: 'Major',
  category: 'C-cpp-review',
  evaluationMethod: 'deterministic_gold_rules',
  reviewerStatus: 'PENDING_EXPERT_REVIEW',
  requiresProvider: true,
  endpoint: '/api/debate',
};

export const codeGoldCases = [
  {
    ...base,
    testCaseId: 'C-01',
    topic: 'Code đúng',
    problem: 'Review đoạn code tính tổng các phần tử của một vector<int>.',
    learnerSolution: 'long long Sum(const std::vector<int>& v) {\n  long long total = 0;\n  for (int x : v) total += x;\n  return total;\n}',
    gold: {
      verdict: 'correct',
      answer: 'Hàm đúng, tham chiếu const và tích lũy kiểu rộng.',
      goldSolution: 'Duyệt hết v, không ghi ra ngoài, không tràn với int thông thường.',
      expectedAiError: 'Không có lỗi; không được bịa lỗi để trông "kỹ tính".',
      selfCheck: () => [1, 2, 3].reduce((sum, value) => sum + value, 0) === 6,
    },
    rules: [{ rule: 'verdict' }, { rule: 'noErrorClaimed' }, { rule: 'contractValid' }],
    analysis: {
      status: 'correct',
      summary: 'Duyệt theo khoảng, tham số const tham chiếu và biến tích lũy kiểu rộng nên an toàn.',
      issues: [],
      strengths: ['Dùng long long để hạn chế tràn khi tổng lớn'],
    },
    expectedBehavior: 'Kết luận đúng và ngắn gọn.',
    passCriteria: 'status = correct, issues rỗng.',
  },
  {
    ...base,
    testCaseId: 'C-02',
    topic: 'Lỗi cú pháp',
    problem: 'Review chương trình dưới đây.',
    learnerSolution: 'int main() {\n  int a = 5\n  int b = a + 1;\n  return b;\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'Thiếu dấu chấm phẩy sau khai báo a.',
      goldSolution: 'int a = 5;',
      expectedAiError: 'Chỉ đúng dòng khai báo thiếu ";',
      selfCheck: () => true,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['dấu chấm phẩy', 'khai báo', 'thiếu ;', 'dòng 2'] } },
      { rule: 'errorType', params: { category: 'knowledge' } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Chương trình không biên dịch được vì một câu khai báo kết thúc thiếu dấu chấm phẩy.',
      issues: [{
        category: 'knowledge',
        step: 'dòng khai biến a ở câu lệnh thứ hai của main',
        explanation: 'Khai báo "int a = 5" thiếu ";" nên trình biên dịch gộp luôn câu lệnh sau.',
        suggestion: 'Thêm dấu chấm phẩy vào cuối câu khai báo.',
      }],
    },
    expectedBehavior: 'Nhận diện lỗi cú pháp và vị trí.',
    passCriteria: 'status = incorrect, issue nêu dấu chấm phẩy/khai báo.',
  },
  {
    ...base,
    testCaseId: 'C-03',
    topic: 'Lỗi logic — hoán đổi',
    problem: 'Review hàm hoán đổi hai biến.',
    learnerSolution: 'void Swap(int& a, int& b) {\n  a = b;\n  b = a;\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'Cả hai biến đều nhận giá trị của b.',
      goldSolution: 'Cần biến tạm: int t = a; a = b; b = t;',
      expectedAiError: 'Gán đè trước khi lưu giá trị cũ.',
      selfCheck: () => { let a = 1; let b = 2; a = b; b = a; return a === 2 && b === 2; },
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['biến tạm', 'gán đè', 'a = b'] } },
      { rule: 'errorType', params: { category: 'logic' } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Phép gán đầu tiên làm mất giá trị cũ của a nên phép gán thứ chỉ sao chép lại giá trị của b.',
      issues: [{
        category: 'logic',
        step: 'hai câu lệnh gán trong thân Swap',
        explanation: 'Sau "a = b" thì a và b đã cùng giá trị, "b = a" không khôi phục được giá trị ban đầu.',
        suggestion: 'Lưu a vào một biến tạm trước khi gán, hoặc dùng std::swap.',
      }],
      nextQuestion: 'Nếu a ban bằng 1 và b bằng 2, sau câu lệnh đầu tiên a bằng bao nhiêu?',
    },
    expectedBehavior: 'Giải thích nguyên nhân, không chỉ báo "sai".',
    passCriteria: 'status = incorrect, issue nêu biến tạm hoặc gán đè.',
    passNote: 'Lỗi logic phải được phát hiện ở bước gán, không phải ở tên hàm.',
  },
  {
    ...base,
    testCaseId: 'C-04',
    topic: 'Sai kiểu dữ liệu — chia số nguyên',
    problem: 'Review hàm tính tỉ số.',
    learnerSolution: 'double Ratio(int a, int b) {\n  return a / b;\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'Phép chia thực hiện trên số nguyên, phần thập phân bị cắt.',
      goldSolution: 'return static_cast<double>(a) / b;',
      expectedAiError: 'Kiểu kết quả chỉ có tác dụng sau khi phép chia đã tính.',
      selfCheck: () => Math.trunc(5 / 2) === 2 && 5 / 2 !== 2,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['chia số nguyên', 'ép kiểu', 'static_cast', 'double', 'chia hai int', 'cắt phần thập phân'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Toán hạng là số nguyên nên phép chia cho kết quả nguyên rồi mới được chuyển đổi khi trả về.',
      issues: [{
        category: 'knowledge',
        step: 'biểu thức return a / b',
        explanation: 'Chia hai int cắt phần thập phân; ví dụ 5 và 2 cho ra 2 thay vì 2,5.',
        suggestion: 'Ép một toán hạng sang double trước khi chia.',
      }],
    },
    expectedBehavior: 'Chỉ ra lỗi liên quan kiểu dữ liệu.',
    passCriteria: 'status = incorrect, issue nêu chia số nguyên/ép kiểu.',
  },
  {
    ...base,
    testCaseId: 'C-05',
    topic: 'Lỗi vòng lặp — không tăng bộ đếm',
    problem: 'Review vòng lặp cộng dồn.',
    learnerSolution: 'int i = 0, total = 0;\nwhile (i < n) {\n  total += v[i];\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'Vòng lặp vô hạn vì i không bao giờ tăng.',
      goldSolution: 'Thêm ++i; trong thân vòng lặp.',
      expectedAiError: 'Biến đếm không đổi nên điều kiện luôn đúng.',
      selfCheck: () => true,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['vòng lặp vô hạn', 'bộ đếm', 'i++', '++]', 'giá trị đầu', 'treo', 'mãi mãi'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Thân vòng lặp không cập nhật biến chỉ mục nên điều kiện dừng không bao giờ đạt tới.',
      issues: [{
        category: 'logic',
        step: 'thân while so với biến i',
        explanation: 'i giữ nguyên giá trị đầu, do đó v[i] được cộng dồn mãi mãi và chương trình treo.',
        suggestion: 'Tăng i ở cuối thân vòng lặp, hoặc dùng for để bộ đếm và điều kiện đi cùng nhau.',
      }],
    },
    expectedBehavior: 'Nhận diện lỗi tiến trình của vòng lặp.',
    passCriteria: 'status = incorrect, issue nêu bộ đếm/vô hạn.',
  },
  {
    ...base,
    testCaseId: 'C-06',
    topic: 'Lỗi chỉ số mảng',
    problem: 'Review vòng duyệt mảng.',
    learnerSolution: 'for (std::size_t i = 0; i <= v.size(); ++i) total += v[i];',
    gold: {
      verdict: 'incorrect',
      answer: 'Đọc một phần tử ngoài biên (chỉ số bằng size).',
      goldSolution: 'Điều kiện phải là i < v.size().',
      expectedAiError: 'Dấu <= làm lặp thêm một lần và truy cập ngoài vùng hợp lệ.',
      selfCheck: () => [10, 20, 30].length === 3 && [...Array(4).keys()].filter(i => i <= 3).length === 4,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['ngoài biên', 'vượt', 'i <=', 'chỉ số'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Vòng lặp chạy một lần quá số phần tử và chạm vào vị trí không tồn tại.',
      issues: [{
        category: 'logic',
        step: 'điều kiện i <= v.size()',
        explanation: 'Chỉ số hợp lệ cuối cùng là size - 1, nên lần lặp với i bằng size là truy cập ngoài biên (hành vi không xác định).',
        suggestion: 'Dùng i < v.size() hoặc vòng lặp theo khoảng.',
      }],
    },
    expectedBehavior: 'Phát hiện lỗi off-by-one.',
    passCriteria: 'status = incorrect, issue nêu ngoài biên/i <=.',
  },
  {
    ...base,
    testCaseId: 'C-07',
    topic: 'Tràn số',
    problem: 'Review hàm tính giai thừa.',
    learnerSolution: 'int Factorial(int n) {\n  int product = 1;\n  for (int i = 1; i <= n; ++i) product *= i;\n  return product;\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'Tràn số nguyên có dấu từ 13! trở đi (13! = 6 227 020 800 > 2^31 - 1) và tràn số học có dấu là hành vi không xác định.',
      goldSolution: 'Dùng long long hoặc kiểm tra chặn trên của n (n ≤ 12 cho int32).',
      expectedAiError: 'Không giới hạn n, tích lũy vượt khoảng của int.',
      selfCheck: () => {
        const factorial = limit => {
          let product = 1n;
          for (let i = 2; i <= limit; i += 1) product *= BigInt(i);
          return product;
        };
        const int32Max = BigInt(2 ** 31 - 1);
        return factorial(12) <= int32Max && factorial(13) > int32Max && factorial(20) > int32Max;
      },
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['tràn', 'long long', '2^31', 'giai thừa'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Biến tích lũy kiểu int và n không bị chặn, nên với n lớn phép nhân vượt khoảng biểu diễn.',
      issues: [{
        category: 'knowledge',
        step: 'product *= i trong vòng lặp',
        explanation: 'Giai thừa tăng rất nhanh và tràn số nguyên có dấu; tràn số học trên int là hành vi không xác định, kết quả có thể quay về 0 hoặc âm.',
        suggestion: 'Dùng long long và chặn n (int32 chỉ an toàn tới 12), hoặc phát hiện tràn bằng phép kiểm tra trước khi nhân.',
      }],
    },
    expectedBehavior: 'Nêu rủi ro tràn, không chỉ nói "kết quả lớn".',
    passCriteria: 'status = incorrect, issue nêu tràn/long long.',
  },
  {
    ...base,
    testCaseId: 'C-08',
    topic: 'Input không hợp lệ',
    problem: 'Review đoạn nhập liệu và tính trung bình.',
    learnerSolution: 'int n;\nstd::cin >> n;\nstd::cout << total / n;',
    gold: {
      verdict: 'incorrect',
      answer: 'Không kiểm tra n khác 0 và không kiểm tra trạng thái của luồng nhập.',
      goldSolution: 'Kiểm tra std::cin và n > 0 trước khi chia.',
      expectedAiError: 'Chia cho 0 là hành vi không xác định; nhập lỗi để n chưa khởi tạo.',
      selfCheck: () => Number.isNaN(0 / 0),
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['chia cho 0', 'kiểm tra input', 'luồng nhập', 'chưa khởi tạo', 'bằng 0', 'giá trị rác'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Chương trình chia cho một giá trị đọc từ người dùng mà không xác nhận giá trị đó hợp lệ.',
      issues: [{
        category: 'knowledge',
        step: 'lệnh std::cin >> n và phép chia ngay sau đó',
        explanation: 'Nếu nhập không phải số thì n giữ nguyên giá trị rác; nếu n bằng 0 thì phép chia gây hành vi không xác định.',
        suggestion: 'Kiểm tra trạng thái luồng nhập và chặn n khác 0 (nên kiểm tra n dương) trước khi tính.',
      }],
    },
    expectedBehavior: 'Quan tâm cả tính bền vững với input, không chỉ logic thuần.',
    passCriteria: 'status = incorrect, issue nêu chia cho 0 hoặc kiểm tra nhập liệu.',
  },
  {
    ...base,
    testCaseId: 'C-09',
    topic: 'Biến chưa khởi tạo',
    problem: 'Review hàm tìm giá trị lớn nhất.',
    learnerSolution: 'int MaxOf(const std::vector<int>& v) {\n  int best;\n  for (int x : v) if (x > best) best = x;\n  return best;\n}',
    gold: {
      verdict: 'incorrect',
      answer: 'best chưa khởi tạo; nếu v rỗng hàm trả về giá trị rác.',
      goldSolution: 'Khởi tạo best = v[0] sau khi kiểm tra v không rỗng.',
      expectedAiError: 'So sánh với biến chưa được gán là hành vi không xác định; thiếu xử lý mảng rỗng.',
      selfCheck: () => true,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'errorLocation', params: { terms: ['chưa khởi tạo', 'giá trị rác', 'vector rỗng', 'best'] } },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'incorrect',
      summary: 'Biến giữ kết quả được khai báo nhưng chưa gán trước lần so sánh đầu tiên.',
      issues: [{
        category: 'knowledge',
        step: 'khai báo int best và điều kiện if (x > best)',
        explanation: 'So sánh với biến chưa khởi tạo là hành vi không xác định; với vector rỗng hàm còn trả về giá trị rác.',
        suggestion: 'Kiểm tra v.empty() rồi khởi tạo best bằng phần tử đầu tiên.',
      }],
    },
    expectedBehavior: 'Báo đúng lớp lỗi khởi tạo.',
    passCriteria: 'status = incorrect, issue nêu chưa khởi tạo/giá trị rác.',
  },
  {
    ...base,
    testCaseId: 'C-10',
    topic: 'Nhiều cách viết hợp lệ',
    problem: 'Review hàm đếm số phần tử chẵn.',
    learnerSolution: 'int CountEven(const std::vector<int>& v) {\n  int n = 0;\n  for (std::size_t i = 0; i < v.size(); ++i) if (v[i] % 2 == 0) ++n;\n  return n;\n}',
    gold: {
      verdict: 'correct',
      answer: 'Đúng; dùng std::count_if cũng chấp nhận được.',
      goldSolution: 'Duyệt theo chỉ mục hoặc chuẩn đều cho kết quả như nhau.',
      expectedAiError: 'Không có lỗi; không trừ điểm vì không dùng thuật toán chuẩn của STL.',
      selfCheck: () => [1, 2, 3, 4, 6].filter(x => x % 2 === 0).length === 3,
    },
    rules: [
      { rule: 'verdict' },
      { rule: 'acceptsMethod', params: { terms: ['đều hợp lệ', 'cách khác', 'std::count_if'] } },
      { rule: 'noErrorClaimed' },
      { rule: 'contractValid' },
    ],
    analysis: {
      status: 'correct',
      summary: 'Vòng lặp duyệt chỉ mục đúng biên và điều kiện chẵn chính xác; có thể viết bằng std::count_if nhưng không bắt buộc.',
      issues: [],
      strengths: ['Không truy cập ngoài biên'],
    },
    expectedBehavior: 'Chấp nhận phương án hợp lệ thay thế.',
    passCriteria: 'status = correct, issues rỗng.',
  },
];

export default codeGoldCases;
