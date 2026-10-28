# PARADOX AI — EduDefend.OS

> **Sản phẩm dự thi UniHack 2026** · EduTech · AI Agents & Security

PARADOX AI là trợ lý phản biện học tập của Nexus Academy Analytics. Thay vì đưa đáp án ngay, sản phẩm hướng người học tự rà soát lập luận, tìm lỗi, sửa bài và củng cố kiến thức bằng bài luyện tương tự.

## Chạy giao diện

Ứng dụng dùng ES module và endpoint serverless để gửi OTP. Cài dependency rồi chạy server local tích hợp:

1. Cài dependency và trình duyệt kiểm thử:

   ```bash
   npm install
   npx playwright install chromium
   ```

2. Chạy ứng dụng:

   ```bash
   npm run serve
   ```

   Sau đó truy cập `http://127.0.0.1:8173`. Nếu `.env` đã cấu hình Gmail/SMTP, bản demo gửi OTP thật tới email người dùng nhập; nếu chưa, mã OTP local được hiển thị ngay trong hộp thoại để phát triển và demo.

## Tính năng giao diện

- Trang giới thiệu responsive, có điều hướng đến **Trang chủ**, **Cách hoạt động**, **Có gì ở PARADOX?** và **Lợi ích**.
- Ứng dụng gồm **AI Audit**, **Dashboard**, **History**, **Analytics**, **Practice Lab**, **Profile**, **Learning Passport**, **About / Guide**, **Settings** và trang **Admin** có phân quyền.
- Điều hướng bằng hash (`#/audit`, `#/dashboard`, …). Riêng `#/sitemap` là màn hình sitemap tối, mở được khi chưa đăng nhập; các trang còn lại yêu cầu phiên demo.
- AI Debate Engine nhận đề bài và lời giải, gọi AnyRouter thực tế để đánh giá đúng/sai/chưa đủ dữ kiện, phân loại lỗi kiến thức/logic/phương pháp và hỗ trợ hỏi tiếp theo ngữ cảnh.
- Dashboard tổng hợp tiến độ; History có bộ lọc trạng thái và tìm kiếm; Analytics có biểu đồ 7/30/90 ngày.
- Practice Lab có câu hỏi trắc nghiệm, phản hồi đáp án và lưu trạng thái đã giải trong `localStorage`.
- Profile cho phép đổi tên hiển thị; Settings lưu giao diện, ngôn ngữ, môn học, mức gợi ý và tùy chọn thông báo.
- Chuyển ngôn ngữ Việt, Anh, Nhật; nút sáng/tối ở landing và thanh trên cùng của ứng dụng; xuất dữ liệu demo dạng JSON và đặt lại tiến độ luyện tập.
- Đăng ký xác minh email bằng OTP 6 số; đăng nhập kiểm tra mật khẩu đã băm; đăng xuất và bảo vệ route theo phiên.
- Trang Admin quản lý danh sách tài khoản, tìm kiếm, tạm khóa/mở khóa người dùng. Email admin demo mặc định là `admin@paradox.ai` và vẫn phải đăng ký/xác minh OTP trước.
- Biểu tượng logo SVG, có thể phóng to mà không vỡ hình.

## Công nghệ

- HTML5
- Vanilla JavaScript và Web Components
- CSS thuần, chạy trực tiếp trên trình duyệt; không cần Sass hoặc bước biên dịch
- Supabase Auth, cơ sở dữ liệu người dùng và Node.js serverless API trên Vercel
- Solidity, Hardhat 3, Ethers v6 và Avalanche Fuji Testnet cho Proof of Learning

## Cấu trúc chính

