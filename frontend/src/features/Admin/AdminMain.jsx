import React, { useEffect, useMemo, useState } from 'react';
import {
  MdPeople,
  MdDashboard,
  MdBusiness,
  MdTableChart,
  MdEdit,
  MdClose,
  MdLogout,
  MdMenu,
  MdRefresh,
  MdAdd,
  MdDelete,
} from 'react-icons/md';
import adminApi from '../../api/adminApi';
import itUpdatesApi from '../../api/itUpdatesApi';
import { getDisplayRole } from '../../utils/displayRole';
import logoSrc from '../../assets/logo.png';
import {
  AdminAddUserModal,
  AdminUserDetailModal,
  formatUserRowRole,
} from './AdminUserModals';
import '../ITUpdates/ITUpdatesMain.css';
import './AdminMain.css';

const ADMIN_TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: MdDashboard },
  { key: 'review_tasks', label: 'Review Tasks', icon: MdDashboard },
  { key: 'overdue_tasks', label: 'Overdue Tasks', icon: MdDashboard },
  { key: 'overview', label: 'Overview', icon: MdTableChart },
  { key: 'users', label: 'Users', icon: MdPeople },
  { key: 'departments', label: 'Departments', icon: MdBusiness },
];

const IT_TEAM_ROLE_CODES = new Set(['it_developer', 'it_manager', 'admin']);

function userMatchesTeamFilter(u, filter) {
  if (filter === 'all') return true;
  const codes = Array.isArray(u.role_codes) ? u.role_codes.map(String) : [];
  const inItTeam =
    Boolean(u.is_it_developer) ||
    Boolean(u.is_it_manager) ||
    codes.some((c) => IT_TEAM_ROLE_CODES.has(c));
  if (filter === 'it') return inItTeam;
  if (filter === 'consultant') return codes.includes('consultant');
  if (filter === 'digital') return codes.includes('digital_marketing');
  return true;
}

const USERS_TEAM_FILTERS = [
  { key: 'all', label: 'All users' },
  { key: 'it', label: 'IT team' },
  { key: 'consultant', label: 'Consultants' },
  { key: 'digital', label: 'Digital team' },
];

function Avatar({ user }) {
  const name = user?.name || user?.username || user?.email || 'U';
  const initial = name[0].toUpperCase();
  const src = user?.profile_image || user?.profileImage;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className="it-updates-avatar it-updates-avatar-img small"
      />
    );
  }
  return (
    <span className="it-updates-avatar small" title={name}>
      {initial}
    </span>
  );
}

const TAB_SUBTITLES = {
  dashboard: 'Overview of users and teams.',
  overview: 'All tasks overview with filters across teams.',
  users: 'Manage accounts, roles, and teams. Only admins can access this page.',
  departments: 'Teams in the organisation. Users are assigned roles linked to these departments.',
};

