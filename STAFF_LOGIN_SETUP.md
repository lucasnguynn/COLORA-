# COLORA Staff Login — Railway setup

## 1. Biến môi trường bắt buộc trên Railway
Trong service COLORA -> Variables, đặt:

- DATABASE_URL = reference tới `Postgres.DATABASE_URL`
- COLORA_ADMIN_KEY = emergency/setup key mạnh
- COLORA_SIGNING_SECRET = chuỗi random dài
- COLORA_SESSION_SECRET = chuỗi random dài, khác signing secret
- PUBLIC_BASE_URL = domain Railway hoặc `https://passport.colora.vn`

## 2. Deploy
Push/upload các file mới lên GitHub. Railway sẽ redeploy.

## 3. Tạo Admin đầu tiên
Mở:
`https://<domain-cua-ban>/login.html`

Nếu PostgreSQL đã kết nối và chưa có staff user, màn hình sẽ hiện "Tạo Admin đầu tiên".
Nhập:
- Họ tên
- Email
- Mật khẩu tối thiểu 8 ký tự
- Admin Key = `COLORA_ADMIN_KEY` trên Railway

Sau khi tạo, Admin Key không còn cần cho thao tác hằng ngày.

## 4. Tạo nhân viên
Đăng nhập bằng Admin -> bấm `Nhân viên` ở góc phải -> tạo tài khoản và role.

Roles:
- Admin: toàn quyền + quản lý nhân viên
- Sales: xem/tạo Product Identity, CRM, warranty, export
- CSKH: xem registry, warranty/CRM, export; không tạo identity mới
- Production: xem/tạo Product Identity; không export CRM
- Viewer: chỉ xem

## 5. Emergency login
Admin Key vẫn có thể dùng ở trang Login -> "Đăng nhập bằng Admin Key khẩn cấp".
Chỉ chủ hệ thống nên biết key này.