| Tệp | Mục đích |
| --- | --- |
| `index.html` | Điểm vào ứng dụng, font chữ, favicon và stylesheet |
| `app.js` | Web Component gốc, state ban đầu, vòng đời và điều phối module |
| `app-router.js` | Hash routing, route guard và đăng xuất |
| `app-theme.js` | Light/dark theme và markup nút chuyển giao diện |
| `app-events.js` | Event delegation cho app shell và các view |
| `components.js` | Đăng ký các Web Component dùng trong ứng dụng |
| `app-config.js` | Cấu hình dùng chung, bản dịch nền và danh sách điều hướng |
| `app-data.js` | IndexedDB/localStorage, History và dữ liệu Analytics |
| `app-views.js` | Re-export `viewMethods`; template nằm trong `views/` |
| `views/` | Template tách theo khu vực, gồm `admin`, `landing`, `dashboard`, `audit`, `history`, `analytics`, `practice`, `profile`, `about`, `settings`, `sitemap` |
| `api/auth/` | API đăng ký, OTP, đăng nhập, session cookie và đăng xuất qua Supabase |
| `api/admin/users.js` | API quản trị người dùng, được bảo vệ bằng role admin phía server |
| `api/debate.js` | Proxy AI Debate Engine, validation đầu vào/đầu ra và timeout AnyRouter |
| `debate-ai.js`, `debate-prompt.js` | Client gọi Debate API và system prompt học thuật phía server |
| `api/learning-records/` | API, service và Supabase store cho phiên học, bài nộp, tương tác và đánh giá |
| `learning-records-service.js`, `learning-records-actions.js` | Đồng bộ Audit/History với learning-record API cho phiên Supabase thật |
| `learning-passport-service.js` | Client service cho Passport, credential API và Avalanche Explorer |
| `learning-passport-mock.js` | Fixtures được gắn nhãn rõ ràng cho giao diện Learning Passport |
| `learning-passport-actions.js` | Tương tác chi tiết và tra cứu chứng nhận |
| `contracts/LearningCredentialRegistry.sol` | Registry hash chứng nhận có issuer authorization và revocation |
| `api/credentials/` | API, Fuji gateway và Supabase credential persistence |
| `supabase/migrations/` | Migration bảng credential và lịch sử transaction |
| `scripts/deploy-learning-credential-registry.mjs` | Deploy script chỉ chấp nhận Fuji chain ID 43113 |
| `app-actions.js` | Tương tác Audit, Practice, upload và modal |
| `i18n.js` | Bản dịch bổ sung cho 8 khu vực, Việt/Anh/Nhật |
| `demo.js` | Dữ liệu demo cho phiên học, thử thách, biểu đồ và kỹ năng |
| `icons.js` | Bộ icon SVG dùng chung cho sidebar và sitemap |
| `styles.css` | CSS nền cho các màn hình và component |
| `editorial.css` | Typography, màu sắc và bố cục sổ tay học tập; tải sau `styles.css` |
| `views.css` | Bố cục các view mới, dark mode và màn hình sitemap; tải sau `editorial.css` |
| `fonts.css`, `fonts/` | Font WOFF2 self-hosted, subset Latin/Vietnamese với `font-display: swap` |
| `logo-mark.svg` | Logo PARADOX dạng vector |

Khi sửa giao diện, cập nhật trực tiếp `styles.css`, `editorial.css` hoặc `views.css`. `index.html` tải `views.css` sau `editorial.css` để các view mới kế thừa đúng art direction. Không cần file SCSS hoặc bước biên dịch.

## Kiểm thử

Test end-to-end dùng Playwright + axe-core (`tests/app.spec.js`): đăng ký/đăng nhập/đăng xuất, route guard, theme, Practice Lab, bộ lọc History và quét accessibility ở mức critical cho landing, dashboard, audit và modal luyện tập.

```bash
npm install
npx playwright install chromium
npm run contract:test
npm test
```

`npm run serve` chạy static server (`tests/static-server.mjs`) tại `http://127.0.0.1:8173` và tự nạp `.env` nếu có. Dự án dùng CSS và ES module trực tiếp nên không có bước build bundle. `npm test` chạy server riêng ở cổng `8175` với cấu hình email/Supabase để trống, nhờ đó test không bao giờ gửi mail thật hay ghi vào Supabase.

## Xác thực nhiều người dùng với Supabase

Sao chép `.env.example` thành `.env` và cấu hình:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_EMAILS=admin@paradox.ai
OTP_SECRET=mot-chuoi-bi-mat-ngau-nhien-toi-thieu-32-ky-tu

# Chọn một trong hai cách gửi OTP bên dưới.
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=your-smtp-user
SMTP_PASS=your-smtp-password
SMTP_FROM_EMAIL=no-reply@your-domain.example
SMTP_FROM_NAME=PARADOX AI

