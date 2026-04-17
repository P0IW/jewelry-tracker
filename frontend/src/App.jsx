import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const API_URL = "https://jewelry-tracker-dq0w.onrender.com/api";

// ─── Axios auth interceptor ───────────────────────────────────────────────────
const api = axios.create({ baseURL: API_URL });
api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("jwt");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// ─── Export ───────────────────────────────────────────────────────────────────
function exportToExcel(orders, sessionCode) {
  if (!orders.length) return false;
  const rows = [["اسم الطلب", "كود الملف"]];
  orders.forEach((o) => rows.push([`${o.design}${o.code}`, sessionCode]));
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sessionCode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toasts, removeToast }) {
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span>{t.msg}</span>
          <button onClick={() => removeToast(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/auth/login`, form);
      localStorage.setItem("jwt", res.data.token);
      localStorage.setItem("user", JSON.stringify(res.data.user));
      onLogin(res.data.user);
    } catch (err) {
      setError(err.response?.data?.message || "خطأ في الاتصال");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-brand">
          <span className="login-gem">💎</span>
          <h1>تتبع الطلبات</h1>
          <p>سجّل دخولك للمتابعة</p>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <input
            className="login-input"
            placeholder="اسم المستخدم"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
            autoFocus
          />
          <input
            className="login-input"
            type="password"
            placeholder="كلمة المرور"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          {error && <div className="login-error">{error}</div>}
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? "جاري التحقق..." : "دخول"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({ item, onConfirm, onCancel }) {
  if (!item) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <p>{item.message || `حذف طلب #${item.code} — ${item.design}؟`}</p>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>
            إلغاء
          </button>
          <button className="btn-delete-confirm" onClick={onConfirm}>
            حذف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ order, onSave, onCancel }) {
  const [form, setForm] = useState({
    clientName: order.client_name,
    designName: order.design,
    code: order.code,
    weight: order.weight || "",
    creator: order.creator,
  });

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-box edit-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="edit-title">تعديل الطلب</h3>
        <div className="edit-fields">
          <label>
            اسم العميل
            <input
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
          </label>
          <label>
            التصميم
            <input
              value={form.designName}
              onChange={(e) => setForm({ ...form, designName: e.target.value })}
            />
          </label>
          <label>
            الكود
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </label>
          <label>
            الوزن (غ)
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
            />
          </label>
          <label>
            المنفّذ
            <select
              value={form.creator}
              onChange={(e) => setForm({ ...form, creator: e.target.value })}
            >
              <option value="مارو">مارو</option>
              <option value="محمد">محمد</option>
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>
            إلغاء
          </button>
          <button className="mf-btn" onClick={() => onSave(form)}>
            حفظ التعديل
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Context Menu (generic) ───────────────────────────────────────────────────
function CtxMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ top: y, left: x }}
      onMouseLeave={onClose}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`ctx-item ${item.danger ? "ctx-delete" : ""}`}
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

// ─── Order Row ────────────────────────────────────────────────────────────────
function OrderRow({ o, onToggle, onDelete, onEdit, readOnly }) {
  const [menu, setMenu] = useState(null);

  return (
    <div
      className={`order-item ${o.is_laser ? "laser-bg" : ""} ${o.is_drawn ? "drawn-bg" : ""}`}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <span className="order-code">#{o.code}</span>
      <span className="order-name">
        {o.design || <em className="empty-field">—</em>}
      </span>
      <span className="order-weight">
        {parseFloat(o.weight || 0).toFixed(1)}غ
      </span>
      <span
        className={`order-creator ${o.creator === "محمد" ? "creator-m" : "creator-k"}`}
      >
        {o.creator === "محمد" ? "م" : "ك"}
      </span>
      <div className="status-btns">
        <button
          className={`s-btn ${o.is_drawn ? "active-drawn" : ""}`}
          onClick={() => !readOnly && onToggle(o.id, "is_drawn", o.is_drawn)}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ●
        </button>
        <button
          className={`s-btn ${o.is_laser ? "active-laser" : ""}`}
          onClick={() => !readOnly && onToggle(o.id, "is_laser", o.is_laser)}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ⚡
        </button>
      </div>

      {menu && (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "✏️ تعديل الطلب", action: () => onEdit(o) },
            { label: "🗑 حذف الطلب", danger: true, action: () => onDelete(o) },
          ]}
        />
      )}
    </div>
  );
}

