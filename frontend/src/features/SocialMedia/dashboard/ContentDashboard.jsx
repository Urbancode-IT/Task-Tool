import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Clapperboard,
  FileSearch,
  FileText,
  Folder,
  GalleryHorizontalEnd,
  House,
  Image as ImageIcon,
  LayoutGrid,
  MoreVertical,
  Newspaper,
  Palette,
  Pencil,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Target,
  Upload,
  X,
} from 'lucide-react';
import { toastSuccess } from '../../../utils/toast';
import {
  BRANCHES,
  PEOPLE,
  PLATFORMS,
  STAGES,
  STATUS_LEGEND,
  STATUSES,
  TYPES,
  blankRequirement,
  formatDeadline,
  initials,
  loadItems,
  personByName,
  saveItems,
  stageCounts,
  totals,
} from './data';
import './dashboard.css';

const STAGE_ICONS = {
  requirement: FileText,
  content_generation: Pencil,
  content_approval: ShieldCheck,
  designing_editing: Palette,
  save_to_drive: Folder,
  final_approval: Check,
  ready_to_post: CalendarDays,
  published: Send,
};

const TYPE_ICONS = {
  reel: Clapperboard,
  video: Play,
  poster: ImageIcon,
  carousel: GalleryHorizontalEnd,
  blog: Newspaper,
};

const NAV = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'social', label: 'Social Media', icon: 'app' },
  { key: 'pipeline', label: 'Content Pipeline', icon: FileSearch },
  { key: 'calendar', label: 'Calendar', icon: Calendar },
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const NOTICES = [
  { title: 'Festival Greetings needs approval', meta: 'Content Approval · Rohit Kumar' },
  { title: 'Admission Open was rejected', meta: 'Returned to the content team' },
  { title: '5 posts are ready to publish', meta: 'Ready to Post · Digital Team' },
];

function stageOf(key) {
  return STAGES.find((stage) => stage.key === key) || STAGES[0];
}

function typeOf(key) {
  return TYPES.find((type) => type.key === key) || TYPES[0];
}

function statusOf(key) {
  return STATUSES.find((status) => status.key === key) || STATUSES[0];
}

function PlatformIcons({ platforms }) {
  const list = Array.isArray(platforms) ? platforms : [];
  return (
    <span className="smd-platforms">
      {list.map((key) => {
        if (key === 'instagram') {
          return (
            <svg key={key} width="14" height="14" viewBox="0 0 16 16" aria-label="Instagram">
              <rect width="16" height="16" rx="4" fill="url(#smd-ig)" />
              <circle cx="8" cy="8" r="3.1" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="11.6" cy="4.4" r="0.7" fill="#fff" />
            </svg>
          );
        }
        if (key === 'facebook') {
          return (
            <svg key={key} width="14" height="14" viewBox="0 0 16 16" aria-label="Facebook">
              <circle cx="8" cy="8" r="8" fill="#1877F2" />
              <path fill="#fff" d="M9.1 12.6V8.5h1.3l.2-1.5H9.1V6.1c0-.4.1-.7.7-.7H10.7V4.1c-.2 0-.8-.1-1.5-.1-1.5 0-2.5.9-2.5 2.5v1.5H5.4v1.5h1.3v4.1h2.4z" />
            </svg>
          );
        }
        if (key === 'linkedin') {
          return (
            <svg key={key} width="14" height="14" viewBox="0 0 16 16" aria-label="LinkedIn">
              <rect width="16" height="16" rx="3" fill="#0A66C2" />
              <path fill="#fff" d="M4.2 6.4h1.7v5.4H4.2V6.4zm.8-2.6a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7.2 6.4h1.6v.7h.1c.2-.4.8-.8 1.7-.8 1.8 0 2.1 1.2 2.1 2.7v2.8H11v-2.5c0-.6 0-1.4-1-.1.4 0-1.1.4-1.1 1.3v2.6H7.2V6.4z" />
            </svg>
          );
        }
        if (key === 'youtube') {
          return (
            <svg key={key} width="14" height="14" viewBox="0 0 16 16" aria-label="YouTube">
              <rect width="16" height="16" rx="4" fill="#FF0033" />
              <path fill="#fff" d="M6.6 5.4v5.2L11.2 8 6.6 5.4z" />
            </svg>
          );
        }
        return (
          <svg key={key} width="14" height="14" viewBox="0 0 16 16" aria-label="Google Ads">
            <path d="M3.2 12.6 8 3.2l1.7 2.8-4.6 6.6z" fill="#FBBC04" />
            <path d="M8 3.2 12.8 12.6H10.6L8 7.6z" fill="#4285F4" />
            <circle cx="4.1" cy="12.2" r="1.5" fill="#34A853" />
          </svg>
        );
      })}
    </span>
  );
}