GMAIL_USER=email-cua-ban@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
GMAIL_FROM_NAME=PARADOX AI
```

### Gửi OTP qua SMTP

Backend hỗ trợ SMTP chuẩn qua `nodemailer`, dùng được với SendGrid, Mailgun, Amazon SES, Postmark, Brevo, Zoho hoặc SMTP server tự host. Cấu hình đầy đủ các biến sau trong `.env` local hoặc Vercel:

| Biến | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `SMTP_HOST` | Có | Hostname, không kèm `smtp://` hoặc đường dẫn |
| `SMTP_PORT` | Không | Mặc định `587`; dùng `465` cho implicit TLS |
| `SMTP_SECURE` | Không | Tự bật khi port là `465`; đặt `true`/`false` nếu cần |
| `SMTP_REQUIRE_TLS` | Không | Mặc định `true` cho host remote ở port không secure; dùng STARTTLS |
| `SMTP_USER`, `SMTP_PASS` | Không | Phải đặt cùng nhau; bỏ trống nếu relay nội bộ không cần auth |
| `SMTP_FROM_EMAIL` | Có* | Địa chỉ người gửi, ví dụ `no-reply@your-domain.example`; có thể bỏ trống nếu `SMTP_USER` là email |
| `SMTP_FROM_NAME` | Không | Tên hiển thị, mặc định `PARADOX AI` |

\* Nếu bỏ trống `SMTP_FROM_EMAIL`, backend dùng `SMTP_USER` khi đó là địa chỉ email, sau đó đến `OTP_FROM_EMAIL`.

Thứ tự ưu tiên khi gửi: **SMTP chung → Gmail App Password → Resend API**. Nếu có bất kỳ biến `SMTP_*` nào nhưng cấu hình thiếu hoặc sai, API trả lỗi cấu hình thay vì âm thầm gửi bằng provider khác.

Ví dụ với SMTP local (MailHog/Mailpit):

```env
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_REQUIRE_TLS=false
SMTP_FROM_EMAIL=dev@paradox.local
```

Kiểm tra kết nối bằng cách đăng ký một tài khoản mới; OTP sẽ được gửi qua SMTP và form xác nhận hiện ra. Nếu gửi thất bại, tài khoản Supabase đang chờ sẽ được xóa để người dùng thử lại.

Lưu ý khi deploy Vercel: một số gói/region có thể chặn outbound SMTP. Nếu không kết nối được, kiểm tra port `587`/`465`, cho phép outbound TLS của provider, hoặc dùng Resend/API HTTP. `SMTP_PASS`, `GMAIL_APP_PASSWORD` và `OTP_SECRET` chỉ được đặt ở server, không được commit hoặc gửi xuống trình duyệt.

Khi tạo bản demo trên Vercel, thêm các biến `OTP_SECRET`, `GMAIL_*` (hoặc `SMTP_*`) cho **cả môi trường Preview**, không chỉ Production, rồi redeploy. Demo công khai đã có giới hạn tần suất OTP mặc định; xem mục dưới để chỉnh.

### Giới hạn tần suất OTP