// ─── Client Card ──────────────────────────────────────────────────────────────
function ClientCard({
  client,
  list,
  quickForm,
  setQuickForm,
  onSubmit,
  onToggle,
  onDelete,
  onEdit,
  readOnly,
}) {
  const qf = quickForm[client] || {};
  const doneCount = list.filter((o) => o.is_drawn && o.is_laser).length;
  const laserCount = list.filter((o) => o.is_laser).length;

  return (
    <div className="client-card">
      <div className="card-header">
        <div className="card-title-row">
          <span className="card-avatar">{client[0]}</span>
          <span className="card-client-name">{client}</span>
        </div>
        <div className="card-meta">
          <span className="badge badge-total">{list.length}</span>
          {laserCount > 0 && (
            <span className="badge badge-laser">⚡{laserCount}</span>
          )}
          {doneCount > 0 && (
            <span className="badge badge-done">✓{doneCount}</span>
          )}
        </div>
      </div>

      {!readOnly && (
        <form className="quick-add-form" onSubmit={(e) => onSubmit(e, client)}>
          <input
            className="qa-design"
            placeholder="التصميم"
            value={qf.designName || ""}
            onChange={(e) =>
              setQuickForm((p) => ({
                ...p,
                [client]: { ...qf, designName: e.target.value },
              }))
            }
          />
          <input
            className="qa-code"
            placeholder="كود"
            value={qf.code || ""}
            onChange={(e) =>
              setQuickForm((p) => ({
                ...p,
                [client]: { ...qf, code: e.target.value },
              }))
            }
          />
          <input
            className="qa-weight"
            type="number"
            step="0.01"
            min="0"
            placeholder="وزن"
            value={qf.weight || ""}
            onChange={(e) =>
              setQuickForm((p) => ({
                ...p,
                [client]: { ...qf, weight: e.target.value },
              }))
            }
          />
          <select
            className="qa-creator"
            value={qf.creator || "مارو"}
            onChange={(e) =>
              setQuickForm((p) => ({
                ...p,
                [client]: { ...qf, creator: e.target.value },
              }))
            }
          >
            <option value="مارو">مارو</option>
            <option value="محمد">محمد</option>
          </select>
          <button type="submit" className="qa-btn">
            +
          </button>
        </form>
      )}

      <div className="orders-list">
        {list.length === 0 && <div className="empty-list">لا توجد طلبات</div>}
        {list.map((o) => (
          <OrderRow
            key={o.id}
            o={o}
            onToggle={onToggle}
            onDelete={onDelete}
            onEdit={onEdit}
            readOnly={readOnly}
          />
        ))}
      </div>

      <div className="card-footer">
        <span>
          {list.reduce((s, o) => s + parseFloat(o.weight || 0), 0).toFixed(2)}غ
          مجموع
        </span>
      </div>
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({
  todaySession,
  sessions,
  viewingDate,
  onSelectDate,
  onExport,
  onDeleteSession,
  orders,
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const [sessionMenu, setSessionMenu] = useState(null); // { x, y, session }

  return (
    <aside className="sidebar">
      <div className="sidebar-today">
        <div className="sidebar-today-label">
          ملف اليوم
          {todaySession && (
            <span className="sidebar-today-code">
              {" "}
              — {todaySession.session_code}
            </span>
          )}
        </div>
        <button className="export-btn" onClick={onExport}>
          ⬇ تصدير Excel
        </button>
      </div>

      <div className="sidebar-history-label">السجل — 30 يوم</div>
      <div className="sidebar-list">
        {sessions.map((s) => {
          const isActive = viewingDate === s.iso_date;
          return (
            <button
              key={s.id}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
              onClick={() => onSelectDate(s.iso_date)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (s.iso_date !== today)
                  setSessionMenu({ x: e.clientX, y: e.clientY, session: s });
              }}
            >
              <span className="si-code">{s.session_code}</span>
              <span className="si-meta">
                {s.order_count} طلب ·{" "}
                {parseFloat(s.total_weight || 0).toFixed(1)}غ
              </span>
            </button>
          );
        })}
        {sessions.length === 0 && (
          <div className="sidebar-empty">لا توجد سجلات</div>
        )}
      </div>

      {sessionMenu && (
        <CtxMenu
          x={sessionMenu.x}
          y={sessionMenu.y}
          onClose={() => setSessionMenu(null)}
          items={[
            {
              label: "⬇ تصدير Excel",
              action: () => onExport(sessionMenu.session),
            },
            {
              label: "🗑 حذف الملف",
              danger: true,
              action: () => onDeleteSession(sessionMenu.session),
            },
          ]}
        />
      )}
    </aside>
  );
}

// ─── Top Scroll Bar ───────────────────────────────────────────────────────────
function TopScrollBar({ scrollRef }) {
  const trackRef = useRef(null);
  const [thumb, setThumb] = useState({ width: 0, left: 0, visible: false });
  const dragging = useRef(false);
  const dragStart = useRef(0);
  const scrollStart = useRef(0);

  const update = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const ratio = el.clientWidth / el.scrollWidth;
    if (ratio >= 1) {
      setThumb((t) => ({ ...t, visible: false }));
      return;
    }
    const thumbW = Math.max(ratio * track.clientWidth, 40);
    const maxScroll = el.scrollWidth - el.clientWidth;
    const maxLeft = track.clientWidth - thumbW;
    const left = (el.scrollLeft / maxScroll) * maxLeft;
    setThumb({ width: thumbW, left, visible: true });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const obs = new ResizeObserver(update);
    obs.observe(el);
    el.addEventListener("scroll", update);
    update();
    return () => {
      obs.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [update, scrollRef]);

  const onMouseDown = (e) => {
    dragging.current = true;
    dragStart.current = e.clientX;
    scrollStart.current = scrollRef.current.scrollLeft;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const el = scrollRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      const ratio = el.scrollWidth / track.clientWidth;
      el.scrollLeft =
        scrollStart.current + (e.clientX - dragStart.current) * ratio;
    };
    const onUp = () => {
      dragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [scrollRef]);

  if (!thumb.visible) return null;

  return (
    <div ref={trackRef} className="top-scrollbar-track">
      <div
        className="top-scrollbar-thumb"
        style={{
          width: thumb.width,
          transform: `translateX(${-thumb.left}px)`,
        }}
        onMouseDown={onMouseDown}
      />
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("user"));
    } catch {
      return null;
    }
  });
  const [orders, setOrders] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [todaySession, setTodaySession] = useState(null);
  const [viewingDate, setViewingDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [confirmItem, setConfirmItem] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCreator, setFilterCreator] = useState("الكل");
  const [mainForm, setMainForm] = useState({
    clientName: "",
    designName: "",
    code: "",
    weight: "",
    creator: "مارو",
  });
  const [quickForm, setQuickForm] = useState({});
  const toastId = useRef(0);
  const cardsScrollRef = useRef(null);

  const today = new Date().toLocaleDateString("sv-SE");
  const isReadOnly = viewingDate !== null && viewingDate !== today;

  const addToast = useCallback((msg, type = "success") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const removeToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  const logout = () => {
    localStorage.removeItem("jwt");
    localStorage.removeItem("user");
    setUser(null);
  };

  // Verify token on load
  useEffect(() => {
    if (!user) return;
    api.get("/auth/me").catch(() => logout());
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const [todayRes, listRes] = await Promise.all([
        api.get("/sessions/today"),
        api.get("/sessions"),
      ]);
      if (todayRes.data.success) setTodaySession(todayRes.data.data);
      if (listRes.data.success) setSessions(listRes.data.data);
    } catch {
      /* silent */
    }
  }, []);

  const fetchOrders = useCallback(
    async (date = null) => {
      try {
        const targetDate = date || today;
        const res = await api.get("/orders", { params: { date: targetDate } });
        if (res.data.success) setOrders(res.data.data);
      } catch {
        addToast("تعذّر الاتصال بالخادم", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast, today],
  );

  useEffect(() => {
    if (!user) return;
    fetchSessions();
    fetchOrders();
    const iv = setInterval(() => {
      fetchSessions();
      fetchOrders(viewingDate);
    }, 20000);
    return () => clearInterval(iv);
  }, [user, fetchSessions, fetchOrders, viewingDate]);

  const handleSelectDate = (isoDate) => {
    const newDate = isoDate === today ? null : isoDate;
    setViewingDate(newDate);
    setSearch("");
    fetchOrders(isoDate);
  };

  const handleMainSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/orders", mainForm);
      setMainForm({
        clientName: "",
        designName: "",
        code: "",
        weight: "",
        creator: "مارو",
      });
      await fetchOrders(today);
      await fetchSessions();
      addToast("✅ تم إضافة الطلب");
    } catch {
      addToast("❌ خطأ في الحفظ", "error");
    }
  };

  const handleQuickSubmit = async (e, client) => {
    e.preventDefault();
    const qf = quickForm[client] || {};
    try {
      await api.post("/orders", {
        clientName: client,
        designName: qf.designName,
        code: qf.code,
        weight: qf.weight,
        creator: qf.creator || "مارو",
      });
      setQuickForm((p) => ({ ...p, [client]: {} }));
      await fetchOrders(today);
      await fetchSessions();
      addToast("✅ تم إضافة الطلب");
    } catch {
      addToast("❌ خطأ في الحفظ", "error");
    }
  };

  const toggleStatus = async (id, field, val) => {
    try {
      await api.patch(`/orders/${id}/status`, { [field]: val === 0 ? 1 : 0 });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id ? { ...o, [field]: val === 0 ? 1 : 0 } : o,
        ),
      );
    } catch {
      addToast("❌ خطأ في التحديث", "error");
    }
  };

  const handleSaveEdit = async (form) => {
    try {
      const { data } = await api.patch(`/orders/${editOrder.id}`, form);
      setOrders((prev) =>
        prev.map((o) => (o.id === editOrder.id ? data.data : o)),
      );
      setEditOrder(null);
      await fetchSessions();
      addToast("✅ تم التعديل");
    } catch {
      addToast("❌ خطأ في التعديل", "error");
    }
  };

  const deleteOrder = async () => {
    if (!confirmItem?.id) return;
    try {
      await api.delete(`/orders/${confirmItem.id}`);
      setOrders((p) => p.filter((o) => o.id !== confirmItem.id));
      await fetchSessions();
      addToast("🗑️ تم الحذف");
    } catch {
      addToast("❌ خطأ في الحذف", "error");
    } finally {
      setConfirmItem(null);
    }
  };

  const deleteSession = async () => {
    if (!confirmItem?.sessionId) return;
    try {
      await api.delete(`/sessions/${confirmItem.sessionId}`);
      await fetchSessions();
      if (viewingDate === confirmItem.isoDate) {
        setViewingDate(null);
        fetchOrders(today);
      }
      addToast("🗑️ تم حذف الملف");
    } catch (err) {
      addToast(err.response?.data?.message || "❌ خطأ في الحذف", "error");
    } finally {
      setConfirmItem(null);
    }
  };

  const handleExport = async (session = null) => {
    // If session passed = exporting a specific past session, fetch its orders
    if (session) {
      try {
        const res = await api.get("/orders", {
          params: { date: session.iso_date },
        });
        const ok = exportToExcel(res.data.data, session.session_code);
        ok
          ? addToast("✅ تم التصدير")
          : addToast("لا توجد طلبات في هذا الملف", "error");
      } catch {
        addToast("❌ خطأ في التصدير", "error");
      }
      return;
    }
    // Export current view
    const s = viewingDate
      ? sessions.find((x) => x.iso_date === viewingDate)
      : todaySession;
    if (!s) {
      addToast("لا يوجد ملف للتصدير", "error");
      return;
    }
    const ok = exportToExcel(orders, s.session_code);
    ok ? addToast("✅ تم التصدير") : addToast("لا توجد طلبات للتصدير", "error");
  };

  // ─── Filter ───
  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.client_name.includes(search) ||
      o.design?.includes(search) ||
      o.code?.includes(search);
    const matchCreator =
      filterCreator === "الكل" || o.creator === filterCreator;
    return matchSearch && matchCreator;
  });

  const grouped = filtered.reduce((acc, o) => {
    if (!acc[o.client_name]) acc[o.client_name] = [];
    acc[o.client_name].push(o);
    return acc;
  }, {});

  const totalWeight = orders.reduce((s, o) => s + parseFloat(o.weight || 0), 0);
  const laserTotal = orders.filter((o) => o.is_laser).length;
  const drawnTotal = orders.filter((o) => o.is_drawn).length;
  const viewingSession = viewingDate
    ? sessions.find((s) => s.iso_date === viewingDate)
    : todaySession;

  // ─── Not logged in ───
  if (!user) return <LoginPage onLogin={(u) => setUser(u)} />;

  return (
    <div className="app">
      <Toast toasts={toasts} removeToast={removeToast} />

      {editOrder && (
        <EditModal
          order={editOrder}
          onSave={handleSaveEdit}
          onCancel={() => setEditOrder(null)}
        />
      )}

      <ConfirmModal
        item={confirmItem}
        onConfirm={confirmItem?.sessionId ? deleteSession : deleteOrder}
        onCancel={() => setConfirmItem(null)}
      />

      {/* ── HEADER ── */}
      <header className="app-header">
        <div className="header-brand">
          <span className="brand-icon">💎</span>
          <div>
            <h1>تتبع الطلبات</h1>
            <span className="brand-sub">
              {new Date().toLocaleDateString("ar-DZ", {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
        </div>

        {!isReadOnly ? (
          <form className="main-form" onSubmit={handleMainSubmit}>
            <input
              className="mf-input"
              placeholder="اسم العميل"
              value={mainForm.clientName}
              onChange={(e) =>
                setMainForm({ ...mainForm, clientName: e.target.value })
              }
              required
            />
            <input
              className="mf-input mf-design"
              placeholder="التصميم (اختياري)"
              value={mainForm.designName}
              onChange={(e) =>
                setMainForm({ ...mainForm, designName: e.target.value })
              }
            />
            <input
              className="mf-input mf-sm"
              placeholder="الكود"
              value={mainForm.code}
              onChange={(e) =>
                setMainForm({ ...mainForm, code: e.target.value })
              }
            />
            <input
              className="mf-input mf-sm"
              type="number"
              step="0.01"
              min="0"
              placeholder="وزن"
              value={mainForm.weight}
              onChange={(e) =>
                setMainForm({ ...mainForm, weight: e.target.value })
              }
            />
            <select
              className="mf-select"
              value={mainForm.creator}
              onChange={(e) =>
                setMainForm({ ...mainForm, creator: e.target.value })
              }
            >
              <option value="مارو">مارو</option>
              <option value="محمد">محمد</option>
            </select>
            <button type="submit" className="mf-btn">
              + إضافة
            </button>
          </form>
        ) : (
          <div className="readonly-banner">
            👁 عرض: {viewingSession?.session_code} — للقراءة فقط
          </div>
        )}

        <div className="header-end">
          <div className="stats-row">
            <div className="stat-pill">
              <span className="stat-val">{orders.length}</span>
              <span className="stat-lbl">طلب</span>
            </div>
            <div className="stat-pill stat-laser">
              <span className="stat-val">⚡{laserTotal}</span>
              <span className="stat-lbl">ليزر</span>
            </div>
            <div className="stat-pill stat-drawn">
              <span className="stat-val">●{drawnTotal}</span>
              <span className="stat-lbl">رسم</span>
            </div>
            <div className="stat-pill stat-weight">
              <span className="stat-val">{totalWeight.toFixed(1)}</span>
              <span className="stat-lbl">جرام</span>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="تسجيل الخروج">
            خروج
          </button>
        </div>
      </header>

      {/* ── BODY ── */}
      <div className="body-row">
        <Sidebar
          todaySession={todaySession}
          sessions={sessions}
          viewingDate={viewingDate || today}
          onSelectDate={handleSelectDate}
          onExport={handleExport}
          onDeleteSession={(s) =>
            setConfirmItem({
              sessionId: s.id,
              isoDate: s.iso_date,
              message: `حذف ملف ${s.session_code} وجميع طلباته؟`,
            })
          }
          orders={orders}
        />

        <div className="main-content">
          <div className="toolbar">
            <input
              className="search-input"
              placeholder="🔍 بحث..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="filter-btns">
              {["الكل", "مارو", "محمد"].map((c) => (
                <button
                  key={c}
                  className={`filter-btn ${filterCreator === c ? "active" : ""}`}
                  onClick={() => setFilterCreator(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <span className="client-count">
              {Object.keys(grouped).length} عميل
            </span>
          </div>

          {/* Top scroll indicator */}
          <TopScrollBar scrollRef={cardsScrollRef} />

          <div className="cards-scroll" ref={cardsScrollRef}>
            {loading ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>جاري التحميل...</span>
              </div>
            ) : Object.keys(grouped).length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">📋</span>
                <p>{search ? "لا نتائج مطابقة" : "لا توجد طلبات"}</p>
              </div>
            ) : (
              <div className="cards-row">
                {Object.entries(grouped).map(([client, list]) => (
                  <ClientCard
                    key={client}
                    client={client}
                    list={list}
                    quickForm={quickForm}
                    setQuickForm={setQuickForm}
                    onSubmit={handleQuickSubmit}
                    onToggle={toggleStatus}
                    onDelete={(o) => setConfirmItem(o)}
                    onEdit={setEditOrder}
                    readOnly={isReadOnly}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