function ContentTypeBadge({ type }) {
  const meta = typeOf(type);
  const Icon = TYPE_ICONS[meta.key] || FileText;
  return (
    <span className="smd-badge" style={{ background: meta.bg, color: meta.ink }}>
      <Icon size={11} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

function StageBadge({ stage }) {
  const meta = stageOf(stage);
  const Icon = STAGE_ICONS[meta.key] || FileText;
  return (
    <span className="smd-badge" style={{ background: meta.bg, color: meta.ink }}>
      <Icon size={11} strokeWidth={2.2} />
      {meta.label}
    </span>
  );
}

const STATUS_ICONS = {
  submitted: Send,
  in_progress: Clock,
  pending: Clock,
  completed: Check,
  scheduled: Calendar,
  live: Check,
  rejected: X,
  approved: Check,
};

function StatusBadge({ status }) {
  const meta = statusOf(status);
  const Icon = STATUS_ICONS[meta.key] || Check;
  return (
    <span className="smd-badge" style={{ background: meta.bg, color: meta.ink }}>
      <Icon size={10} strokeWidth={2.6} />
      {meta.label}
    </span>
  );
}

function UserAvatar({ name, size = 'sm' }) {
  const person = personByName(name);
  return (
    <span className={`smd-avatar ${size === 'lg' ? 'lg' : ''}`} style={size === 'lg' ? undefined : { background: person.color }}>
      {initials(name)}
    </span>
  );
}

function ProgressBar({ value, rejected }) {
  const amount = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="smd-progress">
      <div className="smd-progress-track">
        <div className={`smd-progress-fill${rejected ? ' bad' : ''}`} style={{ width: `${amount}%` }} />
      </div>
      <em>{amount}%</em>
    </div>
  );
}

function WorkflowSummary({ counts, active, onSelect }) {
  return (
    <div className="smd-stages">
      {STAGES.map((stage, index) => {
        const Icon = STAGE_ICONS[stage.key];
        return (
          <React.Fragment key={stage.key}>
            <button
              type="button"
              className={`smd-stage${active === stage.key ? ' active' : ''}`}
              style={{ background: stage.bg, borderColor: stage.border, color: stage.ink }}
              onClick={() => onSelect(active === stage.key ? '' : stage.key)}
            >
              <span className="smd-stage-icon" style={{ background: stage.ink }}>
                <Icon size={14} strokeWidth={2.2} />
              </span>
              <span className="smd-stage-copy">
                <span className="smd-stage-label">{stage.label}</span>
                <span className="smd-stage-count">{counts[stage.key] || 0}</span>
                <span className="smd-stage-sub">{stage.subtitle}</span>
              </span>
            </button>
            {index < STAGES.length - 1 && <ChevronRight className="smd-arrow" size={14} strokeWidth={2.2} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function FilterToolbar({ query, branch, type, status, onQuery, onBranch, onType, onStatus, onCreate, onExport }) {
  return (
    <div className="smd-toolbar">
      <div className="smd-toolbar-left">
        <label className="smd-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search by task ID, branch or content..."
          />
        </label>
        <select className="smd-select" value={branch} onChange={(event) => onBranch(event.target.value)} aria-label="Branch">
          <option value="">All Branches</option>
          {BRANCHES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select className="smd-select" value={type} onChange={(event) => onType(event.target.value)} aria-label="Content type">
          <option value="">All Content Types</option>
          {TYPES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
        <select className="smd-select" value={status} onChange={(event) => onStatus(event.target.value)} aria-label="Status">
          <option value="">All Statuses</option>
          {STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </div>
      <div className="smd-toolbar-right">
        <button type="button" className="smd-primary" onClick={onCreate}>
          <Plus size={14} />
          New Requirement
        </button>
        <button type="button" className="smd-ghost" onClick={onExport}>
          <Upload size={14} />
          Export
        </button>
      </div>
    </div>
  );
}

function ColorLegend() {
  return (
    <div className="smd-legends">
      <div className="smd-legend">
        <b>Stage Colours:</b>
        {STAGES.map((stage) => (
          <span key={stage.key}><i style={{ background: stage.dot }} />{stage.label}</span>
        ))}
      </div>
      <div className="smd-legend">
        <b>Status Colours:</b>
        {STATUS_LEGEND.map((status) => (
          <span key={status.key}><i style={{ background: status.dot }} />{status.label}</span>
        ))}
      </div>
    </div>
  );
}

function ContentTable({ rows, menuId, onMenu }) {
  return (
    <div className="smd-table-wrap">
      <table className="smd-table">
        <colgroup>
          <col style={{ width: 36 }} />
          <col style={{ width: 118 }} />
          <col style={{ width: 168 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 108 }} />
          <col style={{ width: 158 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 98 }} />
          <col style={{ width: 88 }} />
          <col style={{ width: 150 }} />
          <col style={{ width: 40 }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>Task ID</th>
            <th>Content Title</th>
            <th>Branch</th>
            <th>Content Type</th>
            <th>Stage</th>
            <th>Status</th>
            <th>Assigned To</th>
            <th>Deadline</th>
            <th>Platforms</th>
            <th>Progress</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="smd-empty" colSpan={12}>No content matches these filters.</td>
            </tr>
          )}
          {rows.map((item) => {
            const person = personByName(item.assignee);
            return (
              <tr key={item.id}>
                <td>{item.no}</td>
                <td className="smd-id">{item.id}</td>
                <td>
                  <div className="smd-title-cell">
                    <strong>{item.title}</strong>
                    <span>{item.subtitle}</span>
                  </div>
                </td>
                <td>{item.branch}</td>
                <td><ContentTypeBadge type={item.type} /></td>
                <td><StageBadge stage={item.stage} /></td>
                <td><StatusBadge status={item.status} /></td>
                <td>
                  <div className="smd-person">
                    <UserAvatar name={item.assignee} />
                    <div className="smd-person-copy">
                      <strong>{person.name}</strong>
                      <span>{person.role}</span>
                    </div>
                  </div>
                </td>
                <td>{formatDeadline(item.deadline)}</td>
                <td><PlatformIcons platforms={item.platforms} /></td>
                <td><ProgressBar value={item.progress} rejected={item.status === 'rejected'} /></td>
                <td>
                  <button
                    type="button"
                    className={`smd-more${menuId === item.id ? ' open' : ''}`}
                    aria-label={`Actions for ${item.title}`}
                    data-pop="menu"
                    onClick={(event) => onMenu(event, item.id)}
                  >
                    <MoreVertical size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionsDropdown({ menu, onAction }) {
  if (!menu) return null;
  const items = [
    ['view', 'View Details'],
    ['edit', 'Edit Content'],
    ['stage', 'Change Stage'],
    ['assign', 'Assign User'],
    ['delete', 'Delete'],
  ];
  return (
    <div className="smd-menu" style={{ top: menu.top, left: menu.left }} data-pop="menu">
      {items.map(([key, label]) => (
        <button key={key} type="button" className={key === 'delete' ? 'danger' : ''} onClick={() => onAction(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function RequirementModal({ mode, draft, onChange, onClose, onSave }) {
  const set = (key, value) => onChange({ ...draft, [key]: value });
  const togglePlatform = (key) => {
    const has = draft.platforms.includes(key);
    const platforms = has ? draft.platforms.filter((item) => item !== key) : [...draft.platforms, key];
    set('platforms', platforms);
  };
  return (
    <div className="smd-mask" onMouseDown={onClose}>
      <form
        className="smd-modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.title.trim()) return;
          onSave({ ...draft, title: draft.title.trim(), subtitle: draft.subtitle.trim(), progress: Number(draft.progress) || 0 });
        }}
      >
        <div className="smd-modal-head">
          <h2>{mode === 'create' ? 'New Requirement' : 'Edit Content'}</h2>
          <button type="button" className="smd-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="smd-form">
          <label className="wide">Content title
            <input className="smd-field" value={draft.title} onChange={(event) => set('title', event.target.value)} required />
          </label>
          <label className="wide">Subtitle
            <input className="smd-field" value={draft.subtitle} onChange={(event) => set('subtitle', event.target.value)} />
          </label>
          <label>Branch
            <select className="smd-select" value={draft.branch} onChange={(event) => set('branch', event.target.value)}>
              {BRANCHES.map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Content type
            <select className="smd-select" value={draft.type} onChange={(event) => set('type', event.target.value)}>
              {TYPES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label>Stage
            <select className="smd-select" value={draft.stage} onChange={(event) => set('stage', event.target.value)}>
              {STAGES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label>Status
            <select className="smd-select" value={draft.status} onChange={(event) => set('status', event.target.value)}>
              {STATUSES.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label>Assigned to
            <select className="smd-select" value={draft.assignee} onChange={(event) => set('assignee', event.target.value)}>
              {PEOPLE.map((item) => <option key={item.name}>{item.name}</option>)}
            </select>
          </label>
          <label>Deadline
            <input className="smd-field" type="date" value={draft.deadline} onChange={(event) => set('deadline', event.target.value)} required />
          </label>
          <label className="wide">Platforms
            <span className="smd-checks">
              {PLATFORMS.map((item) => (
                <label key={item.key}>
                  <input type="checkbox" checked={draft.platforms.includes(item.key)} onChange={() => togglePlatform(item.key)} />
                  {item.label}
                </label>
              ))}
            </span>
          </label>
          <label className="wide">Progress
            <span className="smd-range">
              <input type="range" min="0" max="100" value={draft.progress} onChange={(event) => set('progress', Number(event.target.value))} />
              <em style={{ fontStyle: 'normal', fontSize: 12 }}>{draft.progress}%</em>
            </span>
          </label>
        </div>
        <div className="smd-actions">
          <button type="button" className="smd-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="smd-primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function ViewModal({ item, onClose, onPatch }) {
  const person = personByName(item.assignee);
  return (
    <div className="smd-mask" onMouseDown={onClose}>
      <div className="smd-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="smd-modal-head">
          <h2>{item.title}</h2>
          <button type="button" className="smd-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <dl className="smd-detail">
          <dt>Task ID</dt><dd>{item.id}</dd>
          <dt>Subtitle</dt><dd>{item.subtitle || '—'}</dd>
          <dt>Branch</dt><dd>{item.branch}</dd>
          <dt>Type</dt><dd>{typeOf(item.type).label}</dd>
          <dt>Stage</dt><dd>{stageOf(item.stage).label}</dd>
          <dt>Assigned</dt><dd>{person.name} · {person.role}</dd>
          <dt>Deadline</dt><dd>{formatDeadline(item.deadline)}</dd>
          <dt>Platforms</dt><dd><PlatformIcons platforms={item.platforms} /></dd>
        </dl>
        <div className="smd-form" style={{ marginTop: 12 }}>
          <label>Status
            <select className="smd-select" value={item.status} onChange={(event) => onPatch({ status: event.target.value })}>
              {STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
            </select>
          </label>
          <label>Progress
            <span className="smd-range">
              <input type="range" min="0" max="100" value={item.progress} onChange={(event) => onPatch({ progress: Number(event.target.value) })} />
              <em style={{ fontStyle: 'normal', fontSize: 12 }}>{item.progress}%</em>
            </span>
          </label>
        </div>
        <div style={{ marginTop: 10 }}><ProgressBar value={item.progress} rejected={item.status === 'rejected'} /></div>
      </div>
    </div>
  );
}

function ChoiceModal({ title, options, value, onClose, onPick }) {
  return (
    <div className="smd-mask" onMouseDown={onClose}>
      <div className="smd-modal narrow" onMouseDown={(event) => event.stopPropagation()}>
        <div className="smd-modal-head">
          <h2>{title}</h2>
          <button type="button" className="smd-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {options.map((option) => (
          <button key={option.key} type="button" className={`smd-choice${option.key === value ? ' on' : ''}`} onClick={() => onPick(option.key)}>
            <i style={{ background: option.dot || option.color || '#1677ED' }} />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DeleteModal({ item, onClose, onConfirm }) {
  return (
    <div className="smd-mask" onMouseDown={onClose}>
      <div className="smd-modal narrow" onMouseDown={(event) => event.stopPropagation()}>
        <div className="smd-modal-head">
          <h2>Delete requirement</h2>
          <button type="button" className="smd-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#3d5674' }}>
          Delete <strong>{item.id}</strong> — {item.title}? This removes it from the pipeline.
        </p>
        <div className="smd-actions">
          <button type="button" className="smd-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="smd-primary" style={{ background: '#e5484d' }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ section, stats, onNav }) {
  return (
    <aside className="smd-side">
      <div className="smd-brand">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="13" cy="16" r="8" fill="#7C6BF2" />
          <circle cx="20" cy="15" r="7" fill="#3B82F6" opacity="0.92" />
        </svg>
        <span>Seyals</span>
      </div>
      <nav className="smd-nav">
        {NAV.map((item) => {
          const active = item.key === 'social' || item.key === 'pipeline'
            ? section === 'pipeline'
            : section === item.key;
          const Icon = item.icon;
          return (
            <button key={item.key} type="button" className={`smd-nav-btn${active ? ' active' : ''}`} onClick={() => onNav(item.key)}>
              {item.icon === 'app' ? (
                <span className="smd-app-icon"><LayoutGrid size={11} color="#fff" strokeWidth={2.4} /></span>
              ) : (
                <Icon size={16} strokeWidth={2} />
              )}
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="smd-stat">
        <span className="smd-stat-icon"><Target size={14} /></span>
        <div>
          <div className="smd-stat-label">Total Content</div>
          <div className="smd-stat-value">{stats.total}</div>
          <div className="smd-stat-sub">{stats.inProgress} in progress • {stats.completed} completed</div>
        </div>
      </div>
    </aside>
  );
}

function exportCsv(rows) {
  const header = ['#', 'Task ID', 'Content Title', 'Subtitle', 'Branch', 'Content Type', 'Stage', 'Status', 'Assigned To', 'Role', 'Deadline', 'Platforms', 'Progress'];
  const lines = rows.map((item) => {
    const person = personByName(item.assignee);
    const cells = [
      item.no,
      item.id,
      item.title,
      item.subtitle,
      item.branch,
      typeOf(item.type).label,
      stageOf(item.stage).label,
      statusOf(item.status).label,
      person.name,
      person.role,
      formatDeadline(item.deadline),
      (item.platforms || []).join(' '),
      `${item.progress}%`,
    ];
    return cells.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'social-content.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function ContentDashboard({ onNavigate, onLogout }) {
  const [items, setItems] = useState(loadItems);
  const [query, setQuery] = useState('');
  const [branch, setBranch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [stage, setStage] = useState('');
  const [section, setSection] = useState('pipeline');
  const [menu, setMenu] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [modal, setModal] = useState(null);

  const commit = (next) => {
    setItems(next);
    saveItems(next);
  };

  useEffect(() => {
    if (!modal) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') setModal(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  useEffect(() => {
    const open = menu || bellOpen || userOpen;
    if (!open) return undefined;
    const close = (event) => {
      if (event.target.closest('[data-pop]')) return;
      setMenu(null);
      setBellOpen(false);
      setUserOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setBellOpen(false);
        setUserOpen(false);
        setModal(null);
      }
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, bellOpen, userOpen]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (stage && item.stage !== stage) return false;
      if (branch && item.branch !== branch) return false;
      if (type && item.type !== type) return false;
      if (status && item.status !== status) return false;
      if (!needle) return true;
      return [item.id, item.title, item.subtitle, item.branch].join(' ').toLowerCase().includes(needle);
    });
  }, [items, query, branch, type, status, stage]);

  const counts = useMemo(() => stageCounts(items), [items]);
  const stats = useMemo(() => totals(items), [items]);

  const openMenu = (event, id) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 168;
    const left = Math.min(rect.right - width, window.innerWidth - width - 8);
    const top = rect.bottom + 150 > window.innerHeight ? rect.top - 164 : rect.bottom + 4;
    setBellOpen(false);
    setUserOpen(false);
    setMenu({ id, top, left });
  };

  const patch = (id, changes) => {
    commit(items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
    setModal((current) => (current?.item?.id === id ? { ...current, item: { ...current.item, ...changes } } : current));
  };

  const onAction = (action) => {
    const item = items.find((row) => row.id === menu?.id);
    setMenu(null);
    if (!item) return;
    if (action === 'view') setModal({ type: 'view', item });
    if (action === 'edit') setModal({ type: 'edit', draft: { ...item, platforms: [...item.platforms] } });
    if (action === 'stage') setModal({ type: 'stage', item });
    if (action === 'assign') setModal({ type: 'assign', item });
    if (action === 'delete') setModal({ type: 'delete', item });
  };

  const onNav = (key) => {
    if (key === 'home') {
      onNavigate?.('Dashboard');
      return;
    }
    if (key === 'calendar') {
      onNavigate?.('Calendar');
      return;
    }
    if (key === 'reports') {
      onNavigate?.('Overview');
      return;
    }
    if (key === 'social' || key === 'pipeline') {
      setSection('pipeline');
      return;
    }
    setSection(key);
  };

  return (
    <div className="smd">
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="smd-ig" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="#FEDA75" />
            <stop offset="0.45" stopColor="#D62976" />
            <stop offset="1" stopColor="#4F5BD5" />
          </linearGradient>
        </defs>
      </svg>
      <Sidebar section={section} stats={stats} onNav={onNav} />
      <div className="smd-main">
        <header className="smd-head">
          <div>
            <h1 className="smd-title">Social Media Content Management</h1>
            <div className="smd-crumb">
              <span>Plan</span><ChevronRight size={12} />
              <span>Create</span><ChevronRight size={12} />
              <span>Approve</span><ChevronRight size={12} />
              <span>Design</span><ChevronRight size={12} />
              <span>Publish</span>
            </div>
          </div>
          <div className="smd-head-right">
            <label className="smd-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by task ID, branch, content type..."
              />
            </label>
            <div className="smd-pop-anchor" data-pop="bell">
              <button
                type="button"
                className="smd-icon-btn"
                aria-label="Notifications"
                onClick={() => { setBellOpen((open) => !open); setUserOpen(false); setMenu(null); }}
              >
                <Bell size={16} />
                <span className="smd-dot" />
              </button>
              {bellOpen && (
                <div className="smd-pop">
                  {NOTICES.map((note) => (
                    <div key={note.title} className="smd-note">
                      <strong>{note.title}</strong>
                      <span>{note.meta}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="smd-pop-anchor" data-pop="user">
              <button
                type="button"
                className="smd-user-btn"
                onClick={() => { setUserOpen((open) => !open); setBellOpen(false); setMenu(null); }}
              >
                <span className="smd-avatar lg">DK</span>
                Digital Team
                <ChevronDown size={14} />
              </button>
              {userOpen && (
                <div className="smd-pop">
                  <div className="smd-note">
                    <strong>Digital Team</strong>
                    <span>Social media workspace</span>
                  </div>
                  {onLogout && (
                    <button type="button" className="smd-signout" onClick={onLogout}>Sign out</button>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="smd-body">
          {section === 'settings' ? (
            <div className="smd-panel">
              <h2>Settings</h2>
              <p>Digital Team workspace. Pipeline changes on this screen are saved in this browser.</p>
            </div>
          ) : (
            <>
              <WorkflowSummary counts={counts} active={stage} onSelect={setStage} />
              <FilterToolbar
                query={query}
                branch={branch}
                type={type}
                status={status}
                onQuery={setQuery}
                onBranch={setBranch}
                onType={setType}
                onStatus={setStatus}
                onCreate={() => setModal({ type: 'create', draft: blankRequirement(items) })}
                onExport={() => { exportCsv(filtered); toastSuccess('Exported the visible rows.'); }}
              />
              <ContentTable rows={filtered} menuId={menu?.id} onMenu={openMenu} />
              <ColorLegend />
            </>
          )}
        </div>
      </div>
      <ActionsDropdown menu={menu} onAction={onAction} />
      {(modal?.type === 'create' || modal?.type === 'edit') && (
        <RequirementModal
          mode={modal.type}
          draft={modal.draft}
          onChange={(draft) => setModal({ ...modal, draft })}
          onClose={() => setModal(null)}
          onSave={(draft) => {
            if (modal.type === 'create') {
              commit([...items, draft]);
              toastSuccess('Requirement added.');
            } else {
              commit(items.map((item) => (item.id === draft.id ? draft : item)));
              toastSuccess('Content updated.');
            }
            setModal(null);
          }}
        />
      )}
      {modal?.type === 'view' && (
        <ViewModal
          item={modal.item}
          onClose={() => setModal(null)}
          onPatch={(changes) => patch(modal.item.id, changes)}
        />
      )}
      {modal?.type === 'stage' && (
        <ChoiceModal
          title="Change stage"
          value={modal.item.stage}
          options={STAGES.map((item) => ({ key: item.key, label: item.label, dot: item.dot }))}
          onClose={() => setModal(null)}
          onPick={(key) => { patch(modal.item.id, { stage: key }); setModal(null); toastSuccess('Stage updated.'); }}
        />
      )}
      {modal?.type === 'assign' && (
        <ChoiceModal
          title="Assign user"
          value={modal.item.assignee}
          options={PEOPLE.map((item) => ({ key: item.name, label: `${item.name} · ${item.role}`, color: item.color }))}
          onClose={() => setModal(null)}
          onPick={(key) => { patch(modal.item.id, { assignee: key }); setModal(null); toastSuccess('Assignee updated.'); }}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteModal
          item={modal.item}
          onClose={() => setModal(null)}
          onConfirm={() => {
            commit(items.filter((item) => item.id !== modal.item.id));
            setModal(null);
            toastSuccess('Requirement deleted.');
          }}
        />
      )}
    </div>
  );
}

