import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
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
 * By default the value is the username, which plugs into the name-based owner_name /
 * teammates storage. With by="id" the value is the user id as a string instead (task
 * assignees).
 *   multiple=false → value is a single key, onChange(key)
 *   multiple=true  → value is a key[], onChange(key[])
 *   emptyLabel     → single mode only: a first option (e.g. "—" or "Me") that clears it
 *
 * Keyboard: on the closed picker, Enter, Space, ArrowDown or typing a letter opens it
 * (typing starts the search). In the menu, ArrowUp/ArrowDown move, Enter picks,
 * Backspace on an empty search removes the last chip, Escape or Tab closes.
 */
export default function MemberPicker({
  members = [],
  value,
  onChange,
  multiple = false,
  placeholder = 'Select…',
  by = 'name',
  searchPlaceholder = 'Search IT team…',
  ariaLabel,
  emptyLabel,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const ref = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const nameOf = (m) => (m.username || m.name || '').trim();
  const keyOf = (m) => (by === 'id' ? String(m.user_id ?? m.id ?? '') : nameOf(m));
  const selected = (multiple ? (Array.isArray(value) ? value : []) : value ? [value] : []).map(String);
  const isSelected = (key) => selected.includes(key);
  // What a chip shows: the member's name, or the raw value for someone not in the list.
  const labelOf = (key) => {
    if (by !== 'id') return key;
    const m = members.find((x) => keyOf(x) === key);
    return m ? nameOf(m) || key : key;
  };

  // The rows in the menu, in order: the optional empty choice, then matching people.
  // Filtering is immediate (no debounce) so Enter always picks what is on screen.
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set();
    const people = members
      .filter((m) => {
        const name = nameOf(m);
        const key = keyOf(m);
        if (!name || !key || seen.has(key)) return false;
        seen.add(key);
        return !q || name.toLowerCase().includes(q);
      })
      .map((m) => ({ key: keyOf(m), name: nameOf(m), member: m }));
    const showEmpty = !multiple && emptyLabel && (!q || emptyLabel.toLowerCase().includes(q));
    return showEmpty ? [{ key: '', name: emptyLabel, member: null }, ...people] : people;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, query, by, multiple, emptyLabel]);

  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  // Keep the highlighted row in view while moving with the arrow keys.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const openMenu = (seed = '') => {
    setQuery(seed);
    // Start on the current choice in single mode, otherwise on the first row.
    const current = !multiple && selected[0] != null ? options.findIndex((o) => o.key === selected[0]) : -1;
    setActive(seed ? 0 : Math.max(current, 0));
    setOpen(true);
  };

  const closeMenu = (refocus = true) => {
    setOpen(false);
    setQuery('');
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const toggle = (key) => {
    if (multiple) {
      onChange(isSelected(key) ? selected.filter((n) => n !== key) : [...selected, key]);
      // Clear the search so the next name can be typed straight away.
      setQuery('');
    } else {
      // Without an empty choice, picking the current person again clears it, as before.
      onChange(!emptyLabel && key !== '' && isSelected(key) ? '' : key);
      closeMenu();
    }
  };

  const onTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openMenu();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing on the closed picker starts a search with that letter.
      e.preventDefault();
      openMenu(e.key);
    } else if (e.key === 'Backspace' && multiple && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(options.length - 1, 0));
    } else if (e.key === 'Enter') {
      // Enter picks the highlighted person and never submits the surrounding form.
      e.preventDefault();
      e.stopPropagation();
      const option = options[activeIndex];
      if (option) toggle(option.key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    } else if (e.key === 'Tab') {
      closeMenu(false);
    } else if (e.key === 'Backspace' && !query && multiple && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  const listId = `mp-list-${useId().replace(/:/g, '')}`;

  return (
    // Forms wrap the picker in a <label>; cancelling the click stops the label from
    // re-clicking the trigger (which would reopen the menu after removing a chip).
    <div className="mp" ref={ref} onClick={(e) => e.preventDefault()}>
      <button
        ref={triggerRef}
        type="button"
        className="mp-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {selected.length === 0 || (!multiple && selected[0] === '') ? (
          <span className="mp-placeholder">{emptyLabel && !multiple ? emptyLabel : placeholder}</span>
        ) : multiple ? (
          <span className="mp-chips">
            {selected.map((key) => (
              <span key={key} className="mp-chip">
                {labelOf(key)}
                <span
                  className="mp-chip-x"
                  role="button"
                  tabIndex={-1}
                  aria-label={`Remove ${labelOf(key)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(selected.filter((n) => n !== key));
                  }}
                >
                  <MdClose size={13} />
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="mp-single">{labelOf(selected[0])}</span>
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
              placeholder={searchPlaceholder}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
              aria-label={ariaLabel ? `Search ${ariaLabel}` : 'Search people'}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <div className="mp-list" id={listId} role="listbox" aria-multiselectable={multiple || undefined} ref={listRef}>
            {options.length === 0 ? (
              <div className="mp-empty">No members found</div>
            ) : (
              options.map((option, index) => {
                const sel = option.key === '' ? !selected.length || selected[0] === '' : isSelected(option.key);
                return (
                  <button
                    type="button"
                    key={option.key || '__empty'}
                    id={`${listId}-${index}`}
                    data-index={index}
                    role="option"
                    aria-selected={sel}
                    tabIndex={-1}
                    className={`mp-option ${sel ? 'selected' : ''} ${index === activeIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActive(index)}
                    // Keep focus in the search box so the keyboard keeps working.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(option.key)}
                  >
                    {option.member ? <MpAvatar member={option.member} /> : <span className="mp-avatar mp-avatar-empty" />}
                    <span className="mp-option-name">{option.name}</span>
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
