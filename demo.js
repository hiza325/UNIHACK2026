/* Demo content for the sitemap views. Frontend-only prototype data. */
export const demo = {
  vi: {
    sessions: [
      { date: '26/10', title: 'Đạo hàm hàm hợp', skill: 'Giải tích', status: 'needs', score: 62 },
      { date: '24/10', title: 'Định luật phân phối trong đại số', skill: 'Đại số', status: 'mastered', score: 88 },
      { date: '22/10', title: 'Python: xử lý danh sách', skill: 'Lập trình', status: 'mastered', score: 92 },
      { date: '19/10', title: 'Giới hạn và liên tục', skill: 'Giải tích', status: 'progress', score: 54 },
      { date: '17/10', title: 'Logic: điều kiện cần và đủ', skill: 'Logic', status: 'needs', score: 67 },
      { date: '15/10', title: 'Xác suất cơ bản', skill: 'Thống kê', status: 'mastered', score: 85 }
    ],
    challenges: [
      {
        title: 'Đạo hàm hàm hợp', subject: 'Giải tích', level: 'Trung bình', mins: 3,
        question: 'Cho f(x) = (3x² + 1)⁴. Đạo hàm f′(x) là:',
        options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'],
        answer: 1,
        explanation: 'Áp dụng quy tắc dây chuyền: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.',
        source: 'OpenStax Calculus Vol. 1, §3.6'
      },
      {
        title: 'Rút gọn biểu thức', subject: 'Đại số', level: 'Cơ bản', mins: 2,
        question: 'Rút gọn 2(x + 3) − 2x.',
        options: ['6', 'x + 6', '2x + 6', '0'],
        answer: 0,
        explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6.',
        source: 'OpenStax Elementary Algebra, §1.6'
      },
      {
        title: 'Python: đảo danh sách', subject: 'Lập trình', level: 'Cơ bản', mins: 2,
        question: 'Kết quả của [1, 2, 3][::-1] là gì?',
        options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', 'Lỗi cú pháp'],
        answer: 0,
        explanation: 'Slice với bước −1 duyệt danh sách từ cuối về đầu: [3, 2, 1].',
        source: 'Python docs · Sequence types'
      }
    ]
  },
  en: {
    sessions: [
      { date: '26/10', title: 'Chain rule', skill: 'Calculus', status: 'needs', score: 62 },
      { date: '24/10', title: 'Distributive law in algebra', skill: 'Algebra', status: 'mastered', score: 88 },
      { date: '22/10', title: 'Python: list operations', skill: 'Programming', status: 'mastered', score: 92 },
      { date: '19/10', title: 'Limits and continuity', skill: 'Calculus', status: 'progress', score: 54 },
      { date: '17/10', title: 'Logic: necessary vs sufficient', skill: 'Logic', status: 'needs', score: 67 },
      { date: '15/10', title: 'Basic probability', skill: 'Statistics', status: 'mastered', score: 85 }
    ],
    challenges: [
      {
        title: 'Chain rule', subject: 'Calculus', level: 'Intermediate', mins: 3,
        question: 'For f(x) = (3x² + 1)⁴, the derivative f′(x) is:',
        options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'],
        answer: 1,
        explanation: 'Chain rule: 4(3x² + 1)³ · 6x = 24x(3x² + 1)³.',
        source: 'OpenStax Calculus Vol. 1, §3.6'
      },
      {
        title: 'Simplify the expression', subject: 'Algebra', level: 'Basic', mins: 2,
        question: 'Simplify 2(x + 3) − 2x.',
        options: ['6', 'x + 6', '2x + 6', '0'],
        answer: 0,
        explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6.',
        source: 'OpenStax Elementary Algebra, §1.6'
      },
      {
        title: 'Python: reverse a list', subject: 'Programming', level: 'Basic', mins: 2,
        question: 'What is the result of [1, 2, 3][::-1]?',
        options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', 'Syntax error'],
        answer: 0,
        explanation: 'A slice with step −1 walks the list backwards: [3, 2, 1].',
        source: 'Python docs · Sequence types'
      }
    ]
  },
  jp: {
    sessions: [
      { date: '26/10', title: '合成関数の微分', skill: '微積分', status: 'needs', score: 62 },
      { date: '24/10', title: '代数の分配法則', skill: '代数', status: 'mastered', score: 88 },
      { date: '22/10', title: 'Python：リスト操作', skill: 'プログラミング', status: 'mastered', score: 92 },
      { date: '19/10', title: '極限と連続性', skill: '微積分', status: 'progress', score: 54 },
      { date: '17/10', title: '論理：必要条件と十分条件', skill: '論理', status: 'needs', score: 67 },
      { date: '15/10', title: '確率の基礎', skill: '統計', status: 'mastered', score: 85 }
    ],
    challenges: [
      {
        title: '合成関数の微分', subject: '微積分', level: '中級', mins: 3,
        question: 'f(x) = (3x² + 1)⁴ の導関数 f′(x) は？',
        options: ['12x(3x² + 1)³', '24x(3x² + 1)³', '4(3x² + 1)³', '6x(3x² + 1)⁴'],
        answer: 1,
        explanation: '連鎖律より 4(3x² + 1)³ · 6x = 24x(3x² + 1)³。',
        source: 'OpenStax Calculus Vol. 1, §3.6'
      },
      {
        title: '式を簡単にする', subject: '代数', level: '基礎', mins: 2,
        question: '2(x + 3) − 2x を簡単にすると？',
        options: ['6', 'x + 6', '2x + 6', '0'],
        answer: 0,
        explanation: '2(x + 3) − 2x = 2x + 6 − 2x = 6。',
        source: 'OpenStax Elementary Algebra, §1.6'
      },
      {
        title: 'Python：リストを逆順に', subject: 'プログラミング', level: '基礎', mins: 2,
        question: '[1, 2, 3][::-1] の結果は？',
        options: ['[3, 2, 1]', '[1, 2, 3]', '[1, 3]', '構文エラー'],
        answer: 0,
        explanation: 'ステップ −1 のスライスは末尾から先頭へ進みます：[3, 2, 1]。',
        source: 'Python docs · Sequence types'
      }
    ]
  }
};

export const APP_VIEWS = ['dashboard', 'audit', 'history', 'analytics', 'practice', 'profile', 'about', 'settings'];

export const charts = {
  7: [42, 58, 36, 71, 64, 88, 54],
  30: [28, 45, 38, 62, 50, 76, 58, 71, 44, 83, 67, 92],
  90: [22, 34, 29, 48, 41, 55, 62, 58, 70, 66, 79, 86]
};

export const skillValues = [78, 64, 71, 82];
