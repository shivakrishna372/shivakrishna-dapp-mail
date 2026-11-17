import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { avatarColor, initials, displayName } from '../lib/utils.js';

// ---------------- Avatar ----------------
export function Avatar({ person, size = 36 }) {
  const name = displayName(person);
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.4, background: avatarColor(person?.email || name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

// ---------------- Icon button ----------------
export function IconButton({ icon: Icon, label, onClick, active, size = 18, className = '', disabled, ...rest }) {
  return (
    <button
      type="button"
      className={`icon-btn ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      {...rest}
    >
      <Icon size={size} strokeWidth={1.9} />
    </button>
  );
}

export function Spinner({ size = 18 }) {
  return <Loader2 className="spin" size={size} />;
}

// ---------------- Click-outside popover menu ----------------
export function Popover({ open, onClose, children, align = 'left', className = '' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={`popover popover-${align} ${className}`} role="menu">
      {children}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onClick, danger, hint }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} role="menuitem">
      {Icon && <Icon size={16} />}
      <span>{children}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

// ---------------- Modal ----------------
export function Modal({ title, onClose, children, footer, width = 460 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h3>{title}</h3>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------- Toasts ----------------
const ToastCtx = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback((message, opts = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-3), { id, message, ...opts }]);
    const ms = opts.duration ?? (opts.error ? 6000 : 4000);
    if (ms > 0) setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);
  show.dismiss = dismiss;
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            <span>{t.message}</span>
            {t.action && (
              <button type="button" onClick={() => { t.action.onClick(); dismiss(t.id); }}>
                {t.action.label}
              </button>
            )}
            <IconButton icon={X} label="Dismiss" size={16} onClick={() => dismiss(t.id)} />
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ---------------- Small helpers ----------------
export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="check"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
    />
  );
}
