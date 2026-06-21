import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first"); // avoid slow/hanging IPv6 lookups

import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment (.env)",
  );
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error(
    "❌ Missing JWT_SECRET in environment (.env) — set it to a long random string",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ─── Auth middleware ──────────────────────────────────────────────────────────
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
  const { data: existing, error: selErr } = await supabase
    .from("sessions")
    .select("*")
    .eq("iso_date", isoDate)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing;

  const { data: last, error: lastErr } = await supabase
    .from("sessions")
    .select("sequence_num")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw lastErr;

  const nextSeq = last ? last.sequence_num + 1 : 3199;
  const code = `${isoToDDMMYYYY(isoDate)}.${nextSeq}`;

  const { data: inserted, error: insErr } = await supabase
    .from("sessions")
    .insert({ session_code: code, iso_date: isoDate, sequence_num: nextSeq })
    .select()
    .single();

  if (insErr) {
    const { data: retry } = await supabase
      .from("sessions")
      .select("*")
      .eq("iso_date", isoDate)
      .maybeSingle();
    if (retry) return retry;
    throw insErr;
  }
  return inserted;
}

async function upsertArchiveKey(searchKey, storageFile, orderDate) {
  if (!searchKey) return;
  const { error } = await supabase.from("archive").upsert(
    {
      search_key: searchKey,
      storage_file: (storageFile || "").trim(),
      order_date: (orderDate || "").trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "search_key,storage_file" },
  );
  if (error) throw error;
}

async function upsertArchive(design, code, sessionCode, orderDate) {
  const searchKey = `${(design || "").trim()}${(code || "").trim()}`.trim();
  await upsertArchiveKey(searchKey, sessionCode, orderDate);
}

async function pruneOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().split("T")[0];

  const { data: oldSessions, error: selErr } = await supabase
    .from("sessions")
    .select("iso_date")
    .lt("iso_date", cutoffStr);
  if (selErr) throw selErr;

  const oldDates = (oldSessions || []).map((s) => s.iso_date);
  if (oldDates.length) {
    const { error: delOrdersErr } = await supabase
      .from("orders")
      .delete()
      .in("order_date", oldDates);
    if (delOrdersErr) throw delOrdersErr;
  }

  const { error: delSessionsErr } = await supabase
    .from("sessions")
    .delete()
    .lt("iso_date", cutoffStr);
  if (delSessionsErr) throw delSessionsErr;
}

async function syncOrderArchive() {
  const { data: sessions, error: sessErr } = await supabase
    .from("sessions")
    .select("iso_date, session_code");
  if (sessErr) throw sessErr;

  for (const s of sessions || []) {
    const { data: rows, error: ordErr } = await supabase
      .from("orders")
      .select("design, code, is_archived")
      .eq("order_date", s.iso_date);
    if (ordErr) throw ordErr;

    const archivedKeys = new Set();
    const allKeys = new Set();
    for (const o of rows || []) {
      const k = `${(o.design || "").trim()}${(o.code || "").trim()}`.trim();
      if (!k) continue;
      allKeys.add(k);
      if (o.is_archived) archivedKeys.add(k);
    }

    for (const k of archivedKeys) {
      await upsertArchiveKey(k, s.session_code, s.iso_date);
    }

    for (const k of allKeys) {
      if (!archivedKeys.has(k)) {
        const { error: delErr } = await supabase
          .from("archive")
          .delete()
          .eq("search_key", k)
          .eq("storage_file", s.session_code);
        if (delErr) throw delErr;
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res
      .status(400)
      .json({ success: false, message: "أدخل اسم المستخدم وكلمة المرور" });

  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("username", username.trim())
      .maybeSingle();
    if (error) throw error;

    if (!user)
      return res
        .status(401)
        .json({ success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid)
      return res
        .status(401)
        .json({ success: false, message: "اسم المستخدم أو كلمة المرور غير صحيحة" });

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

app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get("/api/auth/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("id, username, is_admin, created_at")
      .order("created_at");
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب المستخدمين" });
  }
});

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

    if (error) {
      if (error.code === "23505")
        return res
          .status(400)
          .json({ success: false, message: "اسم المستخدم موجود مسبقًا" });
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في إنشاء المستخدم" });
  }
});

app.delete("/api/auth/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  if (parseInt(id, 10) === req.user.id)
    return res
      .status(400)
      .json({ success: false, message: "لا يمكنك حذف حسابك الخاص" });
  try {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف" });
  }
});

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
      const { error } = await supabase
        .from("users")
        .update({ password_hash: hash })
        .eq("id", req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "خطأ في تحديث كلمة المرور" });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// SESSIONS
// ═══════════════════════════════════════════════════════════════════════════

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
      .select("*")
      .order("id", { ascending: false })
      .limit(30);
    if (error) throw error;

    const withTotals = await Promise.all(
      (sessions || []).map(async (s) => {
        const { data: orders, error: ordErr } = await supabase
          .from("orders")
          .select("weight")
          .eq("order_date", s.iso_date);
        if (ordErr) throw ordErr;
        const order_count = orders.length;
        const total_weight = orders.reduce(
          (sum, o) => sum + (Number(o.weight) || 0),
          0,
        );
        return { ...s, order_count, total_weight };
      }),
    );

    res.json({ success: true, data: withTotals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب السجلات" });
  }
});

