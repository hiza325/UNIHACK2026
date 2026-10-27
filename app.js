import { extraCopy } from './i18n.js';
import { demo, APP_VIEWS } from './demo.js';
import { svgIcon } from './icons.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_FILE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'txt', 'js', 'py'];

const copy = {
  vi: {
    workspace: 'KHÔNG GIAN HỌC TẬP', navAudit: 'Phiên phản biện', navHistory: 'Lịch sử học tập', navSkills: 'Kỹ năng tư duy', navSources: 'Thư viện nguồn', plan: 'Gói sinh viên', remaining: 'Lượt phản biện còn lại', profile: 'Minh Anh', role: 'Người học', crumb: 'Không gian học tập', page: 'Phiên phản biện mới', welcome: 'Chào buổi chiều, Minh Anh', subtitle: 'Mỗi lỗi sai là một cơ hội để hiểu sâu hơn.', today: 'THỨ HAI, 26 THÁNG 10', sessionTitle: 'Bắt đầu phiên phản biện', sessionCaption: 'Gửi đề bài và bài làm để bắt đầu kiểm tra tư duy.', stepLabels: ['Tải bài', 'Nhận xét', 'Tự rà soát', 'Gợi ý', 'Tự sửa', 'Cứu trợ', 'Luyện tập'], problem: 'ĐỀ BÀI', yourWork: 'BÀI LÀM CỦA BẠN', addProblem: 'Tải đề bài', addWork: 'Tải bài làm', fileTypes: 'Ảnh, PDF hoặc DOCX', pasteLabel: 'HOẶC DÁN NỘI DUNG BÀI LÀM', placeholder: 'Dán lời giải hoặc đoạn code của bạn vào đây…', privacy: 'Tệp được bảo vệ và chỉ dùng trong phiên này.', start: 'Bắt đầu phản biện', agent: 'ACADEMIC AUDIT AGENT', secure: '● PHIÊN RIÊNG TƯ', greeting: 'Chào Minh Anh! Mình là <strong>PARADOX AI</strong>. Hãy tải đề bài và bài làm hoặc dán nội dung vào khung bên trên. Mình sẽ chỉ cho bạn biết bài làm <strong>đúng hay sai</strong> trước — chưa tiết lộ đáp án.', greetingPrompt: '<span class="prompt">Bạn muốn bắt đầu với bài nào?</span>', timeNow: 'vừa xong', reply1: 'Tải bài của tôi', reply2: 'Tìm hiểu cách hoạt động', chatPlaceholder: 'Trả lời hoặc tự mô tả cách bạn suy nghĩ…', thisWeek: 'TUẦN NÀY', progress: 'Tiến độ học tập', accuracy: 'Tự phát hiện lỗi', accuracyDesc: 'lỗi được tìm thấy trước khi nhận gợi ý', streak: 'Chuỗi ngày học', streakDesc: 'tiếp tục phát huy nhé', daily: 'THỬ THÁCH HÔM NAY', practiceTitle: 'Một góc nhìn khác về đạo hàm', practiceDesc: 'Bạn có thể phát hiện lỗi trong lời giải này không?', challenge: 'Mở thử thách', difficulty: '3 PHÚT', sources: 'Nguồn tham khảo', viewAll: 'XEM TẤT CẢ ↗', source1: 'Định luật phân phối trong đại số', source1type: 'ĐẠI SỐ · KIẾN THỨC NỀN', source2: 'Quy tắc đạo hàm hàm hợp', source2type: 'GIẢI TÍCH · CÔNG THỨC', source3: 'Python: xử lý danh sách', source3type: 'LẬP TRÌNH · PYTHON', todayLabel: 'Hôm nay', selectLang: 'Chọn ngôn ngữ', feedback: 'PARADOX AI sẽ hướng dẫn bạn tự tìm ra lỗi, thay vì đưa đáp án ngay.', submitted: 'Đã gửi bài. Agent đang xem xét lập luận của bạn.', correct: 'Chính xác! Bạn đã tự kiểm tra lập luận rất tốt.', incorrect: 'Chưa chính xác — hãy thử rà soát lại dấu hoặc điều kiện trong từng bước nhé.', hint: 'Gợi ý: hãy kiểm tra quy tắc áp dụng ở dòng thứ hai.', rescue: 'Lời giải tham khảo: áp dụng quy tắc đạo hàm hàm hợp, sau đó thay giá trị x. Nguồn: Quy tắc dây chuyền, OpenStax Calculus Vol. 1, §3.6.', practiceFeedback: 'Thử thách đã mở — hãy viết điều bạn nghĩ chưa hợp lý vào ô trả lời nhé.', historyMessage: 'Lịch sử học tập sẽ hiện ở đây sau phiên phản biện đầu tiên.', skillsMessage: 'Kỹ năng tư duy: nhận diện giả định, kiểm tra phép biến đổi và tự giải thích lập luận.', sourceMessage: 'Thư viện nguồn gồm công thức và tài liệu tham khảo được trích dẫn trong từng phiên.'
  },
  en: {
    workspace: 'LEARNING SPACE', navAudit: 'Audit session', navHistory: 'Learning history', navSkills: 'Thinking skills', navSources: 'Source library', plan: 'Student plan', remaining: 'Audits remaining', profile: 'Minh Anh', role: 'Learner', crumb: 'Learning space', page: 'New audit session', welcome: 'Good afternoon, Minh Anh', subtitle: 'Every mistake is a chance to understand more deeply.', today: 'MONDAY, OCTOBER 26', sessionTitle: 'Start an audit session', sessionCaption: 'Add a prompt and your work to start reviewing your reasoning.', stepLabels: ['Upload', 'Review', 'Reflect', 'Hint', 'Revise', 'Rescue', 'Practice'], problem: 'PROMPT', yourWork: 'YOUR WORK', addProblem: 'Upload prompt', addWork: 'Upload your work', fileTypes: 'Image, PDF or DOCX', pasteLabel: 'OR PASTE YOUR WORK', placeholder: 'Paste your solution or code here…', privacy: 'Files are protected and used only in this session.', start: 'Start audit', agent: 'ACADEMIC AUDIT AGENT', secure: '● PRIVATE SESSION', greeting: 'Hi Minh Anh! I’m <strong>PARADOX AI</strong>. Upload a prompt and your work, or paste it above. I’ll first tell you whether it is <strong>right or wrong</strong> — without revealing the answer.', greetingPrompt: '<span class="prompt">Which problem would you like to start with?</span>', timeNow: 'just now', reply1: 'Upload my work', reply2: 'How does this work?', chatPlaceholder: 'Reply or describe how you are thinking…', thisWeek: 'THIS WEEK', progress: 'Learning progress', accuracy: 'Self-found errors', accuracyDesc: 'mistakes spotted before a hint', streak: 'Learning streak', streakDesc: 'keep it going', daily: 'TODAY’S CHALLENGE', practiceTitle: 'A different view of derivatives', practiceDesc: 'Can you spot the error in this solution?', challenge: 'Open challenge', difficulty: '3 MIN', sources: 'References', viewAll: 'VIEW ALL ↗', source1: 'Distributive law in algebra', source1type: 'ALGEBRA · FOUNDATIONS', source2: 'Chain rule for derivatives', source2type: 'CALCULUS · FORMULA', source3: 'Python: working with lists', source3type: 'PROGRAMMING · PYTHON', todayLabel: 'Today', selectLang: 'Select language', feedback: 'PARADOX AI guides you to find the mistake instead of giving the answer right away.', submitted: 'Work submitted. The agent is reviewing your reasoning.', correct: 'That’s right! You checked your reasoning carefully.', incorrect: 'Not quite — review the signs or conditions in each step.', hint: 'Hint: check which rule was applied on the second line.', rescue: 'Suggested solution: apply the chain rule, then substitute the value of x. Source: Chain Rule, OpenStax Calculus Vol. 1, §3.6.', practiceFeedback: 'Challenge opened — write what seems incorrect in the reply box.', historyMessage: 'Your learning history will appear here after your first audit.', skillsMessage: 'Thinking skills: identify assumptions, check transformations, and explain your reasoning.', sourceMessage: 'The source library collects formulas and references cited in each session.'
  },
  jp: {
    workspace: '学習スペース', navAudit: '監査セッション', navHistory: '学習履歴', navSkills: '思考スキル', navSources: '参考資料', plan: '学生プラン', remaining: '残りの監査回数', profile: 'ミン・アイン', role: '学習者', crumb: '学習スペース', page: '新しい監査セッション', welcome: 'こんにちは、ミン・アインさん', subtitle: '間違いは、より深く理解するチャンスです。', today: '10月26日 月曜日', sessionTitle: '監査セッションを開始', sessionCaption: '問題と解答を追加して、考え方を確認しましょう。', stepLabels: ['提出', '判定', '振り返り', 'ヒント', '修正', '解説', '練習'], problem: '問題', yourWork: 'あなたの解答', addProblem: '問題をアップロード', addWork: '解答をアップロード', fileTypes: '画像、PDF または DOCX', pasteLabel: 'または解答を貼り付け', placeholder: '解答またはコードをここに貼り付け…', privacy: 'ファイルは保護され、このセッションでのみ使用されます。', start: '監査を開始', agent: 'アカデミック監査エージェント', secure: '● プライベートセッション', greeting: 'こんにちは、ミン・アインさん。<strong>PARADOX AI</strong>です。問題と解答をアップロードするか、上に貼り付けてください。まず、答えを明かさずに<strong>正解かどうか</strong>をお知らせします。', greetingPrompt: '<span class="prompt">どの問題から始めますか？</span>', timeNow: 'たった今', reply1: '解答をアップロード', reply2: '仕組みを確認', chatPlaceholder: '返信または考え方を入力…', thisWeek: '今週', progress: '学習の進捗', accuracy: '自分で見つけた誤り', accuracyDesc: 'ヒントの前に見つけた誤り', streak: '連続学習日数', streakDesc: 'この調子で続けましょう', daily: '今日のチャレンジ', practiceTitle: '導関数の別の見方', practiceDesc: 'この解答の誤りを見つけられますか？', challenge: '挑戦を始める', difficulty: '3分', sources: '参考資料', viewAll: 'すべて見る ↗', source1: '代数の分配法則', source1type: '代数 · 基礎', source2: '合成関数の微分法', source2type: '微積分 · 公式', source3: 'Python：リストの操作', source3type: 'プログラミング · Python', todayLabel: '今日', selectLang: '言語を選択', feedback: 'PARADOX AIは答えをすぐに教えず、自分で誤りを見つけるよう案内します。', submitted: '解答を送信しました。エージェントが考え方を確認しています。', correct: '正解です。丁寧に考え方を確認できました。', incorrect: 'もう少しです。各ステップの符号や条件を見直しましょう。', hint: 'ヒント：2行目で適用した規則を確認してみましょう。', rescue: '解説：合成関数の微分法を適用してから、xの値を代入します。出典：Chain Rule, OpenStax Calculus Vol. 1, §3.6。', practiceFeedback: '問題を開きました。気になる点を返信欄に入力してください。', historyMessage: '最初の監査セッション後に学習履歴が表示されます。', skillsMessage: '思考スキル：前提を特定し、変形を確認し、考え方を説明します。', sourceMessage: '参考資料には、各セッションで引用された公式や資料が表示されます。'
  }
};

Object.assign(copy.vi, extraCopy.vi);
Object.assign(copy.en, extraCopy.en);
Object.assign(copy.jp, extraCopy.jp);

