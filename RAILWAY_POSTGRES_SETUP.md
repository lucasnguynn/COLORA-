# COLORA V2.2 — Railway + PostgreSQL

## 1. Thêm PostgreSQL
Trong Railway project: **+ New → Database → PostgreSQL**.

## 2. Nối database với service COLORA
Mở service **COLORA- → Variables → New Variable** và tạo:

`DATABASE_URL = ${{Postgres.DATABASE_URL}}`

Nếu Railway đặt database bằng tên khác, chọn `DATABASE_URL` từ autocomplete của Railway.

## 3. Giữ các secret ở Railway
- `COLORA_ADMIN_KEY` = mật khẩu admin mạnh
- `COLORA_SIGNING_SECRET` = chuỗi random dài

Không đưa 2 giá trị này lên GitHub hoặc vào frontend.

## 4. Public URL / QR
Bản V2.2 tự lấy Railway public domain. Nếu `PUBLIC_BASE_URL` cũ đang là localhost, app sẽ bỏ qua nó trên Railway. Frontend cũng tự sửa local passport URL thành domain hiện tại trước khi tạo QR.

Có thể để `PUBLIC_BASE_URL` trống trên Railway, hoặc đặt domain public thật, ví dụ:

`PUBLIC_BASE_URL=https://colora-production.up.railway.app`

## 5. Kiểm tra
Mở:

`https://YOUR-DOMAIN/health`

Kết quả đúng phải có:

- `"ok": true`
- `"database": "postgresql"`
- `"publicBaseUrl": "https://..."`

Sau đó tạo **một Product Passport mới**. Dòng dưới QR phải bắt đầu bằng `https://`, không phải `localhost`. Bấm **Test link**. Nếu Product Passport mở được, hãy dùng điện thoại quét thử rồi mới in.

## QR Safe Scan
V2.2 dùng:
- module vuông chuẩn;
- finder pattern vuông chuẩn;
- Error Correction H;
- quiet zone lớn hơn;
- logo giữa nhỏ hơn;
- tự sửa localhost URL trên production.

## PostgreSQL
Khi có `DATABASE_URL`, dữ liệu Product Passport, Warranty, CRM, scan count và scan events được lưu vào PostgreSQL. File `data/products.json` chỉ còn là fallback/dev và nguồn migrate lần đầu nếu database mới còn trống.
