
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_KEY = process.env.COLORA_ADMIN_KEY || "change-me-in-production";
const SIGNING_SECRET = process.env.COLORA_SIGNING_SECRET || "dev-signing-secret-change-me";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "products.json");

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, "[]", "utf8");

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return []; }
}
function saveDb(records) {
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2), "utf8");
}
function json(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}
function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(body);
}
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}
function randomId(bytes = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = crypto.randomBytes(bytes);
  return Array.from(buf, b => alphabet[b % alphabet.length]).join("");
}
function serialFromSku(sku = "ITEM") {
  const safe = String(sku || "ITEM").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16);
  return `COL-${safe || "ITEM"}-${randomId(4)}`;
}
function authCode() {
  return randomId(9);
}
function immutablePayload(record) {
  return [
    record.id,
    record.serial,
    record.authCode,
    record.sku || "",
    record.productName || "",
    record.material || "",
    record.gemstone || "",
    record.issuedAt || ""
  ].join("|");
}
function signRecord(record) {
  return crypto.createHmac("sha256", SIGNING_SECRET).update(immutablePayload(record)).digest("hex");
}
function verifySignature(record) {
  if (!record.signature) return false;
  const a = Buffer.from(record.signature, "hex");
  const b = Buffer.from(signRecord(record), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function adminAuthorized(req) {
  return req.headers["x-admin-key"] === ADMIN_KEY;
}
function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}
function privateScanFingerprint(ip) {
  return crypto.createHmac("sha256", SIGNING_SECRET).update(ip).digest("hex").slice(0, 16);
}
function publicView(record) {
  const now = Date.now();
  const recent = (record.scanEvents || []).filter(x => now - new Date(x.at).getTime() <= 24 * 60 * 60 * 1000);
  const unique = new Set(recent.map(x => x.fp)).size;
  const anomaly = recent.length >= 20 || unique >= 6;
  const sigOk = verifySignature(record);
  const status = record.authStatus || "authentic";

  return {
    id: record.id,
    serial: record.serial,
    productName: record.productName,
    collection: record.collection,
    sku: record.sku,
    material: record.material,
    gemstone: record.gemstone,
    gemstoneOrigin: record.gemstoneOrigin,
    size: record.size,
    issuedAt: record.issuedAt,
    story: record.story,
    careUrl: record.careUrl,
    productUrl: record.productUrl,
    passportUrl: `${PUBLIC_BASE_URL}/p/${record.id}`,
    warranty: {
      status: record.warrantyStatus || "active",
      start: record.warrantyStart || "",
      end: record.warrantyEnd || "",
      notes: record.warrantyNotes || ""
    },
    authenticity: {
      status,
      signatureValid: sigOk,
      anomaly,
      scanCount: record.scanCount || 0,
      lastScanAt: record.lastScanAt || null
    }
  };
}
function recordScan(record, req) {
  const at = new Date().toISOString();
  const fp = privateScanFingerprint(clientIp(req));
  record.scanCount = (record.scanCount || 0) + 1;
  record.lastScanAt = at;
  record.scanEvents = [...(record.scanEvents || []), { at, fp }].slice(-80);
}
function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".json": "application/json; charset=utf-8"
  };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
    return true;
  } catch { return false; }
}
function csvEscape(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_BASE_URL);
  const pathname = decodeURIComponent(url.pathname);

  // Public stable permalink used by both QR and NFC.
  const pMatch = pathname.match(/^\/p\/([A-Z0-9_-]+)$/i);
  if (req.method === "GET" && pMatch) {
    const records = loadDb();
    const record = records.find(r => r.id === pMatch[1]);
    if (!record) return text(res, 404, "COLORA Product Passport not found.");
    recordScan(record, req);
    saveDb(records);
    res.writeHead(302, { Location: `/passport.html?id=${encodeURIComponent(record.id)}` });
    return res.end();
  }

  // Public passport API.
  const passportMatch = pathname.match(/^\/api\/passport\/([A-Z0-9_-]+)$/i);
  if (req.method === "GET" && passportMatch) {
    const records = loadDb();
    const record = records.find(r => r.id === passportMatch[1]);
    if (!record) return json(res, 404, { error: "Passport not found" });
    return json(res, 200, publicView(record));
  }

  // Admin endpoints
  if (pathname.startsWith("/api/admin/") && !adminAuthorized(req)) {
    return json(res, 401, { error: "Unauthorized. Set X-Admin-Key." });
  }

  if (req.method === "GET" && pathname === "/api/admin/products") {
    return json(res, 200, loadDb());
  }

  if (req.method === "POST" && pathname === "/api/admin/products") {
    try {
      const input = await parseBody(req);
      const records = loadDb();
      const id = `P-${randomId(6)}`;
      const record = {
        id,
        serial: input.serial || serialFromSku(input.sku),
        authCode: authCode(),
        productName: input.productName || "Untitled COLORA Piece",
        collection: input.collection || "",
        sku: input.sku || "",
        material: input.material || "925 Sterling Silver",
        gemstone: input.gemstone || "",
        gemstoneOrigin: input.gemstoneOrigin || "",
        size: input.size || "",
        issuedAt: input.issuedAt || new Date().toISOString().slice(0, 10),
        story: input.story || "",
        productUrl: input.productUrl || "",
        careUrl: input.careUrl || "",
        warrantyStatus: input.warrantyStatus || "active",
        warrantyStart: input.warrantyStart || new Date().toISOString().slice(0, 10),
        warrantyEnd: input.warrantyEnd || "",
        warrantyNotes: input.warrantyNotes || "",
        authStatus: "authentic",
        customer: {
          name: input.customerName || "",
          email: input.customerEmail || "",
          phone: input.customerPhone || "",
          consent: Boolean(input.customerConsent)
        },
        crm: {
          tags: Array.isArray(input.crmTags) ? input.crmTags : [],
          notes: input.crmNotes || ""
        },
        scanCount: 0,
        scanEvents: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      record.signature = signRecord(record);
      records.unshift(record);
      saveDb(records);
      return json(res, 201, { ...record, passportUrl: `${PUBLIC_BASE_URL}/p/${record.id}` });
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }
  }

  const updateMatch = pathname.match(/^\/api\/admin\/products\/([A-Z0-9_-]+)$/i);
  if (req.method === "PATCH" && updateMatch) {
    try {
      const input = await parseBody(req);
      const records = loadDb();
      const i = records.findIndex(r => r.id === updateMatch[1]);
      if (i < 0) return json(res, 404, { error: "Product not found" });
      const r = records[i];

      // Mutable operational fields; identity fields stay immutable by default.
      const mutable = [
        "productName", "collection", "story", "productUrl", "careUrl",
        "warrantyStatus", "warrantyStart", "warrantyEnd", "warrantyNotes",
        "authStatus"
      ];
      for (const k of mutable) if (k in input) r[k] = input[k];

      if ("customer" in input && input.customer && typeof input.customer === "object") {
        r.customer = { ...r.customer, ...input.customer };
      }
      if ("crm" in input && input.crm && typeof input.crm === "object") {
        r.crm = { ...r.crm, ...input.crm };
      }
      r.updatedAt = new Date().toISOString();
      records[i] = r;
      saveDb(records);
      return json(res, 200, { ...r, passportUrl: `${PUBLIC_BASE_URL}/p/${r.id}` });
    } catch {
      return json(res, 400, { error: "Invalid JSON body" });
    }
  }

  if (req.method === "GET" && pathname === "/api/admin/export.csv") {
    const rows = loadDb();
    const headers = [
      "id","serial","productName","collection","sku","material","gemstone",
      "warrantyStatus","warrantyStart","warrantyEnd","authStatus","scanCount",
      "customerName","customerEmail","customerPhone","customerConsent","crmTags","crmNotes"
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const vals = [
        r.id,r.serial,r.productName,r.collection,r.sku,r.material,r.gemstone,
        r.warrantyStatus,r.warrantyStart,r.warrantyEnd,r.authStatus,r.scanCount,
        r.customer?.name,r.customer?.email,r.customer?.phone,r.customer?.consent,
        (r.crm?.tags || []).join("|"),r.crm?.notes
      ].map(csvEscape);
      lines.push(vals.join(","));
    }
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="colora-product-passports.csv"'
    });
    return res.end(lines.join("\n"));
  }

  if (req.method === "GET" && pathname === "/api/config") {
    return json(res, 200, { publicBaseUrl: PUBLIC_BASE_URL });
  }

  // Static files.
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return text(res, 403, "Forbidden");
  if (serveFile(res, filePath)) return;
  text(res, 404, "Not found");
});

server.listen(PORT, HOST, () => {
  console.log(`COLORA Product Identity Platform running at ${PUBLIC_BASE_URL}`);
  console.log(`Admin key: ${ADMIN_KEY === "change-me-in-production" ? "DEV DEFAULT — CHANGE IT" : "configured"}`);
});