export default function AdminMain({ currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [dashboardStats, setDashboardStats] = useState(null);
  const [pendingSummary, setPendingSummary] = useState({
    pending_count: 0,
    review_count: 0,
    overdue_count: 0,
    overdue_tasks: [],
  });
  const [reviewTasks, setReviewTasks] = useState([]);
  const [overdueTasks, setOverdueTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [overdueLoading, setOverdueLoading] = useState(false);
  const [error, setError] = useState('');
  const [taskDetailModal, setTaskDetailModal] = useState({ open: false, task: null });
  const [editUserRoles, setEditUserRoles] = useState(null);
  const [userRoleIds, setUserRoleIds] = useState([]);
  const [usersTeamFilter, setUsersTeamFilter] = useState('all');
  const [tasksTeamFilter, setTasksTeamFilter] = useState('all');
  const [overviewTeamFilter, setOverviewTeamFilter] = useState('all');
  const [overviewFilters, setOverviewFilters] = useState({
    status: '',
    priority: '',
    from_date: '',
    to_date: '',
    assigned_to: '',
    project_id: '',
  });
  const [overviewTasks, setOverviewTasks] = useState([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewTeamMembers, setOverviewTeamMembers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [addUserModal, setAddUserModal] = useState(false);
  const [userDetailModal, setUserDetailModal] = useState({
    open: false,
    user: null,
    mode: 'view',
  });

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

  const loadUsers = () => {
    setLoading(true);
    setError('');
    adminApi
      .getUsers()
      .then((res) => setUsers(Array.isArray(res.data) ? res.data : []))
      .catch((e) => setError(e?.response?.data?.message || 'Failed to load users'))
      .finally(() => setLoading(false));
  };

  const loadRoles = () => {
    adminApi
      .getRoles()
      .then((res) => setRoles(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRoles([]));
  };

  const loadDepartments = () => {
    adminApi
      .getDepartments()
      .then((res) => setDepartments(Array.isArray(res.data) ? res.data : []))
      .catch(() => setDepartments([]));
  };

  const loadDashboardStats = () => {
    itUpdatesApi
      .getDashboardStats()
      .then((res) => setDashboardStats(res.data || null))
      .catch(() => setDashboardStats(null));
  };

  const loadReviewTasks = () => {
    setReviewLoading(true);
    adminApi
      .getTasks({
        status: 'review',
        team:
          tasksTeamFilter === 'consultant'
            ? 'consultant'
            : tasksTeamFilter === 'digital'
              ? 'digital_marketing'
              : tasksTeamFilter === 'it'
                ? 'it'
                : undefined,
      })
      .then((res) => setReviewTasks(Array.isArray(res.data) ? res.data : []))
      .catch(() => setReviewTasks([]))
      .finally(() => setReviewLoading(false));
  };

  const loadOverdueTasks = () => {
    setOverdueLoading(true);
    adminApi
      .getTasks({
        overdue: true,
        team:
          tasksTeamFilter === 'consultant'
            ? 'consultant'
            : tasksTeamFilter === 'digital'
              ? 'digital_marketing'
              : tasksTeamFilter === 'it'
                ? 'it'
                : undefined,
      })
      .then((res) => setOverdueTasks(Array.isArray(res.data) ? res.data : []))
      .catch(() => setOverdueTasks([]))
      .finally(() => setOverdueLoading(false));
  };

  const loadPendingSummary = () => {
    adminApi
      .getPendingSummary()
      .then((res) =>
        setPendingSummary(
          res.data || { pending_count: 0, review_count: 0, overdue_count: 0, overdue_tasks: [] }
        )
      )
      .catch(() =>
        setPendingSummary({ pending_count: 0, review_count: 0, overdue_count: 0, overdue_tasks: [] })
      );
  };

  useEffect(() => {
    loadUsers();
    loadRoles();
    loadDepartments();
    loadDashboardStats();
    loadReviewTasks();
    loadPendingSummary();
    loadOverdueTasks();
  }, []);

  useEffect(() => {
    if (activeTab === 'review_tasks') loadReviewTasks();
    if (activeTab === 'overdue_tasks') loadOverdueTasks();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'review_tasks') loadReviewTasks();
    if (activeTab === 'overdue_tasks') loadOverdueTasks();
  }, [tasksTeamFilter]);

  const mapTeamFilter = (key) => {
    if (key === 'consultant') return 'consultant';
    if (key === 'digital') return 'digital_marketing';
    if (key === 'it') return 'it';
    return undefined;
  };

  const loadProjects = () => {
    itUpdatesApi
      .getProjects()
      .then((res) => setProjects(Array.isArray(res.data) ? res.data : []))
      .catch(() => setProjects([]));
  };

  const loadOverviewData = () => {
    setOverviewLoading(true);
    const team = mapTeamFilter(overviewTeamFilter);
    const params = {
      team,
      status: overviewFilters.status || undefined,
      priority: overviewFilters.priority || undefined,
      from_date: overviewFilters.from_date || undefined,
      to_date: overviewFilters.to_date || undefined,
      assigned_to: overviewFilters.assigned_to || undefined,
      project_id: overviewFilters.project_id || undefined,
    };
    Promise.all([
      itUpdatesApi.getTasks(params),
      itUpdatesApi.getTeamOverview({ team }).catch(() => ({ data: [] })),
      projects.length ? Promise.resolve({ data: projects }) : itUpdatesApi.getProjects().catch(() => ({ data: [] })),
    ])
      .then(([tasksRes, teamRes, projRes]) => {
        setOverviewTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
        setOverviewTeamMembers(Array.isArray(teamRes.data) ? teamRes.data : []);
        const p = Array.isArray(projRes.data) ? projRes.data : [];
        setProjects(p);
      })
      .catch(() => {
        setOverviewTasks([]);
        setOverviewTeamMembers([]);
      })
      .finally(() => setOverviewLoading(false));
  };

  useEffect(() => {
    if (activeTab === 'overview') {
      loadOverviewData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'overview') loadOverviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    overviewTeamFilter,
    overviewFilters.status,
    overviewFilters.priority,
    overviewFilters.from_date,
    overviewFilters.to_date,
    overviewFilters.assigned_to,
    overviewFilters.project_id,
  ]);

  const openEditUserRoles = (u) => {
    setEditUserRoles(u);
    setUserRoleIds(
      u.role_codes
        ? roles.filter((r) => u.role_codes.includes(r.code)).map((r) => r.role_id)
        : []
    );
  };

  const saveUserRoles = async () => {
    if (!editUserRoles) return;
    setError('');
    try {
      await adminApi.setUserRoles(editUserRoles.user_id, userRoleIds);
      setEditUserRoles(null);
      loadUsers();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to update roles');
    }
  };

  const toggleUserRole = (roleId) => {
    setUserRoleIds((prev) =>
      prev.includes(roleId) ? prev.filter((id) => id !== roleId) : [...prev, roleId]
    );
  };

  const updateReviewTaskStatus = async (taskId, nextStatus) => {
    try {
      await itUpdatesApi.updateTask(taskId, { status: nextStatus });
      loadReviewTasks();
      loadPendingSummary();
      loadOverdueTasks();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to update task status');
    }
  };

  const openTaskDetail = (task) => setTaskDetailModal({ open: true, task });
  const closeTaskDetail = () => setTaskDetailModal({ open: false, task: null });

  const roleCounts = useMemo(
    () =>
      users.reduce((acc, u) => {
        const codes = Array.isArray(u.role_codes) ? u.role_codes : [];
        if (codes.length === 0) acc['No role'] = (acc['No role'] || 0) + 1;
        else codes.forEach((code) => {
          acc[code] = (acc[code] || 0) + 1;
        });
        return acc;
      }, {}),
    [users]
  );

  const filteredUsers = useMemo(
    () => users.filter((u) => userMatchesTeamFilter(u, usersTeamFilter)),
    [users, usersTeamFilter]
  );

  const tabConfig = ADMIN_TABS.find((t) => t.key === activeTab);
  const handleNavClick = (key) => {
    setActiveTab(key);
    setSidebarOpen(false);
  };

  const refreshAll = () => {
    loadUsers();
    loadRoles();
    loadDepartments();
    loadDashboardStats();
    loadReviewTasks();
    loadPendingSummary();
    loadOverdueTasks();
    if (activeTab === 'overview') loadOverviewData();
  };

  return (
    <div className="it-updates-shell">
      {sidebarOpen && (
        <div
          className="it-updates-sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="it-updates-sidebar-brand">
          <img src={logoSrc} alt="Workspace" className="it-updates-sidebar-logo" />
          <span className="it-updates-sidebar-title">Admin</span>
        </div>
        <nav className="it-updates-sidebar-nav">
          <div className="it-updates-sidebar-nav-label">Navigation</div>
          {ADMIN_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={`it-updates-nav-item ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => handleNavClick(tab.key)}
              >
                <span className="it-updates-nav-icon">
                  <Icon size={18} />
                </span>
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="it-updates-sidebar-footer">
          <div className="it-updates-sidebar-user">
            <Avatar user={user} />
            <div className="it-updates-sidebar-user-info">
              <div className="it-updates-sidebar-username">
                {user?.name || user?.username || user?.email}
              </div>
              <div className="it-updates-sidebar-userrole">{getDisplayRole(user)}</div>
            </div>
            {onLogout && (
              <button
                type="button"
                className="it-updates-sidebar-logout"
                onClick={onLogout}
                title="Sign out"
              >
                <MdLogout size={16} />
              </button>
            )}
          </div>
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
              <h1 className="it-updates-topbar-title">{tabConfig?.label || 'Admin'}</h1>
              <p className="it-updates-topbar-subtitle">{TAB_SUBTITLES[activeTab]}</p>
            </div>
          </div>
          <div className="it-updates-topbar-right">
            <button
              type="button"
              className="it-updates-btn it-updates-btn-icon"
              onClick={refreshAll}
              title="Refresh data"
            >
              <MdRefresh size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div className="it-updates-error" role="alert">
            {error}
          </div>
        )}

        <main className="it-updates-main">
          {activeTab === 'dashboard' && (
            <>
              <section className="it-updates-stats-row">
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Total users</div>
                  <div className="it-updates-stat-value">{users.length}</div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Departments</div>
                  <div className="it-updates-stat-value">{departments.length}</div>
                </div>
              </section>

              <section className="it-updates-stats-row">
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Pending works</div>
                  <div className="it-updates-stat-value">{pendingSummary.pending_count ?? 0}</div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Review tasks</div>
                  <div className="it-updates-stat-value">{pendingSummary.review_count ?? reviewTasks.length ?? 0}</div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Overdue</div>
                  <div className="it-updates-stat-value">{pendingSummary.overdue_count ?? 0}</div>
                </div>
              </section>

              <section className="admin-panel admin-panel-inline">
                <h3 className="admin-subheading">Users by role</h3>
                <div className="admin-role-summary">
                  {Object.entries(roleCounts).map(([role, count]) => (
                    <div key={role} className="admin-role-pill">
                      <span className="admin-role-name">{role}</span>
                      <span className="admin-role-count">{count}</span>
                    </div>
                  ))}
                  {Object.keys(roleCounts).length === 0 && (
                    <p className="admin-empty admin-empty-inline">
                      No user data yet. Go to Users to assign roles.
                    </p>
                  )}
                </div>
              </section>

              <section className="it-updates-panel it-updates-panel-full">
                <div className="it-updates-panel-header">
                  <h2>Team Activity</h2>
                </div>
                <div className="it-updates-team-list">
                  {(dashboardStats?.teamActivity || []).map((member) => (
                    <div
                      key={member.user_id ?? member.username ?? member.assignee}
                      className="it-updates-team-card"
                    >
                      <div className="it-updates-team-header">
                        <Avatar
                          user={{
                            username: member.username ?? member.assignee,
                            profile_image: member.profile_image,
                          }}
                        />
                        <div>
                          <div className="it-updates-team-name">
                            {member.username ?? member.assignee ?? 'Unassigned'}
                          </div>
                          <div className="it-updates-team-sub">
                            {member.total_assigned ?? member.total_tasks ?? member.total ?? 0} tasks
                          </div>
                        </div>
                      </div>
                      <div className="it-updates-team-stats">
                        <span>In progress: {member.in_progress_count ?? 0}</span>
                        <span>Completed: {member.completed_today ?? 0}</span>
                      </div>
                    </div>
                  ))}
                  {!((dashboardStats?.teamActivity || []).length) && (
                    <div className="it-updates-empty">No team activity yet.</div>
                  )}
                </div>
              </section>

            </>
          )}

          {(activeTab === 'review_tasks' || activeTab === 'overdue_tasks') && (
            <section className="admin-panel admin-panel-inline">
              <div className="admin-users-team-filter" role="tablist" aria-label="Filter tasks by team">
                {USERS_TEAM_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tasksTeamFilter === key}
                    className={'admin-team-filter-btn' + (tasksTeamFilter === key ? ' active' : '')}
                    onClick={() => setTasksTeamFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activeTab === 'review_tasks' && (
                <div className="admin-review-panel">
                  <div className="admin-review-header">
                    <h3 className="admin-subheading">Review Tasks</h3>
                    <span className="admin-review-count">{reviewTasks.length}</span>
                  </div>
                  {reviewLoading ? (
                    <div className="admin-loading">Loading…</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Task</th>
                            <th>Assignee</th>
                            <th>Assigned by</th>
                            <th>Priority</th>
                            <th>Due</th>
                            <th>Checklist</th>
                            <th className="admin-th-actions">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reviewTasks.map((t) => {
                            const id = t.id || t.task_id;
                            const title = t.task_title || t.title || 'Task';
                            const assignee = t.assignee || '—';
                            const assignedBy = t.assigned_by_name || t.assigned_by_username || '—';
                            const priority = t.priority || 'medium';
                            const due = t.dueDate || t.due_date;
                            return (
                              <tr key={String(id)}>
                                <td>
                                  <button
                                    type="button"
                                    className="admin-task-link"
                                    onClick={() => openTaskDetail(t)}
                                    title="Open task details"
                                  >
                                    <strong>{title}</strong>
                                  </button>
                                  {t.projectId || t.project_id ? (
                                    <div className="admin-muted">Project #{t.projectId || t.project_id}</div>
                                  ) : null}
                                </td>
                                <td>{assignee}</td>
                                <td>{assignedBy}</td>
                                <td>
                                  <span className={`admin-priority ${priority}`}>{priority}</span>
                                </td>
                                <td>{due ? new Date(due).toLocaleDateString() : '—'}</td>
                                <td>
                                  {Number.isFinite(t.req_total) || Number.isFinite(t.req_completed)
                                    ? `${t.req_completed || 0}/${t.req_total || 0}`
                                    : '—'}
                                </td>
                                <td className="admin-td-actions">
                                  <button
                                    type="button"
                                    className="admin-btn-sm admin-btn-approve"
                                    onClick={() => updateReviewTaskStatus(id, 'completed')}
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    className="admin-btn-sm admin-btn-rework"
                                    onClick={() => updateReviewTaskStatus(id, 'in_progress')}
                                  >
                                    Rework
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!reviewTasks.length && <div className="admin-empty">No tasks in Review right now.</div>}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'overdue_tasks' && (
                <div className="admin-review-panel">
                  <div className="admin-review-header">
                    <h3 className="admin-subheading">Overdue Tasks</h3>
                    <span className="admin-review-count">{overdueTasks.length}</span>
                  </div>
                  {overdueLoading ? (
                    <div className="admin-loading">Loading…</div>
                  ) : (
                    <div className="admin-table-wrap">
                      <table className="admin-table">
                        <thead>
                          <tr>
                            <th>Due</th>
                            <th>Task</th>
                            <th>Assignee</th>
                            <th>Assigned by</th>
                            <th>Status</th>
                            <th>Priority</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overdueTasks.map((t) => {
                            const id = t.id || t.task_id;
                            const title = t.task_title || t.title || 'Task';
                            const assignee = t.assignee || '—';
                            const assignedBy = t.assigned_by_name || t.assigned_by_username || '—';
                            const priority = t.priority || 'medium';
                            const due = t.dueDate || t.due_date;
                            return (
                              <tr key={String(id)}>
                                <td>{due ? new Date(due).toLocaleDateString() : '—'}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="admin-task-link"
                                    onClick={() => openTaskDetail(t)}
                                    title="Open task details"
                                  >
                                    <strong>{title}</strong>
                                  </button>
                                  {t.projectId || t.project_id ? (
                                    <div className="admin-muted">Project #{t.projectId || t.project_id}</div>
                                  ) : null}
                                </td>
                                <td>{assignee}</td>
                                <td>{assignedBy}</td>
                                <td>{t.status}</td>
                                <td>
                                  <span className={`admin-priority ${priority}`}>{priority}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!overdueTasks.length && <div className="admin-empty">No overdue tasks.</div>}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeTab === 'users' && (
            <section className="admin-panel admin-panel-inline">
              <div className="admin-users-toolbar">
                <button
                  type="button"
                  className="admin-btn admin-btn-primary"
                  onClick={() => setAddUserModal(true)}
                >
                  <MdAdd size={18} /> Add user
                </button>
              </div>
              <p className="admin-users-filter-hint">
                Filter by team. Assign Consultant or Digital Marketing via <strong>Assign roles</strong>.
              </p>
              <div className="admin-users-team-filter" role="tablist" aria-label="Filter by team">
                {USERS_TEAM_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={usersTeamFilter === key}
                    className={'admin-team-filter-btn' + (usersTeamFilter === key ? ' active' : '')}
                    onClick={() => setUsersTeamFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="admin-loading">Loading…</div>
              ) : (
                <>
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Username</th>
                          <th>Email</th>
                          <th>Roles</th>
                          <th className="admin-th-actions">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredUsers.map((u) => (
                          <tr key={u.user_id}>
                            <td>
                              <button
                                type="button"
                                className="admin-username-link"
                                onClick={() =>
                                  setUserDetailModal({ open: true, user: u, mode: 'view' })
                                }
                              >
                                {u.username}
                              </button>
                            </td>
                            <td>{u.email || '—'}</td>
                            <td>{formatUserRowRole(u)}</td>
                            <td className="admin-td-actions">
                              <button
                                type="button"
                                className="admin-btn-sm"
                                onClick={() => openEditUserRoles(u)}
                              >
                                <MdEdit size={16} /> Roles
                              </button>
                              <button
                                type="button"
                                className="admin-btn-sm"
                                onClick={() =>
                                  setUserDetailModal({ open: true, user: u, mode: 'edit' })
                                }
                              >
                                <MdEdit size={16} /> Edit
                              </button>
                              <button
                                type="button"
                                className="admin-btn-sm admin-btn-sm-danger"
                                onClick={() => {
                                  if (!window.confirm(`Delete user ${u.username}?`)) return;
                                  adminApi
                                    .deleteUser(u.user_id)
                                    .then(() => loadUsers())
                                    .catch((e) =>
                                      setError(e?.response?.data?.message || 'Failed to delete user')
                                    );
                                }}
                              >
                                <MdDelete size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!users.length && (
                    <div className="admin-empty">No users yet. Click Add user.</div>
                  )}
                  {users.length > 0 && !filteredUsers.length && (
                    <div className="admin-empty">
                      No users in this team. Try another filter or assign roles.
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {activeTab === 'overview' && (
            <section className="admin-panel admin-panel-inline">
              <div className="admin-users-filter-hint">
                Filter tasks by team and date/status/priority. This view shows tasks across all modules.
              </div>

              <div className="admin-users-team-filter" role="tablist" aria-label="Filter overview by team">
                {USERS_TEAM_FILTERS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={overviewTeamFilter === key}
                    className={'admin-team-filter-btn' + (overviewTeamFilter === key ? ' active' : '')}
                    onClick={() => setOverviewTeamFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="it-updates-overview-filters">
                <label>
                  From date
                  <input
                    type="date"
                    value={overviewFilters.from_date}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, from_date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  To date
                  <input
                    type="date"
                    value={overviewFilters.to_date}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, to_date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    value={overviewFilters.status}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, status: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    <option value="in_progress">In Progress</option>
                    <option value="review">Review</option>
                    <option value="completed">Completed</option>
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={overviewFilters.priority}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, priority: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </label>
                <label>
                  Assignee
                  <select
                    value={overviewFilters.assigned_to}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, assigned_to: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {overviewTeamMembers.map((m) => (
                      <option key={m.user_id ?? m.assignee} value={m.user_id ?? m.assignee}>
                        {m.username ?? m.assignee}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Project
                  <select
                    value={overviewFilters.project_id}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, project_id: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {projects.map((p) => (
                      <option key={p.id ?? p.project_id} value={p.id ?? p.project_id}>
                        {p.name ?? p.project_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {overviewLoading ? (
                <div className="admin-loading">Loading…</div>
              ) : (
                <div className="it-updates-table-wrap">
                  <table className="it-updates-table-overview">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Project</th>
                        <th>Task Title</th>
                        <th>Checklist</th>
                        <th>Assigned To</th>
                        <th>Status</th>
                        <th>Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overviewTasks.map((task) => {
                        const project =
                          projects.find((p) => String(p.id ?? p.project_id) === String(task.projectId ?? task.project_id));
                        return (
                          <tr key={task.id || task.task_id}>
                            <td>
                              {task.task_date ? new Date(task.task_date).toLocaleDateString() : '—'}
                            </td>
                            <td>{project?.name ?? project?.project_name ?? (task.projectId ?? task.project_id) ?? '—'}</td>
                            <td>{task.task_title || task.title}</td>
                            <td>
                              {Number.isFinite(task.req_total) || Number.isFinite(task.req_completed)
                                ? `${task.req_completed || 0}/${task.req_total || 0}`
                                : '—'}
                            </td>
                            <td>{task.assignee || '—'}</td>
                            <td>{task.status}</td>
                            <td>{task.priority}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!overviewTasks.length && (
                    <div className="admin-empty">No tasks found for these filters.</div>
                  )}
                </div>
              )}
            </section>
          )}

          {activeTab === 'departments' && (
            <section className="admin-panel admin-panel-inline">
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.department_id || d.code}>
                        <td>
                          <strong>{d.name}</strong>
                        </td>
                        <td>
                          <code className="admin-code">{d.code}</code>
                        </td>
                        <td>{d.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!departments.length && (
                  <div className="admin-empty">No departments loaded.</div>
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      {addUserModal && (
        <AdminAddUserModal
          onClose={() => setAddUserModal(false)}
          onSave={async (form) => {
            setError('');
            try {
              const isDev = form.roleCode === 'it_developer';
              const isMgr = form.roleCode === 'it_manager';
              const { data } = await adminApi.createUser({
                username: form.username.trim(),
                email: form.email?.trim() || undefined,
                password: form.password,
                is_it_developer: isDev,
                is_it_manager: isMgr,
              });
              const uid = data.user_id;
              const r = roles.find((x) => x.code === form.roleCode);
              if (r?.role_id != null) {
                await adminApi.setUserRoles(uid, [r.role_id]);
              }
              setAddUserModal(false);
              loadUsers();
            } catch (e) {
              setError(e?.response?.data?.message || 'Failed to create user');
            }
          }}
        />
      )}

      {userDetailModal.open && userDetailModal.user && (
        <AdminUserDetailModal
          key={userDetailModal.user.user_id}
          user={userDetailModal.user}
          mode={userDetailModal.mode}
          onClose={() =>
            setUserDetailModal({ open: false, user: null, mode: 'view' })
          }
          onEdit={() => setUserDetailModal((m) => ({ ...m, mode: 'edit' }))}
          onSave={async (payload) => {
            try {
              const body = {
                username: payload.username,
                email: payload.email || undefined,
                is_it_developer: payload.is_it_developer ?? false,
                is_it_manager: payload.is_it_manager ?? false,
              };
              if (payload.password?.trim()) body.password = payload.password.trim();
              await adminApi.updateUser(userDetailModal.user.user_id, body);
              setUserDetailModal({ open: false, user: null, mode: 'view' });
              loadUsers();
            } catch (e) {
              setError(e?.response?.data?.message || 'Failed to update user');
            }
          }}
          onDelete={async () => {
            try {
              await adminApi.deleteUser(userDetailModal.user.user_id);
              setUserDetailModal({ open: false, user: null, mode: 'view' });
              loadUsers();
            } catch (e) {
              setError(e?.response?.data?.message || 'Failed to delete user');
            }
          }}
        />
      )}

      {taskDetailModal.open && taskDetailModal.task && (
        <div className="admin-modal-backdrop" onClick={closeTaskDetail}>
          <div className="admin-modal admin-task-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Task details</h3>
              <button type="button" className="admin-modal-close" onClick={closeTaskDetail}>
                <MdClose size={22} />
              </button>
            </div>
            <div className="admin-task-body">
              <div className="admin-task-title">
                {taskDetailModal.task.task_title || taskDetailModal.task.title}
              </div>
              {taskDetailModal.task.task_description ? (
                <div className="admin-task-desc">{taskDetailModal.task.task_description}</div>
              ) : null}

              <div className="admin-task-meta-grid">
                <div><span className="admin-task-meta-label">Status</span><span>{taskDetailModal.task.status || '—'}</span></div>
                <div><span className="admin-task-meta-label">Priority</span><span>{taskDetailModal.task.priority || '—'}</span></div>
                <div><span className="admin-task-meta-label">Due</span><span>{(taskDetailModal.task.dueDate || taskDetailModal.task.due_date) ? new Date(taskDetailModal.task.dueDate || taskDetailModal.task.due_date).toLocaleDateString() : '—'}</span></div>
                <div><span className="admin-task-meta-label">Project</span><span>{taskDetailModal.task.projectId || taskDetailModal.task.project_id || '—'}</span></div>
                <div><span className="admin-task-meta-label">Assignee</span><span>{taskDetailModal.task.assignee || '—'}</span></div>
                <div><span className="admin-task-meta-label">Assigned by</span><span>{taskDetailModal.task.assigned_by_name || taskDetailModal.task.assigned_by_username || '—'}</span></div>
                <div><span className="admin-task-meta-label">Checklist</span><span>{Number.isFinite(taskDetailModal.task.req_total) || Number.isFinite(taskDetailModal.task.req_completed) ? `${taskDetailModal.task.req_completed || 0}/${taskDetailModal.task.req_total || 0}` : '—'}</span></div>
              </div>
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn admin-btn-secondary" onClick={closeTaskDetail}>
                Close
              </button>
              {taskDetailModal.task.status === 'review' && (
                <>
                  <button
                    type="button"
                    className="admin-btn admin-btn-primary"
                    onClick={() => {
                      const id = taskDetailModal.task.id || taskDetailModal.task.task_id;
                      updateReviewTaskStatus(id, 'completed');
                      closeTaskDetail();
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    onClick={() => {
                      const id = taskDetailModal.task.id || taskDetailModal.task.task_id;
                      updateReviewTaskStatus(id, 'in_progress');
                      closeTaskDetail();
                    }}
                  >
                    Rework
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {editUserRoles && (
        <div className="admin-modal-backdrop" onClick={() => setEditUserRoles(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h3>Assign roles: {editUserRoles.username}</h3>
              <button
                type="button"
                className="admin-modal-close"
                onClick={() => setEditUserRoles(null)}
              >
                <MdClose size={22} />
              </button>
            </div>
            <div className="admin-modal-body">
              {roles.map((r) => (
                <label key={r.role_id} className="admin-check-label">
                  <input
                    type="checkbox"
                    checked={userRoleIds.includes(r.role_id)}
                    onChange={() => toggleUserRole(r.role_id)}
                  />
                  {r.name} <span className="admin-code">({r.code})</span>
                </label>
              ))}
            </div>
            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-btn admin-btn-secondary"
                onClick={() => setEditUserRoles(null)}
              >
                Cancel
              </button>
              <button type="button" className="admin-btn admin-btn-primary" onClick={saveUserRoles}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
