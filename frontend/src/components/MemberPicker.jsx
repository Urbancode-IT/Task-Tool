import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MdSearch, MdClose, MdExpandMore, MdCheck } from 'react-icons/md';
import './MemberPicker.css';

function MpAvatar({ member, size = 22 }) {
  const name = member.username || member.name || 'U';
  const src = member.profile_image || member.image;
  if (src) {
    return <img className="mp-avatar" src={src} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <span className="mp-avatar mp-avatar-fallback" style={{ width: size, height: size }}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Searchable people picker over a members list ({ user_id, username, profile_image }).
 * Works with usernames as the value so it plugs into the existing owner_name /
 * teammates (name-based) storage.
 *   multiple=false → value is a username string, onChange(username)
 *   multiple=true  → value is a username[] , onChange(username[])
 */
export default function MemberPicker({
  members = [],
  value,
  onChange,
  multiple = false,
  placeholder = 'Select…',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];
  const isSelected = (name) => selected.includes(name);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set();
    return members.filter((m) => {
      const name = (m.username || m.name || '').trim();
      if (!name || seen.has(name)) return false;
      seen.add(name);
      return !q || name.toLowerCase().includes(q);
    });
  }, [members, query]);

  const toggle = (name) => {
    if (multiple) {
      onChange(isSelected(name) ? selected.filter((n) => n !== name) : [...selected, name]);
    } else {
      onChange(isSelected(name) ? '' : name);
      setOpen(false);
    }
  };

  return (
    <div className="mp" ref={ref}>
      <button
        type="button"
        className="mp-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        {selected.length === 0 ? (
          <span className="mp-placeholder">{placeholder}</span>
        ) : multiple ? (
          <span className="mp-chips">
            {selected.map((name) => (
              <span key={name} className="mp-chip">
                {name}
                <span
                  className="mp-chip-x"
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(selected.filter((n) => n !== name));
                  }}
                >
                  <MdClose size={13} />
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="mp-single">{selected[0]}</span>
        )}
        <MdExpandMore size={18} className="mp-caret" />
      </button>

      {open && (
        <div className="mp-menu">
          <div className="mp-search">
            <MdSearch size={16} />
            <input
              type="text"
              autoFocus
              value={query}
              placeholder="Search IT team…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mp-list">
            {filtered.length === 0 ? (
              <div className="mp-empty">No members found</div>
            ) : (
              filtered.map((m) => {
                const name = m.username || m.name;
                const sel = isSelected(name);
                return (
                  <button
                    type="button"
                    key={m.user_id ?? name}
                    className={`mp-option ${sel ? 'selected' : ''}`}
                    onClick={() => toggle(name)}
                  >
                    <MpAvatar member={m} />
                    <span className="mp-option-name">{name}</span>
                    {sel && <MdCheck size={16} className="mp-option-check" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