Backend chặn spam ngay ở `/api/auth/signup`, `/api/auth/otp` và `/api/auth/resend`:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OTP_SEND_COOLDOWN_SECONDS` | `60` | Thời gian chờ giữa hai lần gửi cho cùng email |
| `OTP_SEND_EMAIL_LIMIT` | `5` | Số lần gửi tối đa cho một email trong một cửa sổ |
| `OTP_SEND_IP_LIMIT` | `20` | Số lần gửi tối đa từ một IP trong một cửa sổ |
| `OTP_SEND_WINDOW_MINUTES` | `60` | Độ dài cửa sổ cho giới hạn gửi |
| `OTP_VERIFY_EMAIL_LIMIT` | `10` | Số lần nhập sai OTP tối đa cho một email |
| `OTP_VERIFY_IP_LIMIT` | `50` | Số lần thử OTP tối đa từ một IP |
| `OTP_VERIFY_WINDOW_MINUTES` | `15` | Độ dài cửa sổ cho giới hạn xác minh |

Khi vượt giới hạn, API trả `429` kèm header `Retry-After` và mã `RATE_LIMITED`; giao diện hiển thị số giây cần chờ. Đặt `RATE_LIMIT_DISABLED=1` để tắt hoàn toàn khi cần test tải.

Bộ đếm lưu trong bộ nhớ của từng serverless instance: một instance mới (cold start) sẽ đếm lại từ đầu, nên giới hạn này chặn được spam liên tục từ một client nhưng không phải hàng rào tuyệt đối. Nếu cần chặn chính xác trên toàn hệ thống, chuyển bộ đếm sang Redis/Upstash hoặc một bảng Supabase dùng chung.

### Chế độ demo vẫn gửi mail

`npm run serve` tự nạp `.env`. Nếu `.env` có `OTP_SECRET` và cấu hình `GMAIL_*` hoặc `SMTP_*`, bản demo local sẽ **gửi OTP thật tới email người dùng nhập**, kể cả khi chưa cấu hình Supabase; sau khi xác minh, tài khoản được tạo trong `localStorage` như luồng demo cũ.

Nếu chưa cấu hình email, backend trả `developmentCode` và giao diện hiển thị mã ngay dưới form để người test vẫn đăng nhập được. Trên Vercel, `developmentCode` không bao giờ được trả về; cần cấu hình email thật hoặc dùng email mặc định của Supabase.

### Gửi OTP bằng chính Gmail của bạn

> Nếu chọn Gmail, hãy bỏ trống hoặc comment toàn bộ biến `SMTP_*`; SMTP chung được ưu tiên hơn Gmail.

1. Bật **Xác minh 2 bước** cho tài khoản Google.
2. Mở [Google App Passwords](https://myaccount.google.com/apppasswords), tạo mật khẩu ứng dụng mới và đặt vào `GMAIL_APP_PASSWORD`. Không dùng mật khẩu Gmail thông thường.
3. Đặt địa chỉ Gmail vào `GMAIL_USER`, tạo `OTP_SECRET` dài ít nhất 32 ký tự và thêm tất cả biến trên vào Vercel.
4. Redeploy ứng dụng. Email gửi đi sẽ hiển thị dạng `PARADOX AI <email-cua-ban@gmail.com>`.

Khi cấu hình Gmail đầy đủ, backend tạo tài khoản chưa xác minh trong Supabase, gửi OTP bằng Gmail SMTP, chỉ xác nhận tài khoản sau khi OTP đúng rồi mới tạo session. Nếu gửi email thất bại, tài khoản chờ được dọn khỏi Supabase để người dùng có thể thử lại.

### Quên mật khẩu bằng OTP

Từ hộp thoại đăng nhập, chọn **Quên mật khẩu?**, nhập email đã xác minh, sau đó nhập OTP nhận qua Gmail/SMTP và mật khẩu mới. Backend chỉ cập nhật mật khẩu sau khi challenge OTP hợp lệ và được ràng buộc riêng với mục đích `password-reset`; OTP đăng ký không thể dùng lại để đổi mật khẩu.

Endpoint luôn trả cùng một phản hồi ở bước yêu cầu mã, kể cả khi email không tồn tại hoặc chưa xác minh, nhằm tránh làm lộ danh sách tài khoản. Luồng này dùng chung giới hạn tần suất theo email/IP với OTP đăng ký. Mật khẩu cũ không bao giờ được đọc hoặc gửi qua email.

Nếu không muốn dùng Gmail SMTP, có thể dùng cơ chế email mặc định của Supabase:

1. Mở **Authentication → Providers → Email**, bật email/password và xác nhận email.
2. Mở **Authentication → Email Templates → Confirm signup** và dùng `{{ .Token }}` trong nội dung email để người dùng nhận mã OTP 6 số thay vì magic link.
3. Với môi trường thật, cấu hình **Project Settings → Auth → SMTP Settings** bằng Resend hoặc nhà cung cấp SMTP của bạn để gửi ổn định đến Gmail.
4. `SUPABASE_SERVICE_ROLE_KEY`, Gmail App Password và `OTP_SECRET` chỉ được đặt ở server, tuyệt đối không đưa vào frontend hoặc commit Git.

Sau khi cấu hình, tài khoản nằm trong Supabase Auth, người dùng có thể đăng nhập trên nhiều thiết bị, phiên được giữ bằng cookie `HttpOnly`, và trang admin gọi API server để liệt kê/tạm khóa tài khoản. Khi chưa cấu hình Supabase ở local, ứng dụng tự dùng chế độ tài khoản/OTP demo trên trình duyệt.

Triển khai bằng Vercel để thư mục `api/` được nhận diện là serverless functions; GitHub Pages thuần tĩnh không thể chạy hệ thống xác thực này.

CI (`.github/workflows/test.yml`) chạy Playwright mỗi lần push/pull request và audit Lighthouse cho bản static.

Axe chặn lỗi ở cả mức **serious** và **critical** trên landing, toàn bộ 8 view và modal luyện tập. Lighthouse CI áp ngưỡng tối thiểu cho Performance (0.75), Accessibility (0.95), Best Practices (0.90) và SEO (0.90).

Font đã được self-host để trang không phụ thuộc Google Fonts khi chạy. Muốn tải lại đúng các subset/weight đang dùng:

```bash
npm run fonts:vendor
```

## AI hỗ trợ sử dụng website

Widget trợ lý nổi chỉ hướng dẫn cách sử dụng PARADOX; system prompt không cho phép giải bài hoặc trả lời câu hỏi học thuật. Frontend gọi endpoint cùng domain `/api/support`; key không được gửi xuống trình duyệt.

Backend/serverless function tại `api/support.js` gọi AnyRouter Chat Completions:

- Endpoint: `https://anyrouter.dev/api/v1/chat/completions`
- Model mặc định: `anyrouter/free`
- Key: biến môi trường `ANYROUTER_API_KEY`
- Model tùy chọn: biến môi trường `ANYROUTER_MODEL`