/** DELETE /api/sessions/:id — delete a past session, its orders, and its archive entries */
app.delete("/api/sessions/:id", requireAuth, async (req, res) => {
  try {
    const { data: session, error: getErr } = await supabase
      .from("sessions")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!session)
      return res.status(404).json({ success: false, message: "الجلسة غير موجودة" });

    if (session.iso_date === todayISO())
      return res
        .status(400)
        .json({ success: false, message: "لا يمكن حذف ملف اليوم" });

    const { error: delOrdersErr } = await supabase
      .from("orders")
      .delete()
      .eq("order_date", session.iso_date);
    if (delOrdersErr) throw delOrdersErr;

    const { error: delArchiveErr } = await supabase
      .from("archive")
      .delete()
      .eq("storage_file", session.session_code);
    if (delArchiveErr) throw delArchiveErr;

    const { error: delSessionErr } = await supabase
      .from("sessions")
      .delete()
      .eq("id", req.params.id);
    if (delSessionErr) throw delSessionErr;

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════

app.post("/api/orders", requireAuth, async (req, res) => {
  const { clientName, designName, code, weight, creator } = req.body;
  if (!clientName)
    return res
      .status(400)
      .json({ success: false, message: "اسم العميل مطلوب ❌" });
  try {
    const today = todayISO();
    await getOrCreateSession(today);

    const { data: inserted, error } = await supabase
      .from("orders")
      .insert({
        client_name: clientName.trim(),
        design: (designName || "").trim(),
        code: (code || "").trim(),
        weight: weight ? parseFloat(weight) : 0,
        creator: (creator || "مارو").trim(),
        order_date: today,
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({
      success: true,
      id: inserted.id,
      message: "تم حفظ الطلب ✅",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحفظ ❌" });
  }
});

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const targetDate = req.query.date || todayISO();
    const { data: orders, error } = await supabase
      .from("orders")
      .select("*")
      .eq("order_date", targetDate)
      .order("created_at", { ascending: true });
    if (error) throw error;
    res.json({ success: true, count: orders.length, data: orders });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "فشل جلب البيانات ❌" });
  }
});

/** PATCH /api/orders/:id/status — toggle boolean fields */
app.patch("/api/orders/:id/status", requireAuth, async (req, res) => {
  const { id } = req.params;
  const ALLOWED = ["is_drawn", "is_weighed", "is_cut_sent"];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(
      ([field, value]) => ALLOWED.includes(field) && value !== undefined,
    ),
  );
  if (!Object.keys(updates).length)
    return res
      .status(400)
      .json({ success: false, message: "لا يوجد حقل للتحديث" });
  try {
    const { data: updated, error } = await supabase
      .from("orders")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التحديث ❌" });
  }
});

/** PATCH /api/orders/:id/archive — add/remove this order from the archive */
app.patch("/api/orders/:id/archive", requireAuth, async (req, res) => {
  const { id } = req.params;
  const archived = req.body.archived ? 1 : 0;
  try {
    const { data: order, error: getErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "الطلب غير موجود" });

    const session = await getOrCreateSession(order.order_date);

    const { error: updErr } = await supabase
      .from("orders")
      .update({ is_archived: archived })
      .eq("id", id);
    if (updErr) throw updErr;

    const key =
      `${(order.design || "").trim()}${(order.code || "").trim()}`.trim();

    if (archived) {
      await upsertArchive(
        order.design,
        order.code,
        session.session_code,
        order.order_date,
      );
    } else {
      const { data: others, error: othErr } = await supabase
        .from("orders")
        .select("design, code")
        .eq("is_archived", 1)
        .eq("order_date", order.order_date)
        .neq("id", id);
      if (othErr) throw othErr;

      const stillNeeded = (others || []).some(
        (o) =>
          `${(o.design || "").trim()}${(o.code || "").trim()}`.trim() === key,
      );
      if (key && !stillNeeded) {
        const { error: delErr } = await supabase
          .from("archive")
          .delete()
          .eq("search_key", key)
          .eq("storage_file", session.session_code);
        if (delErr) throw delErr;
      }
    }

    const { data: updated, error: finErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();
    if (finErr) throw finErr;

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الأرشفة ❌" });
  }
});

