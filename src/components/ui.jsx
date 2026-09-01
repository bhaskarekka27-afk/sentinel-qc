import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, BrainCircuit, FlaskConical, X, Info } from 'lucide-react';

// ── Verdict pill ──────────────────────────────────────────────────────
export function VerdictPill({ status, children }) {
  const label = children || { pass: 'Pass', review: 'Review', fail: 'Fail' }[status] || status;
  return <span className={`pill dot ${status}`}>{label}</span>;
}

// ── Stat card ─────────────────────────────────────────────────────────
export function Stat({ label, value, foot, icon: Icon, accent }) {
  return (
    <div className={`stat ${accent ? `accent-${accent}` : ''}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && <span className="stat-icon"><Icon size={17} /></span>}
      </div>
      <div className="stat-value">{value}</div>
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

// ── Score bar / metric row ────────────────────────────────────────────
export function scoreColor(n) {
  if (n >= 80) return 'var(--pass)';
  if (n >= 60) return 'var(--review)';
  return 'var(--fail)';
}
export function MetricRow({ label, value }) {
  const v = Number.isFinite(value) ? value : 0;
  return (
    <div className="metric-row">
      <div className="lbl"><span className="muted">{label}</span><b>{v}%</b></div>
      <div className="scorebar"><span style={{ width: `${v}%`, background: scoreColor(v) }} /></div>
    </div>
  );
}

// ── Engine chip ───────────────────────────────────────────────────────
const ENGINE_META = {
  llama: { label: 'LLAMA', icon: BrainCircuit },
  heuristic: { label: 'Heuristics', icon: FlaskConical },
};
export function EngineChip({ engine, suffix }) {
  const m = ENGINE_META[engine] || { label: engine, icon: Sparkles };
  const Icon = m.icon;
  return <span className={`chip engine-${engine}`}><Icon /> {m.label}{suffix ? ` · ${suffix}` : ''}</span>;
}

// ── Empty state ───────────────────────────────────────────────────────
export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={38} strokeWidth={1.4} />}
      {title && <h4>{title}</h4>}
      {children && <p>{children}</p>}
    </div>
  );
}

export function Banner({ kind = 'info', icon, children, ...rest }) {
  const Icon = icon || (kind === 'warn' ? AlertTriangle : Info);
  return <div className={`banner banner-${kind}`} {...rest}><Icon size={17} /><div>{children}</div></div>;
}

// ── Modal ─────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        {children}
        {footer && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>{footer}</div>}
      </div>
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────
const ToastCtx = createContext(null);
export function useToast() { return useContext(ToastCtx); }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const toast = { ok: (m) => push(m, 'ok'), err: (m) => push(m, 'err') };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'ok' ? <CheckCircle2 size={16} color="var(--pass)" /> : <XCircle size={16} color="var(--fail)" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const statusIcon = { pass: CheckCircle2, review: AlertTriangle, fail: XCircle };
