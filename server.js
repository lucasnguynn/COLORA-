const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { Pool } = require('pg');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_KEY = process.env.COLORA_ADMIN_KEY || 'change-me-in-production';
const SIGNING_SECRET = process.env.COLORA_SIGNING_SECRET || 'dev-signing-secret-change-me';
const SESSION_SECRET = process.env.COLORA_SESSION_SECRET || SIGNING_SECRET;
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'products.json');

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf8');

const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require'
    ? { rejectUnauthorized: false }
    : undefined
}) : null;

const VALID_ROLES = new Set(['admin', 'sales', 'cskh', 'production', 'viewer']);
const ROLE_LABELS = { admin: 'Admin', sales: 'Sales', cskh: 'CSKH', production: 'Production', viewer: 'Viewer' };

function publicBase(req) {
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (railwayDomain) return `https://${railwayDomain.replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
  if (configured && !(process.env.RAILWAY_ENVIRONMENT && configuredIsLocal)) return configured;
  let proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  if (process.env.RAILWAY_ENVIRONMENT || /\.up\.railway\.app$/i.test(host)) proto = 'https';
  return `${proto}://${host}`.replace(/\/$/, '');
}

function json(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(payload));
}
function text(res, status, body, contentType = 'text/plain; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': contentType, ...headers });
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}
function randomId(bytes = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = crypto.randomBytes(bytes);
  return Array.from(buf, b => alphabet[b % alphabet.length]).join('');
}
function serialFromSku(sku = 'ITEM') {
  const safe = String(sku || 'ITEM').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16);
  return `COL-${safe || 'ITEM'}-${randomId(4)}`;
}
function authCode() { return randomId(9); }
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function immutablePayload(r) {
  return [r.id, r.serial, r.authCode, r.sku || '', r.productName || '', r.material || '', r.gemstone || '', r.issuedAt || ''].join('|');
}
function signRecord(r) { return crypto.createHmac('sha256', SIGNING_SECRET).update(immutablePayload(r)).digest('hex'); }
function verifySignature(r) {
  try {
    if (!r.signature) return false;
    const a = Buffer.from(r.signature, 'hex');
    const b = Buffer.from(signRecord(r), 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}
function clientIp(req) {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || req.socket.remoteAddress || 'unknown';
}
function privateScanFingerprint(ip) { return crypto.createHmac('sha256', SIGNING_SECRET).update(ip).digest('hex').slice(0, 16); }
function loadJsonDb() { try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; } }
function saveJsonDb(records) { fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), 'utf8'); }

