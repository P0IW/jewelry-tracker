import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import "./App.css";

const API_URL = "http://localhost:3001/api";

// ─── Excel Export (client-side CSV → .csv that Excel opens) ──────────────────
function exportToExcel(orders, sessionCode) {
  if (!orders.length) return;
  const rows = [["اسم الطلب", "كود الملف"]];
  orders.forEach((o) => {
    rows.push([`${o.design}${o.code}`, sessionCode]);
  });
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
  const bom = "\uFEFF"; // UTF-8 BOM for Excel Arabic support
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sessionCode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({ item, onConfirm, onCancel }) {
  if (!item) return null;
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <p>
          حذف طلب <strong>#{item.code}</strong> — {item.design}؟
        </p>
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

// ─── Order Row ────────────────────────────────────────────────────────────────
function OrderRow({ o, onToggle, onDelete, readOnly }) {
  const [menu, setMenu] = useState(null);
  const rowRef = useRef(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => {
      if (rowRef.current && !rowRef.current.contains(e.target)) setMenu(null);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);

  return (
    <div
      ref={rowRef}
      className={`order-item ${o.is_laser ? "laser-bg" : ""} ${o.is_drawn ? "drawn-bg" : ""}`}
      onContextMenu={(e) => {
        if (!readOnly) {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }
      }}
    >
      <span className="order-code">#{o.code}</span>
      <span className="order-name">{o.design}</span>
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
          title="رسم"
          className={`s-btn ${o.is_drawn ? "active-drawn" : ""}`}
          onClick={() => !readOnly && onToggle(o.id, "is_drawn", o.is_drawn)}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ●
        </button>
        <button
          title="ليزر"
          className={`s-btn ${o.is_laser ? "active-laser" : ""}`}
          onClick={() => !readOnly && onToggle(o.id, "is_laser", o.is_laser)}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ⚡
        </button>
      </div>
      {menu && (
        <div
          className="ctx-menu"
          style={{ top: menu.y, left: menu.x }}
          onMouseLeave={() => setMenu(null)}
        >
          <button
            className="ctx-delete"
            onClick={() => {
              setMenu(null);
              onDelete(o);
            }}
          >
            🗑 حذف الطلب
          </button>
        </div>
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
  orders,
}) {
  const today = new Date().toLocaleDateString("sv-SE");
  const isToday = viewingDate === today || viewingDate === null;

  return (
    <aside className="sidebar">
      {/* Today's session code */}
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
        <button className="export-btn" onClick={onExport} title="تصدير Excel">
          ⬇ تصدير Excel
        </button>
      </div>

      {/* History */}
      <div className="sidebar-history-label">السجل — 30 يوم</div>
      <div className="sidebar-list">
        {sessions.map((s) => {
          const isActive =
            viewingDate === s.iso_date || (isToday && s.iso_date === today);
          return (
            <button
              key={s.id}
              className={`sidebar-item ${isActive ? "sidebar-item-active" : ""}`}
              onClick={() => onSelectDate(s.iso_date)}
            >
              <span className="si-code">{s.session_code}</span>
              <span className="si-meta">
                {s.order_count} طلب · {parseFloat(s.total_weight).toFixed(1)}غ
              </span>
            </button>
          );
        })}
        {sessions.length === 0 && (
          <div className="sidebar-empty">لا توجد سجلات</div>
        )}
      </div>
    </aside>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [orders, setOrders] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [todaySession, setTodaySession] = useState(null);
  const [viewingDate, setViewingDate] = useState(null); // null = today
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [confirmItem, setConfirmItem] = useState(null);
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

  const today = new Date().toLocaleDateString("sv-SE");
  const isReadOnly = viewingDate !== null && viewingDate !== today;

  const addToast = useCallback((msg, type = "success") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);

  const removeToast = (id) => setToasts((t) => t.filter((x) => x.id !== id));

  const fetchSessions = useCallback(async () => {
    try {
      const [todayRes, listRes] = await Promise.all([
        axios.get(`${API_URL}/sessions/today`),
        axios.get(`${API_URL}/sessions`),
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
        const res = await axios.get(`${API_URL}/orders`, {
          params: { date: targetDate },
        });
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
    fetchSessions();
    fetchOrders();
    const iv = setInterval(() => {
      fetchSessions();
      fetchOrders(viewingDate);
    }, 20000);
    return () => clearInterval(iv);
  }, [fetchSessions, fetchOrders, viewingDate]);

  const handleSelectDate = (isoDate) => {
    setViewingDate(isoDate === today ? null : isoDate);
    setSearch("");
    fetchOrders(isoDate);
  };

  const handleMainSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_URL}/orders`, mainForm);
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
      await axios.post(`${API_URL}/orders`, {
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
      await axios.patch(`${API_URL}/orders/${id}/status`, {
        [field]: val === 0 ? 1 : 0,
      });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id ? { ...o, [field]: val === 0 ? 1 : 0 } : o,
        ),
      );
    } catch {
      addToast("❌ خطأ في التحديث", "error");
    }
  };

  const deleteOrder = async () => {
    if (!confirmItem) return;
    try {
      await axios.delete(`${API_URL}/orders/${confirmItem.id}`);
      setOrders((p) => p.filter((o) => o.id !== confirmItem.id));
      await fetchSessions();
      addToast("🗑️ تم الحذف");
    } catch {
      addToast("❌ خطأ في الحذف", "error");
    } finally {
      setConfirmItem(null);
    }
  };

  const handleExport = () => {
    // Use todaySession directly when viewing today — don't rely on sessions list
    const sessionForExport = viewingDate
      ? sessions.find((s) => s.iso_date === viewingDate)
      : todaySession;
    if (!sessionForExport) {
      addToast("لا يوجد ملف للتصدير", "error");
      return;
    }
    if (!orders.length) {
      addToast("لا توجد طلبات للتصدير", "error");
      return;
    }
    exportToExcel(orders, sessionForExport.session_code);
    addToast("✅ تم التصدير");
  };

  // ─── Filter ───
  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.client_name.includes(search) ||
      o.design.includes(search) ||
      o.code.includes(search);
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

  // Viewing label
  const viewingSession = viewingDate
    ? sessions.find((s) => s.iso_date === viewingDate)
    : todaySession;

  return (
    <div className="app">
      <Toast toasts={toasts} removeToast={removeToast} />
      <ConfirmModal
        item={confirmItem}
        onConfirm={deleteOrder}
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

        {/* Main Add Form — centered, only when viewing today */}
        {!isReadOnly && (
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
        )}
        {isReadOnly && (
          <div className="readonly-banner">
            👁 عرض: {viewingSession?.session_code} — للقراءة فقط
          </div>
        )}

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
      </header>

      {/* ── BODY (sidebar + main) ── */}
      <div className="body-row">
        {/* Sidebar */}
        <Sidebar
          todaySession={todaySession}
          sessions={sessions}
          viewingDate={viewingDate || today}
          onSelectDate={handleSelectDate}
          onExport={handleExport}
          orders={orders}
        />

        {/* Main content */}
        <div className="main-content">
          {/* Toolbar */}
          <div className="toolbar">
            <input
              className="search-input"
              placeholder="🔍 بحث بالعميل، التصميم، الكود..."
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

          {/* Cards */}
          <div className="cards-scroll">
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
                    onDelete={setConfirmItem}
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
