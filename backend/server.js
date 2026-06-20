import express from "express";
import cors from "cors";
import Database from "better-sqlite3";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Database ─────────────────────────────────────────────────────────────────
const db = new Database("./jewelry.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_code  TEXT    NOT NULL UNIQUE,
    iso_date      TEXT    NOT NULL UNIQUE,
    sequence_num  INTEGER NOT NULL,
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
    is_weighed   INTEGER DEFAULT 0,
    is_cut_sent  INTEGER DEFAULT 0,
    is_archived  INTEGER DEFAULT 0,
    order_date   TEXT    DEFAULT (date('now','localtime')),
    created_at   TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS archive (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    search_key    TEXT    NOT NULL,
    storage_file  TEXT    NOT NULL,
    order_date    TEXT,
    updated_at    TEXT    DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_key_file ON archive(search_key, storage_file);
`);

// ─── Migrate existing DB ───────────────────────────────────────────────────────
const existingCols = db.prepare("PRAGMA table_info(orders)").all().map((c) => c.name);
if (!existingCols.includes("is_weighed"))
  db.prepare("ALTER TABLE orders ADD COLUMN is_weighed INTEGER DEFAULT 0").run();
if (!existingCols.includes("is_cut_sent"))
  db.prepare("ALTER TABLE orders ADD COLUMN is_cut_sent INTEGER DEFAULT 0").run();
if (!existingCols.includes("is_archived"))
  db.prepare("ALTER TABLE orders ADD COLUMN is_archived INTEGER DEFAULT 0").run();

// ترقية جدول الأرشيف: إضافة عمود التاريخ + التحوّل من فهرس فريد على (search_key)
// وحده إلى فهرس مركّب (search_key + storage_file) حتى تُحفظ كل حالة في ملف منفصل
// بدلاً من استبدال الأحدث فقط.
const archiveCols = db.prepare("PRAGMA table_info(archive)").all().map((c) => c.name);
if (!archiveCols.includes("order_date"))
  db.prepare("ALTER TABLE archive ADD COLUMN order_date TEXT").run();
db.prepare("DROP INDEX IF EXISTS idx_archive_search_key").run();
db.prepare(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_archive_key_file ON archive(search_key, storage_file)"
).run();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

function getOrCreateSession(isoDate) {
  let session = db.prepare("SELECT * FROM sessions WHERE iso_date = ?").get(isoDate);
  if (!session) {
    const last = db
      .prepare("SELECT sequence_num FROM sessions ORDER BY id DESC LIMIT 1")
      .get();
    const nextSeq = last ? last.sequence_num + 1 : 3199;
    const code = `${isoToDDMMYYYY(isoDate)}.${nextSeq}`;
    db.prepare(
      "INSERT INTO sessions (session_code, iso_date, sequence_num) VALUES (?, ?, ?)"
    ).run(code, isoDate, nextSeq);
    session = db.prepare("SELECT * FROM sessions WHERE iso_date = ?").get(isoDate);
  }
  return session;
}

/**
 * تحديث أرشيف البحث عند كل إضافة/تعديل لطلب.
 * search_key   = التصميم + الكود  (الكود + الرقم)
 * storage_file = كود ملف اليوم (رقم الملف، مثل "17062026.3244")
 * order_date   = تاريخ الطلب (ISO)
 *
 * المفتاح الفريد أصبح (search_key + storage_file): نفس التصميم+الكود يُحفَظ
 * كسجل مستقل في كل ملف/يوم — فيظهر في البحث "كل الحالات" وليس الأحدث فقط.
 */
const upsertArchiveStmt = db.prepare(`
  INSERT INTO archive (search_key, storage_file, order_date, updated_at)
  VALUES (?, ?, ?, datetime('now','localtime'))
  ON CONFLICT(search_key, storage_file) DO UPDATE SET
    order_date = excluded.order_date,
    updated_at = excluded.updated_at
`);

function upsertArchive(design, code, sessionCode, orderDate) {
  const searchKey = `${(design || "").trim()}${(code || "").trim()}`.trim();
  if (!searchKey) return;
  upsertArchiveStmt.run(
    searchKey,
    (sessionCode || "").trim(),
    (orderDate || "").trim()
  );
}

function pruneOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  const old = db.prepare("SELECT iso_date FROM sessions WHERE iso_date < ?").all(cutoffStr);
  for (const { iso_date } of old) {
    db.prepare("DELETE FROM orders WHERE order_date = ?").run(iso_date);
  }
  db.prepare("DELETE FROM sessions WHERE iso_date < ?").run(cutoffStr);
  // ملاحظة: جدول الأرشيف لا يُحذف — يبقى سجلاً دائماً لكل الملفات.
}
pruneOldData();

// ─── مزامنة الأرشيف مع أزرار الأرشفة (عند كل تشغيل — آمنة) ────────────────────
// لكل ملف (جلسة): تُضاف الطلبات المؤرشفة (is_archived=1) إلى الأرشيف، وتُحذف منه
// الطلبات غير المؤرشفة. تمسّ فقط السجلات المشتقّة من الطلبات (نفس رقم الملف الحالي)
// ولا تلمس السجلات المستوردة من Excel القديم.
function syncOrderArchive() {
  const sessions = db.prepare("SELECT iso_date, session_code FROM sessions").all();
  const tx = db.transaction(() => {
    for (const s of sessions) {
      const rows = db
        .prepare("SELECT design, code, is_archived FROM orders WHERE order_date = ?")
        .all(s.iso_date);
      const archivedKeys = new Set();
      const allKeys = new Set();
      for (const o of rows) {
        const k = `${(o.design || "").trim()}${(o.code || "").trim()}`.trim();
        if (!k) continue;
        allKeys.add(k);
        if (o.is_archived) archivedKeys.add(k);
      }
      for (const k of archivedKeys) {
        upsertArchiveStmt.run(k, s.session_code, s.iso_date);
      }
      for (const k of allKeys) {
        if (!archivedKeys.has(k)) {
          db.prepare("DELETE FROM archive WHERE search_key = ? AND storage_file = ?").run(
            k,
            s.session_code
          );
        }
      }
    }
  });
  tx();
}
syncOrderArchive();

// ─── Sessions ─────────────────────────────────────────────────────────────────
app.get("/api/sessions/today", (_req, res) => {
  try {
    const today = new Date().toLocaleDateString("sv-SE");
    const session = getOrCreateSession(today);
    res.json({ success: true, data: session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الجلسة" });
  }
});

app.get("/api/sessions", (_req, res) => {
  try {
    const sessions = db
      .prepare(
        `SELECT s.*,
                COUNT(o.id)                AS order_count,
                COALESCE(SUM(o.weight), 0) AS total_weight
         FROM   sessions s
         LEFT JOIN orders o ON o.order_date = s.iso_date
         GROUP BY s.id
         ORDER BY s.id DESC
         LIMIT 30`
      )
      .all();
    res.json({ success: true, data: sessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب السجلات" });
  }
});

// ─── Orders ───────────────────────────────────────────────────────────────────
app.post("/api/orders", (req, res) => {
  const { clientName, designName, code, weight, creator } = req.body;
  if (!clientName)
    return res.status(400).json({ success: false, message: "اسم العميل مطلوب ❌" });
  try {
    const today = new Date().toLocaleDateString("sv-SE");
    const session = getOrCreateSession(today);
    const result = db
      .prepare(
        `INSERT INTO orders (client_name, design, code, weight, creator)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        clientName.trim(),
        (designName || "").trim(),
        (code || "").trim(),
        weight ? parseFloat(weight) : 0,
        (creator || "مارو").trim()
      );
    // لا تتم الأرشفة تلقائياً — تُضاف فقط عند الضغط على زر الأرشفة في الطلب.
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

app.get("/api/orders", (req, res) => {
  try {
    const targetDate = req.query.date || new Date().toLocaleDateString("sv-SE");
    const orders = db
      .prepare(
        `SELECT * FROM orders WHERE order_date = ?
         ORDER BY created_at ASC`
      )
      .all(targetDate);
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "فشل جلب البيانات ❌" });
  }
});

