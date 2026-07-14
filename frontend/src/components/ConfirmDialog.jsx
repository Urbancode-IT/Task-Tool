import React, { useEffect, useRef, useState } from 'react';
import { MdWarningAmber } from 'react-icons/md';
import { CONFIRM_EVENT } from '../utils/confirm';
import './ConfirmDialog.css';

/**
 * App-wide confirmation dialog. Mounted once (beside <ToastContainer>); listens
 * for CONFIRM_EVENT dispatched by confirmDialog() and resolves that call's
 * promise with the user's choice. Replaces native window.confirm pop-ups.
 */
export default function ConfirmDialog() {
  const [dialog, setDialog] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, resolve }
  const confirmBtnRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail;
      if (!detail || typeof detail.resolve !== 'function') return;
      // If one is already open, resolve it as cancelled before showing the next.
      setDialog((prev) => {
        if (prev) prev.resolve(false);
        return detail;
      });
    };
    window.addEventListener(CONFIRM_EVENT, handler);
    return () => window.removeEventListener(CONFIRM_EVENT, handler);
  }, []);

  useEffect(() => {
    if (dialog) confirmBtnRef.current?.focus();
  }, [dialog]);

  if (!dialog) return null;

  const close = (result) => {
    dialog.resolve(result);
    setDialog(null);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    }
  };

  return (
    <div
      className="confirm-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false);
      }}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={onKeyDown}
      >
        <div className={`confirm-icon ${dialog.danger ? 'confirm-icon-danger' : ''}`} aria-hidden="true">
          <MdWarningAmber size={22} />
        </div>
        <h2 className="confirm-title" id="confirm-title">
          {dialog.title}
        </h2>
        {dialog.message && <p className="confirm-message">{dialog.message}</p>}
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => close(false)}>
            {dialog.cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className={`confirm-btn ${dialog.danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
            onClick={() => close(true)}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
