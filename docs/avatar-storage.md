# Profile avatars

Ảnh đại diện được xử lý hoàn toàn ở server. Browser chỉ gửi ảnh đã crop dưới
dạng base64 JSON và nhận lại `avatarUrl`; browser không tự lưu URL vào
`localStorage`.

## Luồng upload

1. Người dùng chọn JPG/PNG/WebP, tối đa 5 MB.
2. Editor crop vuông 1:1 bằng canvas 512×512, có zoom và căn ngang/dọc.
3. Browser gửi `POST /api/auth/session?avatar=meta` (Supabase) hoặc
   `POST /api/auth/local?avatar=meta` (Local Auth) với:
   `{ "mime": "image/webp", "image": "<base64>" }`.
4. Server xác thực session, giới hạn 5 MB trên bytes đã decode, kiểm tra MIME
   thật bằng `sharp`, xoay theo EXIF, resize 512×512 và encode WebP.
5. Server ghi object mới, cập nhật metadata, trả `avatarUrl` có cache-busting
   `v=<uuid>.webp`.
6. Ảnh cũ được đưa vào hàng đợi `retired` và chỉ xóa sau khi ảnh mới active.
   Nếu xóa thất bại, lần request sau sẽ thử lại; avatar hiện tại không bị mất.

## Backend theo môi trường

### Local Auth (chỉ development)

- Metadata: `.data/profiles/<sha256(email)>.json` → `avatar`.
- File: `.data/avatars/<sha256(email)>/<uuid>.webp`.
- Owner lấy từ signed Local Auth session, không tin `userId` do client gửi.
- Tồn tại qua reload, logout/login và restart server.
- Local Auth bị vô hiệu hóa khi `VERCEL=1` hoặc `NODE_ENV=production`.

### Supabase (Production/Vercel)

- Metadata: bảng `public.avatar_profiles`, cập nhật qua RPC row-lock
  `avatar_mutate` (rate limit, enqueue, activate, expire, clean).
- File: bucket **private** `profile-avatars` (5 MB, `image/webp`).
- Chỉ service role trong serverless function được đọc/ghi bucket và bảng.
- Không có storage policy cho client; API luôn xác thực cookie session trước
  và tự tạo object key từ user id đã xác thực.
- `AVATAR_STORAGE_BUCKET` tùy chọn, mặc định `profile-avatars` (khớp migration).

## Cấu hình Production

1. Chạy `supabase/migrations/202611100001_profile_avatars.sql` trên project
   Supabase (SQL Editor hoặc `supabase db push`). Migration tạo:
   - bảng `public.avatar_profiles` + RLS;
   - RPC `public.avatar_mutate`;
   - bucket private `profile-avatars`.
2. Đặt các biến sau trên Vercel (server-side, không prefix public):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `AVATAR_STORAGE_BUCKET=profile-avatars` (khuyến nghị đặt tường minh)
3. Redeploy. Vercel không giữ file trong filesystem của function, nên không có
   fallback ghi đĩa cho tài khoản Supabase.
4. Kiểm tra lại bucket trong Supabase Storage: `public = false`. Nếu bucket
   public, API trả `AVATAR_NOT_CONFIGURED` và không ghi dữ liệu.
5. Nếu API tự tạo bucket không được phép bởi project, tạo thủ công bucket
   private tên `profile-avatars` với giới hạn 5 MB và MIME `image/webp`.

## Mã lỗi

| Code | HTTP | Ý nghĩa |
| --- | --- | --- |
| `AVATAR_NOT_CONFIGURED` | 503 | Thiếu `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, bucket name sai, hoặc bucket đang public. |
| `AVATAR_STORAGE_NOT_READY` | 503 | Migration avatar chưa chạy (thiếu bảng hoặc RPC). |
| `AVATAR_STORAGE_UNAVAILABLE` | 503 | Supabase Storage/PostgREST không phản hồi hoặc trả lỗi. |
| `AVATAR_NOT_FOUND` | 404 | Metadata trỏ tới object không còn tồn tại. |
| `AVATAR_TOO_LARGE` | 413 | Ảnh > 5 MB. |
| `AVATAR_INVALID_TYPE` | 415 | MIME không thuộc JPG/PNG/WebP. |
| `AVATAR_INVALID_IMAGE` | 400 | Nội dung không phải ảnh hợp lệ hoặc JSON sai. |
| `AVATAR_RATE_LIMITED` | 429 | Quá 10 lần thay đổi trong 10 phút. |
| `AVATAR_FORBIDDEN` | 403 | Request cross-origin hoặc sai host. |

Log server chỉ ghi **tên** biến môi trường còn thiếu, không bao giờ ghi giá trị
secret.

## Kiểm thử

- `tests/avatar.spec.js`: Local Auth, crop/zoom/pan, reload, logout/login,
  isolation giữa hai người dùng, file lỗi/quá lớn, rate limit, cleanup bền vững.
- `tests/avatar-production.spec.js`: chạy nhánh Supabase với một Supabase API
  giả lập cục bộ — mặc định bucket, tự tạo bucket private, upload/đọc/xóa ảnh,
  cập nhật metadata, isolation và mapping lỗi migration.
