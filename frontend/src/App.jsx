import { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import axios from "axios";
import "./App.css";

const API_URL = "https://jewelry-tracker-dq0w.onrender.com/api";

// ─── العاصمة clients ──────────────────────────────────────────────────────────
const CAPITAL_CLIENTS = [
  "فتوح", "بن علي فوت لوفر", "بن علي", "سعيد",
  "سعيد كتلونيا", "خميس مليانة", "الحاج حسين",
];
const isCapitalClient = (name) =>
  CAPITAL_CLIENTS.some((c) => name?.trim() === c);

// ─── Date helper (ISO → DD/MM/YYYY) ───────────────────────────────────────────
function fmtArchiveDate(iso) {
  if (!iso) return "—";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
}

// ─── Axios instance ────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: API_URL });

// ─── Excel Export (daily orders) ──────────────────────────────────────────────
function exportToExcel(orders, sessionCode) {
  if (!orders.length) return false;
  const rows = [["اسم الطلب", "كود الملف"]];
  orders.forEach((o) => rows.push([`${o.design}${o.code}`, sessionCode]));
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\r\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sessionCode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// ─── Full Archive Excel Export (3 columns) ────────────────────────────────────
function exportArchiveToExcel(rows) {
  if (!rows.length) return;
  const data = [["الكود + الرقم", "رقم الملف", "التاريخ"]];
  rows.forEach((r) =>
    data.push([r.search_key, r.storage_file || "", fmtArchiveDate(r.order_date)])
  );
  const csv = data
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `الأرشيف_الكامل_${new Date().toLocaleDateString("sv-SE")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Toast ───────────────────────────────────────────────────────────────────
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

// ─── Confirm Modal ───────────────────────────────────────────────────────────
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

// ─── Edit Modal ──────────────────────────────────────────────────────────────
function EditModal({ item, onSave, onCancel }) {
  const [form, setForm] = useState({
    design: item?.design || "",
    code: item?.code || "",
    weight: item?.weight || "",
    client_name: item?.client_name || "",
    creator: item?.creator || "مارو",
  });

  if (!item) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-box edit-modal-box" onClick={(e) => e.stopPropagation()}>
        <p>تعديل الطلب</p>
        <div className="edit-form">
          <label className="edit-label">اسم العميل</label>
          <input
            className="edit-input"
            value={form.client_name}
            onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            placeholder="اسم العميل"
          />
          <label className="edit-label">التصميم</label>
          <input
            className="edit-input"
            value={form.design}
            onChange={(e) => setForm({ ...form, design: e.target.value })}
            placeholder="التصميم"
          />
          <label className="edit-label">الكود</label>
          <input
            className="edit-input"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="الكود"
          />
          <label className="edit-label">الوزن (غ)</label>
          <input
            className="edit-input"
            type="number"
            step="0.01"
            min="0"
            value={form.weight}
            onChange={(e) => setForm({ ...form, weight: e.target.value })}
            placeholder="الوزن"
          />
          <label className="edit-label">المنفّذ</label>
          <select
            className="edit-input"
            value={form.creator}
            onChange={(e) => setForm({ ...form, creator: e.target.value })}
          >
            <option value="مارو">مارو</option>
            <option value="محمد">محمد</option>
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>
            إلغاء
          </button>
          <button
            className="btn-save-confirm"
            onClick={() => onSave(item.id, form)}
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Generic Floating Context Menu (portal at root) ───────────────────────────
function CtxMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return ReactDOM.createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => (
        <button
          key={i}
          className={`ctx-item ${it.danger ? "ctx-delete" : ""}`}
          onClick={() => {
            onClose();
            it.action();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body
  );
}

// ─── Order Row ───────────────────────────────────────────────────────────────
function OrderRow({ o, onToggle, onArchive, onMenu, readOnly }) {
  const isCutSent = !!o.is_cut_sent;
  const isMohamed = o.creator === "محمد";

  const openMenu = (e) => {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const menuW = 155;
    const menuH = 90;
    const x = Math.min(e.clientX, window.innerWidth - menuW - 8);
    const y = Math.min(e.clientY, window.innerHeight - menuH - 8);
    onMenu({ x, y, order: o });
  };

  return (
    <div
      className={`order-item
        ${o.is_drawn ? "drawn-bg" : ""}
        ${isCutSent ? "cut-sent-row" : ""}
        ${!readOnly ? "order-item-clickable" : ""}
      `}
      onClick={openMenu}
      onContextMenu={openMenu}
    >
      {isCutSent && <div className="cut-sent-line" />}
      <span className="order-code">#{o.code}</span>
      <span className="order-name">
        {o.design || <em className="empty-field">—</em>}
      </span>
      {o.creator && (
        <span className={`order-creator ${isMohamed ? "creator-m" : "creator-k"}`}>
          {o.creator}
        </span>
      )}
      <span className="order-weight">
        {parseFloat(o.weight || 0).toFixed(1)}غ
      </span>
      <div className="status-btns">
        <button
          title="رسم"
          className={`s-btn ${o.is_drawn ? "active-drawn" : ""}`}
          onClick={(e) => { e.stopPropagation(); !readOnly && onToggle(o.id, "is_drawn", o.is_drawn); }}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ●
        </button>
        <button
          title="تم حساب الوزن"
          className={`s-btn ${o.is_weighed ? "active-weighed" : ""}`}
          onClick={(e) => { e.stopPropagation(); !readOnly && onToggle(o.id, "is_weighed", o.is_weighed); }}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ⚖
        </button>
        <button
          title="أُرسل للقطع"
          className={`s-btn ${isCutSent ? "active-cut-sent" : ""}`}
          onClick={(e) => { e.stopPropagation(); !readOnly && onToggle(o.id, "is_cut_sent", o.is_cut_sent); }}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          ✂
        </button>
        <button
          title={o.is_archived ? "إزالة من الأرشيف" : "إضافة إلى الأرشيف"}
          className={`s-btn ${o.is_archived ? "active-archived" : ""}`}
          onClick={(e) => { e.stopPropagation(); !readOnly && onArchive(o); }}
          style={readOnly ? { opacity: 0.5, cursor: "default" } : {}}
        >
          🗄
        </button>
      </div>
    </div>
  );
}

// ─── Client Card ─────────────────────────────────────────────────────────────
function ClientCard({
  client,
  list,
  quickForm,
  setQuickForm,
  onSubmit,
  onToggle,
  onArchive,
  onMenu,
  readOnly,
  isCapital,
  filterRegion,
  isDragging,
  isBlurred,
  onDragStart,
  onDragEnd,
  onDragOver,
}) {
  const qf = quickForm[client] || {};
  const doneCount = list.filter((o) => o.is_drawn).length;
  const weighedCount = list.filter((o) => o.is_weighed).length;
  const cutCount = list.filter((o) => o.is_cut_sent).length;
  const archivedCount = list.filter((o) => o.is_archived).length;

  // Highlight العاصمة cards only in الكل view
  const highlightCapital = isCapital && filterRegion === "الكل";

  return (
    <div
      className={`client-card
        ${isDragging ? "card-dragging" : ""}
        ${isBlurred ? "card-blurred" : ""}
        ${highlightCapital ? "card-capital" : ""}
      `}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
    >
      {/* Drag handle hint */}
      <div className="drag-handle" title="اسحب لإعادة الترتيب">⠿</div>

      <div className="card-header">
        <div className="card-title-row">
          <span className="card-avatar">{client[0]}</span>
          <span className="card-client-name">{client}</span>
        </div>
        <div className="card-meta">
          <span className="badge badge-total">{list.length}</span>
          {weighedCount > 0 && (
            <span className="badge badge-weighed">⚖{weighedCount}</span>
          )}
          {cutCount > 0 && (
            <span className="badge badge-cut">✂{cutCount}</span>
          )}
          {archivedCount > 0 && (
            <span className="badge badge-archived">🗄{archivedCount}</span>
          )}
          {doneCount > 0 && (
            <span className="badge badge-done">✓{doneCount}</span>
          )}
          {highlightCapital && (
            <span className="badge badge-capital">العاصمة</span>
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
            onArchive={onArchive}
            onMenu={onMenu}
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

// ─── Archive Search (inline toolbar dropdown — shows ALL matches) ─────────────
function ArchiveSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [coords, setCoords] = useState(null);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get("/archive/search", {
          params: { q: query.trim() },
        });
        setResults(
          res.data.success && Array.isArray(res.data.data) ? res.data.data : []
        );
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  // Close dropdown when clicking outside (checks both the input wrapper and the portal dropdown)
  useEffect(() => {
    const close = (e) => {
      const insideInput = wrapRef.current && wrapRef.current.contains(e.target);
      const insideDropdown = e.target.closest?.(".archive-dropdown");
      if (!insideInput && !insideDropdown) setFocused(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const updateCoords = () => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
  };

  // Keep the dropdown glued to the input on scroll/resize while open
  useEffect(() => {
    if (!focused) return;
    updateCoords();
    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);
    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
    };
  }, [focused]);

  const showDropdown = focused && query.trim().length > 0 && coords;

  return (
    <div className="archive-search-wrap" ref={wrapRef}>
      <input
        ref={inputRef}
        className="archive-search-input-inline"
        placeholder="🔍 البحث في الأرشيف — اكتب الكود + الرقم أو رقم الملف..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          setFocused(true);
          updateCoords();
        }}
      />
      {showDropdown &&
        ReactDOM.createPortal(
          <div
            className="archive-dropdown"
            style={{
              top: coords.top,
              left: coords.left,
              width: Math.max(coords.width, 360),
            }}
          >
            {loading && <div className="archive-dropdown-msg">جاري البحث...</div>}
            {!loading && results.length === 0 && (
              <div className="archive-dropdown-msg archive-dropdown-empty">
                ❌ لا توجد نتيجة لهذا الطلب
              </div>
            )}
            {!loading && results.length > 0 && (
              <>
                <div className="archive-dropdown-head">
                  <span className="adh-key">الكود + الرقم</span>
                  <span className="adh-file">رقم الملف</span>
                  <span className="adh-date">التاريخ</span>
                </div>
                {results.map((r, i) => (
                  <div
                    className="archive-dropdown-item"
                    key={`${r.id ?? r.search_key}-${i}`}
                  >
                    <span className="archive-item-key mono">{r.search_key}</span>
                    <span className="archive-item-file">{r.storage_file || "—"}</span>
                    <span className="archive-item-date">
                      {fmtArchiveDate(r.order_date)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}

// ─── Full Archive Modal (3 columns: key / file / date) ────────────────────────
function ArchiveModal({ onClose, addToast }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exporting, setExporting] = useState(false);
  const PAGE = 100;
  const debounceRef = useRef(null);

  const load = useCallback(
    (q, offset) =>
      api
        .get("/archive/all", { params: { q: q.trim(), limit: PAGE, offset } })
        .then((r) => r.data),
    []
  );

  // initial load + reload on search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await load(query, 0);
        if (data.success) {
          setRows(data.data);
          setTotal(data.total);
        }
      } catch {
        addToast("❌ تعذّر جلب الأرشيف", "error");
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, load, addToast]);

  const loadMore = async () => {
    if (rows.length >= total || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await load(query, rows.length);
      if (data.success) setRows((prev) => [...prev, ...data.data]);
    } catch {
      /* silent */
    } finally {
      setLoadingMore(false);
    }
  };

  const onScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore();
  };

  const handleExportAll = async () => {
    setExporting(true);
    try {
      const res = await api.get("/archive/all", {
        params: { q: query.trim(), all: 1 },
      });
      if (res.data.success && res.data.data.length) {
        exportArchiveToExcel(res.data.data);
        addToast(`✅ تم تصدير ${res.data.data.length} سجل`);
      } else {
        addToast("لا توجد سجلات للتصدير", "error");
      }
    } catch {
      addToast("❌ خطأ في التصدير", "error");
    } finally {
      setExporting(false);
    }
  };

  return ReactDOM.createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="archive-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="archive-modal-header">
          <div className="archive-modal-title">
            📚 الأرشيف الكامل
            <span className="archive-modal-count">{total} سجل</span>
          </div>
          <button className="archive-modal-close" onClick={onClose} title="إغلاق">
            ✕
          </button>
        </div>

        <div className="archive-modal-toolbar">
          <input
            className="edit-input"
            placeholder="🔍 بحث — الكود+الرقم أو رقم الملف..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <button
            className="btn-save-confirm archive-export-all-btn"
            onClick={handleExportAll}
            disabled={exporting}
          >
            {exporting ? "جاري التصدير..." : "⬇ تصدير الكل Excel"}
          </button>
        </div>

        <div className="archive-modal-list" onScroll={onScroll}>
          <div className="archive-modal-row archive-modal-row-head">
            <span className="am-key">الكود + الرقم</span>
            <span className="am-file">رقم الملف</span>
            <span className="am-date">التاريخ</span>
          </div>
          {loading ? (
            <div className="archive-dropdown-msg">جاري التحميل...</div>
          ) : rows.length === 0 ? (
            <div className="archive-dropdown-msg archive-dropdown-empty">
              ❌ لا توجد سجلات
            </div>
          ) : (
            rows.map((r, i) => (
              <div className="archive-modal-row" key={`${r.id}-${i}`}>
                <span className="am-key mono">{r.search_key}</span>
                <span className="am-file">{r.storage_file || "—"}</span>
                <span className="am-date">{fmtArchiveDate(r.order_date)}</span>
              </div>
            ))
          )}
          {loadingMore && (
            <div className="archive-dropdown-msg">جاري تحميل المزيد...</div>
          )}
          {!loading && rows.length > 0 && rows.length < total && !loadingMore && (
            <button className="archive-loadmore-btn" onClick={loadMore}>
              تحميل المزيد ({rows.length}/{total})
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({
  todaySession,
  sessions,
  viewingDate,
  onSelectDate,
  onExport,
  onSessionMenu,
  isOpen,
  onClose,
}) {
  const today = new Date().toLocaleDateString("sv-SE");

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${isOpen ? "sidebar-open" : ""}`}>
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
          <button className="export-btn" onClick={() => onExport()} title="تصدير Excel">
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
                onClick={() => {
                  onSelectDate(s.iso_date);
                  onClose();
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (s.iso_date !== today) onSessionMenu(e.clientX, e.clientY, s);
                }}
              >
                <span className="si-code">{s.session_code}</span>
                <span className="si-meta">
                  {s.order_count} طلب · {parseFloat(s.total_weight || 0).toFixed(1)}غ
                </span>
              </button>
            );
          })}
          {sessions.length === 0 && (
            <div className="sidebar-empty">لا توجد سجلات</div>
          )}
        </div>
      </aside>
    </>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [orders, setOrders] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [todaySession, setTodaySession] = useState(null);
  const [viewingDate, setViewingDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [confirmItem, setConfirmItem] = useState(null);
  const [editOrder, setEditOrder] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, items }
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState("الكل");

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  // ─── Theme (light / dark) ───
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("jewelry-theme") || "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("jewelry-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const toggleTheme = () =>
    setTheme((t) => (t === "light" ? "dark" : "light"));

  // Column order state — stores client names in display order (insertion order by default)
  const [columnOrder, setColumnOrder] = useState([]);
  const [draggingClient, setDraggingClient] = useState(null);
  const dragOverClient = useRef(null);

  const [mainForm, setMainForm] = useState({
    clientName: "",
    designName: "",
    code: "",
    weight: "",
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
        if (res.data.success) {
          setOrders(res.data.data);
          // Preserve existing column order, only add new clients at the end
          setColumnOrder((prev) => {
            const incoming = [
              ...new Set(res.data.data.map((o) => o.client_name)),
            ];
            const existing = prev.filter((c) => incoming.includes(c));
            const newClients = incoming.filter((c) => !prev.includes(c));
            return [...existing, ...newClients];
          });
        }
      } catch {
        addToast("تعذّر الاتصال بالخادم", "error");
      } finally {
        setLoading(false);
      }
    },
    [addToast, today]
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
    setColumnOrder([]); // reset order when switching days
    fetchOrders(isoDate);
  };

  const handleMainSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/orders", mainForm);
      setMainForm({ clientName: "", designName: "", code: "", weight: "" });
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
      await api.patch(`/orders/${id}/status`, {
        [field]: val === 0 || val === false || !val ? 1 : 0,
      });
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? { ...o, [field]: val === 0 || val === false || !val ? 1 : 0 }
            : o
        )
      );
    } catch {
      addToast("❌ خطأ في التحديث", "error");
    }
  };

  const toggleArchive = async (order) => {
    const newVal = order.is_archived ? 0 : 1;
    // تحديث فوري للواجهة
    setOrders((prev) =>
      prev.map((o) => (o.id === order.id ? { ...o, is_archived: newVal } : o))
    );
    try {
      await api.patch(`/orders/${order.id}/archive`, { archived: newVal });
      addToast(newVal ? "🗄 أُضيف إلى الأرشيف" : "↩️ أُزيل من الأرشيف");
    } catch {
      // تراجع عند الفشل
      setOrders((prev) =>
        prev.map((o) =>
          o.id === order.id ? { ...o, is_archived: order.is_archived } : o
        )
      );
      addToast("❌ خطأ في الأرشفة", "error");
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

  const handleEditSave = async (id, form) => {
    try {
      await api.patch(`/orders/${id}/edit`, form);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === id
            ? {
                ...o,
                design: form.design,
                code: form.code,
                weight: parseFloat(form.weight) || 0,
                client_name: form.client_name,
                creator: form.creator,
              }
            : o
        )
      );
      await fetchSessions();
      addToast("✅ تم التعديل");
    } catch {
      addToast("❌ خطأ في التعديل", "error");
    } finally {
      setEditOrder(null);
    }
  };

  const handleExport = async (session = null) => {
    // Exporting a specific past session (from the sidebar context menu)
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
    const sessionForExport = viewingDate
      ? sessions.find((s) => s.iso_date === viewingDate)
      : todaySession;
    if (!sessionForExport) {
      addToast("لا يوجد ملف للتصدير", "error");
      return;
    }
    const ok = exportToExcel(orders, sessionForExport.session_code);
    ok ? addToast("✅ تم التصدير") : addToast("لا توجد طلبات للتصدير", "error");
  };

  // ─── Order context menu (right-click / click on an order row) ───
  const handleOrderMenu = ({ x, y, order }) => {
    setCtxMenu({
      x,
      y,
      items: [
        { label: "✏️ تعديل الطلب", action: () => setEditOrder(order) },
        {
          label: "🗑 حذف الطلب",
          danger: true,
          action: () => setConfirmItem(order),
        },
      ],
    });
  };

  // ─── Session context menu (right-click on a past session in sidebar) ───
  const handleSessionMenu = (x, y, session) => {
    setCtxMenu({
      x,
      y,
      items: [
        { label: "⬇ تصدير Excel", action: () => handleExport(session) },
        {
          label: "🗑 حذف الملف",
          danger: true,
          action: () =>
            setConfirmItem({
              sessionId: session.id,
              isoDate: session.iso_date,
              message: `حذف ملف ${session.session_code} وجميع طلباته؟`,
            }),
        },
      ],
    });
  };

  // ─── Drag handlers ───
  const handleDragStart = (client) => {
    setDraggingClient(client);
  };

  const handleDragEnd = () => {
    if (draggingClient && dragOverClient.current && draggingClient !== dragOverClient.current) {
      setColumnOrder((prev) => {
        const arr = [...prev];
        const fromIdx = arr.indexOf(draggingClient);
        const toIdx = arr.indexOf(dragOverClient.current);
        if (fromIdx === -1 || toIdx === -1) return prev;
        arr.splice(fromIdx, 1);
        arr.splice(toIdx, 0, draggingClient);
        return arr;
      });
    }
    setDraggingClient(null);
    dragOverClient.current = null;
  };

  const handleDragOver = (e, client) => {
    e.preventDefault();
    dragOverClient.current = client;
  };

  // ─── Filter ───
  const filtered = orders.filter((o) => {
    const matchSearch =
      !search ||
      o.client_name.includes(search) ||
      o.design.includes(search) ||
      o.code.includes(search);
    const matchRegion =
      filterRegion === "الكل" ||
      (filterRegion === "العاصمة" && isCapitalClient(o.client_name)) ||
      (filterRegion === "سطيف" && !isCapitalClient(o.client_name));
    return matchSearch && matchRegion;
  });

  const grouped = filtered.reduce((acc, o) => {
    if (!acc[o.client_name]) acc[o.client_name] = [];
    acc[o.client_name].push(o);
    return acc;
  }, {});

  // Respect columnOrder for display (not alphabetical)
  const orderedClients = [
    ...columnOrder.filter((c) => grouped[c]),
    ...Object.keys(grouped).filter((c) => !columnOrder.includes(c)),
  ];

  const totalWeight = orders.reduce((s, o) => s + parseFloat(o.weight || 0), 0);
  const drawnTotal = orders.filter((o) => o.is_drawn).length;

  const viewingSession = viewingDate
    ? sessions.find((s) => s.iso_date === viewingDate)
    : todaySession;

  return (
    <div className="app">
      <Toast toasts={toasts} removeToast={removeToast} />
      {ctxMenu && (
        <CtxMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}
      <ConfirmModal
        item={confirmItem}
        onConfirm={confirmItem?.sessionId ? deleteSession : deleteOrder}
        onCancel={() => setConfirmItem(null)}
      />
      <EditModal
        item={editOrder}
        onSave={handleEditSave}
        onCancel={() => setEditOrder(null)}
      />
      {archiveOpen && (
        <ArchiveModal
          onClose={() => setArchiveOpen(false)}
          addToast={addToast}
        />
      )}

      {/* ── HEADER ── */}
      <header className="app-header">
        <button
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen((v) => !v)}
          title="السجل"
        >
          ☰
        </button>
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={theme === "light" ? "الوضع الليلي" : "الوضع النهاري"}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
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

        <div className="header-end">
          <div className="stats-row">
            <div className="stat-pill">
              <span className="stat-val">{orders.length}</span>
              <span className="stat-lbl">طلب</span>
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
        </div>
      </header>

      {/* Mobile Add Form */}
      {!isReadOnly && (
        <div className="mobile-add-bar">
          <form className="mobile-form" onSubmit={handleMainSubmit}>
            <div className="mobile-form-row">
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
                placeholder="التصميم"
                value={mainForm.designName}
                onChange={(e) =>
                  setMainForm({ ...mainForm, designName: e.target.value })
                }
              />
            </div>
            <div className="mobile-form-row">
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
              <button type="submit" className="mf-btn">
                +
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── BODY ── */}
      <div className="body-row">
        <Sidebar
          todaySession={todaySession}
          sessions={sessions}
          viewingDate={viewingDate || today}
          onSelectDate={handleSelectDate}
          onExport={handleExport}
          onSessionMenu={handleSessionMenu}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
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
              {["الكل", "سطيف", "العاصمة"].map((r) => (
                <button
                  key={r}
                  className={`filter-btn ${filterRegion === r ? "active" : ""} ${r === "العاصمة" ? "filter-btn-capital" : ""}`}
                  onClick={() => setFilterRegion(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <ArchiveSearch />
            <button
              className="archive-open-btn"
              onClick={() => setArchiveOpen(true)}
              title="فتح الأرشيف الكامل"
            >
              📚 الأرشيف الكامل
            </button>
            <span className="client-count">
              {orderedClients.length} عميل
            </span>
          </div>
          <div className="cards-scroll">
            {loading ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>جاري التحميل...</span>
              </div>
            ) : orderedClients.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">📋</span>
                <p>{search ? "لا نتائج مطابقة" : "لا توجد طلبات"}</p>
              </div>
            ) : (
              <div className="cards-grid">
                {[0, 1, 2, 3].map((colIdx) => (
                  <div className="cards-column" key={colIdx}>
                    {orderedClients
                      .filter((_, i) => i % 4 === colIdx)
                      .map((client) => (
                        <ClientCard
                          key={client}
                          client={client}
                          list={grouped[client]}
                          quickForm={quickForm}
                          setQuickForm={setQuickForm}
                          onSubmit={handleQuickSubmit}
                          onToggle={toggleStatus}
                          onArchive={toggleArchive}
                          onMenu={handleOrderMenu}
                          readOnly={isReadOnly}
                          isCapital={isCapitalClient(client)}
                          filterRegion={filterRegion}
                          isDragging={draggingClient === client}
                          isBlurred={draggingClient !== null && draggingClient !== client}
                          onDragStart={() => handleDragStart(client)}
                          onDragEnd={handleDragEnd}
                          onDragOver={(e) => handleDragOver(e, client)}
                        />
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}