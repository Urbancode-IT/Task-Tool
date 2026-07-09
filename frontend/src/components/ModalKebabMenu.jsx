import React, { useEffect, useRef, useState } from 'react';
import { MdMoreVert } from 'react-icons/md';
import './ModalKebabMenu.css';

/**
 * Three-dots ("kebab") menu for modal headers.
 * Pass an array of actions: { label, icon, onClick, danger }.
 * Renders nothing when no actions are provided.
 */
export default function ModalKebabMenu({ actions = [] }) {
  const items = actions.filter(Boolean);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="modal-kebab" ref={ref}>
      <button
        type="button"
        className="it-updates-modal-close"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
      >
        <MdMoreVert size={22} />
      </button>
      {open && (
        <div className="modal-kebab-menu">
          {items.map((a, i) => (
            <button
              key={i}
              type="button"
              className={`modal-kebab-item ${a.danger ? 'danger' : ''}`}
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
