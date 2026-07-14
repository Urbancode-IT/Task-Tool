import React, { useMemo } from 'react';
import { MdFolderSpecial, MdPublic, MdPeople, MdCampaign, MdShare, MdAdminPanelSettings, MdGavel } from 'react-icons/md';
import ITUpdatesMain from '../features/ITUpdates/ITUpdatesMain';
import ConsultantsMain from '../features/Consultants/ConsultantsMain';
import CreativeTeamMain from '../features/CreativeTeam/CreativeTeamMain';
import SocialMediaMain from '../features/SocialMedia/SocialMediaMain';
import LegalFinanceMain from '../features/LegalFinance/LegalFinanceMain';
import AdminMain from '../features/Admin/AdminMain';
import ToastContainer from './Toast';
import ConfirmDialog from './ConfirmDialog';
import usePersistedState from '../utils/usePersistedState';
import './MainLayout.css';

const LOGO_SRC = '/logo-icon.png';

const MODULES = [
  // "IT Updates" is now the Internal Projects sector. External Projects sits beside
  // it and is available to the same IT-team members (gated by it_updates.view).
  { key: 'it_updates', label: 'Internal Projects', icon: MdFolderSpecial, permission: 'it_updates.view' },
  { key: 'external_projects', label: 'External Projects', icon: MdPublic, permission: 'it_updates.view' },
  { key: 'consultants', label: 'Consultants', icon: MdPeople, permission: 'consultants.view' },
  { key: 'creative_team', label: 'Creative Team', icon: MdCampaign, permission: 'creative_team.view' },
  { key: 'social_media', label: 'Social Media Management', icon: MdShare, permission: 'social_media.view' },
  {
    key: 'legal_finance',
    label: 'Legal & Finance',
    icon: MdGavel,
    permissions: ['legal_finance.view', 'legal_finance.manage'],
  },
  {
    key: 'admin',
    label: 'Management',
    icon: MdAdminPanelSettings,
    permissions: ['admin.access', 'director.view', 'director.manage'],
  },
];

export default function MainLayout({ currentUser, onLogout }) {
  // Persisted so a page reload lands back on the same module.
  // Invalid/unpermitted values fall back via `safeActiveModule` below.
  const [activeModule, setActiveModule] = usePersistedState('activeModule', 'it_updates');

  const user = currentUser;

  const userPermissions = user?.permissions || [];

  const modulesToShow = useMemo(() => {
    if (userPermissions.includes('admin.access')) return MODULES;
    const filtered = MODULES.filter((m) => {
      if (Array.isArray(m.permissions) && m.permissions.length > 0) {
        return m.permissions.some((perm) => userPermissions.includes(perm));
      }
      return !m.permission || userPermissions.includes(m.permission);
    });
    return filtered.length > 0 ? filtered : MODULES.filter((m) => m.key === 'it_updates');
  }, [userPermissions]);

  const safeActiveModule = modulesToShow.some((m) => m.key === activeModule)
    ? activeModule
    : modulesToShow[0]?.key || 'it_updates';

  const renderContent = () => {
    switch (safeActiveModule) {
      case 'it_updates':
        return <ITUpdatesMain currentUser={user} onLogout={onLogout} scope="internal" />;
      case 'external_projects':
        return <ITUpdatesMain currentUser={user} onLogout={onLogout} scope="external" />;
      case 'consultants':
        return <ConsultantsMain currentUser={user} onLogout={onLogout} />;
      case 'creative_team':
        return <CreativeTeamMain currentUser={user} onLogout={onLogout} />;
      case 'social_media':
        return <SocialMediaMain currentUser={user} onLogout={onLogout} />;
      case 'legal_finance':
        return <LegalFinanceMain currentUser={user} onLogout={onLogout} />;
      case 'admin':
        return <AdminMain currentUser={user} onLogout={onLogout} />;
      default:
        return <ITUpdatesMain currentUser={user} onLogout={onLogout} />;
    }
  };

  // These modules render their own fixed sidebar (ITUpdatesMain.css shell),
  // so the global header needs left padding to avoid overlap.
  const hasSidebar = [
    'it_updates',
    'external_projects',
    'consultants',
    'creative_team',
    'social_media',
    'legal_finance',
    'admin',
  ].includes(safeActiveModule);

  return (
    <div className={`main-layout ${hasSidebar ? 'main-layout-with-sidebar' : ''}`}>
      <header className="main-layout-header">
        <div className="main-layout-header-left">
          <div className="main-layout-brand">
            <img src={LOGO_SRC} alt="Seyal" className="main-layout-logo" />
            <span className="main-layout-brand-name">Seyal</span>
          </div>
          <nav className="main-layout-module-nav">
            {modulesToShow.map((mod) => {
              const Icon = mod.icon;
              return (
                <button
                  key={mod.key}
                  type="button"
                  className={
                    'main-layout-module-btn' + (safeActiveModule === mod.key ? ' active' : '')
                  }
                  onClick={() => setActiveModule(mod.key)}
                >
                  <Icon size={20} />
                  <span>{mod.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="main-layout-content">{renderContent()}</main>
      <ToastContainer />
      <ConfirmDialog />
    </div>
  );
}
