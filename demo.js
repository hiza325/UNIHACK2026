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
      },
      {
        title: 'Điều kiện cần và đủ', subject: 'Logic', level: 'Trung bình', mins: 3,
        question: 'Nếu một số chia hết cho 4 thì số đó chắc chắn:',
        options: ['Chia hết cho 2', 'Chia hết cho 8', 'Là số nguyên tố', 'Là số lẻ'],
        answer: 0,
        explanation: 'Mọi bội của 4 đều có dạng 4k = 2(2k), nên luôn chia hết cho 2.',
        source: 'OpenStax Contemporary Mathematics · Logic'
      },
      {
        title: 'Xác suất cơ bản', subject: 'Thống kê', level: 'Cơ bản', mins: 2,
        question: 'Tung một đồng xu cân bằng hai lần. Xác suất xuất hiện đúng một mặt ngửa là:',
        options: ['1/4', '1/2', '3/4', '1'],
        answer: 1,
        explanation: 'Có 4 kết quả đồng khả năng: NN, NS, SN, SS. Hai kết quả có đúng một mặt ngửa nên xác suất là 2/4 = 1/2.',
        source: 'OpenStax Introductory Statistics · Probability'
      },
      {
        title: 'Vận tốc trung bình', subject: 'Vật lý', level: 'Cơ bản', mins: 3,
        question: 'Một vật đi được 120 m trong 10 s. Vận tốc trung bình là:',
        options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'],
        answer: 1,
        explanation: 'Vận tốc trung bình bằng quãng đường chia thời gian: 120 / 10 = 12 m/s.',
        source: 'OpenStax Physics · Motion'
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
      },
      {
        title: 'Necessary and sufficient', subject: 'Logic', level: 'Intermediate', mins: 3,
        question: 'If a number is divisible by 4, it must be:',
        options: ['Divisible by 2', 'Divisible by 8', 'Prime', 'Odd'],
        answer: 0,
        explanation: 'Every multiple of 4 has the form 4k = 2(2k), so it is always divisible by 2.',
        source: 'OpenStax Contemporary Mathematics · Logic'
      },
      {
        title: 'Basic probability', subject: 'Statistics', level: 'Basic', mins: 2,
        question: 'A fair coin is tossed twice. The probability of exactly one head is:',
        options: ['1/4', '1/2', '3/4', '1'],
        answer: 1,
        explanation: 'There are four equally likely outcomes: HH, HT, TH, TT. Two contain exactly one head, so the probability is 2/4 = 1/2.',
        source: 'OpenStax Introductory Statistics · Probability'
      },
      {
        title: 'Average speed', subject: 'Physics', level: 'Basic', mins: 3,
        question: 'An object travels 120 m in 10 s. Its average speed is:',
        options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'],
        answer: 1,
        explanation: 'Average speed is distance divided by time: 120 / 10 = 12 m/s.',
        source: 'OpenStax Physics · Motion'
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
      },
      {
        title: '必要条件と十分条件', subject: '論理', level: '中級', mins: 3,
        question: 'ある数が4で割り切れるなら、必ず成り立つことは？',
        options: ['2で割り切れる', '8で割り切れる', '素数である', '奇数である'],
        answer: 0,
        explanation: '4の倍数は 4k = 2(2k) と表せるため、必ず2で割り切れます。',
        source: 'OpenStax Contemporary Mathematics · Logic'
      },
      {
        title: '確率の基礎', subject: '統計', level: '基礎', mins: 2,
        question: '公平なコインを2回投げるとき、表がちょうど1回出る確率は？',
        options: ['1/4', '1/2', '3/4', '1'],
        answer: 1,
        explanation: '同様に確からしい4通りのうち、表が1回の結果は2通りなので 2/4 = 1/2 です。',
        source: 'OpenStax Introductory Statistics · Probability'
      },
      {
        title: '平均の速さ', subject: '物理', level: '基礎', mins: 3,
        question: '物体が120 mを10秒で進みました。平均の速さは？',
        options: ['10 m/s', '12 m/s', '20 m/s', '1200 m/s'],
        answer: 1,
        explanation: '平均の速さは距離÷時間なので、120 / 10 = 12 m/s です。',
        source: 'OpenStax Physics · Motion'
      }
    ]
  }
};

export const APP_VIEWS = ['dashboard', 'audit', 'history', 'analytics', 'practice', 'profile', 'passport', 'verify', 'about', 'settings', 'admin'];