/** PATCH /api/orders/:id/edit — edit order content fields (incl. creator) */
app.patch("/api/orders/:id/edit", requireAuth, async (req, res) => {
  const { id } = req.params;
  const { design, code, weight, client_name, creator } = req.body;

  try {
    const { data: existing, error: getErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!existing)
      return res
        .status(404)
        .json({ success: false, message: "الطلب غير موجود" });

    const { error: updErr } = await supabase
      .from("orders")
      .update({
        design: (design || "").trim(),
        code: (code || "").trim(),
        weight: weight ? parseFloat(weight) : 0,
        client_name: (client_name || "").trim(),
        creator: (creator || existing.creator || "مارو").trim(),
      })
      .eq("id", id);
    if (updErr) throw updErr;

    const session = await getOrCreateSession(existing.order_date);

    if (existing.is_archived === 1) {
      const oldKey =
        `${(existing.design || "").trim()}${(existing.code || "").trim()}`.trim();

      const { data: others, error: othErr } = await supabase
        .from("orders")
        .select("design, code")
        .eq("is_archived", 1)
        .eq("order_date", existing.order_date)
        .neq("id", id);
      if (othErr) throw othErr;

      const stillNeeded = (others || []).some(
        (o) =>
          `${(o.design || "").trim()}${(o.code || "").trim()}`.trim() ===
          oldKey,
      );
      if (oldKey && !stillNeeded) {
        const { error: delErr } = await supabase
          .from("archive")
          .delete()
          .eq("search_key", oldKey)
          .eq("storage_file", session.session_code);
        if (delErr) throw delErr;
      }
      await upsertArchive(
        design,
        code,
        session.session_code,
        existing.order_date,
      );
    }

    const { data: updated, error: finErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", id)
      .single();
    if (finErr) throw finErr;

    res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في التعديل ❌" });
  }
});

app.delete("/api/orders/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const { data: exists, error: getErr } = await supabase
      .from("orders")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!exists)
      return res
        .status(404)
        .json({ success: false, message: "الطلب غير موجود" });

    const { error: delErr } = await supabase
      .from("orders")
      .delete()
      .eq("id", id);
    if (delErr) throw delErr;

    res.json({ success: true, message: "تم الحذف ✅" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في الحذف ❌" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ARCHIVE
// ═══════════════════════════════════════════════════════════════════════════

app.get("/api/archive/search", requireAuth, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json({ success: true, mode: "empty", data: [] });
  try {
    const { data: exactRows, error: exErr } = await supabase
      .from("archive")
      .select("*")
      .eq("search_key", q)
      .order("order_date", { ascending: false })
      .order("updated_at", { ascending: false });
    if (exErr) throw exErr;

    if (exactRows?.length) {
      return res.json({ success: true, mode: "list", data: exactRows });
    }

    const { data: prefixRows, error: preErr } = await supabase
      .from("archive")
      .select("*")
      .ilike("search_key", `${q}%`)
      .order("order_date", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (preErr) throw preErr;

    let rows = prefixRows || [];
    if (rows.length < 50) {
      const { data: containsRows, error: conErr } = await supabase
        .from("archive")
        .select("*")
        .ilike("search_key", `%${q}%`)
        .not("search_key", "ilike", `${q}%`)
        .order("order_date", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(50 - rows.length);
      if (conErr) throw conErr;
      rows = [...rows, ...(containsRows || [])];
    }

    res.json({ success: true, mode: "list", data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في البحث ❌" });
  }
});

app.get("/api/archive/all", requireAuth, async (req, res) => {
  const q = (req.query.q || "").trim();
  const fetchAll = req.query.all === "1";
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    let query = supabase.from("archive").select("*", { count: "exact" });

    if (q) {
      query = query.or(`search_key.ilike.%${q}%,storage_file.ilike.%${q}%`);
    }

    query = query
      .order("order_date", { ascending: false })
      .order("updated_at", { ascending: false });

    if (!fetchAll) {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: rows, count, error } = await query;
    if (error) throw error;

    res.json({
      success: true,
      total: count,
      count: rows.length,
      offset,
      limit,
      data: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ في جلب الأرشيف ❌" });
  }
});

app.post(
  "/api/archive/import",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const rows = req.body?.rows;
    if (!Array.isArray(rows))
      return res
        .status(400)
        .json({ success: false, message: "صيغة غير صالحة" });
    try {
      const payload = rows
        .filter((r) => r.search_key)
        .map((r) => ({
          search_key: String(r.search_key).trim(),
          storage_file: String(r.storage_file || "").trim(),
          order_date: String(r.order_date || "").trim() || null,
          updated_at: new Date().toISOString(),
        }));

      const CHUNK_SIZE = 500;
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase
          .from("archive")
          .upsert(chunk, { onConflict: "search_key,storage_file" });
        if (error) throw error;
      }

      const { count, error: countErr } = await supabase
        .from("archive")
        .select("*", { count: "exact", head: true });
      if (countErr) throw countErr;

      res.json({ success: true, imported: rows.length, total: count });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, message: "خطأ في الاستيراد ❌" });
    }
  },
);

app.get("/api/archive/count", requireAuth, async (_req, res) => {
  try {
    const { count, error } = await supabase
      .from("archive")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    res.json({ success: true, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "خطأ" });
  }
});

// ─── Health (public — no auth, used for diagnostics) ─────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.get("/", (_req, res) => res.send("API is running 🚀"));

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

(async () => {
  try {
    await pruneOldData();
    await syncOrderArchive();
  } catch (err) {
    console.error("⚠️ Startup maintenance tasks failed:", err);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🟢 Backend running on port ${PORT}`);
  });
})();