Tạo file `.env` từ `.env.example` để ghi nhớ tên biến (file `.env` đã được gitignore). Key inference AnyRouter hiện tại phải bắt đầu bằng `sk-ar-v1-` và được tạo tại [AnyRouter Dashboard](https://anyrouter.dev/dashboard/keys). Không dùng key quản trị hoặc ghi key vào `support-ai-config.js`.

Khi chạy local, sao chép `.env.example` thành `.env`, thay key rồi chạy:

```bash
npm run serve
```

Static server dành cho local tự đọc `.env`; biến môi trường hệ thống vẫn được ưu tiên nếu đã đặt.

Khi deploy Vercel, thêm `ANYROUTER_API_KEY` trong Project Settings → Environment Variables; `api/support.js` sẽ được nhận diện là serverless function. GitHub Pages thuần tĩnh không chạy được endpoint này, nên cần deploy frontend/backend lên Vercel hoặc trỏ `proxyUrl` đến một backend riêng.

Frontend gửi:

```json
{ "messages": [], "language": "vi", "currentView": "dashboard" }
```

Backend trả về:

```json
{ "text": "Nội dung hướng dẫn" }
```

System prompt được áp đặt lại ở backend; trường `system` từ client bị bỏ qua để người dùng không thể thay đổi phạm vi trợ lý. Nếu proxy nằm ở domain khác, cần đổi `proxyUrl` trong `support-ai-config.js` và thêm domain đó vào `connect-src` trong CSP của `index.html`.

## AI Debate Engine

Trang `#/audit` gọi endpoint cùng domain `/api/debate`. Endpoint tái sử dụng `ANYROUTER_API_KEY` và `ANYROUTER_MODEL`, giữ key hoàn toàn ở server. Input được giới hạn độ dài; request upstream có timeout 25 giây; JSON từ mô hình được kiểm tra lại theo schema trước khi trả cho frontend.

Kết quả chuẩn hóa gồm:

- `status`: `correct`, `incorrect` hoặc `insufficient`.
- `summary` và `confidence`.
- `issues`: tối đa 8 lỗi, mỗi lỗi có `category`, `step`, `explanation`, `suggestion`.
- `strengths`, `nextQuestion` và `reply` cho câu hỏi tiếp theo.

Prompt bắt buộc không bịa lỗi cho bài đúng và phải trả `insufficient` khi thiếu cơ sở đánh giá. Nội dung do người dùng gửi được coi là dữ liệu không tin cậy, không được phép thay đổi system prompt.

Trong một phiên Audit, cùng endpoint còn hỗ trợ bốn mode: `analyze`, `discuss`, `hint`, `resubmit`. Hội thoại gần nhất, tối đa ba gợi ý và tối đa mười lần nộp được giữ trong audit state ở IndexedDB để phục hồi giao diện. Với tài khoản Supabase, bản ghi chuẩn còn được lưu qua learning-record API ở backend; chế độ tài khoản local tiếp tục dùng IndexedDB/localStorage làm fallback. Gợi ý chỉ tăng từ cấp 1 đến cấp 3 khi người học bấm yêu cầu; server kiểm tra đúng cấp và từ chối nội dung trùng hoàn toàn. Khi nộp lại, AI nhận cả lời giải trước và sau để trả phần so sánh, còn giao diện theo dõi số lần sửa và giữ nguyên lịch sử khi chuyển trang.

### Rubric đánh giá bài sửa

Mode `resubmit` chấm bốn tiêu chí, mỗi tiêu chí từ 0–25 điểm:

| Tiêu chí | Nội dung đánh giá |
| --- | --- |
| `knowledgeAccuracy` | Độ chính xác kiến thức và khái niệm |
| `reasoningLogic` | Tính hợp lệ, nhất quán của lập luận |
| `solutionCompleteness` | Mức độ đầy đủ của bước giải, điều kiện và kết luận |
| `errorRemediation` | Mức độ khắc phục lỗi trong lần nộp trước |

Server tự tính tổng và không tin tổng điểm/trạng thái do mô hình cung cấp. Trạng thái **Đạt** chỉ xuất hiện khi tổng từ 75, phân tích là `correct`, không còn lỗi, đủ bằng chứng và confidence từ 0,6. Nếu thiếu dữ kiện hoặc confidence thấp, điểm tổng được để trống và trạng thái bắt buộc là **Chưa đủ cơ sở**; các trường hợp còn lại là **Cần cải thiện**. Giao diện hiển thị nhận xét, bằng chứng cho từng tiêu chí, lỗi đã sửa và lỗi còn tồn tại.

### Tối ưu và Proof of Learning

- Frontend gộp các request giống nhau đang chạy và cache mode `analyze` trong 2 phút, tối đa 50 kết quả. `discuss`, `hint` và `resubmit` không cache để tránh dùng lại ngữ cảnh cũ.
- API giới hạn 15 request/phút/client, timeout upstream 25 giây và chỉ đọc `ANYROUTER_API_KEY` ở server.
- Mọi output AI được chuẩn hóa và kiểm tra lại; trạng thái rubric được suy ra phía server.
- Mỗi lần nộp lại tạo `proofRecord` phiên bản `paradox-proof-of-learning-v1`, gồm SHA-256 content hash, rubric version, attempt number, thời gian, model, confidence, trạng thái và các tiêu chí. Backend lưu cấu trúc này cùng evaluation; đây chỉ là bằng chứng off-chain chuẩn bị cho credential, không tự tạo transaction hoặc chứng nhận blockchain.

## Backend & Learning Records

Giai đoạn 3 dùng chính Supabase project và Supabase Auth hiện có, không tạo database hoặc hệ thống đăng nhập thứ hai. Áp dụng migration additive `supabase/migrations/202610280002_learning_records.sql` để tạo bốn bảng:

| Bảng | Dữ liệu chính |
| --- | --- |
| `learning_sessions` | Đề bài, môn học, trạng thái, thời điểm bắt đầu/kết thúc và tổng thời gian |
| `learning_submissions` | Lời giải ban đầu, từng bản sửa, trạng thái phân tích và output AI đã validate |
| `learning_interactions` | Phân tích, câu hỏi phản biện, câu trả lời và gợi ý theo cấp |
| `learning_evaluations` | Rubric, điểm, nhận xét, lỗi đã sửa/còn lại và dữ liệu eligibility cho Passport |

Migration không xóa hoặc cập nhật bản ghi cũ. Mỗi bảng đều có `learner_id`; RLS chỉ cho tài khoản đã đăng nhập đọc dữ liệu của chính mình. Quyền ghi bị thu hồi khỏi `anon`/`authenticated` và chỉ backend với `service_role` được ghi. Backend vẫn kiểm tra session cookie và thêm điều kiện `learner_id` vào mọi truy vấn, nên service-role không thay thế kiểm tra ownership ở tầng API.

### Learning-record API

Tất cả route yêu cầu phiên Supabase hợp lệ trong cookie `HttpOnly`:

| Method | Route/body | Mục đích |
| --- | --- | --- |
| `POST` | `/api/learning-records` + `{ "action": "createSession", ... }` | Tạo phiên và bài nộp ban đầu |
| `POST` | `/api/learning-records` + `{ "action": "createSubmission", "sessionId", "solution" }` | Thêm một bản sửa mới, không ghi đè bài cũ |
| `POST` | `/api/learning-records` + `{ "action": "abandonSession", "sessionId" }` | Đóng phiên đang học |
| `GET` | `/api/learning-records?limit=50&offset=0` | Lấy lịch sử phiên của người dùng hiện tại |
| `GET` | `/api/learning-records?id=<uuid>` | Lấy chi tiết phiên, submissions, interactions và evaluations |
| `GET` | `/api/learning-records?view=evaluations` | Lấy evaluation đủ điều kiện để Learning Passport sử dụng |

Frontend chỉ tạo session/submission. Khi `/api/debate` nhận `learningRecord.sessionId` và `submissionId`, backend xác minh owner và đối chiếu đề/lời giải đã lưu trước khi gọi AI. Chỉ output AI đã qua schema/rubric validation phía server mới được ghi thành analysis/evaluation. Một submission đã phân tích không được chấm lại để tránh ghi đè kết quả cũ; bản sửa luôn tạo submission mới.

Client không thể tự gửi trạng thái `pass`, điểm hoặc eligibility. Backend chỉ chuẩn bị `credential_id`, credential ID hash tương thích registry, SHA-256 evidence hash, `credential_status: eligible` và `verification_status: unverified` khi evaluation đạt đủ điều kiện. `transactionHash` luôn là `null` ở API này; việc phát hành/xác minh blockchain thuộc luồng credential riêng và cần giao dịch Fuji thật.

### Cấu hình Supabase

1. Link Supabase CLI với project rồi chạy `supabase db push`, **hoặc** mở SQL Editor và chạy migration `202610280002_learning_records.sql` sau migration credential nếu dùng cả hai tính năng.
2. Cấu hình `SUPABASE_URL`, `SUPABASE_ANON_KEY` và `SUPABASE_SERVICE_ROLE_KEY` trong `.env` local/Vercel. Service-role key chỉ được đặt ở server và không được prefix thành biến public.
3. Cấu hình `ANYROUTER_API_KEY` để thực hiện phân tích thật. Nếu key chưa có, session/submission vẫn được giữ lại với `analysis_failed` / `analysis_unavailable`; backend không tạo evaluation hoặc credential giả.
4. Redeploy serverless API sau khi thêm environment variables. GitHub Pages thuần tĩnh không chạy được các route này.

History/Dashboard/Analytics tự tải tối đa 100 phiên Supabase sau khi xác thực và sau mỗi lần Audit. Nếu đang dùng chế độ tài khoản local, luồng cũ trên IndexedDB/localStorage vẫn hoạt động và giao diện không thay đổi.

## Learning Passport và Avalanche Proof of Learning

Hai route `#/passport` và `#/verify` cung cấp hồ sơ năng lực, tiến độ, kết quả đánh giá, danh sách chứng nhận, modal chi tiết và trang tra cứu theo mã. Khi chưa dùng Supabase Auth/API, dữ liệu đến từ `learning-passport-mock.js` và luôn có nhãn **DỮ LIỆU MẪU / MOCK DATA**. Với phiên Supabase thật, giao diện tự gọi `/api/credentials`, hiển thị transaction/status đã lưu và xác minh lại từ Avalanche Fuji khi người dùng tra cứu.

`learning-passport-service.js` kết nối frontend với backend nhưng không bao giờ nhận private key:

- `LEARNING_PASSPORT_API_INTERFACE` mô tả route lấy Passport, phát hành, xác minh và thu hồi.
- `createCredentialDraftFromAiEvaluation()` chuyển proof record thành bản nháp chứng nhận ở trạng thái `unverified`.
- `AVALANCHE_CREDENTIAL_INTERFACE` chỉ chứa Avalanche Fuji (`43113`), Explorer và chữ ký hàm registry.
- Trạng thái `verified` chỉ được hiển thị khi có Transaction Hash hợp lệ và kết quả kiểm tra thật với `verification.source = "avalanche"`, `checked = true`, `valid = true`.
- Nút Avalanche Explorer chỉ hoạt động khi Transaction Hash đúng định dạng 32-byte và network nằm trong danh sách hỗ trợ.
- Credential `manual-test` bắt buộc dùng mã `PXP-TEST-*`, `isTest: true` và được gắn nhãn **CHỨNG NHẬN KIỂM THỬ**. Payload có `source: "mock"` bị backend từ chối.

### Smart contract

`LearningCredentialRegistry` chỉ lưu hai giá trị `bytes32` (credential ID hash và evidence hash), địa chỉ issuer cùng timestamp. Bài làm, email, tên người học và PII không được đưa lên chain. Contract hỗ trợ:

- Owner cấp hoặc thu hồi quyền issuer; owner luôn phải còn quyền issuer.
- Chỉ issuer đang được cấp quyền mới được phát hành/thu hồi.
- Chặn credential ID trùng, evidence hash trùng, hash rỗng và thu hồi lần hai.
- Xác minh tồn tại/trạng thái qua `credentialExists`, `getCredential` và `isCredentialValid`.
- Chuyển owner theo quy trình hai bước `transferOwnership` / `acceptOwnership`.

```bash
npm run contract:build
npm run contract:test
```

### Supabase persistence

Áp dụng `supabase/migrations/202610280001_learning_credentials.sql` bằng Supabase CLI hoặc SQL Editor trước khi bật API. Migration tạo:

- `learning_credentials`: metadata off-chain, credential/evidence hash, Fuji contract, transaction hash và trạng thái xác minh.
- `credential_transactions`: lịch sử `issue`/`revoke` với `submitting`, `pending`, `confirmed` hoặc `failed`.
- RLS và quyền chỉ dành cho `service_role`; frontend không được truy cập bảng trực tiếp.

Backend ghi trạng thái `pending` ngay khi nhận transaction hash, sau đó cập nhật receipt thành `confirmed`, `revoked` hoặc `failed`. Tra cứu so sánh evidence hash on-chain với database trước khi trả trạng thái verified.
Nếu request phát hành mất kết nối sau khi đã gửi transaction, bản ghi `failed` có thể được gửi lại với `retryFailed: true`; service kiểm tra chain trước, tự hòa giải transaction đã mine và chỉ gửi transaction mới khi credential chưa tồn tại on-chain.

### Cấu hình và deploy Fuji

Tạo **ví mới chỉ dùng cho Fuji**, không tái sử dụng ví Mainnet. Lấy AVAX testnet không có giá trị thật tại [Core Testnet Faucet](https://core.app/tools/testnet-faucet), rồi đặt biến trong `.env`/Vercel (không commit giá trị thật):

```env
AVALANCHE_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc
AVALANCHE_ISSUER_PRIVATE_KEY=0x...
```

Deploy:

```bash
npm run contract:deploy:fuji
```

Script kiểm tra RPC trả đúng chain ID `43113`, kiểm tra số dư Fuji AVAX, deploy, xác minh issuer và chỉ sau receipt thành công mới tạo `deployments/avalanche-fuji.json`. Sau đó thêm địa chỉ thật:

```env
AVALANCHE_CREDENTIAL_REGISTRY_ADDRESS=0x...
```

Không có cấu hình hoặc code path Avalanche Mainnet. Tại thời điểm tài liệu này được cập nhật, contract **chưa được deploy**, vì vậy chưa có contract address hay transaction hash thật để công bố.

### Điều hướng nhanh

| Hash | Màn hình |
| --- | --- |
| `#/audit` | AI Audit / Phản biện bài làm |
| `#/dashboard` | Tổng quan học tập |
| `#/history` | Lịch sử bài làm |
| `#/analytics` | Phân tích tiến bộ |
| `#/practice` | Luyện tập củng cố |
| `#/profile` | Hồ sơ cá nhân |
| `#/passport` | Learning Passport và danh sách chứng nhận |
| `#/verify` | Tra cứu và xác minh chứng nhận |
| `#/about` | Giới thiệu & hướng dẫn |
| `#/settings` | Cài đặt hệ thống |
| `#/admin` | Quản trị người dùng (chỉ role admin) |
| `#/sitemap` | Website Sitemap (công khai) |

## Trạng thái prototype và bảo mật

- Khi có cấu hình Supabase, tài khoản và mật khẩu được Supabase quản lý, access/refresh token nằm trong cookie `HttpOnly`; learning records thật được lưu trong Supabase và IndexedDB chỉ giữ state giao diện hiện tại. Khi thiếu cấu hình, ứng dụng dùng chế độ local dành cho phát triển.
- Chọn tệp chỉ cập nhật tên tệp trên giao diện. Tệp chưa được tải lên hoặc phân tích.
- AI Debate Engine gọi AnyRouter thật; Practice Lab và dữ liệu biểu đồ vẫn là nội dung demo. Kết quả AI có thể sai nên chỉ nên dùng như phản hồi hỗ trợ học tập, không phải đáp án có thẩm quyền.
- Với tài khoản Supabase, History của AI Audit và Proof of Learning credential/transaction state được lưu trong Supabase sau khi áp dụng migration. Practice/settings và chế độ tài khoản local vẫn nằm trên từng trình duyệt.
