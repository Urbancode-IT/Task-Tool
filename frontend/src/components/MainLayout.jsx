import React, { useState, useMemo } from 'react';
import { MdComputer, MdPeople, MdCampaign, MdShare, MdAdminPanelSettings, MdGavel } from 'react-icons/md';
import ITUpdatesMain from '../features/ITUpdates/ITUpdatesMain';
import ConsultantsMain from '../features/Consultants/ConsultantsMain';
import CreativeTeamMain from '../features/CreativeTeam/CreativeTeamMain';
import SocialMediaMain from '../features/SocialMedia/SocialMediaMain';
import LegalFinanceMain from '../features/LegalFinance/LegalFinanceMain';
import AdminMain from '../features/Admin/AdminMain';
import ToastContainer from './Toast';
import './MainLayout.css';

const MODULES = [
  { key: 'it_updates', label: 'IT Updates', icon: MdComputer, permission: 'it_updates.view' },
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
  const [activeModule, setActiveModule] = useState('it_updates');

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
        return <ITUpdatesMain currentUser={user} onLogout={onLogout} />;
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
    </div>
  );
}