/** PATCH /api/orders/:id/status — toggle boolean fields */
app.patch("/api/orders/:id/status", (req, res) => {
  const { id } = req.params;
  const ALLOWED = ["is_drawn", "is_laser", "is_weighed", "is_cut_sent"];
  const updates = Object.entries(req.body).filter(
    ([field, value]) => ALLOWED.includes(field) && value !== undefined
  );
  if (!updates.length)
    return res.status(400).json({ success: false, message: "لا يوجد حقل للتحديث" });
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

/** PATCH /api/orders/:id/archive — add/remove this order from the archive */
app.patch("/api/orders/:id/archive", (req, res) => {
  const { id } = req.params;
  const archived = req.body.archived ? 1 : 0;
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order)
    return res.status(404).json({ success: false, message: "الطلب غير موجود" });
  try {
    const session = getOrCreateSession(order.order_date);
    db.prepare("UPDATE orders SET is_archived = ? WHERE id = ?").run(archived, id);

    const key = `${(order.design || "").trim()}${(order.code || "").trim()}`.trim();

    if (archived) {
      // أضِف إلى الأرشيف (الكود+الرقم، رقم الملف، التاريخ)
      upsertArchive(order.design, order.code, session.session_code, order.order_date);
    } else {
      // احذف من الأرشيف — فقط إن لم يَعُد هناك طلب مؤرشف آخر بنفس المفتاح في نفس الملف
      const others = db
        .prepare(
          "SELECT design, code FROM orders WHERE is_archived = 1 AND id != ? AND order_date = ?"
        )
        .all(id, order.order_date);
      const stillNeeded = others.some(
        (o) => `${(o.design || "").trim()}${(o.code || "").trim()}`.trim() === key
      );
      if (key && !stillNeeded) {
        db.prepare("DELETE FROM archive WHERE search_key = ? AND storage_file = ?").run(
          key,
          session.session_code
        );
      }
    }

    const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الأرشفة ❌" });
  }
});

/** PATCH /api/orders/:id/edit — edit order content fields */
app.patch("/api/orders/:id/edit", (req, res) => {
  const { id } = req.params;
  const { design, code, weight, client_name } = req.body;

  const existing = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!existing)
    return res.status(404).json({ success: false, message: "الطلب غير موجود" });

  try {
    db.prepare(
      `UPDATE orders
       SET design = ?, code = ?, weight = ?, client_name = ?
       WHERE id = ?`
    ).run(
      (design || "").trim(),
      (code || "").trim(),
      weight ? parseFloat(weight) : 0,
      (client_name || "").trim(),
      id
    );
    const session = getOrCreateSession(existing.order_date);
    // إن كان الطلب مؤرشفاً، حدّث مدخل الأرشيف: أزِل المفتاح القديم (إن لم يَعُد
    // مطلوباً لطلب مؤرشف آخر في نفس الملف) ثم أضِف المفتاح الجديد.
    if (existing.is_archived === 1) {
      const oldKey = `${(existing.design || "").trim()}${(existing.code || "").trim()}`.trim();
      const others = db
        .prepare(
          "SELECT design, code FROM orders WHERE is_archived = 1 AND id != ? AND order_date = ?"
        )
        .all(id, existing.order_date);
      const stillNeeded = others.some(
        (o) => `${(o.design || "").trim()}${(o.code || "").trim()}`.trim() === oldKey
      );
      if (oldKey && !stillNeeded) {
        db.prepare("DELETE FROM archive WHERE search_key = ? AND storage_file = ?").run(
          oldKey,
          session.session_code
        );
      }
      upsertArchive(design, code, session.session_code, existing.order_date);
    }
    const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التعديل ❌" });
  }
});

