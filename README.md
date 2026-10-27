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

   Sau đó truy cập `http://127.0.0.1:8173`. Khi chưa cấu hình email, mã OTP local được hiển thị ngay trong hộp thoại để phát triển và demo.

## Tính năng giao diện

- Trang giới thiệu responsive, có điều hướng đến **Trang chủ**, **Cách hoạt động**, **Có gì ở PARADOX?** và **Lợi ích**.
- Ứng dụng gồm **AI Audit**, **Dashboard**, **History**, **Analytics**, **Practice Lab**, **Profile**, **About / Guide**, **Settings** và trang **Admin** có phân quyền.
- Điều hướng bằng hash (`#/audit`, `#/dashboard`, …). Riêng `#/sitemap` là màn hình sitemap tối, mở được khi chưa đăng nhập; các trang còn lại yêu cầu phiên demo.
- Luồng phản biện học tập 7 bước, khu vực chọn đề/bài làm, hội thoại mô phỏng và thử thách luyện tập.
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
npm test
```

`npm run serve` chạy static server (`tests/static-server.mjs`) tại `http://127.0.0.1:8173` nếu muốn tự duyệt thay vì `python -m http.server`.

## Xác thực nhiều người dùng với Supabase

Sao chép `.env.example` thành `.env` và cấu hình:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ADMIN_EMAILS=admin@paradox.ai
```

Trong Supabase Dashboard:

1. Mở **Authentication → Providers → Email**, bật email/password và xác nhận email.
2. Mở **Authentication → Email Templates → Confirm signup** và dùng `{{ .Token }}` trong nội dung email để người dùng nhận mã OTP 6 số thay vì magic link.
3. Với môi trường thật, cấu hình **Project Settings → Auth → SMTP Settings** bằng Resend hoặc nhà cung cấp SMTP của bạn để gửi ổn định đến Gmail.
4. Thêm bốn biến môi trường trên vào Vercel. `SUPABASE_SERVICE_ROLE_KEY` chỉ được đặt ở server, tuyệt đối không đưa vào frontend hoặc commit Git.

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

### Điều hướng nhanh

| Hash | Màn hình |
| --- | --- |
| `#/audit` | AI Audit / Phản biện bài làm |
| `#/dashboard` | Tổng quan học tập |
| `#/history` | Lịch sử bài làm |
| `#/analytics` | Phân tích tiến bộ |
| `#/practice` | Luyện tập củng cố |
| `#/profile` | Hồ sơ cá nhân |
| `#/about` | Giới thiệu & hướng dẫn |
| `#/settings` | Cài đặt hệ thống |
| `#/admin` | Quản trị người dùng (chỉ role admin) |
| `#/sitemap` | Website Sitemap (công khai) |

## Trạng thái prototype và bảo mật

- Khi có cấu hình Supabase, tài khoản và mật khẩu được Supabase quản lý, access/refresh token nằm trong cookie `HttpOnly`, còn `localStorage` chỉ giữ hồ sơ hiển thị và dữ liệu học tập demo. Khi thiếu cấu hình, ứng dụng dùng chế độ local dành cho phát triển.
- Chọn tệp chỉ cập nhật tên tệp trên giao diện. Tệp chưa được tải lên hoặc phân tích.
- Phản hồi hội thoại và các bước AI là nội dung mô phỏng phía trình duyệt, chưa gọi Gemini.
- Dữ liệu học tập hiện vẫn nằm trên từng trình duyệt. Nếu cần đồng bộ lịch sử học trên nhiều thiết bị, bước tiếp theo là chuyển các bảng lịch sử/practice/settings sang Supabase PostgreSQL với Row Level Security.
