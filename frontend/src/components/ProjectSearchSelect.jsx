import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MdSearch, MdClose } from 'react-icons/md';
import './ProjectSearchSelect.css';

/**
 * Type-ahead project filter. Replaces the plain "All projects" <select> with a
 * search field that recommends matching projects char by char.
 *
 * Props:
 *  - projects: array of { id|project_id, name|project_name }
 *  - value: currently selected project id (string|number) or '' for all
 *  - onChange: (id: string) => void  ('' clears the filter)
 *  - placeholder: input placeholder text
 */
export default function ProjectSearchSelect({
  projects = [],
  value = '',
  onChange,
  placeholder = 'Search projects...',
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const options = useMemo(
    () =>
      (projects || [])
        .map((p) => ({
          id: String(p.id ?? p.project_id ?? ''),
          name: p.name ?? p.project_name ?? '',
        }))
        .filter((o) => o.id),
    [projects]
  );

  const selectedName = useMemo(() => {
    const match = options.find((o) => o.id === String(value ?? ''));
    return match ? match.name : '';
  }, [options, value]);

  // Keep the field text in sync with the externally selected project.
  useEffect(() => {
    setQuery(selectedName);
  }, [selectedName]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || q === selectedName.toLowerCase()) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query, selectedName]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(selectedName); // discard unconfirmed typing
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [selectedName]);

  const selectProject = (id) => {
    onChange?.(id);
    setOpen(false);
  };

  const clearSelection = () => {
    onChange?.('');
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="project-search" ref={wrapRef}>
      <div className="project-search-field">
        <MdSearch size={16} className="project-search-icon" />
        <input
          type="text"
          className="project-search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        {(value || query) && (
          <button
            type="button"
            className="project-search-clear"
            onClick={clearSelection}
            title="Clear project filter"
          >
            <MdClose size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul className="project-search-menu">
          <li
            className={`project-search-option ${!value ? 'active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              clearSelection();
            }}
          >
            Projects
          </li>
          {matches.map((o) => (
            <li
              key={o.id}
              className={`project-search-option ${String(value) === o.id ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectProject(o.id);
              }}
            >
              {o.name}
            </li>
          ))}
          {!matches.length && <li className="project-search-empty">No projects found</li>}
        </ul>
      )}
    </div>
  );
}
