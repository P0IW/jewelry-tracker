import dotenv from "dotenv";
dotenv.config();
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);

import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
<<<<<<< HEAD
app.use(cors());
app.use(express.json({ limit: "10mb" }));
=======
app.use(
  cors({
    origin: "https://your-vercel-app.vercel.app",
  }),
);
app.use(express.json());
app.use(express.static(join(__dirname, "dist")));
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // service role key — never expose to frontend
);

<<<<<<< HEAD
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

=======
const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret-in-production";

// ─── Auth Middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, message: "غير مصرح ❌" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res
      .status(401)
      .json({ success: false, message: "انتهت الجلسة، سجّل دخولك مجددًا" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin)
    return res.status(403).json({ success: false, message: "للمشرف فقط" });
  next();
}

>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

<<<<<<< HEAD
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
=======
function todayISO() {
  return new Date().toLocaleDateString("sv-SE");
}

async function getOrCreateSession(isoDate) {
  // Check if session exists
  const { data: existing } = await supabase
    .from("sessions")
    .select("*")
    .eq("iso_date", isoDate)
    .single();

  if (existing) return existing;

  // Get last sequence number
  const { data: last } = await supabase
    .from("sessions")
    .select("sequence_num")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  const nextSeq = last ? last.sequence_num + 1 : 3199;
  const sessionCode = `${isoToDDMMYYYY(isoDate)}.${nextSeq}`;

  const { data: created, error } = await supabase
    .from("sessions")
    .insert({
      session_code: sessionCode,
      iso_date: isoDate,
      sequence_num: nextSeq,
    })
    .select()
    .single();

  if (error) throw error;
  return created;
}

async function pruneOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  // Delete old orders
  await supabase.from("orders").delete().lt("order_date", cutoffStr);
  // Delete old sessions
  const { count } = await supabase
    .from("sessions")
    .delete()
    .lt("iso_date", cutoffStr)
    .select("*", { count: "exact", head: true });

  if (count > 0) console.log(`🧹 Pruned ${count} old session(s)`);
}

// Prune on startup + every 24h
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
pruneOldData();
setInterval(pruneOldData, 24 * 60 * 60 * 1000);

<<<<<<< HEAD
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
=======
// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────

/** POST /api/auth/login */
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, message: "أدخل اسم المستخدم وكلمة المرور" });

  try {
    const { data: user } = await supabase
      .from("users")
      .select("*")
      .eq("username", username.trim())
      .single();

    if (!user)
      return res.status(401).json({
        success: false,
        message: "اسم المستخدم أو كلمة المرور غير صحيحة",
      });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res.status(401).json({
        success: false,
        message: "اسم المستخدم أو كلمة المرور غير صحيحة",
      });

    const token = jwt.sign(
      { id: user.id, username: user.username, is_admin: user.is_admin },
      JWT_SECRET,
      { expiresIn: "12h" },
    );

    res.json({
      success: true,
      token,
      user: { username: user.username, is_admin: user.is_admin },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الخادم" });
  }
});

/** GET /api/auth/me — verify token */
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

/** GET /api/auth/users — admin only */
app.get("/api/auth/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { data } = await supabase
      .from("users")
      .select("id, username, is_admin, created_at")
      .order("created_at");
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "خطأ في جلب المستخدمين" });
  }
});

/** POST /api/auth/users — admin creates user */
app.post("/api/auth/users", requireAuth, requireAdmin, async (req, res) => {
  const { username, password, is_admin = false } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, message: "اسم المستخدم وكلمة المرور مطلوبان" });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from("users")
      .insert({ username: username.trim(), password_hash: hash, is_admin })
      .select("id, username, is_admin")
      .single();

    if (error?.code === "23505")
      return res
        .status(400)
        .json({ success: false, message: "اسم المستخدم موجود مسبقًا" });

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "خطأ في إنشاء المستخدم" });
  }
});

/** DELETE /api/auth/users/:id — admin deletes user */
app.delete(
  "/api/auth/users/:id",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === req.user.id)
      return res
        .status(400)
        .json({ success: false, message: "لا يمكنك حذف حسابك الخاص" });

    try {
      await supabase.from("users").delete().eq("id", id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, message: "خطأ في الحذف" });
    }
  },
);

/** PATCH /api/auth/users/:id/password — admin resets password */
app.patch(
  "/api/auth/users/:id/password",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const { password } = req.body;
    if (!password)
      return res
        .status(400)
        .json({ success: false, message: "كلمة المرور مطلوبة" });
    try {
      const hash = await bcrypt.hash(password, 10);
      await supabase
        .from("users")
        .update({ password_hash: hash })
        .eq("id", req.params.id);
      res.json({ success: true });
    } catch (err) {
      res
        .status(500)
        .json({ success: false, message: "خطأ في تحديث كلمة المرور" });
    }
  },
);