// --- Password + session auth -------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [kind, salt, hash] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !hash) return false;
    const candidate = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > -1) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  return out;
}
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySessionToken(token) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if (!safeEqual(sig, expected)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > Number(payload.exp)) return null;
    return payload;
  } catch { return null; }
}
function sessionCookie(req, token) {
  const secure = publicBase(req).startsWith('https://');
  return `colora_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure ? '; Secure' : ''}`;
}
function clearSessionCookie(req) {
  const secure = publicBase(req).startsWith('https://');
  return `colora_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}
function makeSessionForUser(user) {
  return signSession({ type: 'staff', uid: Number(user.id), exp: Date.now() + 12 * 60 * 60 * 1000 });
}
function makeEmergencySession() {
  return signSession({ type: 'emergency', role: 'admin', exp: Date.now() + 2 * 60 * 60 * 1000 });
}
async function currentUser(req) {
  const token = parseCookies(req).colora_session;
  const session = verifySessionToken(token);
  if (!session) return null;
  if (session.type === 'emergency') {
    return { id: 0, email: 'emergency-admin', name: 'Emergency Admin', role: 'admin', active: true, emergency: true };
  }
  if (!pool || !session.uid) return null;
  const { rows } = await pool.query('SELECT id,email,name,role,active,created_at,updated_at FROM staff_users WHERE id=$1', [session.uid]);
  const user = rows[0];
  if (!user || !user.active) return null;
  return { ...user, id: Number(user.id), emergency: false };
}
async function requireAuth(req, res, roles = null) {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Authentication required' });
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    json(res, 403, { error: 'You do not have permission for this action' });
    return null;
  }
  return user;
}

function publicStaff(user) {
  return { id: Number(user.id), email: user.email, name: user.name, role: user.role, roleLabel: ROLE_LABELS[user.role] || user.role, active: Boolean(user.active), emergency: Boolean(user.emergency) };
}

// --- PostgreSQL --------------------------------------------------------------
function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id, serial: row.serial, authCode: row.auth_code, productName: row.product_name,
    collection: row.collection || '', sku: row.sku || '', material: row.material || '', gemstone: row.gemstone || '',
    gemstoneOrigin: row.gemstone_origin || '', size: row.size || '', issuedAt: row.issued_at ? String(row.issued_at).slice(0, 10) : '',
    story: row.story || '', productUrl: row.product_url || '', careUrl: row.care_url || '',
    warrantyStatus: row.warranty_status || 'active', warrantyStart: row.warranty_start ? String(row.warranty_start).slice(0, 10) : '',
    warrantyEnd: row.warranty_end ? String(row.warranty_end).slice(0, 10) : '', warrantyNotes: row.warranty_notes || '',
    authStatus: row.auth_status || 'authentic', customer: row.customer || {}, crm: row.crm || {}, signature: row.signature || '',
    scanCount: Number(row.scan_count || 0), lastScanAt: row.last_scan_at || null, createdAt: row.created_at || null, updatedAt: row.updated_at || null
  };
}
async function initPostgres() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, serial TEXT UNIQUE NOT NULL, auth_code TEXT NOT NULL, product_name TEXT NOT NULL,
      collection TEXT DEFAULT '', sku TEXT DEFAULT '', material TEXT DEFAULT '', gemstone TEXT DEFAULT '', gemstone_origin TEXT DEFAULT '',
      size TEXT DEFAULT '', issued_at DATE, story TEXT DEFAULT '', product_url TEXT DEFAULT '', care_url TEXT DEFAULT '',
      warranty_status TEXT DEFAULT 'active', warranty_start DATE, warranty_end DATE, warranty_notes TEXT DEFAULT '',
      auth_status TEXT DEFAULT 'authentic', customer JSONB NOT NULL DEFAULT '{}'::jsonb, crm JSONB NOT NULL DEFAULT '{}'::jsonb,
      signature TEXT NOT NULL, scan_count INTEGER NOT NULL DEFAULT 0, last_scan_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS scan_events (
      id BIGSERIAL PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      at TIMESTAMPTZ NOT NULL DEFAULT NOW(), fp TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_users (
      id BIGSERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY, actor_user_id BIGINT, actor_email TEXT,
      action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_scan_events_product_time ON scan_events(product_id,at DESC);
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_users(email);
    CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(at DESC);
  `);
  const count = Number((await pool.query('SELECT COUNT(*)::int AS count FROM products')).rows[0].count || 0);
  if (count === 0) {
    const legacy = loadJsonDb();
    for (const record of legacy) {
      try { await pgInsert(record); } catch (e) { console.warn('Legacy migration skipped:', record.id, e.message); }
    }
    if (legacy.length) console.log(`Migrated up to ${legacy.length} legacy JSON product(s) into PostgreSQL.`);
  }
}
async function audit(actor, action, entityType, entityId = null, meta = {}) {
  if (!pool) return;
  try {
    await pool.query('INSERT INTO audit_logs(actor_user_id,actor_email,action,entity_type,entity_id,meta) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
      [actor?.id || null, actor?.email || null, action, entityType, entityId, JSON.stringify(meta || {})]);
  } catch (e) { console.warn('Audit log failed:', e.message); }
}
async function pgInsert(record) {
  await pool.query(`INSERT INTO products (
    id,serial,auth_code,product_name,collection,sku,material,gemstone,gemstone_origin,size,issued_at,story,product_url,care_url,
    warranty_status,warranty_start,warranty_end,warranty_notes,auth_status,customer,crm,signature,scan_count,last_scan_at,created_at,updated_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,'')::date,$12,$13,$14,$15,NULLIF($16,'')::date,NULLIF($17,'')::date,$18,$19,$20::jsonb,$21::jsonb,$22,$23,$24,$25,$26)`,
  [record.id,record.serial,record.authCode,record.productName,record.collection||'',record.sku||'',record.material||'',record.gemstone||'',record.gemstoneOrigin||'',record.size||'',record.issuedAt||'',record.story||'',record.productUrl||'',record.careUrl||'',record.warrantyStatus||'active',record.warrantyStart||'',record.warrantyEnd||'',record.warrantyNotes||'',record.authStatus||'authentic',JSON.stringify(record.customer||{}),JSON.stringify(record.crm||{}),record.signature,Number(record.scanCount||0),record.lastScanAt||null,record.createdAt||new Date().toISOString(),record.updatedAt||new Date().toISOString()]);
  if (Array.isArray(record.scanEvents)) {
    for (const e of record.scanEvents.slice(-80)) if (e?.at && e?.fp) await pool.query('INSERT INTO scan_events(product_id,at,fp) VALUES($1,$2,$3)', [record.id,e.at,e.fp]);
  }
}
async function listRecords() {
  if (!pool) return loadJsonDb();
  const { rows } = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
  return rows.map(rowToRecord);
}
async function getRecord(id) {
  if (!pool) return loadJsonDb().find(r => r.id === id) || null;
  const { rows } = await pool.query('SELECT * FROM products WHERE id=$1', [id]);
  return rowToRecord(rows[0]);
}
async function createRecord(record) {
  if (!pool) { const records = loadJsonDb(); records.unshift(record); saveJsonDb(records); return; }
  await pgInsert(record);
}
async function updateRecord(record) {
  record.signature = signRecord(record);
  record.updatedAt = new Date().toISOString();
  if (!pool) {
    const records = loadJsonDb(); const i = records.findIndex(r => r.id === record.id);
    if (i >= 0) records[i] = record; saveJsonDb(records); return;
  }
  await pool.query(`UPDATE products SET product_name=$2,collection=$3,story=$4,product_url=$5,care_url=$6,warranty_status=$7,
    warranty_start=NULLIF($8,'')::date,warranty_end=NULLIF($9,'')::date,warranty_notes=$10,auth_status=$11,customer=$12::jsonb,
    crm=$13::jsonb,signature=$14,updated_at=$15 WHERE id=$1`,
    [record.id,record.productName,record.collection||'',record.story||'',record.productUrl||'',record.careUrl||'',record.warrantyStatus||'active',record.warrantyStart||'',record.warrantyEnd||'',record.warrantyNotes||'',record.authStatus||'authentic',JSON.stringify(record.customer||{}),JSON.stringify(record.crm||{}),record.signature,record.updatedAt]);
}
async function recordScan(id, req) {
  const at = new Date().toISOString();
  const fp = privateScanFingerprint(clientIp(req));
  if (!pool) {
    const records = loadJsonDb(); const i = records.findIndex(r => r.id === id); if (i < 0) return;
    records[i].scanCount = (records[i].scanCount || 0) + 1; records[i].lastScanAt = at;
    records[i].scanEvents = [...(records[i].scanEvents || []), { at, fp }].slice(-80); saveJsonDb(records); return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE products SET scan_count=scan_count+1,last_scan_at=$2 WHERE id=$1', [id, at]);
    await client.query('INSERT INTO scan_events(product_id,at,fp) VALUES($1,$2,$3)', [id, at, fp]);
    await client.query('COMMIT');
  } catch (e) { try { await client.query('ROLLBACK'); } catch {} throw e; } finally { client.release(); }
}
async function recentStats(id, record) {
  if (!pool) {
    const now = Date.now(); const recent = (record.scanEvents || []).filter(x => now - new Date(x.at).getTime() <= 86400000);
    return { count: recent.length, unique: new Set(recent.map(x => x.fp)).size };
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count,COUNT(DISTINCT fp)::int AS unique FROM scan_events WHERE product_id=$1 AND at>NOW()-INTERVAL '24 hours'`, [id]);
  return { count: Number(rows[0].count || 0), unique: Number(rows[0].unique || 0) };
}
async function publicView(record, req) {
  const stats = await recentStats(record.id, record);
  const anomaly = stats.count >= 20 || stats.unique >= 6;
  return {
    id:record.id, serial:record.serial, productName:record.productName, collection:record.collection, sku:record.sku,
    material:record.material, gemstone:record.gemstone, gemstoneOrigin:record.gemstoneOrigin, size:record.size, issuedAt:record.issuedAt,
    story:record.story, careUrl:record.careUrl, productUrl:record.productUrl, passportUrl:`${publicBase(req)}/p/${record.id}`,
    warranty:{ status:record.warrantyStatus||'active', start:record.warrantyStart||'', end:record.warrantyEnd||'', notes:record.warrantyNotes||'' },
    authenticity:{ status:record.authStatus||'authentic', signatureValid:verifySignature(record), anomaly, scanCount:record.scanCount||0, lastScanAt:record.lastScanAt||null }
  };
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.json':'application/json; charset=utf-8' };
  try {
    const stat = fs.statSync(filePath); if (!stat.isFile()) return false;
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); fs.createReadStream(filePath).pipe(res); return true;
  } catch { return false; }
}
function csvEscape(v) { const s = String(v ?? ''); return `"${s.replace(/"/g, '""')}"`; }

