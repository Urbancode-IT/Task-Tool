import { useCallback, useEffect, useState } from 'react';
import {
  MdHistory, MdRefresh, MdMenu, MdCorporateFare, MdPalette, MdGavel,
} from 'react-icons/md';
import masterApi from '../../api/masterApi';
import { toastError } from '../../utils/toast';
import SidebarUser from '../../components/SidebarUser';
import Preloader from '../../components/Preloader';
import ToastContainer from '../../components/Toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import useSidebarCollapsed from '../../utils/useSidebarCollapsed';
import { useBranding } from '../../branding/BrandingContext';
import MasterBranding from './MasterBranding';
import MasterAppearance from './MasterAppearance';
import RegulatoryCompliance from './RegulatoryCompliance';
import '../../components/MainLayout.css';
import '../ITUpdates/ITUpdatesMain.css';
import '../Admin/AdminMain.css';
import './MasterConsole.css';

/**
 * The console is deliberately narrow: it owns company identity, and records what was
 * changed here. User, role and EOD-lock administration stay in the workspace admin
 * panel, which is where they were already reachable.
 */
const SECTIONS = [
  { key: 'branding', label: 'Company & Branding', icon: MdCorporateFare, subtitle: 'Identity, links, mail signatures and navigation' },
  { key: 'appearance', label: 'Appearance', icon: MdPalette, subtitle: 'Brand assets and the colour theme' },
  { key: 'compliance', label: 'Billing & Legal', icon: MdGavel, subtitle: 'Statutory details, bank details and invoice defaults' },
  { key: 'audit', label: 'Change history', icon: MdHistory, subtitle: 'What was changed from this console, and when' },
];

const fmtDateTime = (v) => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};

/**
 * One line saying who changed what.
 *
 * The stored action is already written as a phrase ("Company profile updated (2 fields)",
 * "Company seal updated"), so this only has to tidy it and attach the actor rather than
 * decode an event code.
 */
function describeAction(entry) {
  const who = entry.username || (entry.user_id ? `User #${entry.user_id}` : 'The system');
  const raw = String(entry.action || 'made a change');
  // Drop the field count: the list underneath already shows every field.
  const what = raw.replace(/\s*\(\d+ fields?\)$/, '');
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  return `${who} — ${lower}`;
}

/**
 * The per-field change list an entry carries in `details`.
 *
 * `details` is JSONB from the server but can arrive as a string depending on the driver's
 * column typing, so parse defensively. Entries written before the diff existed have none
 * and simply show a dash.
 */
function AuditChanges({ details }) {
  let parsed = details;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  const changes = Array.isArray(parsed?.changes) ? parsed.changes : [];
  if (changes.length === 0) return <span className="master-dim">—</span>;

  return (
    <ul className="master-changes">
      {changes.map((c, i) => (
        <li key={`${c.field}-${i}`}>
          {/* `label` is the friendly form; entries written before it existed fall
              back to the raw path. */}
          <span className="master-mono">{c.label || c.field}</span>
          <span className="master-change-from">{c.from}</span>
          <span className="master-change-arrow" aria-hidden>→</span>
          <span className="master-change-to">{c.to}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The master control console. Uses the same shell, sidebar, topbar and tables as the
 * rest of Seyal (ITUpdatesMain.css / AdminMain.css) so it looks like one product; only
 * the content is master-specific.
 */
export default function MasterConsole({ currentUser, onLogout }) {
  const branding = useBranding();
  const { collapsed } = useSidebarCollapsed();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [section, setSection] = useState('branding');
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [booted, setBooted] = useState(false);

  // One fetch per section, run whenever the section changes.
  const load = useCallback(async (which) => {
    setLoading(true);
    try {
      if (which === 'branding' || which === 'appearance' || which === 'compliance') {
        // These sections load and save the company profile themselves.
      } else if (which === 'audit') {
        const { data } = await masterApi.getAudit({ limit: 200 });
        setAudit(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to load console data');
    } finally {
      setLoading(false);
      setBooted(true);
    }
  }, []);

  useEffect(() => {
    load(section);
  }, [section, load]);

  const active = SECTIONS.find((s) => s.key === section);

  const handleNavClick = (key) => {
    setSection(key);
    setSidebarOpen(false);
  };

  const renderSection = () => {
    switch (section) {
      case 'branding':
        return <MasterBranding />;

      case 'appearance':
        return <MasterAppearance />;

      case 'compliance':
        return <RegulatoryCompliance />;

      case 'audit':
        return (
          <section className="admin-panel">
            <p className="admin-panel-desc">
              What has been changed from this console, newest first. Bank and statutory
              values are recorded as changed but never shown.
            </p>
            {audit.length === 0 ? (
              <div className="admin-empty">
                Nothing has been changed from this console yet.
              </div>
            ) : (
              <ul className="master-history">
                {audit.map((a) => (
                  <li key={a.audit_id} className="master-history-row">
                    <div className="master-history-head">
                      <span className="master-history-what">{describeAction(a)}</span>
                      <span className="master-history-when">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <AuditChanges details={a.details} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );

      default:
        return null;
    }
  };

  return (
    <div className="main-layout master-layout">
      <header className="main-layout-header">
        <div className="main-layout-header-left">
          <div className="main-layout-brand">
            <img src={branding.logo} alt={branding.company_name} className="main-layout-logo" />
            <span className="main-layout-brand-name">{branding.company_name}</span>
          </div>
        </div>
      </header>

      <main className="main-layout-content">
        <div className={`master-shell it-updates-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
          {sidebarOpen && (
            <div className="it-updates-sidebar-overlay visible" onClick={() => setSidebarOpen(false)} />
          )}

          <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
            <nav className="it-updates-sidebar-nav">
              <div className="it-updates-sidebar-nav-label" />
              {SECTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.key}
                    type="button"
                    className={`it-updates-nav-item ${section === s.key ? 'active' : ''}`}
                    onClick={() => handleNavClick(s.key)}
                  >
                    <span className="it-updates-nav-icon">
                      <Icon size={18} />
                    </span>
                    {s.label}
                  </button>
                );
              })}
            </nav>
            <div className="it-updates-sidebar-footer">
              <SidebarUser user={currentUser} onLogout={onLogout} />
            </div>
          </aside>

          <div className="it-updates-content-area">
            <header className="it-updates-topbar">
              <div className="it-updates-topbar-left">
                <button
                  type="button"
                  className="it-updates-mobile-menu-btn"
                  onClick={() => setSidebarOpen(true)}
                >
                  <MdMenu size={24} />
                </button>
                <div>
                  <h1 className="it-updates-topbar-title">{active?.label || 'Master console'}</h1>
                  <p className="it-updates-topbar-subtitle">{active?.subtitle}</p>
                </div>
              </div>
              <div className="it-updates-topbar-right">
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-icon"
                  onClick={() => load(section)}
                  title="Refresh data"
                >
                  <MdRefresh size={18} />
                </button>
              </div>
            </header>

            <main className="it-updates-main">
              {!booted && <Preloader label="Loading the console…" />}
              {booted && loading && <Preloader label="Loading…" />}
              {booted && renderSection()}
            </main>
          </div>
        </div>
      </main>

      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
