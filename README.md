# COLORA Product Identity Platform — v2.2

Mini platform cho **Product Passport + Warranty + NFC + CRM + Authentication**.

## Cách hoạt động
Mỗi món trang sức có một stable URL riêng, ví dụ:

`https://passport.colora.vn/p/P-XXXXXXXX`

Cùng URL này được ghi vào QR và NFC. Nội dung passport, warranty và CRM có thể cập nhật phía server mà không cần in lại QR.

## V2.2 có gì
- Product Passport công khai
- Warranty
- CRM / ownership fields chỉ dành cho admin
- QR PNG/SVG với COLORA mark
- Safe-scan QR: module chuẩn, quiet zone lớn, logo nhỏ hơn, Error Correction H
- Tự sửa local URL thành public origin trên production
- Web NFC write trên browser hỗ trợ
- Unique Product ID, Serial, Auth Code
- HMAC server-side signature
- Scan count + scan anomaly heuristic
- Không lưu raw IP; chỉ lưu fingerprint HMAC
- PostgreSQL production storage
- JSON fallback để chạy local / migrate dữ liệu cũ
- CSV export
- `/health` để kiểm tra deploy + database

## Railway + PostgreSQL
Xem `RAILWAY_POSTGRES_SETUP.md`.

Tóm tắt:
1. Railway project → **+ New → Database → PostgreSQL**.
2. Service COLORA → Variables → tạo Reference Variable:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`
3. Đặt `COLORA_ADMIN_KEY` và `COLORA_SIGNING_SECRET` ở Railway Variables.
4. Redeploy.
5. Mở `/health`; phải thấy `"database":"postgresql"`.

## QR không được chứa localhost
Production QR phải có dạng:

`https://your-public-domain/p/P-XXXXXX`

Không dùng:

`http://localhost:...`

V2.2 ưu tiên `RAILWAY_PUBLIC_DOMAIN`; nếu frontend vẫn nhận local URL, nó tự thay host bằng `location.origin` trước khi render QR.

## Chạy local
Yêu cầu Node.js 18+.

```bash
npm install
COLORA_ADMIN_KEY="your-admin-key" \
COLORA_SIGNING_SECRET="your-signing-secret" \
node server.js
```

Không có `DATABASE_URL` thì app dùng `data/products.json` làm fallback.

## Production notes
- Không commit admin key, signing secret hoặc database credentials lên GitHub.
- Authentication bằng signed digital identity giúp phát hiện record bị thay đổi, nhưng QR vẫn có thể bị copy. Với anti-counterfeit mạnh hơn, cần secure NFC/challenge-response/ownership activation.
- Product Passport công khai không trả customer name/email/phone.
