import React, { useState, useMemo } from 'react';
import { MdComputer, MdPeople, MdCampaign, MdAdminPanelSettings } from 'react-icons/md';
import ITUpdatesMain from '../features/ITUpdates/ITUpdatesMain';
import ConsultantsMain from '../features/Consultants/ConsultantsMain';
import DigitalMarketingMain from '../features/DigitalMarketing/DigitalMarketingMain';
import AdminMain from '../features/Admin/AdminMain';
import './MainLayout.css';

const MODULES = [
  { key: 'it_updates', label: 'IT Updates', icon: MdComputer, permission: 'it_updates.view' },
  { key: 'consultants', label: 'Consultants', icon: MdPeople, permission: 'consultants.view' },
  { key: 'digital_marketing', label: 'Digital Marketing', icon: MdCampaign, permission: 'digital_marketing.view' },
  { key: 'admin', label: 'Admin', icon: MdAdminPanelSettings, permission: 'admin.access' },
];

export default function MainLayout({ currentUser, onLogout }) {
  const [activeModule, setActiveModule] = useState('it_updates');

  const user =
    currentUser ||
    (() => {
      try {
        const stored = localStorage.getItem('user');
        return stored ? JSON.parse(stored) : null;
      } catch {
        return null;
      }
    })();

  const userPermissions = user?.permissions || [];

  const modulesToShow = useMemo(() => {
    if (userPermissions.includes('admin.access')) return MODULES;
    const filtered = MODULES.filter(
      (m) => !m.permission || userPermissions.includes(m.permission)
    );
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
      case 'digital_marketing':
        return <DigitalMarketingMain currentUser={user} onLogout={onLogout} />;
      case 'admin':
        return <AdminMain currentUser={user} onLogout={onLogout} />;
      default:
        return <ITUpdatesMain currentUser={user} onLogout={onLogout} />;
    }
  };

  // These modules render their own fixed sidebar (ITUpdatesMain.css shell),
  // so the global header needs left padding to avoid overlap.
  const hasSidebar = ['it_updates', 'consultants', 'digital_marketing', 'admin'].includes(
    safeActiveModule
  );

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
    </div>
  );
}