const server = http.createServer(async (req, res) => {
  try {
    const base = publicBase(req);
    const url = new URL(req.url, base);
    const pathname = decodeURIComponent(url.pathname);

    // Health + public config
    if (req.method === 'GET' && pathname === '/health') {
      if (pool) await pool.query('SELECT 1');
      return json(res, 200, { ok:true, database:pool?'postgresql':'json-fallback', publicBaseUrl:base, railway:Boolean(process.env.RAILWAY_ENVIRONMENT) });
    }
    if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, { publicBaseUrl:base });

    // Authentication
    if (req.method === 'GET' && pathname === '/api/auth/status') {
      let hasStaff = false;
      if (pool) hasStaff = Number((await pool.query('SELECT COUNT(*)::int AS count FROM staff_users')).rows[0].count || 0) > 0;
      return json(res, 200, { database:pool?'postgresql':'json-fallback', hasStaff });
    }
    if (req.method === 'POST' && pathname === '/api/auth/bootstrap') {
      if (!pool) return json(res, 503, { error:'PostgreSQL is required before creating staff accounts.' });
      const input = await parseBody(req);
      const count = Number((await pool.query('SELECT COUNT(*)::int AS count FROM staff_users')).rows[0].count || 0);
      if (count > 0) return json(res, 409, { error:'Initial admin already exists.' });
      if (!safeEqual(input.setupKey, ADMIN_KEY)) return json(res, 403, { error:'Setup key is incorrect.' });
      const email = normalizeEmail(input.email); const name = String(input.name || '').trim(); const password = String(input.password || '');
      if (!email.includes('@') || !name || password.length < 8) return json(res, 400, { error:'Enter a valid name/email and a password of at least 8 characters.' });
      const { rows } = await pool.query('INSERT INTO staff_users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role,active', [email,name,hashPassword(password),'admin']);
      const user = rows[0];
      await audit(user, 'bootstrap_admin', 'staff_user', String(user.id));
      const token = makeSessionForUser(user);
      return json(res, 201, { user:publicStaff(user) }, { 'Set-Cookie':sessionCookie(req, token) });
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') {
      if (!pool) return json(res, 503, { error:'PostgreSQL is not connected. Use emergency Admin Key login or connect PostgreSQL.' });
      const input = await parseBody(req); const email = normalizeEmail(input.email); const password = String(input.password || '');
      const { rows } = await pool.query('SELECT * FROM staff_users WHERE email=$1', [email]); const user = rows[0];
      if (!user || !user.active || !verifyPassword(password, user.password_hash)) return json(res, 401, { error:'Email hoặc mật khẩu không đúng.' });
      await audit(user, 'login', 'auth', null);
      return json(res, 200, { user:publicStaff(user) }, { 'Set-Cookie':sessionCookie(req, makeSessionForUser(user)) });
    }
    if (req.method === 'POST' && pathname === '/api/auth/emergency') {
      const input = await parseBody(req);
      if (!safeEqual(input.adminKey, ADMIN_KEY)) return json(res, 401, { error:'Admin Key không đúng.' });
      return json(res, 200, { user:{ id:0,email:'emergency-admin',name:'Emergency Admin',role:'admin',roleLabel:'Admin',active:true,emergency:true } }, { 'Set-Cookie':sessionCookie(req, makeEmergencySession()) });
    }
    if (req.method === 'GET' && pathname === '/api/auth/me') {
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error:'Not signed in' });
      return json(res, 200, { user:publicStaff(user), database:pool?'postgresql':'json-fallback' });
    }
    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const user = await currentUser(req); if (user) await audit(user, 'logout', 'auth', null);
      return json(res, 200, { ok:true }, { 'Set-Cookie':clearSessionCookie(req) });
    }

    // Public product passport
    const pMatch = pathname.match(/^\/p\/([A-Z0-9_-]+)$/i);
    if (req.method === 'GET' && pMatch) {
      const record = await getRecord(pMatch[1]); if (!record) return text(res, 404, 'COLORA Product Passport not found.');
      await recordScan(record.id, req);
      res.writeHead(302, { Location:`/passport.html?id=${encodeURIComponent(record.id)}` }); return res.end();
    }
    const passportMatch = pathname.match(/^\/api\/passport\/([A-Z0-9_-]+)$/i);
    if (req.method === 'GET' && passportMatch) {
      const record = await getRecord(passportMatch[1]); if (!record) return json(res, 404, { error:'Passport not found' });
      return json(res, 200, await publicView(record, req));
    }

    // Staff management — Admin only
    if (req.method === 'GET' && pathname === '/api/admin/staff') {
      const actor = await requireAuth(req, res, ['admin']); if (!actor) return;
      if (!pool) return json(res, 503, { error:'PostgreSQL is required for staff management.' });
      const { rows } = await pool.query('SELECT id,email,name,role,active,created_at,updated_at FROM staff_users ORDER BY created_at ASC');
      return json(res, 200, rows.map(publicStaff));
    }
    if (req.method === 'POST' && pathname === '/api/admin/staff') {
      const actor = await requireAuth(req, res, ['admin']); if (!actor) return;
      if (!pool) return json(res, 503, { error:'PostgreSQL is required for staff management.' });
      const input = await parseBody(req); const email = normalizeEmail(input.email); const name = String(input.name||'').trim(); const password = String(input.password||''); const role = String(input.role||'viewer');
      if (!email.includes('@') || !name || password.length < 8 || !VALID_ROLES.has(role)) return json(res, 400, { error:'Invalid staff information.' });
      try {
        const { rows } = await pool.query('INSERT INTO staff_users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,name,role,active,created_at,updated_at', [email,name,hashPassword(password),role]);
        await audit(actor, 'create_staff', 'staff_user', String(rows[0].id), { email, role });
        return json(res, 201, publicStaff(rows[0]));
      } catch (e) {
        if (String(e.code) === '23505') return json(res, 409, { error:'Email này đã có tài khoản.' });
        throw e;
      }
    }
    const staffPatch = pathname.match(/^\/api\/admin\/staff\/(\d+)$/);
    if (req.method === 'PATCH' && staffPatch) {
      const actor = await requireAuth(req, res, ['admin']); if (!actor) return;
      if (!pool) return json(res, 503, { error:'PostgreSQL is required for staff management.' });
      const targetId = Number(staffPatch[1]); const input = await parseBody(req);
      const { rows } = await pool.query('SELECT * FROM staff_users WHERE id=$1', [targetId]); const target = rows[0];
      if (!target) return json(res, 404, { error:'Staff user not found' });
      const name = 'name' in input ? String(input.name||'').trim() : target.name;
      const role = 'role' in input ? String(input.role) : target.role;
      const active = 'active' in input ? Boolean(input.active) : target.active;
      if (!name || !VALID_ROLES.has(role)) return json(res, 400, { error:'Invalid name or role.' });
      if (actor.id === targetId && (!active || role !== 'admin')) return json(res, 400, { error:'Bạn không thể tự vô hiệu hóa hoặc hạ quyền Admin của chính mình.' });
      let passwordHash = target.password_hash;
      if (input.password) {
        if (String(input.password).length < 8) return json(res, 400, { error:'Password must be at least 8 characters.' });
        passwordHash = hashPassword(input.password);
      }
      const updated = (await pool.query('UPDATE staff_users SET name=$2,role=$3,active=$4,password_hash=$5,updated_at=NOW() WHERE id=$1 RETURNING id,email,name,role,active,created_at,updated_at', [targetId,name,role,active,passwordHash])).rows[0];
      await audit(actor, 'update_staff', 'staff_user', String(targetId), { role, active });
      return json(res, 200, publicStaff(updated));
    }

    // Product admin APIs — session protected
    if (req.method === 'GET' && pathname === '/api/admin/products') {
      const actor = await requireAuth(req, res, ['admin','sales','cskh','production','viewer']); if (!actor) return;
      return json(res, 200, await listRecords());
    }
    if (req.method === 'POST' && pathname === '/api/admin/products') {
      const actor = await requireAuth(req, res, ['admin','sales','production']); if (!actor) return;
      const input = await parseBody(req); const now = new Date().toISOString();
      const record = {
        id:`P-${randomId(6)}`, serial:input.serial||serialFromSku(input.sku), authCode:authCode(), productName:input.productName||'Untitled COLORA Piece',
        collection:input.collection||'', sku:input.sku||'', material:input.material||'925 Sterling Silver', gemstone:input.gemstone||'', gemstoneOrigin:input.gemstoneOrigin||'',
        size:input.size||'', issuedAt:input.issuedAt||now.slice(0,10), story:input.story||'', productUrl:input.productUrl||'', careUrl:input.careUrl||'',
        warrantyStatus:input.warrantyStatus||'active', warrantyStart:input.warrantyStart||now.slice(0,10), warrantyEnd:input.warrantyEnd||'', warrantyNotes:input.warrantyNotes||'',
        authStatus:'authentic', customer:{name:input.customerName||'',email:input.customerEmail||'',phone:input.customerPhone||'',consent:Boolean(input.customerConsent)},
        crm:{tags:Array.isArray(input.crmTags)?input.crmTags:[],notes:input.crmNotes||''}, scanCount:0, scanEvents:[], createdAt:now, updatedAt:now
      };
      record.signature = signRecord(record); await createRecord(record); await audit(actor, 'create_product', 'product', record.id, { serial:record.serial, sku:record.sku });
      return json(res, 201, { ...record, passportUrl:`${base}/p/${record.id}` });
    }
    const updateMatch = pathname.match(/^\/api\/admin\/products\/([A-Z0-9_-]+)$/i);
    if (req.method === 'PATCH' && updateMatch) {
      const actor = await requireAuth(req, res, ['admin','sales','cskh','production']); if (!actor) return;
      const input = await parseBody(req); const record = await getRecord(updateMatch[1]); if (!record) return json(res, 404, { error:'Product not found' });
      const mutable = ['productName','collection','story','productUrl','careUrl','warrantyStatus','warrantyStart','warrantyEnd','warrantyNotes'];
      for (const k of mutable) if (k in input) record[k] = input[k];
      if (actor.role === 'admin' && 'authStatus' in input) record.authStatus = input.authStatus;
      if (input.customer && typeof input.customer === 'object') record.customer = { ...record.customer, ...input.customer };
      if (input.crm && typeof input.crm === 'object') record.crm = { ...record.crm, ...input.crm };
      await updateRecord(record); await audit(actor, 'update_product', 'product', record.id);
      return json(res, 200, { ...record, passportUrl:`${base}/p/${record.id}` });
    }
    if (req.method === 'GET' && pathname === '/api/admin/export.csv') {
      const actor = await requireAuth(req, res, ['admin','sales','cskh']); if (!actor) return;
      const rows = await listRecords();
      const headers = ['id','serial','productName','collection','sku','material','gemstone','warrantyStatus','warrantyStart','warrantyEnd','authStatus','scanCount','customerName','customerEmail','customerPhone','customerConsent','crmTags','crmNotes'];
      const lines = [headers.join(',')];
      for (const r of rows) lines.push([r.id,r.serial,r.productName,r.collection,r.sku,r.material,r.gemstone,r.warrantyStatus,r.warrantyStart,r.warrantyEnd,r.authStatus,r.scanCount,r.customer?.name,r.customer?.email,r.customer?.phone,r.customer?.consent,(r.crm?.tags||[]).join('|'),r.crm?.notes].map(csvEscape).join(','));
      res.writeHead(200, { 'Content-Type':'text/csv; charset=utf-8', 'Content-Disposition':'attachment; filename="colora-product-passports.csv"' }); return res.end(lines.join('\n'));
    }

    // Static files
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(PUBLIC_DIR, safePath);
    if (!filePath.startsWith(PUBLIC_DIR)) return text(res, 403, 'Forbidden');
    if (serveFile(res, filePath)) return;
    text(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error:'Server error', detail:process.env.NODE_ENV === 'production' ? undefined : e.message });
  }
});

initPostgres().then(() => {
  server.listen(PORT, HOST, () => console.log(`COLORA Product Identity Platform running on ${PORT} (${pool ? 'PostgreSQL' : 'JSON fallback'})`));
}).catch(err => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
