import express from "express";
import cors from "cors";
import Database from "better-sqlite3";

const app = express();
app.use(cors());
app.use(express.json());

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Database("./jewelry.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code  TEXT    NOT NULL UNIQUE,  -- e.g. "13042026.3199"
    iso_date      TEXT    NOT NULL UNIQUE,  -- e.g. "2026-04-13"
    sequence_num  INTEGER NOT NULL,         -- e.g. 3199
    created_at    TEXT    DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name  TEXT    NOT NULL,
    design       TEXT    NOT NULL,
    code         TEXT    NOT NULL,
    weight       REAL    NOT NULL,
    creator      TEXT    NOT NULL,
    is_drawn     INTEGER DEFAULT 0,
    is_laser     INTEGER DEFAULT 0,
    order_date   TEXT    DEFAULT (date('now','localtime')),
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert ISO date "2026-04-13" → "13042026" */
function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

/** Get or create the session for a given ISO date */
function getOrCreateSession(isoDate) {
  let session = db
    .prepare("SELECT * FROM sessions WHERE iso_date = ?")
    .get(isoDate);
  if (!session) {
    // Next sequence = last sequence + 1, starting at 3199
    const last = db
      .prepare("SELECT sequence_num FROM sessions ORDER BY id DESC LIMIT 1")
      .get();
    const nextSeq = last ? last.sequence_num + 1 : 3199;
    const code = `${isoToDDMMYYYY(isoDate)}.${nextSeq}`;
    db.prepare(
      "INSERT INTO sessions (session_code, iso_date, sequence_num) VALUES (?, ?, ?)",
    ).run(code, isoDate, nextSeq);
    session = db
      .prepare("SELECT * FROM sessions WHERE iso_date = ?")
      .get(isoDate);
  }
  return session;
}

/** Delete sessions and their orders older than 30 days */
function pruneOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const old = db
    .prepare("SELECT iso_date FROM sessions WHERE iso_date < ?")
    .all(cutoffStr);
  for (const { iso_date } of old) {
    db.prepare("DELETE FROM orders WHERE order_date = ?").run(iso_date);
  }
  db.prepare("DELETE FROM sessions WHERE iso_date < ?").run(cutoffStr);
}

// Run pruning on startup
pruneOldData();

// ─── Sessions ─────────────────────────────────────────────────────────────────

/** GET /api/sessions/today — get or create today's session */
app.get("/api/sessions/today", (_req, res) => {
  try {
    const today = new Date().toLocaleDateString("sv-SE"); // "2026-04-13" format
    const session = getOrCreateSession(today);
    res.json({ success: true, data: session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الجلسة" });
  }
});

/** GET /api/sessions — list last 30 sessions with order counts */
app.get("/api/sessions", (_req, res) => {
  try {
    const sessions = db
      .prepare(
        `
      SELECT s.*,
             COUNT(o.id)   AS order_count,
             COALESCE(SUM(o.weight), 0) AS total_weight
      FROM   sessions s
      LEFT JOIN orders o ON o.order_date = s.iso_date
      GROUP BY s.id
      ORDER BY s.id DESC
      LIMIT 30
    `,
      )
      .all();
    res.json({ success: true, data: sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب السجلات" });
  }
});

// ─── Orders ───────────────────────────────────────────────────────────────────

/** POST /api/orders */
app.post("/api/orders", (req, res) => {
  const { clientName, designName, code, weight, creator } = req.body;
  if (!clientName)
    return res
      .status(400)
      .json({ success: false, message: "اسم العميل مطلوب ❌" });

  try {
    // Ensure today's session exists
    const today = new Date().toLocaleDateString("sv-SE");
    getOrCreateSession(today);

    const result = db
      .prepare(
        `INSERT INTO orders (client_name, design, code, weight, creator)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        clientName.trim(),
        (designName || "").trim(),
        (code || "").trim(),
        weight ? parseFloat(weight) : 0,
        (creator || "مارو").trim(),
      );

    res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      message: "تم حفظ الطلب ✅",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحفظ ❌" });
  }
});

/** GET /api/orders?date=2026-04-13 */
app.get("/api/orders", (req, res) => {
  try {
    const targetDate = req.query.date || new Date().toLocaleDateString("sv-SE");
    const orders = db
      .prepare(
        `SELECT * FROM orders WHERE order_date = ?
       ORDER BY client_name ASC, created_at DESC`,
      )
      .all(targetDate);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "فشل جلب البيانات ❌" });
  }
});

/** PATCH /api/orders/:id/status */
app.patch("/api/orders/:id/status", (req, res) => {
  const { id } = req.params;
  const { is_drawn, is_laser } = req.body;
  const updates = Object.entries({ is_drawn, is_laser }).filter(
    ([, v]) => v !== undefined,
  );
  if (!updates.length)
    return res
      .status(400)
      .json({ success: false, message: "لا يوجد حقل للتحديث" });

  try {
    for (const [field, value] of updates)
      db.prepare(`UPDATE orders SET ${field} = ? WHERE id = ?`).run(value, id);
    const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التحديث ❌" });
  }
});

/** DELETE /api/orders/:id */
app.delete("/api/orders/:id", (req, res) => {
  const { id } = req.params;
  try {
    const exists = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
    if (!exists)
      return res
        .status(404)
        .json({ success: false, message: "الطلب غير موجود" });
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
    res.json({ success: true, message: "تم الحذف ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف ❌" });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🟢 Backend: http://localhost:${PORT}`);
});
