import React, { useEffect, useState, useCallback } from 'react';
import { MdCheckCircle, MdError, MdInfo, MdClose } from 'react-icons/md';
import { TOAST_EVENT } from '../utils/toast';
import './Toast.css';

const TOAST_ICON = {
  success: MdCheckCircle,
  error: MdError,
  info: MdInfo,
};

let nextId = 1;

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail || {};
      const message = detail.message;
      if (!message) return;
      const id = nextId++;
      const type = detail.type || 'info';
      const duration = typeof detail.duration === 'number' ? detail.duration : 3500;
      setToasts((prev) => [...prev, { id, message, type }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    };
    window.addEventListener(TOAST_EVENT, handler);
    return () => window.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="app-toast-container" role="status" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.type] || MdInfo;
        return (
          <div key={t.id} className={`app-toast app-toast-${t.type}`}>
            <span className="app-toast-icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="app-toast-message">{t.message}</span>
            <button
              type="button"
              className="app-toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
            >
              <MdClose size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
