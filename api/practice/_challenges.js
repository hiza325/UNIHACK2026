// Server-owned Practice Lab content. These definitions are the single source of
// truth for both the Supabase migration and the local development SQLite store.
// Answers live only here and on the server; the public API never exposes them
// until a user submits an attempt.
export const PRACTICE_CHALLENGE_SUBJECTS = Object.freeze({
  calculus: { vi: 'Giải tích', en: 'Calculus', jp: '微積分' },
  algebra: { vi: 'Đại số', en: 'Algebra', jp: '代数' },
  programming: { vi: 'Lập trình', en: 'Programming', jp: 'プログラミング' },
  logic: { vi: 'Logic', en: 'Logic', jp: '論理' },
  statistics: { vi: 'Thống kê', en: 'Statistics', jp: '統計' },
  physics: { vi: 'Vật lý', en: 'Physics', jp: '物理' },
});

export const PRACTICE_CHALLENGES = Object.freeze([
  {
    slug: 'chain-rule',
    subjectKey: 'calculus',
    minutes: 3,
    correctOption: 1,
    sortOrder: 0,
    content: {
      vi: { title: 'Đạo hàm hàm hợp', question: 'Cho f(x) = (3x² + 1)⁴. Đạo hàm f′(x) là:', options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'], level: 'Trung bình', explanation: 'Áp dụng quy tắc dây chuyền: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.', source: 'OpenStax Calculus Vol. 1, §3.6' },
      en: { title: 'Chain rule', question: 'For f(x) = (3x² + 1)⁴, the derivative f′(x) is:', options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'], level: 'Intermediate', explanation: 'Chain rule: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.', source: 'OpenStax Calculus Vol. 1, §3.6' },
      jp: { title: '合成関数の微分', question: 'f(x) = (3x² + 1)⁴ の導関数 f′(x) は？', options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'], level: '中級', explanation: '連鎖律より 4(3x² + 1)³ · 6x = 24x(3x² + 1)³。', source: 'OpenStax Calculus Vol. 1, §3.6' },
    },
  },
  {
    slug: 'simplify-expression',
    subjectKey: 'algebra',
    minutes: 2,
    correctOption: 0,
    sortOrder: 1,
    content: {
      vi: { title: 'Rút gọn biểu thức', question: 'Rút gọn 2(x + 3) − 2x.', options: ['6', 'x + 6', '2x + 6', '0'], level: 'Cơ bản', explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6.', source: 'OpenStax Elementary Algebra, §1.6' },
      en: { title: 'Simplify the expression', question: 'Simplify 2(x + 3) − 2x.', options: ['6', 'x + 6', '2x + 6', '0'], level: 'Basic', explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6.', source: 'OpenStax Elementary Algebra, §1.6' },
      jp: { title: '式を簡単にする', question: '2(x + 3) − 2x を簡単にすると？', options: ['6', 'x + 6', '2x + 6', '0'], level: '基礎', explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6。', source: 'OpenStax Elementary Algebra, §1.6' },
    },
  },
  {
    slug: 'python-reverse-list',
    subjectKey: 'programming',
    minutes: 2,
    correctOption: 0,
    sortOrder: 2,
    content: {
      vi: { title: 'Python: đảo danh sách', question: 'Kết quả của [1, 2, 3][::-1] là gì?', options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', 'Lỗi cú pháp'], level: 'Cơ bản', explanation: 'Slice với bước −1 duyệt danh sách từ cuối về đầu: [3, 2, 1].', source: 'Python docs · Sequence types' },
      en: { title: 'Python: reverse a list', question: 'What is the result of [1, 2, 3][::-1]?', options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', 'Syntax error'], level: 'Basic', explanation: 'A slice with step −1 walks the list backwards: [3, 2, 1].', source: 'Python docs · Sequence types' },
      jp: { title: 'Python：リストを逆順に', question: '[1, 2, 3][::-1] の結果は？', options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', '構文エラー'], level: '基礎', explanation: 'ステップ −1 のスライスは末尾から先頭へ進みます：[3, 2, 1]。', source: 'Python docs · Sequence types' },
    },
  },
  {
    slug: 'necessary-sufficient',
    subjectKey: 'logic',
    minutes: 3,
    correctOption: 0,
    sortOrder: 3,
    content: {
      vi: { title: 'Điều kiện cần và đủ', question: 'Nếu một số chia hết cho 4 thì số đó chắc chắn:', options: ['Chia hết cho 2', 'Chia hết cho 8', 'Là số nguyên tố', 'Là số lẻ'], level: 'Trung bình', explanation: 'Mọi bội của 4 đều có dạng 4k = 2(2k), nên luôn chia hết cho 2.', source: 'OpenStax Contemporary Mathematics · Logic' },
      en: { title: 'Necessary and sufficient', question: 'If a number is divisible by 4, it must be:', options: ['Divisible by 2', 'Divisible by 8', 'Prime', 'Odd'], level: 'Intermediate', explanation: 'Every multiple of 4 has the form 4k = 2(2k), so it is always divisible by 2.', source: 'OpenStax Contemporary Mathematics · Logic' },
      jp: { title: '必要条件と十分条件', question: 'ある数が4で割り切れるなら、必ず成り立つことは？', options: ['2で割り切れる', '8で割り切れる', '素数である', '奇数である'], level: '中級', explanation: '4の倍数は 4k = 2(2k) と表せるため、必ず2で割り切れます。', source: 'OpenStax Contemporary Mathematics · Logic' },
    },
  },
  {
    slug: 'basic-probability',
    subjectKey: 'statistics',
    minutes: 2,
    correctOption: 1,
    sortOrder: 4,
    content: {
      vi: { title: 'Xác suất cơ bản', question: 'Tung một đồng xu cân bằng hai lần. Xác suất xuất hiện đúng một mặt ngửa là:', options: ['1/4', '1/2', '3/4', '1'], level: 'Cơ bản', explanation: 'Có 4 kết quả đồng khả năng: NN, NS, SN, SS. Hai kết quả có đúng một mặt ngửa nên xác suất là 2/4 = 1/2.', source: 'OpenStax Introductory Statistics · Probability' },
      en: { title: 'Basic probability', question: 'A fair coin is tossed twice. The probability of exactly one head is:', options: ['1/4', '1/2', '3/4', '1'], level: 'Basic', explanation: 'There are four equally likely outcomes: HH, HT, TH, TT. Two contain exactly one head, so the probability is 2/4 = 1/2.', source: 'OpenStax Introductory Statistics · Probability' },
      jp: { title: '確率の基礎', question: '公平なコインを2回投げるとき、表がちょうど1回出る確率は？', options: ['1/4', '1/2', '3/4', '1'], level: '基礎', explanation: '同様に確からしい4通りのうち、表が1回の結果は2通りなので 2/4 = 1/2 です。', source: 'OpenStax Introductory Statistics · Probability' },
    },
  },
  {
    slug: 'average-speed',
    subjectKey: 'physics',
    minutes: 3,
    correctOption: 1,
    sortOrder: 5,
    content: {
      vi: { title: 'Vận tốc trung bình', question: 'Một vật đi được 120 m trong 10 s. Vận tốc trung bình là:', options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'], level: 'Cơ bản', explanation: 'Vận tốc trung bình bằng quãng đường chia thời gian: 120 / 10 = 12 m/s.', source: 'OpenStax Physics · Motion' },
      en: { title: 'Average speed', question: 'An object travels 120 m in 10 s. Its average speed is:', options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'], level: 'Basic', explanation: 'Average speed is distance divided by time: 120 / 10 = 12 m/s.', source: 'OpenStax Physics · Motion' },
      jp: { title: '平均の速さ', question: '物体が120 mを10秒で進みました。平均の速さは？', options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'], level: '基礎', explanation: '平均の速さは距離÷時間なので、120 / 10 = 12 m/s です。', source: 'OpenStax Physics · Motion' },
    },
  },
]);