// ─── SESSIONS ─────────────────────────────────────────────────────────────────

app.get("/api/sessions/today", requireAuth, async (_req, res) => {
  try {
    const session = await getOrCreateSession(todayISO());
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
    res.json({ success: true, data: session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الجلسة" });
  }
});

<<<<<<< HEAD
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
=======
app.get("/api/sessions", requireAuth, async (_req, res) => {
  try {
    const { data: sessions, error } = await supabase
      .from("sessions")
      .select("*, orders(count, weight)")
      .order("id", { ascending: false })
      .limit(30);

    // Manually aggregate since Supabase doesn't do SUM in select easily
    const { data: raw } = await supabase.rpc("get_sessions_with_stats");
    res.json({ success: true, data: raw || [] });
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب السجلات" });
  }
});

<<<<<<< HEAD
// ─── Orders ───────────────────────────────────────────────────────────────────
app.post("/api/orders", (req, res) => {
=======
/** DELETE /api/sessions/:id — delete a past session and its orders */
app.delete("/api/sessions/:id", requireAuth, async (req, res) => {
  try {
    const { data: session } = await supabase
      .from("sessions")
      .select("iso_date")
      .eq("id", req.params.id)
      .single();

    if (!session)
      return res
        .status(404)
        .json({ success: false, message: "الجلسة غير موجودة" });

    // Prevent deleting today
    if (session.iso_date === todayISO())
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن حذف ملف اليوم" });

    await supabase.from("orders").delete().eq("order_date", session.iso_date);
    await supabase.from("sessions").delete().eq("id", req.params.id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف" });
  }
});

// ─── ORDERS ───────────────────────────────────────────────────────────────────

app.post("/api/orders", requireAuth, async (req, res) => {
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  const { clientName, designName, code, weight, creator } = req.body;
  if (!clientName)
    return res.status(400).json({ success: false, message: "اسم العميل مطلوب ❌" });
  try {
<<<<<<< HEAD
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
=======
    await getOrCreateSession(todayISO());

    const { data, error } = await supabase
      .from("orders")
      .insert({
        client_name: clientName.trim(),
        design: (designName || "").trim(),
        code: (code || "").trim(),
        weight: weight ? parseFloat(weight) : 0,
        creator: (creator || "مارو").trim(),
      })
      .select()
      .single();

    if (error) throw error;
    res
      .status(201)
      .json({ success: true, id: data.id, message: "تم حفظ الطلب ✅" });
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحفظ ❌" });
  }
});

<<<<<<< HEAD
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
=======
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const targetDate = req.query.date || todayISO();
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("order_date", targetDate)
      .order("client_name", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) throw error;
    res.json({ success: true, count: data.length, data });
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "فشل جلب البيانات ❌" });
  }
});

<<<<<<< HEAD
/** PATCH /api/orders/:id/status — toggle boolean fields */
app.patch("/api/orders/:id/status", (req, res) => {
  const { id } = req.params;
  const ALLOWED = ["is_drawn", "is_laser", "is_weighed", "is_cut_sent"];
  const updates = Object.entries(req.body).filter(
    ([field, value]) => ALLOWED.includes(field) && value !== undefined
  );
  if (!updates.length)
    return res.status(400).json({ success: false, message: "لا يوجد حقل للتحديث" });
=======
/** PATCH /api/orders/:id/status — toggle drawn/laser */
app.patch("/api/orders/:id/status", requireAuth, async (req, res) => {
  const { is_drawn, is_laser } = req.body;
  const updates = {};
  if (is_drawn !== undefined) updates.is_drawn = is_drawn;
  if (is_laser !== undefined) updates.is_laser = is_laser;
  if (!Object.keys(updates).length)
    return res
      .status(400)
      .json({ success: false, message: "لا يوجد حقل للتحديث" });

>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  try {
    const { data, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التحديث ❌" });
  }
});

<<<<<<< HEAD
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
=======
/** PATCH /api/orders/:id — full edit */
app.patch("/api/orders/:id", requireAuth, async (req, res) => {
  const { clientName, designName, code, weight, creator } = req.body;
  try {
    const updates = {};
    if (clientName !== undefined) updates.client_name = clientName.trim();
    if (designName !== undefined) updates.design = designName.trim();
    if (code !== undefined) updates.code = code.trim();
    if (weight !== undefined) updates.weight = parseFloat(weight) || 0;
    if (creator !== undefined) updates.creator = creator.trim();

    const { data, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", req.params.id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التعديل ❌" });
  }
});

app.delete("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("orders")
      .delete()
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف ❌" });
  }
});

<<<<<<< HEAD
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
=======
>>>>>>> 09ea083a44859e5199b139197b5876e66ceeb309
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Fallback → React
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 Running on http://localhost:${PORT}`);
});
