# PARADOX AI — EduDefend.OS

> **Sản phẩm dự thi UniHack 2026** · EduTech · AI Agents & Security

PARADOX AI là trợ lý phản biện học tập của Nexus Academy Analytics. Thay vì đưa đáp án ngay, sản phẩm hướng người học tự rà soát lập luận, tìm lỗi, sửa bài và củng cố kiến thức bằng bài luyện tương tự.

## Chạy giao diện

Đây là frontend tĩnh, không cần cài dependency.

1. Mở `index.html` trong trình duyệt; hoặc
2. Mở thư mục dự án bằng VS Code và chạy với Live Server; hoặc
3. Chạy static server tại thư mục dự án:

   ```bash
   python -m http.server 5500
   ```

   Sau đó truy cập `http://localhost:5500`.

## Tính năng giao diện

- Trang giới thiệu responsive, có điều hướng đến **Trang chủ**, **Cách hoạt động**, **Có gì ở PARADOX?** và **Lợi ích**.
- Luồng phản biện học tập 7 bước, khu vực chọn đề/bài làm, hội thoại mô phỏng và thử thách luyện tập.
- Chuyển ngôn ngữ Việt, Anh, Nhật; chuyển giao diện sáng/tối.
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
| `app.js` | Component giao diện, nội dung đa ngôn ngữ và tương tác prototype |
| `styles.css` | CSS nền cho các màn hình và component |
| `editorial.css` | Typography, màu sắc và bố cục sổ tay học tập; tải sau `styles.css` |
| `logo-mark.svg` | Logo PARADOX dạng vector |

Khi sửa giao diện, cập nhật trực tiếp `styles.css` hoặc `editorial.css`. `index.html` tải `editorial.css` sau `styles.css` để áp dụng các tùy chỉnh giao diện. Không cần file SCSS hoặc bước biên dịch.

## Trạng thái prototype và bảo mật

- Đăng nhập/đăng ký hiện chỉ tạo phiên demo trên trình duyệt, lưu tên và email trong `localStorage`; mật khẩu không được lưu và chưa được xác thực với máy chủ. Vì vậy, đây chưa phải hệ thống tài khoản an toàn.
- Chọn tệp chỉ cập nhật tên tệp trên giao diện. Tệp chưa được tải lên hoặc phân tích.
- Phản hồi hội thoại và các bước AI là nội dung mô phỏng phía trình duyệt, chưa gọi Gemini.
- Trước khi dùng với người dùng thật, cần xây backend PHP/MySQL, băm mật khẩu bằng bcrypt, quản lý session phía máy chủ, xác thực quyền truy cập và xử lý tệp an toàn. Gemini API key cần được giữ ở backend.
