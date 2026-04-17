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
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "dist")));

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // service role key — never expose to frontend
);

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}${m}${y}`;
}

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
pruneOldData();
setInterval(pruneOldData, 24 * 60 * 60 * 1000);

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
    res.json({ success: true, data: session });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الجلسة" });
  }
});

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب السجلات" });
  }
});

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
  const { clientName, designName, code, weight, creator } = req.body;
  if (!clientName)
    return res
      .status(400)
      .json({ success: false, message: "اسم العميل مطلوب ❌" });

  try {
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
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحفظ ❌" });
  }
});

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "فشل جلب البيانات ❌" });
  }
});

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
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف ❌" });
  }
});

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// Fallback → React
app.get("/", (req, res) => {
  res.send("API is running 🚀");
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🟢 Running on http://localhost:${PORT}`);
});