app.delete("/api/orders/:id", (req, res) => {
  const { id } = req.params;
  try {
    const exists = db.prepare("SELECT id FROM orders WHERE id = ?").get(id);
    if (!exists)
      return res.status(404).json({ success: false, message: "الطلب غير موجود" });
    db.prepare("DELETE FROM orders WHERE id = ?").run(id);
    res.json({ success: true, message: "تم الحذف ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف ❌" });
  }
});

// ─── Archive Search ─────────────────────────────────────────────────────────
/**
 * GET /api/archive/search?q=...
 * يُرجع دائماً قائمة بكل الحالات المطابقة (وليس الأحدث فقط):
 *  - تطابق تام على search_key  → كل السجلات بنفس المفتاح
 *  - وإلا بحث جزئي (يبدأ بـ ثم يحتوي)
 */
app.get("/api/archive/search", (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ success: true, mode: "empty", data: [] });
  try {
    const exactRows = db
      .prepare(
        `SELECT * FROM archive WHERE search_key = ?
         ORDER BY order_date DESC, updated_at DESC`
      )
      .all(q);

    if (exactRows.length) {
      return res.json({ success: true, mode: "list", data: exactRows });
    }

    const prefixRows = db
      .prepare(
        `SELECT * FROM archive WHERE search_key LIKE ?
         ORDER BY order_date DESC, updated_at DESC LIMIT 50`
      )
      .all(`${q}%`);

    let rows = prefixRows;
    if (rows.length < 50) {
      const containsRows = db
        .prepare(
          `SELECT * FROM archive WHERE search_key LIKE ? AND search_key NOT LIKE ?
           ORDER BY order_date DESC, updated_at DESC LIMIT ?`
        )
        .all(`%${q}%`, `${q}%`, 50 - rows.length);
      rows = [...rows, ...containsRows];
    }

    res.json({ success: true, mode: "list", data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في البحث ❌" });
  }
});