const NAV_ITEMS = [
  ['dashboard', 'navDashboard', 'grid'],
  ['audit', 'navAudit', 'shield'],
  ['history', 'navHistory', 'clock'],
  ['analytics', 'navAnalytics', 'chart'],
  ['practice', 'navPractice', 'book'],
  ['profile', 'navProfile', 'user'],
  ['about', 'navAbout', 'help'],
  ['settings', 'navSettings', 'settings']
];
const PAGE_KEYS = {
  dashboard: 'pageDashboard', audit: 'page', history: 'pageHistory',
  analytics: 'pageAnalytics', practice: 'pagePractice', profile: 'pageProfile',
  about: 'pageAbout', settings: 'pageSettings'
};

class EduApp extends HTMLElement {
  constructor() {
    super();
    this.lang = ['vi', 'en', 'jp'].includes(localStorage.getItem('paradox-lang')) ? localStorage.getItem('paradox-lang') : 'vi';
    this.step = 0;
    this.files = { problem: [], work: [] };
    this.authMode = 'login';
    this.user = this.readSession();
    this.view = 'dashboard';
    this.pendingView = null;
    this.practiceIndex = null;
    this.practiceSolved = this.readJSON('paradox-practice', []);
    this.practiceActivity = this.readJSON('paradox-practice-activity', []);
    this.settings = this.readJSON('paradox-settings', { reminder: true, digest: true, sound: false, subject: 'math', hint: 2 });
    this.auditMessages = [];
    this.auditText = '';
    this.isAnalyzing = false;
    this.auditStorageReady = false;
    this.filePreviewUrls = {};
    this.historyPage = 1;
    this.historyPageSize = 5;
    this.toastTimer = null;
  }
  connectedCallback() {
    this.addEventListener('click', this.onClick);
    this.addEventListener('change', this.onChange);
    this.addEventListener('input', this.onInput);
    this.addEventListener('submit', this.onSubmit);
    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('hashchange', this.onHashChange);
    this.handleRoute();
    this.loadAuditState().then(() => {
      this.auditStorageReady = true;
      if (this.user && this.view === 'audit') this.render();
    });
  }
  disconnectedCallback() {
    this.removeEventListener('click', this.onClick);
    this.removeEventListener('change', this.onChange);
    this.removeEventListener('input', this.onInput);
    this.removeEventListener('submit', this.onSubmit);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('hashchange', this.onHashChange);
  }
  onHashChange = () => { if (!location.hash || location.hash.startsWith('#/')) this.handleRoute(); };
  readJSON(key, fallback) { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
  openAuditDB() {
    if (!('indexedDB' in window)) return Promise.resolve(null);
    return new Promise(resolve => {
      const request = indexedDB.open('paradox-learning', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }
  async loadAuditState() {
    this.auditDB = await this.openAuditDB();
    if (!this.auditDB) return;
    const state = await new Promise(resolve => {
      const request = this.auditDB.transaction('state', 'readonly').objectStore('state').get('audit');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
    if (!state) return;
    this.step = Number.isInteger(state.step) ? Math.max(0, Math.min(6, state.step)) : 0;
    this.auditMessages = Array.isArray(state.messages) ? state.messages.slice(-60) : [];
    this.auditText = typeof state.text === 'string' ? state.text : '';
    this.files = {
      problem: state.files?.problem ? [state.files.problem] : [],
      work: state.files?.work ? [state.files.work] : []
    };
  }
  saveAuditState() {
    if (!this.auditDB) return;
    const state = {
      step: this.step,
      text: this.auditText,
      messages: this.auditMessages.slice(-60),
      files: { problem: this.files.problem[0] || null, work: this.files.work[0] || null }
    };
    try { this.auditDB.transaction('state', 'readwrite').objectStore('state').put(state, 'audit'); } catch { /* IndexedDB may be unavailable in private mode. */ }
  }
  handleRoute() {
    const raw = location.hash.startsWith('#/') ? location.hash.slice(2).replace(/\/+$/, '') : '';
    document.body.classList.remove('sitemap-mode');
    if (raw === 'sitemap') { this.view = 'sitemap'; this.renderSitemap(); return; }
    window.scrollTo(0, 0);
    if (!this.user) {
      this.view = 'landing';
      this.renderLanding();
      if (APP_VIEWS.includes(raw)) { this.pendingView = raw; this.openAuth('login'); }
      else this.pendingView = null;
      return;
    }
    this.view = APP_VIEWS.includes(raw) ? raw : 'dashboard';
    this.render();
  }
  navigate(view) {
    const target = `#/${view}`;
    if (location.hash === target) this.handleRoute();
    else location.hash = target;
  }
  logout() {
    localStorage.removeItem('paradox-session');
    this.user = null;
    this.view = 'landing';
    this.pendingView = null;
    document.body.classList.remove('sitemap-mode');
    document.body.style.overflow = '';
    history.replaceState(null, '', location.pathname + location.search);
    window.scrollTo(0, 0);
    this.renderLanding();
  }
  themeToggleMarkup(extraClass = '') {
    const dark = document.body.classList.contains('dark');
    const label = this.t(dark ? 'themeToLight' : 'themeToDark');
    return `<button class="icon-button theme-toggle ${extraClass}" type="button" data-theme-toggle aria-label="${label}" title="${label}" aria-pressed="${dark}">${svgIcon(dark ? 'sun' : 'moon')}</button>`;
  }
  applyTheme(dark, persist = true) {
    document.body.classList.toggle('dark', dark);
    if (persist) localStorage.setItem('paradox-theme', dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#151b18' : '#f6f7f3');
    this.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      const label = this.t(dark ? 'themeToLight' : 'themeToDark');
      btn.innerHTML = svgIcon(dark ? 'sun' : 'moon');
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
      btn.setAttribute('aria-pressed', String(dark));
    });
    this.querySelectorAll('[data-set-theme]').forEach(btn => {
      const active = btn.dataset.setTheme === (dark ? 'dark' : 'light');
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  }
  toggleTheme() { this.applyTheme(!document.body.classList.contains('dark')); }
  saveSettings() { localStorage.setItem('paradox-settings', JSON.stringify(this.settings)); }
  applyStoredTheme() { this.applyTheme(localStorage.getItem('paradox-theme') === 'dark', false); }
  readSession() { try { return JSON.parse(localStorage.getItem('paradox-session') || 'null'); } catch { return null; } }
  t(key) { return copy[this.lang][key] || copy.vi[key] || key; }
  renderLanding() {
    document.body.classList.remove('sitemap-mode');
    document.documentElement.lang = this.lang === 'jp' ? 'ja' : this.lang;
    document.body.style.overflow = '';
    this.applyStoredTheme();
    const text = {
      vi: { nav:'Cách hoạt động', login:'Đăng nhập', cta:'Bắt đầu học', eyebrow:'PARADOX / HỌC TỪ NHỮNG ĐIỀU CHƯA ĐÚNG', title:'Đừng vội<br>xem <em>đáp án.</em>', intro:'Có những lỗi sai, tự tìm ra một lần sẽ nhớ lâu hơn. Cùng PARADOX đọc lại bài làm, đặt câu hỏi và tìm cách sửa.', start:'Thử một phiên học', explore:'Khám phá cách học', note:'Bản trải nghiệm · Bắt đầu từ một bài làm', badge:'NGƯỜI BẠN PHẢN BIỆN AI', flag:'Có điều gì đó chưa ổn…', response:'Chính xác. Bạn nghĩ lỗi nằm ở đâu?', audience:'DÀNH CHO NHỮNG TÂM TRÍ TÒ MÒ', f1:'Gợi ý thay vì đáp án', f2:'Học từ mỗi lần sai', f3:'Giải thích luôn có nguồn dẫn', loginTitle:'Chào mừng trở lại', signupTitle:'Tạo tài khoản PARADOX', name:'Tên của bạn', email:'Địa chỉ email', password:'Mật khẩu', confirm:'Nhập lại mật khẩu', submitLogin:'Đăng nhập', submitSignup:'Tạo tài khoản', switchLogin:'Đã có tài khoản? Đăng nhập', switchSignup:'Chưa dùng PARADOX? Tạo tài khoản', mismatch:'Hai mật khẩu chưa khớp.', footer:'Một chút tư duy tạo nên khác biệt.' },
      en: { nav:'How it works', login:'Log in', cta:'Start learning', eyebrow:'A LEARNING SPACE THAT CHALLENGES YOU', title:'Think it through.<br>Find it yourself.', intro:'An AI audit partner that helps you catch your own mistakes before revealing the solution.', start:'Begin your audit', explore:'Explore the method', note:'Free to get started · No card required', badge:'YOUR AI AUDIT PARTNER', flag:'Something feels off…', response:'That’s right. Where might the error be?', audience:'MADE FOR CURIOUS MINDS', f1:'Hints, not shortcuts', f2:'Learn from every mistake', f3:'Sources behind explanations', loginTitle:'Welcome back', signupTitle:'Create your PARADOX account', name:'Your name', email:'Email address', password:'Password', confirm:'Confirm password', submitLogin:'Log in', submitSignup:'Create account', switchLogin:'Already have an account? Log in', switchSignup:'New to PARADOX? Sign up', mismatch:'Passwords do not match.', footer:'A little more thinking changes everything.' },
      jp: { nav:'使い方', login:'ログイン', cta:'学習を始める', eyebrow:'考える力を伸ばす学習スペース', title:'考え抜こう。<br>自分で見つけよう。', intro:'答えを教える前に、自分の間違いに気づく力を育てるAI学習パートナー。', start:'監査を始める', explore:'学び方を見る', note:'無料で始められます · カード不要', badge:'AI学習監査パートナー', flag:'ここが少し気になる…', response:'正解です。どこに誤りがありそうですか？', audience:'好奇心を持つすべての人へ', f1:'答えではなくヒント', f2:'間違いから学ぶ', f3:'説明には参考資料を掲載', loginTitle:'おかえりなさい', signupTitle:'アカウントを作成', name:'お名前', email:'メールアドレス', password:'パスワード', confirm:'パスワードの確認', submitLogin:'ログイン', submitSignup:'登録する', switchLogin:'アカウントをお持ちですか？ログイン', switchSignup:'初めての方はこちら', mismatch:'パスワードが一致しません。', footer:'少し考えるだけで、理解は変わります。' }
    }[this.lang];
    Object.assign(text, ({
      vi: { homeNav:'Trang chủ', featuresNav:'Có gì ở PARADOX?', audienceNav:'Lợi ích', howTitle:'Học bằng cách tự tìm ra lỗi', howIntro:'PARADOX dẫn dắt bạn qua từng bước — từ bài làm đầu tiên đến khi thật sự hiểu vì sao mình sai.', howOne:'Gửi bài làm', howOneDesc:'Thêm đề bài cùng lời giải, ghi chú hoặc đoạn code bạn muốn kiểm tra.', howTwo:'Tự rà soát', howTwoDesc:'AI chỉ báo đúng hoặc sai, rồi gợi ý vừa đủ để bạn tự phát hiện điểm chưa hợp lý.', howThree:'Củng cố kiến thức', howThreeDesc:'Xem lời giải có nguồn dẫn và luyện thêm bài tương tự để ghi nhớ lâu hơn.', featuresTitle:'Một người bạn học biết đặt câu hỏi', featuresIntro:'Được thiết kế để việc học chủ động trở nên tự nhiên, rõ ràng và đáng tin cậy.', featureOne:'Tư duy chủ động', featureOneDesc:'Không nhận đáp án ngay. Bạn tự kiểm tra, sửa lỗi và hiểu sâu hơn qua từng lượt.', featureTwo:'Phản biện theo tiến trình', featureTwoDesc:'Bảy bước hỗ trợ từ nhận xét ban đầu đến gợi ý, giải thích và thực hành.', featureThree:'Giải thích có nguồn', featureThreeDesc:'Công thức và tài liệu tham khảo đi cùng lời giải để bạn có thể kiểm chứng.' },
      en: { homeNav:'Home', featuresNav:'Inside PARADOX', audienceNav:'Why PARADOX', howTitle:'Learn by finding the mistake', howIntro:'PARADOX guides you from your first attempt to understanding exactly why it went wrong.', howOne:'Share your work', howOneDesc:'Add the prompt and the solution, notes, or code you want to review.', howTwo:'Audit your reasoning', howTwoDesc:'AI tells you right or wrong, then gives just enough guidance for you to spot the issue.', howThree:'Make it stick', howThreeDesc:'Explore a sourced explanation and practice a similar problem to build lasting understanding.', featuresTitle:'A learning partner that asks better questions', featuresIntro:'Designed to make active learning feel clear, natural, and trustworthy.', featureOne:'Active thinking', featureOneDesc:'No instant answers. Check your work, revise it, and build deeper understanding.', featureTwo:'A guided process', featureTwoDesc:'Seven steps from an initial review through hints, explanations, and practice.', featureThree:'Grounded explanations', featureThreeDesc:'Formulas and references accompany explanations so you can verify them.' },
      jp: { homeNav:'ホーム', featuresNav:'PARADOXの特徴', audienceNav:'選ばれる理由', howTitle:'自分で誤りを見つけて学ぶ', howIntro:'最初の解答から、間違いの理由を理解するまでPARADOXが案内します。', howOne:'解答を共有', howOneDesc:'問題と、確認したい解答・メモ・コードを追加します。', howTwo:'考え方を確認', howTwoDesc:'AIは正誤を伝え、問題点を自分で見つけるためのヒントを示します。', howThree:'知識を定着', howThreeDesc:'出典付きの解説を読み、似た問題に取り組んで理解を深めます。', featuresTitle:'問いかけてくれる学習パートナー', featuresIntro:'主体的な学びを、わかりやすく自然で信頼できる体験に。', featureOne:'自分で考える', featureOneDesc:'すぐに答えを受け取らず、確認と修正を通じて理解を深めます。', featureTwo:'段階的なサポート', featureTwoDesc:'最初の確認からヒント、解説、練習までの7ステップ。', featureThree:'根拠のある解説', featureThreeDesc:'公式や参考資料を示し、説明の内容を確認できます。' }
    })[this.lang]);
    this.innerHTML = `<main class="landing" id="top"><header class="landing-nav"><a class="landing-brand" href="#top"><img src="logo-mark.svg" alt=""><span><b>PARADOX</b><small>THINK. QUESTION. UNDERSTAND.</small></span></a><button class="mobile-menu-toggle" id="mobile-menu-toggle" aria-label="${this.t('menuOpen')}" aria-expanded="false" aria-controls="landing-nav-links">☰</button><nav id="landing-nav-links"><a href="#top">${text.homeNav}</a><a href="#how">${text.nav}</a><a href="#features">${text.featuresNav}</a><a href="#audience">${text.audienceNav}</a><button id="landing-login">${text.login}</button><button class="lang-button" id="landing-lang">◎ ${this.lang.toUpperCase()}⌄</button>${this.themeToggleMarkup('landing-theme-toggle')}</nav></header><section class="hero"><div class="hero-copy"><div class="hero-eyebrow"><i></i>${text.eyebrow}</div><h1>${text.title}</h1><p>${text.intro}</p><div class="hero-actions"><button class="hero-primary" id="hero-start">${text.start}<span>↗</span></button><a class="hero-secondary" href="#how">${text.explore} <span>↓</span></a></div><div class="hero-note"><span>✳</span>${text.note}</div></div><div class="study-scene"><article class="study-sheet"><header class="sheet-meta"><span>PARADOX / ${this.lang==='vi'?'SỔ TAY TƯ DUY':this.lang==='en'?'THINKING JOURNAL':'学習ノート'}</span><span>№ 001</span></header><p class="sheet-subject">${this.lang==='vi'?'Đại số · Tìm giá trị của x':this.lang==='en'?'Algebra · Find the value of x':'代数 · x の値を求める'}</p><div class="sheet-equation">2x + 5 = 13</div><div class="solution-line"><small>01</small><span>2x = 13 − 5</span></div><div class="solution-line"><small>02</small><span>2x = 8</span></div><div class="solution-line wrong"><small>03</small><del>x = 8 − 2</del><span class="correction">${this.lang==='vi'?'Thử nghĩ lại ↙':this.lang==='en'?'Think again ↙':'もう一度 ↙'}</span></div><p class="margin-note">${this.lang==='vi'?'Ở bước cuối, mình cần trừ 2<br>hay chia cho 2?':this.lang==='en'?'In the last step, do we subtract 2<br>or divide by 2?':'最後のステップでは、2を引く？<br>それとも2で割る？'}</p><footer class="sheet-bottom"><span>${this.lang==='vi'?'MỘT CÂU HỎI. MỘT BƯỚC TIẾN.':this.lang==='en'?'ONE QUESTION. ONE STEP FORWARD.':'一つの問い。一歩前へ。'}</span><span>01 / 07</span></footer></article><p class="scene-caption"><b>↳</b>${this.lang==='vi'?'Một ví dụ nhỏ về cách học cùng PARADOX.':this.lang==='en'?'A small example of learning with PARADOX.':'PARADOXでの学びの一例。'}</p></div></section><div class="desktop-panels"><section class="how-section" id="how"><div class="section-heading"><span class="section-kicker">01 — THE AUDIT METHOD</span><h2>${text.howTitle}</h2><p>${text.howIntro}</p></div><div class="how-cards"><article><span class="how-number">01</span><div class="how-icon">↗</div><h3>${text.howOne}</h3><p>${text.howOneDesc}</p></article><article class="how-featured"><span class="how-number">02</span><div class="how-icon">◎</div><h3>${text.howTwo}</h3><p>${text.howTwoDesc}</p></article><article><span class="how-number">03</span><div class="how-icon">✳</div><h3>${text.howThree}</h3><p>${text.howThreeDesc}</p></article></div></section><section class="landing-proof" id="features"><div class="proof-lead"><span>${text.audience}</span><b>01 / 03</b></div><div class="proof-items"><article><i>↗</i><span>${text.f1}</span></article><article><i>◎</i><span>${text.f2}</span></article><article><i>⌁</i><span>${text.f3}</span></article></div></section><section class="features-section" id="audience"><div class="section-heading"><span class="section-kicker">02 — BUILT FOR BETTER THINKING</span><h2>${text.featuresTitle}</h2><p>${text.featuresIntro}</p></div><div class="feature-grid"><article><span>✳</span><h3>${text.featureOne}</h3><p>${text.featureOneDesc}</p></article><article><span>⌘</span><h3>${text.featureTwo}</h3><p>${text.featureTwoDesc}</p></article><article><span>↗</span><h3>${text.featureThree}</h3><p>${text.featureThreeDesc}</p></article></div></section></div><footer class="landing-footer"><span>PARADOX AI © 2026</span><strong>${this.t('contestFooter')}</strong><a class="footer-sitemap" href="#/sitemap">${this.t('smBadge')} ↗</a><span>NEXUS ACADEMY ANALYTICS</span></footer><div class="auth-backdrop" id="auth-backdrop" hidden><section class="auth-panel" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button class="auth-close" id="auth-close" aria-label="${this.t('close')}">×</button><img class="auth-logo" src="logo-mark.svg" alt=""><span class="auth-kicker">PARADOX AI</span><h2 id="auth-title"></h2><p class="auth-subtitle">${text.intro}</p><form id="auth-form"><label class="auth-name-field">${text.name}<input name="name" autocomplete="name"></label><label>${text.email}<input name="email" type="email" autocomplete="email" required></label><label>${text.password}<input name="password" type="password" minlength="8" autocomplete="current-password" required></label><label class="auth-confirm-field">${text.confirm}<input name="confirm" type="password" minlength="8" autocomplete="new-password"></label><p class="auth-error" id="auth-error" role="alert"></p><button class="auth-submit" type="submit"></button></form><button class="auth-switch" id="auth-switch"></button><small class="auth-legal">${this.t('authLegal')}</small></section></div></main>`;
    this.updateAuthText(text);
    const menuButton = this.querySelector('#mobile-menu-toggle');
    menuButton.addEventListener('click', () => {
      const open = this.querySelector('.landing-nav').classList.toggle('menu-open');
      menuButton.setAttribute('aria-expanded', String(open));
      menuButton.setAttribute('aria-label', this.t(open ? 'menuClose' : 'menuOpen'));
      menuButton.textContent = open ? '×' : '☰';
    });
    this.querySelectorAll('#landing-nav-links a').forEach(link => link.addEventListener('click', () => {
      this.querySelector('.landing-nav').classList.remove('menu-open');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', this.t('menuOpen'));
      menuButton.textContent = '☰';
    }));
    this.querySelector('#landing-login').addEventListener('click',()=>{this.querySelector('.landing-nav').classList.remove('menu-open');const button=this.querySelector('#mobile-menu-toggle');button.setAttribute('aria-expanded','false');button.textContent='☰';this.openAuth('login');});
    this.querySelector('#hero-start').addEventListener('click',()=>this.openAuth('signup'));
    this.querySelector('#auth-switch').addEventListener('click',()=>this.openAuth(this.authMode==='login'?'signup':'login'));
    this.querySelector('#auth-close').addEventListener('click',()=>{this.querySelector('#auth-backdrop').hidden=true;});
    this.querySelector('#auth-backdrop').addEventListener('click',e=>{if(e.target.id==='auth-backdrop')e.currentTarget.hidden=true;});
    this.querySelector('#auth-form').addEventListener('submit',e=>this.authenticate(e,text));
    this.querySelector('#landing-lang').addEventListener('click',()=>{const langs=['vi','en','jp'];this.lang=langs[(langs.indexOf(this.lang)+1)%langs.length];localStorage.setItem('paradox-lang',this.lang);this.renderLanding();});
  }
  updateAuthText(text) { const signup=this.authMode==='signup'; this.querySelector('#auth-title').textContent=signup?text.signupTitle:text.loginTitle; this.querySelector('.auth-name-field').hidden=!signup; this.querySelector('.auth-confirm-field').hidden=!signup; this.querySelector('.auth-name-field input').required=signup; this.querySelector('.auth-confirm-field input').required=signup; this.querySelector('#auth-form input[name="password"]').autocomplete=signup?'new-password':'current-password'; this.querySelector('.auth-submit').innerHTML=`${signup?text.submitSignup:text.submitLogin}<span>↗</span>`; this.querySelector('#auth-switch').textContent=signup?text.switchLogin:text.switchSignup; }
  openAuth(mode) { this.authMode=mode; this.querySelector('#auth-error').textContent=''; this.querySelector('#auth-backdrop').hidden=false; this.updateAuthText(({vi:{loginTitle:'Chào mừng trở lại',signupTitle:'Tạo tài khoản PARADOX',name:'Tên của bạn',email:'Địa chỉ email',password:'Mật khẩu',confirm:'Nhập lại mật khẩu',submitLogin:'Đăng nhập',submitSignup:'Tạo tài khoản',switchLogin:'Đã có tài khoản? Đăng nhập',switchSignup:'Chưa dùng PARADOX? Tạo tài khoản'},en:{loginTitle:'Welcome back',signupTitle:'Create your PARADOX account',name:'Your name',email:'Email address',password:'Password',confirm:'Confirm password',submitLogin:'Log in',submitSignup:'Create account',switchLogin:'Already have an account? Log in',switchSignup:'New to PARADOX? Sign up'},jp:{loginTitle:'おかえりなさい',signupTitle:'アカウントを作成',name:'お名前',email:'メールアドレス',password:'パスワード',confirm:'パスワードの確認',submitLogin:'ログイン',submitSignup:'登録する',switchLogin:'アカウントをお持ちですか？ログイン',switchSignup:'初めての方はこちら'}})[this.lang]); }
  authenticate(event, text) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get('password') || '');
    if (this.authMode === 'signup' && password !== String(data.get('confirm') || '')) {
      this.querySelector('#auth-error').textContent = text.mismatch;
      return;
    }
    const email = String(data.get('email') || '').trim();
    const name = String(data.get('name') || '').trim() || email.split('@')[0];
    this.user = { name, email };
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    const target = this.pendingView || 'dashboard';
    this.pendingView = null;
    this.navigate(target);
  }
  render() {
    if (!this.user) { this.renderLanding(); return; }
    document.body.classList.remove('sitemap-mode');
    document.documentElement.lang = this.lang === 'jp' ? 'ja' : this.lang;
    document.body.style.overflow = '';
    this.applyStoredTheme();
    const pageTitle = this.t(PAGE_KEYS[this.view] || 'page');
    this.innerHTML = `<div class="app-shell">
      ${this.sidebar()}
      <main class="main">
        ${this.topbar(pageTitle)}
        ${this.viewMarkup()}
      </main>
    </div><footer class="app-footer">${this.t('contestFooter')}</footer><div class="toast" id="toast" role="status"></div>`;
    this.bind();
  }
  sidebar() {
    const t = k => this.t(k);
    const count = String(this.getSessions().length).padStart(2, '0');
    const nav = NAV_ITEMS.map(([view, key, ic]) => `<button class="nav-item ${this.view === view ? 'active' : ''}" data-route="${view}" ${this.view === view ? 'aria-current="page"' : ''}><span class="nav-icon">${svgIcon(ic)}</span><span class="nav-text">${t(key)}</span>${view === 'history' ? `<span class="nav-count">${count}</span>` : ''}</button>`).join('');
    return `<aside class="sidebar">
      <a class="brand brand-link" href="#/dashboard" aria-label="PARADOX AI">
        <img class="brand-mark" src="logo-mark.svg" alt="" />
        <div class="brand-copy"><div class="brand-name">PARADOX<span class="brand-ai"> AI</span></div><div class="brand-sub">NEXUS ACADEMY ANALYTICS</div></div>
      </a>
      <div style="width:100%"><div class="workspace-label">${t('workspace')}</div><nav class="nav-group">${nav}<button class="nav-item mobile-more ${['about', 'settings'].includes(this.view) ? 'active' : ''}" type="button" data-mobile-more aria-expanded="false" ${['about', 'settings'].includes(this.view) ? 'aria-current="page"' : ''}><span class="nav-icon">•••</span><span class="nav-text">${t('more')}</span></button></nav></div>
      <div class="mobile-more-menu" id="mobile-more-menu" hidden><button data-route="about">${svgIcon('help')} ${t('navAbout')}</button><button data-route="settings">${svgIcon('settings')} ${t('navSettings')}</button></div>
      <div class="sidebar-spacer"></div>
      <div class="plan-card"><div class="plan-top"><span>${t('plan')}</span><span class="plan-tag">FREE</span></div><p>${t('remaining')}</p><div class="progress-track"><div class="progress-fill"></div></div><div class="plan-foot"><span>04 / 10</span><span>60%</span></div></div>
      <div class="profile"><div class="avatar">${this.escape((this.user.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase())}</div><div class="profile-copy"><div class="profile-name">${this.escape(this.user.name || this.user.email)}</div><div class="profile-role">${this.escape(this.user.email)}</div></div></div>
    </aside>`;
  }
  topbar(title) {
    const t = k => this.t(k);
    return `<header class="topbar">
      <div class="crumb">${t('crumb')}<span>/</span><strong>${title}</strong></div>
      <div class="top-actions">
        <button class="icon-button" data-route="sitemap" aria-label="${t('smBadge')}" title="${t('smBadge')}">${svgIcon('grid')}</button>
        <button class="lang-button" id="lang-toggle" aria-label="${t('selectLang')}">◎ <span>${this.lang.toUpperCase()}</span>⌄</button>
        ${this.themeToggleMarkup()}
        <button class="logout-button" id="logout-button">${this.lang === 'en' ? 'Log out' : this.lang === 'jp' ? 'ログアウト' : 'Đăng xuất'} ↗</button>
      </div>
    </header>`;
  }
  viewMarkup() {
    switch (this.view) {
      case 'audit': return this.viewAudit();
      case 'history': return this.viewHistory();
      case 'analytics': return this.viewAnalytics();
      case 'practice': return this.viewPractice();
      case 'profile': return this.viewProfile();
      case 'about': return this.viewAbout();
      case 'settings': return this.viewSettings();
      default: return this.viewDashboard();
    }
  }
  viewHead(title, subKey) {
    return `<section class="view-head"><div><div class="eyebrow"><span class="live-dot"></span> ${this.t('workspace')}</div><h1>${title}</h1><p class="view-sub">${this.t(subKey)}</p></div><div class="date-chip">◷ &nbsp;${this.t('today')}</div></section>`;
  }
  statCard(label, value, suffix = '', trend = '') {
    return `<section class="stat-card"><span class="stat-label">${label}</span><div class="stat-value">${value}<small>${suffix}</small>${trend ? `<span class="stat-trend">${trend}</span>` : ''}</div></section>`;
  }
  getSessions() {
    const saved = this.readJSON('paradox-audit-sessions', []);
    const seen = new Set();
    return [...saved, ...demo[this.lang].sessions].filter(item => {
      const key = item.id || `${item.date}|${item.title}|${item.skill}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  sessionISODate(session) {
    if (session.isoDate) return session.isoDate;
    const [day, month] = String(session.date || '').split('/').map(Number);
    if (!day || !month) return '';
    return `${new Date().getFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  learningMetrics() {
    const sessions = this.getSessions();
    const average = sessions.length ? Math.round(sessions.reduce((sum, item) => sum + Number(item.score || 0), 0) / sessions.length) : 0;
    const mastered = sessions.filter(item => item.status === 'mastered').length;
    const accuracy = sessions.length ? Math.round(mastered / sessions.length * 100) : 0;
    const dates = new Set([
      ...sessions.map(item => this.sessionISODate(item)),
      ...this.practiceActivity.map(item => item.isoDate)
    ].filter(Boolean));
    let cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    const todayKey = this.localDateKey(cursor);
    if (!dates.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    while (dates.has(this.localDateKey(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return { sessions, average, mastered, accuracy, streak };
  }
  activitySeries(period) {
    const slots = period === 7 ? 7 : 12;
    const values = Array(slots).fill(0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const activities = [
      ...this.getSessions().map(item => ({ isoDate: this.sessionISODate(item), minutes: 6 + Math.round(Number(item.score || 0) / 20) })),
      ...this.practiceActivity
    ];
    activities.forEach(item => {
      const date = new Date(`${item.isoDate}T00:00:00`);
      if (Number.isNaN(date.getTime())) return;
      const daysAgo = Math.floor((now - date) / 86400000);
      if (daysAgo < 0 || daysAgo >= period) return;
      const chronologicalDay = period - 1 - daysAgo;
      const index = Math.min(slots - 1, Math.floor(chronologicalDay / (period / slots)));
      values[index] += Number(item.minutes || 3);
    });
    const max = Math.max(...values, 1);
    return { values, heights: values.map(value => value ? Math.max(12, Math.round(value / max * 100)) : 4) };
  }
  weeklyChartMarkup() {
    const series = this.activitySeries(7);
    return `<div class="chart">${series.heights.map((height, i) => `<div class="bar-wrap"><span class="bar ${series.values[i] === Math.max(...series.values) && series.values[i] ? 'hot' : ''}" style="height:${height}%" title="${series.values[i]} min"></span></div>`).join('')}</div><div class="chart-labels"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>`;
  }
  recordAuditSession(text) {
    const subjectKeys = { math: 'setSubjectMath', algebra: 'setSubjectAlgebra', code: 'setSubjectCode' };
    const source = this.files.problem[0]?.name || String(text || '').split(/\r?\n/)[0].slice(0, 54) || this.t('sessionTitle');
    const now = new Date();
    const sessions = this.readJSON('paradox-audit-sessions', []);
    sessions.unshift({
      id: `audit-${now.getTime()}`,
      date: `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`,
      isoDate: this.localDateKey(now),
      title: source,
      skill: this.t(subjectKeys[this.settings.subject] || 'setSubjectMath'),
      status: 'progress',
      score: 50
    });
    localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions.slice(0, 100)));
  }
  updateAuditProgress(step) {
    const sessions = this.readJSON('paradox-audit-sessions', []);
    if (!sessions.length) return;
    sessions[0].score = Math.min(95, 50 + step * 8);
    sessions[0].status = step >= 5 ? 'mastered' : 'progress';
    localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions));
  }
  sessionRow(s, compact = false) {
    const statusKey = 'status' + s.status.charAt(0).toUpperCase() + s.status.slice(1);
    return `<div class="session-row ${compact ? 'compact' : ''}" data-session-status="${s.status}" data-session-subject="${this.escape(s.skill)}" data-session-date="${this.escape(this.sessionISODate(s))}" data-search="${this.escape((s.title + ' ' + s.skill).toLowerCase())}">
      <div class="session-main"><span class="session-title">${this.escape(s.title)}</span><span class="session-date">${s.date} · ${this.escape(s.skill)}</span></div>
      ${compact ? '' : `<span class="session-skill">${this.escape(s.skill)}</span>`}
      <span class="session-score">${s.score}<small>/100</small></span>
      <span class="status ${s.status}">${this.t(statusKey)}</span>
      <button class="row-action" data-route="audit">${this.t('histOpen')} ↗</button>
    </div>`;
  }
  formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  fileSelectionMarkup(type) {
    const file = this.files[type][0];
    if (!file) return '';
    const extension = file.name.split('.').pop()?.toUpperCase() || 'FILE';
    return `<div class="file-selected"><div class="file-chip"><span class="file-chip-type">${this.escape(extension)}</span><span class="file-chip-copy"><strong>${this.escape(file.name)}</strong><small>${this.formatBytes(file.size)}</small></span><button type="button" data-remove-file="${type}" aria-label="${this.t('fileRemove')}">×</button></div><div class="file-preview" data-file-preview="${type}" aria-label="${this.t('filePreview')}"></div></div>`;
  }
  fileControl(type, title, meta) {
    return `<div class="file-field"><label class="file-drop" for="file-${type}"><span class="file-symbol">${type === 'problem' ? '▧' : '▤'}</span><span><span class="file-title">${title}</span><span class="file-meta">${meta} · MAX 10 MB</span></span><span class="file-plus">＋</span><input class="file-input" type="file" id="file-${type}" data-file="${type}" accept="image/*,.pdf,.doc,.docx,.txt,.js,.py" /></label>${this.fileSelectionMarkup(type)}</div>`;
  }
  hydrateFilePreviews() {
    ['problem', 'work'].forEach(async type => {
      const file = this.files[type][0];
      const target = this.querySelector(`[data-file-preview="${type}"]`);
      if (!file || !target) return;
      if (file.type.startsWith('image/')) {
        if (this.filePreviewUrls[type]) URL.revokeObjectURL(this.filePreviewUrls[type]);
        const url = URL.createObjectURL(file);
        this.filePreviewUrls[type] = url;
        target.innerHTML = `<img src="${url}" alt="${this.escape(file.name)}">`;
        return;
      }
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (['txt', 'js', 'py'].includes(extension)) {
        const content = await file.slice(0, 1400).text();
        if (target.isConnected) target.innerHTML = `<pre>${this.escape(content)}</pre>`;
        return;
      }
      target.innerHTML = `<span class="file-preview-generic">${this.escape((extension || 'FILE').toUpperCase())}</span>`;
    });
  }
  auditMessagesMarkup() {
    const greeting = `<audit-message class="message"><span class="message-icon">✳</span><div class="bubble">${this.t('greeting')}<div style="margin-top:7px">${this.t('greetingPrompt')}</div><div class="message-time">${this.t('timeNow')}</div></div></audit-message>`;
    const saved = this.auditMessages.map(item => {
      const initials = (this.user?.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
      return `<audit-message class="message ${item.user ? 'user' : ''}"><span class="message-icon">${item.user ? this.escape(initials) : '✳'}</span><div class="bubble">${item.html}<div class="message-time">${this.t('timeNow')}</div></div></audit-message>`;
    }).join('');
    return greeting + saved + (this.isAnalyzing ? this.typingMarkup() : '');
  }
  typingMarkup() {
    return `<div class="typing-indicator" id="typing-indicator" role="status"><span class="agent-orb">✳</span><span class="typing-dots"><i></i><i></i><i></i></span><span>${this.t('analyzing')}</span></div>`;
  }
  viewDashboard() {
    const t = k => this.t(k);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('welcome').replace('Minh Anh', name).replace('ミン・アイン', name);
    const metrics = this.learningMetrics();
    const recent = metrics.sessions.slice(0, 3).map(s => this.sessionRow(s, true)).join('');
    return `<div class="page">
      ${this.viewHead(greeting, 'subtitle')}
      <div class="quick-actions">
        <button class="primary-button" data-route="audit">${t('dashNew')} <span class="button-arrow">↗</span></button>
        <button class="ghost-button" data-route="practice">${svgIcon('spark')} ${t('navPractice')}</button>
      </div>
      <div class="content-grid">
        <div class="left-stack">
          <section class="card continue-card">
            <div class="continue-top"><span class="eyebrow">${t('dashContinue')}</span><span class="continue-step">04 / 07</span></div>
            <h2>${t('dashContinueTitle')}</h2>
            <p>${t('dashContinueDesc')}</p>
            <div class="continue-progress"><span></span></div>
            <div class="continue-foot"><span class="difficulty">${t('difficulty')}</span><button class="primary-button" data-route="audit">${t('dashResume')} ↗</button></div>
          </section>
          <section class="card recent-card">
            <div class="panel-head"><div><h3 class="panel-title">${t('dashRecent')}</h3><p class="panel-sub">${t('dashRecentSub')}</p></div><button class="panel-link" data-route="history">${t('viewAll')}</button></div>
            <div class="recent-list">${recent}</div>
          </section>
        </div>
        <div class="right-stack">
          <div class="right-duo"><section class="card metric-card"><div class="metric-header"><span class="metric-title">${t('accuracy')}</span><span class="metric-icon">${svgIcon('spark')}</span></div><div class="metric-value">${metrics.accuracy}<span style="font-size:15px">%</span></div><div class="metric-sub">${t('accuracyDesc')}</div></section><section class="card metric-card"><div class="metric-header"><span class="metric-title">${t('streak')}</span><span class="metric-icon">${svgIcon('check')}</span></div><div class="metric-value">${String(metrics.streak).padStart(2, '0')} <span style="font-size:12px;color:#8c9b80">${this.lang === 'en' ? 'DAYS' : this.lang === 'jp' ? '日' : 'NGÀY'}</span></div><div class="metric-sub">${t('streakDesc')}</div></section></div>
          <section class="card activity-card"><div class="activity-head"><h3 class="activity-title">${t('progress')}</h3><span class="activity-week">${t('thisWeek')}</span></div>${this.weeklyChartMarkup()}</section>
          <section class="card source-card"><div class="source-head"><h3 class="source-title">${t('sources')}</h3><button class="source-link" data-route="about">${t('viewAll')}</button></div>${[['◉', 'source1', 'source1type'], ['ƒ', 'source2', 'source2type'], ['⌘', 'source3', 'source3type']].map(([i, n, d]) => `<div class="source-item"><span class="source-icon">${i}</span><div><div class="source-name">${t(n)}</div><div class="source-type">${t(d)}</div></div></div>`).join('')}</section>
        </div>
      </div>
    </div>`;
  }
  viewAudit() {
    const t = k => this.t(k);
    const name = this.escape(this.user.name || this.user.email);
    const greeting = t('welcome').replace('Minh Anh', name).replace('ミン・アイン', name);
    const metrics = this.learningMetrics();
    const steps = t('stepLabels').map((s, i) => `<div class="step ${i < this.step ? 'done' : ''} ${i === this.step ? 'active' : ''}"><span class="step-num">${i < this.step ? '✓' : i + 1}</span><span class="step-name">${s}</span></div>`).join('');
    return `<div class="page">
      ${this.viewHead(greeting, 'subtitle')}
      <div class="content-grid"><div class="left-stack">
        <section class="card audit-card"><div class="card-heading"><div><h2 class="card-title">${t('sessionTitle')}</h2><p class="card-caption">${t('sessionCaption')}</p></div><span class="session-id">SESSION #${new Date().getFullYear()}-014</span></div>
          <audit-stepper class="stepper">${steps}</audit-stepper>
          <div class="upload-zone" id="drop-zone"><span class="upload-label">${t('problem')} + ${t('yourWork')}</span><div class="upload-fields">
            ${this.fileControl('problem', t('addProblem'), t('fileTypes'))}${this.fileControl('work', t('addWork'), t('fileTypes'))}
          </div></div>
          <div class="text-entry"><div class="text-entry-head"><label class="upload-label" for="work-text" style="margin:0">${t('pasteLabel')}</label><span class="file-meta">TEXT / CODE</span></div><textarea id="work-text" placeholder="${t('placeholder')}">${this.escape(this.auditText)}</textarea><div class="text-actions"><span class="hint">♧ &nbsp;${t('privacy')}</span><button class="primary-button" id="start-audit" ${this.isAnalyzing ? 'disabled' : ''}>${t('start')} <span class="button-arrow">↗</span></button></div></div>
          <div class="divider"></div><div class="chat-area"><div class="chat-top"><span class="agent-label"><span class="agent-orb">✳</span>${t('agent')}</span><span class="secure-tag">${t('secure')}</span></div><div id="messages">${this.auditMessagesMarkup()}</div>
            <div class="quick-replies"><button class="reply-chip" data-reply="upload">＋ ${t('reply1')}</button><button class="reply-chip" data-reply="how">✳ ${t('reply2')}</button></div>
            <form class="chat-input" id="chat-form"><input id="chat-message" placeholder="${t('chatPlaceholder')}" autocomplete="off" ${this.isAnalyzing ? 'disabled' : ''}/><button class="send-button" aria-label="${t('send')}" ${this.isAnalyzing ? 'disabled' : ''}>↑</button></form>
          </div>
        </section>
      </div><div class="right-stack">
        <div class="right-duo"><section class="card metric-card"><div class="metric-header"><span class="metric-title">${t('accuracy')}</span><span class="metric-icon">${svgIcon('spark')}</span></div><div class="metric-value">${metrics.accuracy}<span style="font-size:15px">%</span></div><div class="metric-sub">${t('accuracyDesc')}</div></section><section class="card metric-card"><div class="metric-header"><span class="metric-title">${t('streak')}</span><span class="metric-icon">${svgIcon('check')}</span></div><div class="metric-value">${String(metrics.streak).padStart(2, '0')} <span style="font-size:12px;color:#8c9b80">${this.lang === 'en' ? 'DAYS' : this.lang === 'jp' ? '日' : 'NGÀY'}</span></div><div class="metric-sub">${t('streakDesc')}</div></section></div>
        <section class="card practice-card"><div class="eyebrow"><span class="live-dot"></span>${t('daily')}</div><h3>${t('practiceTitle')}</h3><p>${t('practiceDesc')}</p><div class="practice-bottom"><button class="practice-button" id="practice-button">${t('challenge')} ↗</button><span class="difficulty">${t('difficulty')}</span></div></section>
        <section class="card source-card"><div class="source-head"><h3 class="source-title">${t('sources')}</h3><button class="source-link" data-route="about">${t('viewAll')}</button></div>${[['◉', 'source1', 'source1type'], ['ƒ', 'source2', 'source2type'], ['⌘', 'source3', 'source3type']].map(([i, n, d]) => `<div class="source-item"><span class="source-icon">${i}</span><div><div class="source-name">${t(n)}</div><div class="source-type">${t(d)}</div></div></div>`).join('')}</section>
        <section class="card activity-card"><div class="activity-head"><h3 class="activity-title">${t('progress')}</h3><span class="activity-week">${t('thisWeek')}</span></div>${this.weeklyChartMarkup()}</section>
      </div></div>
    </div>`;
  }
  viewHistory() {
    const t = k => this.t(k);
    const sessions = this.getSessions();
    const avg = sessions.length ? Math.round(sessions.reduce((sum, s) => sum + s.score, 0) / sessions.length) : 0;
    const mastered = sessions.filter(s => s.status === 'mastered').length;
    const filters = [['all', 'histAll'], ['needs', 'histNeeds'], ['mastered', 'histMastered'], ['progress', 'histProgress']]
      .map(([value, key], i) => `<button class="chip ${i === 0 ? 'active' : ''}" data-history-filter="${value}" aria-pressed="${i === 0}">${t(key)}</button>`).join('');
    const subjects = [...new Set(sessions.map(item => item.skill))].map(subject => `<option value="${this.escape(subject)}">${this.escape(subject)}</option>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageHistory'), 'histSub')}
      <div class="stat-grid three">
        ${this.statCard(t('histTotal'), sessions.length, '')}
        ${this.statCard(t('histAvg'), avg, '/100')}
        ${this.statCard(t('histMasteredCount'), mastered, `/${sessions.length}`)}
      </div>
      <section class="card history-card">
        <div class="filter-row"><div class="chip-row">${filters}</div><label class="search-field">${svgIcon('search')}<input id="history-search" placeholder="${t('histSearch')}" aria-label="${t('histSearch')}" autocomplete="off"></label></div>
        <div class="history-tools"><select id="history-subject" aria-label="${t('histSubjectFilter')}"><option value="all">${t('histSubjectFilter')}</option>${subjects}</select><select id="history-date" aria-label="${t('histDateFilter')}"><option value="all">${t('histDateFilter')}</option><option value="7">${t('histLast7')}</option><option value="30">${t('histLast30')}</option><option value="90">${t('histLast90')}</option></select><div class="history-data-actions"><button class="ghost-button" id="export-history">${svgIcon('download')} ${t('histExport')}</button><label class="ghost-button import-button" for="import-history">${t('histImport')}<input id="import-history" type="file" accept="application/json,.json"></label></div></div>
        <div class="session-table">
          <div class="session-head"><span>${t('histSession')}</span><span>${t('histSkill')}</span><span>${t('histScore')}</span><span>${t('histStatus')}</span><span></span></div>
          ${sessions.map(s => this.sessionRow(s)).join('')}
        </div>
        <p class="empty-note" id="history-empty" hidden>${t('histEmpty')}</p>
        <div class="history-pagination"><button class="ghost-button" data-history-page="prev" aria-label="${t('back')}">←</button><span id="history-page-label">${t('histPage')} 1 / 1</span><button class="ghost-button" data-history-page="next" aria-label="${t('dashOpen')}">→</button></div>
      </section>
    </div>`;
  }
  bind() {
    this.querySelector('#logout-button')?.addEventListener('click', () => this.logout());
    this.applyStoredTheme();
    if (window.matchMedia('(max-width: 540px)').matches) {
      requestAnimationFrame(() => this.querySelector('.nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'center' }));
    }
    this.querySelector('#lang-toggle')?.addEventListener('click', () => {
      const langs = ['vi', 'en', 'jp'];
      this.lang = langs[(langs.indexOf(this.lang) + 1) % langs.length];
      localStorage.setItem('paradox-lang', this.lang);
      this.render();
    });
    this.querySelectorAll('[data-file]').forEach(input => input.addEventListener('change', e => this.setFile(e.target.dataset.file, e.target.files)));
    this.hydrateFilePreviews();
    if (this.view === 'history') requestAnimationFrame(() => this.filterHistory());
    const zone = this.querySelector('#drop-zone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const files = [...e.dataTransfer.files]; if (files.length) this.setFile('problem', [files[0]]); if (files.length > 1) this.setFile('work', [files[1]]); });
    }
    this.querySelector('#start-audit')?.addEventListener('click', () => this.startAudit());
    this.querySelector('#chat-form')?.addEventListener('submit', e => { e.preventDefault(); this.sendMessage(); });
    this.querySelectorAll('[data-reply]').forEach(btn => btn.addEventListener('click', () => { if (btn.dataset.reply === 'upload') this.querySelector('#file-work')?.click(); else this.showToast(this.t('feedback')); }));
    this.querySelector('#practice-button')?.addEventListener('click', () => this.navigate('practice'));
  }
  onClick = (event) => {
    if (event.target.closest?.('[data-theme-toggle]')) { this.toggleTheme(); return; }
    const more = event.target.closest?.('[data-mobile-more]');
    if (more) { const menu = this.querySelector('#mobile-more-menu'); const open = menu?.hidden; if (menu) menu.hidden = !open; more.setAttribute('aria-expanded', String(open)); return; }
    const route = event.target.closest?.('[data-route]');
    if (route) { event.preventDefault(); this.navigate(route.dataset.route); return; }
    const removeFile = event.target.closest?.('[data-remove-file]');
    if (removeFile) { this.removeFile(removeFile.dataset.removeFile); return; }
    const filter = event.target.closest?.('[data-history-filter]');
    if (filter) { this.historyPage = 1; this.querySelectorAll('[data-history-filter]').forEach(b => { b.classList.toggle('active', b === filter); b.setAttribute('aria-pressed', String(b === filter)); }); this.filterHistory(); return; }
    const historyPage = event.target.closest?.('[data-history-page]');
    if (historyPage) { this.historyPage += historyPage.dataset.historyPage === 'next' ? 1 : -1; this.filterHistory(); return; }
    const period = event.target.closest?.('[data-chart-period]');
    if (period) { this.chartPeriod = Number(period.dataset.chartPeriod); this.render(); return; }
    const challenge = event.target.closest?.('[data-challenge]');
    if (challenge) { this.openPractice(Number(challenge.dataset.challenge)); return; }
    const option = event.target.closest?.('[data-option]');
    if (option) { this.answerPractice(Number(option.dataset.option)); return; }
    if (event.target.closest?.('[data-retry-practice]')) { this.retryPractice(); return; }
    if (event.target.closest?.('[data-close-practice]') || event.target.id === 'practice-modal') { this.closePractice(); return; }
    const langBtn = event.target.closest?.('[data-set-lang]');
    if (langBtn) { this.lang = langBtn.dataset.setLang; localStorage.setItem('paradox-lang', this.lang); this.render(); return; }
    const themeBtn = event.target.closest?.('[data-set-theme]');
    if (themeBtn) { this.applyTheme(themeBtn.dataset.setTheme === 'dark'); return; }
    if (event.target.closest?.('[data-upgrade]')) { this.showToast(this.t('profUpgradeToast')); return; }
    if (event.target.closest?.('#export-data')) { this.exportData(); return; }
    if (event.target.closest?.('#export-history')) { this.exportHistory(); return; }
    if (event.target.closest?.('#reset-data')) { this.openResetModal(); return; }
    if (event.target.closest?.('[data-confirm-reset]')) { this.resetPractice(); return; }
    if (event.target.closest?.('[data-cancel-reset]') || event.target.id === 'reset-modal') { this.closeResetModal(); return; }
    if (event.target.closest?.('#delete-account')) { this.logout(); }
  };
  onChange = (event) => {
    const setting = event.target.closest?.('[data-setting]');
    if (setting) { this.settings[setting.dataset.setting] = setting.checked; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'default-subject') { this.settings.subject = event.target.value; this.saveSettings(); this.showToast(this.t('setSaved')); return; }
    if (event.target.id === 'hint-level') { this.settings.hint = Number(event.target.value); this.saveSettings(); this.showToast(this.t('setSaved')); }
    if (event.target.id === 'history-subject' || event.target.id === 'history-date') { this.historyPage = 1; this.filterHistory(); return; }
    if (event.target.id === 'import-history') this.importHistory(event.target.files?.[0]);
  };
  onInput = (event) => {
    if (event.target.id === 'history-search') { this.historyPage = 1; this.filterHistory(); }
    if (event.target.id === 'work-text') { this.auditText = event.target.value; this.saveAuditState(); }
    if (event.target.id === 'hint-level') {
      const label = this.querySelector('#hint-value');
      const value = Number(event.target.value);
      if (label) label.textContent = [this.t('setHintLow'), this.t('setHintMed'), this.t('setHintHigh')][value - 1];
    }
  };
  onSubmit = (event) => {
    if (event.target.id !== 'profile-form') return;
    event.preventDefault();
    const name = String(new FormData(event.target).get('name') || '').trim();
    if (!name) return;
    this.user.name = name;
    localStorage.setItem('paradox-session', JSON.stringify(this.user));
    this.render();
    this.showToast(this.t('profSaved'));
  };
  onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const modal = this.querySelector('#practice-modal');
    if (modal && !modal.hidden) { this.closePractice(); return; }
    const reset = this.querySelector('#reset-modal');
    if (reset && !reset.hidden) { this.closeResetModal(); return; }
    const more = this.querySelector('#mobile-more-menu');
    if (more && !more.hidden) { more.hidden = true; this.querySelector('[data-mobile-more]')?.setAttribute('aria-expanded', 'false'); return; }
    const auth = this.querySelector('#auth-backdrop');
    if (auth && !auth.hidden) { auth.hidden = true; return; }
    if (location.hash === '#/sitemap') this.navigate('');
  };
  filterHistory() {
    const active = this.querySelector('[data-history-filter].active')?.dataset.historyFilter || 'all';
    const query = (this.querySelector('#history-search')?.value || '').trim().toLowerCase();
    const subject = this.querySelector('#history-subject')?.value || 'all';
    const dateRange = this.querySelector('#history-date')?.value || 'all';
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const rows = [...this.querySelectorAll('[data-session-status]')];
    const matches = rows.filter(row => {
      const statusOk = active === 'all' || row.dataset.sessionStatus === active;
      const queryOk = !query || (row.dataset.search || row.textContent.toLowerCase()).includes(query);
      const subjectOk = subject === 'all' || row.dataset.sessionSubject === subject;
      const sessionDate = new Date(`${row.dataset.sessionDate}T00:00:00`);
      const daysAgo = Math.floor((now - sessionDate) / 86400000);
      const dateOk = dateRange === 'all' || (!Number.isNaN(daysAgo) && daysAgo >= 0 && daysAgo < Number(dateRange));
      return statusOk && queryOk && subjectOk && dateOk;
    });
    const pages = Math.max(1, Math.ceil(matches.length / this.historyPageSize));
    this.historyPage = Math.max(1, Math.min(pages, this.historyPage));
    const start = (this.historyPage - 1) * this.historyPageSize;
    rows.forEach(row => { row.hidden = true; });
    matches.slice(start, start + this.historyPageSize).forEach(row => { row.hidden = false; });
    const empty = this.querySelector('#history-empty');
    if (empty) empty.hidden = matches.length > 0;
    const label = this.querySelector('#history-page-label');
    if (label) label.textContent = `${this.t('histPage')} ${this.historyPage} / ${pages}`;
    const previous = this.querySelector('[data-history-page="prev"]');
    const next = this.querySelector('[data-history-page="next"]');
    if (previous) previous.disabled = this.historyPage === 1;
    if (next) next.disabled = this.historyPage === pages;
  }
  exportHistory() {
    const payload = { sessions: this.getSessions(), exportedAt: new Date().toISOString(), version: 1 };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paradox-learning-history.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  async importHistory(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = Array.isArray(parsed) ? parsed : parsed.sessions;
      if (!Array.isArray(source)) throw new Error('Invalid sessions');
      const sessions = source.map((item, index) => {
        if (!item || typeof item.title !== 'string' || !Number.isFinite(Number(item.score))) throw new Error('Invalid session');
        return {
          id: item.id || `import-${Date.now()}-${index}`,
          date: String(item.date || ''),
          isoDate: /^\d{4}-\d{2}-\d{2}$/.test(String(item.isoDate || '')) ? item.isoDate : '',
          title: item.title.slice(0, 160),
          skill: String(item.skill || this.t('setSubjectMath')).slice(0, 80),
          status: ['needs', 'mastered', 'progress'].includes(item.status) ? item.status : 'progress',
          score: Math.max(0, Math.min(100, Math.round(Number(item.score))))
        };
      });
      localStorage.setItem('paradox-audit-sessions', JSON.stringify(sessions.slice(0, 100)));
      this.historyPage = 1;
      this.render();
      this.showToast(this.t('histImportDone'));
    } catch {
      this.showToast(this.t('histImportError'));
    }
  }
  exportData() {
    const payload = { user: this.user, settings: this.settings, practice: this.practiceSolved, sessions: this.getSessions(), exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'paradox-demo-data.json';
    link.click();
    URL.revokeObjectURL(url);
    this.showToast(this.t('setExportDone'));
  }
  resetPractice() {
    localStorage.removeItem('paradox-practice');
    localStorage.removeItem('paradox-practice-activity');
    this.practiceSolved = [];
    this.practiceActivity = [];
    this.render();
    this.showToast(this.t('setResetDone'));
  }
  openResetModal() {
    const modal = this.querySelector('#reset-modal');
    if (!modal) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('[data-cancel-reset]')?.focus();
  }
  closeResetModal() {
    const modal = this.querySelector('#reset-modal');
    if (modal) modal.hidden = true;
    document.body.style.overflow = '';
    this.querySelector('#reset-data')?.focus();
  }
  viewSettings() {
    const t = k => this.t(k);
    const dark = document.body.classList.contains('dark');
    const langs = [['vi', 'VI'], ['en', 'EN'], ['jp', 'JP']].map(([code, label]) => `<button class="${this.lang === code ? 'active' : ''}" data-set-lang="${code}" aria-pressed="${this.lang === code}">${label}</button>`).join('');
    const subjects = [['math', 'setSubjectMath'], ['algebra', 'setSubjectAlgebra'], ['code', 'setSubjectCode']].map(([value, key]) => `<option value="${value}" ${this.settings.subject === value ? 'selected' : ''}>${t(key)}</option>`).join('');
    const hint = this.settings.hint || 2;
    const toggle = (key, title, desc) => `<div class="setting-row"><div><h4>${t(title)}</h4><p>${t(desc)}</p></div><label class="switch"><input type="checkbox" data-setting="${key}" aria-label="${t(title)}" ${this.settings[key] ? 'checked' : ''}><span></span></label></div>`;
    return `<div class="page">
      ${this.viewHead(t('pageSettings'), 'setSub')}
      <div class="settings-grid">
        <section class="card setting-group"><div class="panel-head"><h3 class="panel-title">${t('setAppearance')}</h3></div>
          <div class="setting-row"><div><h4>${t('setTheme')}</h4></div><div class="segmented"><button class="${dark ? '' : 'active'}" data-set-theme="light" aria-pressed="${!dark}">${t('setLight')}</button><button class="${dark ? 'active' : ''}" data-set-theme="dark" aria-pressed="${dark}">${t('setDark')}</button></div></div>
          <div class="setting-row"><div><h4>${t('setLanguage')}</h4></div><div class="segmented">${langs}</div></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h3 class="panel-title">${t('setLearning')}</h3></div>
          <div class="setting-row"><div><h4>${t('setSubject')}</h4></div><select id="default-subject" aria-label="${t('setSubject')}">${subjects}</select></div>
          <div class="setting-row"><div><h4>${t('setHint')}</h4></div><div class="hint-control"><input id="hint-level" type="range" min="1" max="3" value="${hint}" aria-label="${t('setHint')}"><span id="hint-value">${[t('setHintLow'), t('setHintMed'), t('setHintHigh')][hint - 1]}</span></div></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h3 class="panel-title">${t('setNotify')}</h3></div>
          ${toggle('reminder', 'setReminder', 'setReminderDesc')}
          ${toggle('digest', 'setDigest', 'setDigestDesc')}
          ${toggle('sound', 'setSound', 'setSoundDesc')}
        </section>
        <section class="card setting-group"><div class="panel-head"><h3 class="panel-title">${t('setPrivacy')}</h3></div>
          <div class="setting-row"><div><h4>${t('setExport')}</h4><p>${t('setExportDesc')}</p></div><button class="ghost-button" id="export-data">${svgIcon('download')} ${t('setExport')}</button></div>
          <div class="setting-row"><div><h4>${t('setReset')}</h4><p>${t('setResetDesc')}</p></div><button class="ghost-button" id="reset-data">${svgIcon('trash')} ${t('setReset')}</button></div>
          <div class="setting-row"><div><h4>${t('setDelete')}</h4><p>${t('setDeleteDesc')}</p></div><button class="ghost-button" id="delete-account">${t('setDelete')}</button></div>
        </section>
        <section class="card setting-group"><div class="panel-head"><h3 class="panel-title">${t('setAbout')}</h3></div>
          <div class="setting-row"><div><h4>${t('setVersion')}</h4></div></div>
          <div class="setting-row"><div><h4>${t('setOpenSitemap')}</h4><p>${t('setSitemapDesc')}</p></div><button class="ghost-button" data-route="sitemap">${svgIcon('grid')}</button></div>
        </section>
      </div>
      <div class="confirm-backdrop" id="reset-modal" hidden><section class="confirm-panel" role="dialog" aria-modal="true" aria-labelledby="reset-title"><span class="badge-icon">${svgIcon('trash')}</span><h2 id="reset-title">${t('setResetTitle')}</h2><p>${t('setConfirmReset')}</p><div class="confirm-actions"><button class="ghost-button" data-cancel-reset>${t('profCancel')}</button><button class="danger-button" data-confirm-reset>${t('setResetConfirm')}</button></div></section></div>
    </div>`;
  }
  renderSitemap() {
    document.body.classList.add('sitemap-mode');
    document.documentElement.lang = this.lang === 'jp' ? 'ja' : this.lang;
    document.body.style.overflow = '';
    window.scrollTo(0, 0);
    const t = k => this.t(k);
    const cards = [
      ['audit', 'smAudit', 'smAuditDesc', 'shield'],
      ['dashboard', 'smDashboard', 'smDashboardDesc', 'grid'],
      ['history', 'smHistory', 'smHistoryDesc', 'clock'],
      ['analytics', 'smAnalytics', 'smAnalyticsDesc', 'chart'],
      ['practice', 'smPractice', 'smPracticeDesc', 'book'],
      ['profile', 'smProfile', 'smProfileDesc', 'user'],
      ['about', 'smAbout', 'smAboutDesc', 'help'],
      ['settings', 'smSettings', 'smSettingsDesc', 'settings']
    ].map(([route, title, desc, ic]) => `<a class="sitemap-card" href="#/${route}"><span class="sitemap-card-title">${svgIcon(ic)}<b>${t(title)}</b></span><span class="sitemap-card-desc">${t(desc)}</span></a>`).join('');
    this.innerHTML = `<main class="sitemap-page">
      <header class="sitemap-header">
        <a class="sitemap-brand" href="#/" aria-label="PARADOX AI"><img src="logo-mark.svg" alt=""><b>PARADOX AI</b></a>
        <span class="sitemap-badge">${t('smBadge')}</span>
      </header>
      <section class="sitemap-hero"><h1>${t('smTitle')}</h1><p>${t('smSub')}</p></section>
      <nav class="sitemap-grid" aria-label="${t('smBadge')}">${cards}</nav>
      <p class="sitemap-hint">${t('smHint')}</p>
      <footer class="sitemap-footer"><a href="#/">← ${t('smHome')}</a><span>PARADOX AI © 2026</span><span>NEXUS ACADEMY ANALYTICS</span></footer>
    </main>`;
  }
  viewProfile() {
    const t = k => this.t(k);
    const initials = (this.user.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const goals = [['profGoal1', 70], ['profGoal2', 55], ['profGoal3', 40]].map(([key, value]) => `<div class="goal-row"><div class="skill-top"><span>${t(key)}</span><span>${value}%</span></div><div class="skill-track"><span style="width:${value}%"></span></div></div>`).join('');
    const badges = [1, 2, 3, 4].map(i => `<div class="badge-tile ${i === 4 ? 'locked' : ''}"><span class="badge-icon">${svgIcon(i === 4 ? 'clock' : 'spark')}</span><strong>${t('badge' + i)}</strong><small>${t('badge' + i + 'Desc')}</small></div>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageProfile'), 'profSub')}
      <section class="card profile-hero">
        <div class="avatar profile-avatar-lg">${this.escape(initials)}</div>
        <div class="profile-hero-copy"><h2>${this.escape(this.user.name || this.user.email)}</h2><p>${this.escape(this.user.email)}</p><span class="profile-since">${t('profSince')}</span></div>
        <div class="profile-plan"><span class="plan-tag">FREE</span><strong>${t('profPlanName')}</strong><button class="ghost-button" data-upgrade>${t('profUpgrade')} ↗</button></div>
      </section>
      <div class="stat-grid three">
        ${this.statCard(t('profSessions'), demo[this.lang].sessions.length, '')}
        ${this.statCard(t('accuracy'), '72%', '', '↗ 8%')}
        ${this.statCard(t('streak'), 6, this.lang === 'en' ? 'days' : this.lang === 'jp' ? '日' : 'ngày')}
      </div>
      <div class="profile-grid">
        <section class="card form-card"><div class="panel-head"><h3 class="panel-title">${t('profInfo')}</h3></div><form id="profile-form" class="profile-form"><label>${t('profName')}<input name="name" value="${this.escape(this.user.name || '')}" required></label><label>${t('profEmail')}<input value="${this.escape(this.user.email)}" disabled></label><button class="primary-button" type="submit">${t('profSave')} ↗</button></form></section>
        <section class="card"><div class="panel-head"><h3 class="panel-title">${t('profGoals')}</h3></div><div class="goal-list">${goals}</div></section>
        <section class="card profile-badges"><div class="panel-head"><h3 class="panel-title">${t('profBadges')}</h3></div><div class="badge-grid">${badges}</div></section>
      </div>
    </div>`;
  }
  viewAbout() {
    const t = k => this.t(k);
    const steps = t('stepLabels').map((label, i) => `<div class="guide-step"><span class="guide-num">${String(i + 1).padStart(2, '0')}</span><div><h3>${label}</h3><p>${t('guide' + (i + 1))}</p></div></div>`).join('');
    const principles = [1, 2, 3].map(i => `<article class="principle"><span>${svgIcon(i === 1 ? 'shield' : i === 2 ? 'spark' : 'book')}</span><h3>${t('aboutP' + i)}</h3><p>${t('aboutP' + i + 'Desc')}</p></article>`).join('');
    const faqs = [1, 2, 3].map(i => `<details><summary>${t('faq' + i + 'Q')}</summary><p>${t('faq' + i + 'A')}</p></details>`).join('');
    return `<div class="page">
      ${this.viewHead(t('aboutHeading'), 'aboutSub')}
      <div class="about-grid">
        <section class="card method-card"><div class="panel-head"><div><h3 class="panel-title">${t('aboutMethod')}</h3><p class="panel-sub">${t('aboutMethodSub')}</p></div></div><div class="guide-list">${steps}</div></section>
        <div class="about-side">
          <section class="card cta-card"><span class="eyebrow">${t('workspace')}</span><h3>${t('aboutHeading')}</h3><p>${t('aboutSub')}</p><button class="primary-button" data-route="audit">${t('aboutCta')} ↗</button><button class="ghost-button" data-route="sitemap">${t('setOpenSitemap')}</button></section>
          <section class="card"><div class="panel-head"><h3 class="panel-title">${t('aboutPrinciples')}</h3></div><div class="principles">${principles}</div></section>
        </div>
      </div>
      <section class="card faq-card"><div class="panel-head"><h3 class="panel-title">${t('faqTitle')}</h3></div><div class="faq-list">${faqs}</div></section>
    </div>`;
  }
  setFile(type, files) {
    if (!files?.length) return;
    const file = files[0];
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_FILE_EXTENSIONS.includes(extension)) { this.showToast(this.t('fileInvalid')); return; }
    if (file.size > MAX_FILE_SIZE) { this.showToast(this.t('fileTooLarge')); return; }
    this.files[type] = [file];
    this.saveAuditState();
    this.render();
  }
  removeFile(type) {
    if (!['problem', 'work'].includes(type)) return;
    if (this.filePreviewUrls[type]) URL.revokeObjectURL(this.filePreviewUrls[type]);
    delete this.filePreviewUrls[type];
    this.files[type] = [];
    this.saveAuditState();
    this.render();
  }
  viewAnalytics() {
    const t = k => this.t(k);
    const period = this.chartPeriod || 30;
    const metrics = this.learningMetrics();
    const series = this.activitySeries(period);
    const labels = period === 7 ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] : series.values.map((_, i) => String(i + 1));
    const maxValue = Math.max(...series.values);
    const bars = series.heights.map((height, i) => `<div class="bar-wrap"><span class="bar ${series.values[i] === maxValue && maxValue ? 'hot' : ''}" style="height:${height}%" title="${series.values[i]} min"></span></div>`).join('');
    const skillValues = [metrics.accuracy, metrics.average, Math.min(100, 45 + this.practiceSolved.length * 8), Math.min(100, 40 + metrics.mastered * 10)];
    const skillRows = skillValues.map((value, i) => `<div class="skill-row"><div class="skill-top"><span>${t('skill' + (i + 1))}</span><span>${value}%</span></div><div class="skill-track"><span style="width:${value}%"></span></div></div>`).join('');
    return `<div class="page">
      ${this.viewHead(t('pageAnalytics'), 'anaSub')}
      <div class="period-row">${[[7, 'ana7'], [30, 'ana30'], [90, 'ana90']].map(([p, k]) => `<button class="chip ${period === p ? 'active' : ''}" data-chart-period="${p}" aria-pressed="${period === p}">${t(k)}</button>`).join('')}</div>
      <div class="stat-grid">
        ${this.statCard(t('accuracy'), `${metrics.accuracy}%`)}
        ${this.statCard(t('anaScore'), metrics.average, '/100')}
        ${this.statCard(t('anaSessions'), metrics.sessions.length, '')}
        ${this.statCard(t('streak'), metrics.streak, this.lang === 'en' ? 'days' : this.lang === 'jp' ? '日' : 'ngày')}
      </div>
      <div class="analytics-grid">
        <section class="card chart-card"><div class="panel-head"><div><h3 class="panel-title">${t('anaWeekly')}</h3><p class="panel-sub">${t('anaWeeklySub')}</p></div><span class="plan-tag">${t('thisWeek')}</span></div><div class="big-chart">${bars}</div><div class="big-chart-labels">${labels.map(l => `<span>${l}</span>`).join('')}</div></section>
        <section class="card skills-card"><div class="panel-head"><div><h3 class="panel-title">${t('anaSkills')}</h3><p class="panel-sub">${t('anaSkillsSub')}</p></div></div><div class="skill-list">${skillRows}</div></section>
      </div>
      <h2 class="section-title">${t('anaInsights')}</h2>
      <div class="insight-grid">
        <article class="card insight-card strong"><span class="eyebrow">${t('anaStrength')}</span><p>${t('anaStrengthDesc').replace('{value}', String(metrics.accuracy))}</p></article>
        <article class="card insight-card focus"><span class="eyebrow">${t('anaFocus')}</span><p>${t('anaFocusDesc')}</p></article>
        <article class="card insight-card tip"><span class="eyebrow">${t('anaTip')}</span><p>${t('anaTipDesc')}</p></article>
      </div>
    </div>`;
  }
  viewPractice() {
    const t = k => this.t(k);
    const list = demo[this.lang].challenges;
    const topics = [...new Set(list.map(item => item.subject))];
    const topicProgress = topics.map(subject => {
      const indexes = list.map((item, index) => item.subject === subject ? index : -1).filter(index => index >= 0);
      const solved = indexes.filter(index => this.practiceSolved.includes(index)).length;
      const percent = Math.round(solved / indexes.length * 100);
      return `<article class="topic-progress-card"><div class="skill-top"><span>${this.escape(subject)}</span><span>${solved}/${indexes.length}</span></div><div class="skill-track"><span style="width:${percent}%"></span></div><small>${solved} ${t('pracSolvedCount')}</small></article>`;
    }).join('');
    const cards = list.map((c, i) => {
      const done = this.practiceSolved.includes(i);
      return `<article class="challenge-card ${done ? 'solved' : ''}">
        <div class="challenge-top"><span class="eyebrow">${this.escape(c.subject)}</span><span class="challenge-badge">${done ? t('pracSolved') : `${c.mins} ${t('pracMinutes')}`}</span></div>
        <h3>${this.escape(c.title)}</h3>
        <p>${this.escape(c.question)}</p>
        <div class="challenge-meta"><span>${t('pracLevel')} · ${this.escape(c.level)}</span><span>${done ? '✓' : `${c.mins} ${t('pracMinutes')}`}</span></div>
        <button class="ghost-button" data-challenge="${i}">${done ? t('pracSolved') : t('pracStart')} ↗</button>
      </article>`;
    }).join('');
    return `<div class="page">
      ${this.viewHead(t('pagePractice'), 'pracSub')}
      <section class="card daily-card">
        <div><span class="eyebrow">${t('pracDaily')}</span><h3>${t('pracDailyTitle')}</h3><p>${t('pracDailyDesc')}</p></div>
        <div class="daily-side"><span class="difficulty">${t('difficulty')}</span><button class="primary-button" data-challenge="0">${t('pracStart')} ↗</button></div>
      </section>
      <section class="topic-progress-section"><h2 class="section-title">${t('pracTopicProgress')}</h2><div class="topic-progress-grid">${topicProgress}</div></section>
      <div class="challenge-grid">${cards}</div>
      <p class="practice-count">${t('pracSolved')}: ${this.practiceSolved.length} / ${list.length}</p>
      <div class="practice-backdrop" id="practice-modal" hidden></div>
    </div>`;
  }
  openPractice(index) {
    const ch = demo[this.lang].challenges[index];
    const modal = this.querySelector('#practice-modal');
    if (!ch || !modal) return;
    this.practiceIndex = index;
    const t = k => this.t(k);
    modal.innerHTML = `<section class="practice-panel" role="dialog" aria-modal="true" aria-labelledby="practice-title">
      <button class="practice-close" data-close-practice aria-label="${t('pracClose')}">×</button>
      <span class="eyebrow">${this.escape(ch.subject)} · ${t('pracLevel')} ${this.escape(ch.level)}</span>
      <h2 id="practice-title">${this.escape(ch.title)}</h2>
      <p class="practice-question">${this.escape(ch.question)}</p>
      <div class="practice-options">${ch.options.map((opt, i) => `<button class="option-btn" data-option="${i}"><span>${String.fromCharCode(65 + i)}</span>${this.escape(opt)}</button>`).join('')}</div>
      <div class="practice-result" id="practice-result" hidden></div>
      <div class="practice-foot"><span class="practice-source">${t('pracSource')}: ${this.escape(ch.source)}</span><button class="ghost-button" data-close-practice>${t('pracClose')}</button></div>
    </section>`;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.practice-close')?.focus();
  }
  answerPractice(index) {
    const modal = this.querySelector('#practice-modal');
    const ch = demo[this.lang].challenges[this.practiceIndex];
    if (!modal || !ch) return;
    const buttons = [...modal.querySelectorAll('[data-option]')];
    if (buttons.some(btn => btn.classList.contains('correct') || btn.classList.contains('wrong'))) return;
    const correct = index === ch.answer;
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === ch.answer) btn.classList.add('correct');
      if (i === index && !correct) btn.classList.add('wrong');
    });
    const result = modal.querySelector('#practice-result');
    result.hidden = false;
    result.className = `practice-result ${correct ? 'ok' : 'no'}`;
    result.innerHTML = `<strong>${correct ? this.t('pracCorrect') : this.t('pracWrong')}</strong><p>${this.escape(ch.explanation)}</p>${correct ? '' : `<button class="ghost-button" type="button" data-retry-practice>${this.t('pracRetry')}</button>`}`;
    if (correct && !this.practiceSolved.includes(this.practiceIndex)) {
      this.practiceSolved.push(this.practiceIndex);
      localStorage.setItem('paradox-practice', JSON.stringify(this.practiceSolved));
      this.practiceActivity.push({ isoDate: this.localDateKey(), minutes: ch.mins, subject: ch.subject, challenge: this.practiceIndex });
      localStorage.setItem('paradox-practice-activity', JSON.stringify(this.practiceActivity.slice(-200)));
      this.querySelectorAll(`[data-challenge="${this.practiceIndex}"]`).forEach(btn => {
        btn.textContent = `${this.t('pracSolved')} ↗`;
        btn.closest('.challenge-card')?.classList.add('solved');
      });
      const count = this.querySelector('.practice-count');
      if (count) count.textContent = `${this.t('pracSolved')}: ${this.practiceSolved.length} / ${demo[this.lang].challenges.length}`;
    }
  }
  retryPractice() {
    const modal = this.querySelector('#practice-modal');
    if (!modal) return;
    modal.querySelectorAll('[data-option]').forEach(button => { button.disabled = false; button.classList.remove('correct', 'wrong'); });
    const result = modal.querySelector('#practice-result');
    if (result) { result.hidden = true; result.className = 'practice-result'; result.innerHTML = ''; }
    modal.querySelector('[data-option]')?.focus();
  }
  closePractice() {
    const modal = this.querySelector('#practice-modal');
    const index = this.practiceIndex;
    if (modal) { modal.hidden = true; modal.innerHTML = ''; }
    document.body.style.overflow = '';
    if (index !== null) this.querySelector(`[data-challenge="${index}"]`)?.focus();
    this.practiceIndex = null;
  }
  startAudit() {
    if (this.isAnalyzing) return;
    const field = this.querySelector('#work-text');
    const text = field ? field.value.trim() : '';
    if (!text && !this.files.work.length) { this.showToast(this.t('feedback')); field?.focus(); return; }
    this.auditText = text;
    this.recordAuditSession(text);
    this.advance(1); this.appendMessage(this.t('submitted'));
    this.runAnalysis(() => { this.advance(2); this.appendMessage(`${this.t('incorrect')}<div style="margin-top:7px"><span class="prompt">${this.t('greetingPrompt')}</span></div>`); this.addReplies(); }, 700);
  }
  sendMessage() {
    if (this.isAnalyzing) return;
    const input = this.querySelector('#chat-message');
    if (!input) return;
    const value = input.value.trim(); if (!value) return;
    this.appendMessage(this.escape(value), true); input.value = '';
    const normalized = value.toLowerCase();
    this.runAnalysis(() => {
      if (/gợi ý|hint|ヒント|không tìm|can't|cant|không biết/.test(normalized)) { this.advance(3); this.appendMessage(this.t('hint')); this.addReplies(); }
      else if (/sửa|fixed|chỉnh|修正|đổi/.test(normalized)) { this.advance(5); this.appendMessage(this.t('correct')); this.addReplies(); }
      else if (/đáp án|cứu|answer|解答|rescue/.test(normalized)) { this.advance(5); this.appendMessage(this.t('rescue')); this.addReplies(); }
      else { if (this.step < 4) this.advance(this.step + 1); this.appendMessage(this.t('incorrect')); this.addReplies(); }
    }, 650);
  }
  setAnalyzing(active) {
    this.isAnalyzing = active;
    this.querySelectorAll('#start-audit, #chat-message, .send-button, .reply-chip').forEach(element => { element.disabled = active; });
    const existing = this.querySelector('#typing-indicator');
    if (active && !existing) this.querySelector('#messages')?.insertAdjacentHTML('beforeend', this.typingMarkup());
    if (!active) existing?.remove();
  }
  runAnalysis(callback, delay = 650) {
    this.setAnalyzing(true);
    window.setTimeout(() => { this.setAnalyzing(false); callback(); }, delay);
  }
  addReplies() {
    const messages = this.querySelector('#messages');
    if (!messages) return;
    messages.querySelectorAll('.quick-replies').forEach(el => el.remove());
    const wrap = document.createElement('div'); wrap.className = 'quick-replies'; wrap.innerHTML = `<button class="reply-chip" data-action="hint">${this.lang === 'en' ? 'I need a hint' : this.lang === 'jp' ? 'ヒントがほしい' : 'Mình cần gợi ý'}</button><button class="reply-chip" data-action="rescue">${this.lang === 'en' ? 'Show the full solution' : this.lang === 'jp' ? '解説を見る' : 'Xem lời giải'}</button><button class="reply-chip" data-action="practice">${this.lang === 'en' ? 'Give me a similar problem' : this.lang === 'jp' ? '似た問題を出して' : 'Cho bài tương tự'}</button>`;
    wrap.querySelectorAll('[data-action]').forEach(btn => btn.addEventListener('click', () => { const action = btn.dataset.action; wrap.remove(); this.runAnalysis(() => { if (action === 'hint') { this.advance(3); this.appendMessage(this.t('hint')); } if (action === 'rescue') { this.advance(5); this.appendMessage(this.t('rescue')); } if (action === 'practice') { this.advance(6); this.appendMessage(this.t('practiceFeedback')); } this.addReplies(); }); }));
    messages.append(wrap);
  }
  appendMessage(html, user = false) {
    const messages = this.querySelector('#messages');
    this.auditMessages.push({ html, user, at: new Date().toISOString() });
    this.auditMessages = this.auditMessages.slice(-60);
    this.saveAuditState();
    if (!messages) return;
    const initials = (this.user?.name || 'U').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
    const item = document.createElement('audit-message'); item.className = `message ${user ? 'user' : ''}`;
    item.innerHTML = `<span class="message-icon">${user ? this.escape(initials) : '✳'}</span><div class="bubble">${html}<div class="message-time">${this.t('timeNow')}</div></div>`;
    messages.append(item); item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  advance(step) {
    this.step = Math.max(0, Math.min(6, step));
    this.updateAuditProgress(this.step);
    this.saveAuditState();
    const root = this.querySelector('audit-stepper');
    if (!root) return;
    root.innerHTML = this.t('stepLabels').map((s, i) => `<div class="step ${i < this.step ? 'done' : ''} ${i === this.step ? 'active' : ''}"><span class="step-num">${i < this.step ? '✓' : i + 1}</span><span class="step-name">${s}</span></div>`).join('');
  }
  showToast(text) {
    const toast = this.querySelector('#toast');
    if (!toast) return;
    toast.textContent = text; toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
}

customElements.define('edu-app', EduApp);
customElements.define('audit-stepper', class extends HTMLElement {});
customElements.define('audit-message', class extends HTMLElement {});
