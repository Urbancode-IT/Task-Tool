import React, { useEffect, useRef, useState } from 'react';
import { MdWarningAmber } from 'react-icons/md';
import { CONFIRM_EVENT } from '../utils/confirm';
import './ConfirmDialog.css';

/**
 * App-wide confirmation dialog. Mounted once (beside <ToastContainer>); listens
 * for CONFIRM_EVENT dispatched by confirmDialog() and resolves that call's
 * promise with the user's choice. Replaces native window.confirm pop-ups.
 *
 * A request carrying `reason` (see reasonDialog) additionally requires the user to
 * type a reason: the primary button stays disabled until the text is long enough,
 * and the promise resolves with that text instead of `true`.
 */
export default function ConfirmDialog() {
  const [dialog, setDialog] = useState(null); // { title, message, confirmLabel, cancelLabel, danger, reason, resolve }
  const [reasonText, setReasonText] = useState('');
  const confirmBtnRef = useRef(null);
  const reasonRef = useRef(null);

  useEffect(() => {
    const handler = (event) => {
      const detail = event.detail;
      if (!detail || typeof detail.resolve !== 'function') return;
      // If one is already open, resolve it as cancelled before showing the next.
      setDialog((prev) => {
        if (prev) prev.resolve(prev.reason ? null : false);
        return detail;
      });
      setReasonText('');
    };
    window.addEventListener(CONFIRM_EVENT, handler);
    return () => window.removeEventListener(CONFIRM_EVENT, handler);
  }, []);

  useEffect(() => {
    if (!dialog) return;
    // The reason is the point of that variant, so focus the field, not the button.
    if (dialog.reason) reasonRef.current?.focus();
    else confirmBtnRef.current?.focus();
  }, [dialog]);

  if (!dialog) return null;

  const askingReason = Boolean(dialog.reason);
  const minLength = dialog.reason?.minLength ?? 5;
  const maxLength = dialog.reason?.maxLength ?? 500;
  const trimmedReason = reasonText.replace(/\s+/g, ' ').trim();
  const reasonReady = !askingReason || trimmedReason.length >= minLength;

  const close = (confirmed) => {
    if (!confirmed) {
      dialog.resolve(askingReason ? null : false);
    } else {
      dialog.resolve(askingReason ? trimmedReason : true);
    }
    setDialog(null);
    setReasonText('');
  };

  const submit = () => {
    if (!reasonReady) {
      reasonRef.current?.focus();
      return;
    }
    close(true);
  };

  // Project convention: Enter runs the primary action, Shift+Enter adds a newline,
  // Escape cancels.
  const onKeyDown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
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
        {askingReason && (
          <div className="confirm-reason">
            <label className="confirm-reason-label" htmlFor="confirm-reason-input">
              {dialog.reason.label} <span className="confirm-reason-required">(required)</span>
            </label>
            <textarea
              id="confirm-reason-input"
              ref={reasonRef}
              className="confirm-reason-input"
              rows={3}
              maxLength={maxLength}
              value={reasonText}
              placeholder={dialog.reason.placeholder || ''}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <p className="confirm-reason-hint">
              {reasonReady
                ? 'This is saved to the deletion log with your name and the time.'
                : `At least ${minLength} characters. Saved to the deletion log with your name and the time.`}
            </p>
          </div>
        )}
        <div className="confirm-actions">
          <button type="button" className="confirm-btn confirm-btn-cancel" onClick={() => close(false)}>
            {dialog.cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmBtnRef}
            className={`confirm-btn ${dialog.danger ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
            disabled={!reasonReady}
            onClick={submit}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