// ─── Full Archive (list all — paginated + searchable, all=1 for export) ──────
/**
 * GET /api/archive/all?q=&limit=&offset=&all=
 * - بدون q     → كل السجلات مرتّبة بالأحدث
 * - مع q       → بحث في الكود+الرقم أو رقم الملف
 * - all=1      → يتجاهل limit/offset ويُرجع كل النتائج (يُستعمَل للتصدير الكامل)
 */
app.get("/api/archive/all", (req, res) => {
  const q = (req.query.q || "").trim();
  const fetchAll = req.query.all === "1";
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    let total, rows;
    if (q) {
      const like = `%${q}%`;
      total = db
        .prepare(
          `SELECT COUNT(*) AS c FROM archive WHERE search_key LIKE ? OR storage_file LIKE ?`
        )
        .get(like, like).c;
      rows = fetchAll
        ? db
            .prepare(
              `SELECT * FROM archive WHERE search_key LIKE ? OR storage_file LIKE ?
               ORDER BY order_date DESC, updated_at DESC`
            )
            .all(like, like)
        : db
            .prepare(
              `SELECT * FROM archive WHERE search_key LIKE ? OR storage_file LIKE ?
               ORDER BY order_date DESC, updated_at DESC LIMIT ? OFFSET ?`
            )
            .all(like, like, limit, offset);
    } else {
      total = db.prepare(`SELECT COUNT(*) AS c FROM archive`).get().c;
      rows = fetchAll
        ? db.prepare(`SELECT * FROM archive ORDER BY order_date DESC, updated_at DESC`).all()
        : db
            .prepare(
              `SELECT * FROM archive ORDER BY order_date DESC, updated_at DESC LIMIT ? OFFSET ?`
            )
            .all(limit, offset);
    }
    res.json({ success: true, total, count: rows.length, offset, limit, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الأرشيف ❌" });
  }
});

/** POST /api/archive/import — bulk import [{search_key, storage_file, order_date?}, ...] */
app.post("/api/archive/import", (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows))
    return res.status(400).json({ success: false, message: "صيغة غير صالحة" });
  try {
    const insertMany = db.transaction((items) => {
      for (const { search_key, storage_file, order_date } of items) {
        if (!search_key) continue;
        upsertArchiveStmt.run(
          String(search_key).trim(),
          String(storage_file || "").trim(),
          String(order_date || "").trim()
        );
      }
    });
    insertMany(rows);
    const count = db.prepare("SELECT COUNT(*) AS c FROM archive").get().c;
    res.json({ success: true, imported: rows.length, total: count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الاستيراد ❌" });
  }
});

app.get("/api/archive/count", (_req, res) => {
  try {
    const count = db.prepare("SELECT COUNT(*) AS c FROM archive").get().c;
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false, message: "خطأ" });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🟢 Backend: http://localhost:${PORT}`);
});
