# COLORA Product Identity Platform — v2

Đây là bản nâng cấp từ một QR generator thành một mini Product Identity Platform.

## Mục tiêu
Mỗi món trang sức có một stable URL riêng:

`https://your-domain.com/p/P-XXXXXXXX`

Stable URL này được ghi vào:
- QR code in trên card / packaging
- NFC tag/card

QR/NFC không cần thay khi nội dung phía sau thay đổi.

## Có sẵn trong starter này
- Product Passport công khai
- Warranty data
- CRM/ownership fields ở admin
- QR với COLORA mark, PNG/SVG
- Web NFC write (Chrome Android + HTTPS)
- Unique public ID, serial và auth code
- HMAC server-side signature cho identity
- Scan count
- Anomaly heuristic
- IP được HMAC-hash trước khi lưu fingerprint; không lưu IP thô
- Admin registry
- CSV export cho CRM
- Trạng thái authentication: authentic / revoked / etc.
- Stable permalink `/p/:id`

## Chạy local
Yêu cầu Node.js 18+.

macOS / Linux:
```bash
export COLORA_ADMIN_KEY="your-strong-admin-key"
export COLORA_SIGNING_SECRET="a-long-random-secret"
export PUBLIC_BASE_URL="http://localhost:8787"
node server.js
```

Windows PowerShell:
```powershell
$env:COLORA_ADMIN_KEY="your-strong-admin-key"
$env:COLORA_SIGNING_SECRET="a-long-random-secret"
$env:PUBLIC_BASE_URL="http://localhost:8787"
node server.js
```

Mở: `http://localhost:8787`

## Deploy production
Đặt app sau HTTPS và dùng domain COLORA sở hữu, ví dụ:
- `https://passport.colora.vn`
- hoặc reverse proxy `/p/*` từ `colora.vn`

Biến môi trường bắt buộc:
- `COLORA_ADMIN_KEY`
- `COLORA_SIGNING_SECRET`
- `PUBLIC_BASE_URL`

## Giới hạn của starter
Starter dùng JSON file làm database để dễ chạy và kiểm tra. Production nên đổi sang PostgreSQL/MySQL/Supabase/Cloudflare D1 tùy hạ tầng.

HMAC signature xác nhận record được COLORA server phát hành, nhưng **không biến QR thành anti-counterfeit tuyệt đối**. QR vẫn có thể bị copy. Để tăng độ tin cậy:
1. dùng NFC UID/chip có tính năng chống clone nếu budget cho phép;
2. link ownership/activation sau purchase;
3. challenge-response hoặc secure NFC chip cho SKU cao cấp;
4. anomaly detection;
5. customer activation + transfer ownership;
6. audit log không sửa được.

## Privacy / CRM
Chỉ lưu dữ liệu cá nhân khi có cơ sở pháp lý/consent phù hợp. Product Passport công khai không trả customer name/email/phone.

## Haravan
Haravan có thể tiếp tục làm storefront. Product Identity Platform nên chạy ở backend riêng và dùng custom domain/subdomain. Sau đó Haravan link sang passport hoặc gọi API tùy mức tích hợp.
