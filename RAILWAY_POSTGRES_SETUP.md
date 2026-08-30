# COLORA — Railway + PostgreSQL setup

## 1) Add PostgreSQL in Railway
Open the same Railway project that contains the COLORA service.

- Click **+ New** on the project canvas.
- Choose **Database → PostgreSQL**.
- Wait until the Postgres service shows as deployed.

## 2) Link DATABASE_URL to the COLORA service
Open the **COLORA-** service → **Variables**.

Add a **Reference Variable**:

- Name: `DATABASE_URL`
- Value: `${{Postgres.DATABASE_URL}}`

If your database service has a different name, choose its `DATABASE_URL` from Railway's autocomplete instead of typing the service name manually.

## 3) Keep these server secrets
In the COLORA service → Variables, set:

- `COLORA_ADMIN_KEY` = a strong internal admin key
- `COLORA_SIGNING_SECRET` = a long random secret

Do not put either secret in GitHub or in frontend code.

## 4) PUBLIC_BASE_URL
The updated server automatically prefers Railway's public domain and no longer creates `localhost` QR links in Railway.

You may still set:

`PUBLIC_BASE_URL=https://colora-production.up.railway.app`

but it is optional on Railway after this update.

## 5) Redeploy and verify
After adding `DATABASE_URL`, Railway should redeploy the service.

Open:

`https://YOUR-DOMAIN/health`

Expected result contains:

`"database":"postgresql"`

The admin page also displays **PostgreSQL connected** above the QR preview.

## Why the old QR did not scan correctly
The old page generated a QR containing a local development URL such as:

`http://localhost:8080/p/P-XXXXXX`

A phone scanning that QR tries to open its own localhost, not the Railway server. The updated server derives the real public Railway URL automatically.

## QR safe-scan changes
The updated QR preview uses:

- standard square modules;
- standard finder patterns;
- a larger white quiet zone;
- Error Correction H;
- a smaller center logo;
- fixed responsive preview sizing;
- a **Test link** button.

These changes favor reliable scanning over decorative styling.
