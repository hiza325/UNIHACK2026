# PARADOX AI — EduDefend.OS

> **Sản phẩm dự thi UniHack 2026** · EduTech · AI Agents & Security

PARADOX AI là trợ lý phản biện học tập của Nexus Academy Analytics. Thay vì đưa đáp án ngay, sản phẩm hướng người học tự rà soát lập luận, tìm lỗi, sửa bài và củng cố kiến thức bằng bài luyện tương tự.

## Chạy giao diện

Đây là frontend tĩnh, không cần cài dependency. Vì ứng dụng dùng ES module, hãy chạy qua static server thay vì mở trực tiếp `index.html`.

1. Chạy static server tại thư mục dự án:

   ```bash
   python -m http.server 8123
   ```

   Sau đó truy cập `http://127.0.0.1:8123`.

2. Hoặc mở thư mục dự án bằng VS Code và chạy với Live Server.

## Tính năng giao diện

- Trang giới thiệu responsive, có điều hướng đến **Trang chủ**, **Cách hoạt động**, **Có gì ở PARADOX?** và **Lợi ích**.
- Ứng dụng 8 khu vực theo sitemap: **AI Audit**, **Dashboard**, **History**, **Analytics**, **Practice Lab**, **Profile**, **About / Guide** và **Settings**.
- Điều hướng bằng hash (`#/audit`, `#/dashboard`, …). Riêng `#/sitemap` là màn hình sitemap tối, mở được khi chưa đăng nhập; các trang còn lại yêu cầu phiên demo.
- Luồng phản biện học tập 7 bước, khu vực chọn đề/bài làm, hội thoại mô phỏng và thử thách luyện tập.
- Dashboard tổng hợp tiến độ; History có bộ lọc trạng thái và tìm kiếm; Analytics có biểu đồ 7/30/90 ngày.
- Practice Lab có câu hỏi trắc nghiệm, phản hồi đáp án và lưu trạng thái đã giải trong `localStorage`.
- Profile cho phép đổi tên hiển thị; Settings lưu giao diện, ngôn ngữ, môn học, mức gợi ý và tùy chọn thông báo.
- Chuyển ngôn ngữ Việt, Anh, Nhật; nút sáng/tối ở landing và thanh trên cùng của ứng dụng; xuất dữ liệu demo dạng JSON và đặt lại tiến độ luyện tập.
- Màn hình đăng nhập/đăng ký và đăng xuất dạng prototype.
- Biểu tượng logo SVG, có thể phóng to mà không vỡ hình.

## Công nghệ

- HTML5
- Vanilla JavaScript và Web Components
- CSS thuần, chạy trực tiếp trên trình duyệt; không cần Sass hoặc bước biên dịch
- PHP/MySQL và Gemini API là định hướng backend, chưa tích hợp trong bản hiện tại

## Cấu trúc chính

| Tệp | Mục đích |
| --- | --- |
| `index.html` | Điểm vào ứng dụng, font chữ, favicon và stylesheet |
| `app.js` | Component giao diện, routing, các view và tương tác prototype |
| `i18n.js` | Bản dịch bổ sung cho 8 khu vực, Việt/Anh/Nhật |
| `demo.js` | Dữ liệu demo cho phiên học, thử thách, biểu đồ và kỹ năng |
| `icons.js` | Bộ icon SVG dùng chung cho sidebar và sitemap |
| `styles.css` | CSS nền cho các màn hình và component |
| `editorial.css` | Typography, màu sắc và bố cục sổ tay học tập; tải sau `styles.css` |
| `views.css` | Bố cục các view mới, dark mode và màn hình sitemap; tải sau `editorial.css` |
| `logo-mark.svg` | Logo PARADOX dạng vector |

Khi sửa giao diện, cập nhật trực tiếp `styles.css`, `editorial.css` hoặc `views.css`. `index.html` tải `views.css` sau `editorial.css` để các view mới kế thừa đúng art direction. Không cần file SCSS hoặc bước biên dịch.

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
| `#/sitemap` | Website Sitemap (công khai) |

## Trạng thái prototype và bảo mật

- Đăng nhập/đăng ký hiện chỉ tạo phiên demo trên trình duyệt, lưu tên và email trong `localStorage`; mật khẩu không được lưu và chưa được xác thực với máy chủ. Vì vậy, đây chưa phải hệ thống tài khoản an toàn.
- Chọn tệp chỉ cập nhật tên tệp trên giao diện. Tệp chưa được tải lên hoặc phân tích.
- Phản hồi hội thoại và các bước AI là nội dung mô phỏng phía trình duyệt, chưa gọi Gemini.
- Trước khi dùng với người dùng thật, cần xây backend PHP/MySQL, băm mật khẩu bằng bcrypt, quản lý session phía máy chủ, xác thực quyền truy cập và xử lý tệp an toàn. Gemini API key cần được giữ ở backend.
