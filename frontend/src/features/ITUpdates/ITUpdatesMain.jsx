import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  MdLogout,
  MdRefresh,
  MdAdd,
  MdClose,
  MdOutlineAssignment,
  MdDashboard,
  MdChecklist,
  MdViewKanban,
  MdFolder,
  MdTableChart,
  MdMenu,
  MdCalendarToday,
  MdEdit,
} from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import { getDisplayRole } from '../../utils/displayRole';
import logoSrc from '../../assets/logo.png';
import './ITUpdatesMain.css';

const TABS = [
  { key: 'Dashboard', label: 'Dashboard', icon: MdDashboard },
  { key: 'My Tasks', label: 'My Tasks', icon: MdChecklist },
  { key: 'All Tasks', label: 'All Tasks', icon: MdViewKanban },
  { key: 'Projects', label: 'Projects', icon: MdFolder },
  { key: 'Overview', label: 'Overview', icon: MdTableChart },
  { key: 'EOD Updates', label: 'EOD Updates', icon: MdOutlineAssignment },
];

const STATUS_LABELS = {
  in_progress: 'In Progress',
  review: 'Review',
  completed: 'Completed',
};

const STATUS_COLORS = {
  in_progress: '#6366f1',
  review: '#8b5cf6',
  completed: '#10b981',
};

const PROJECT_STATUS_COLORS = {
  active: '#10b981',
  on_hold: '#f59e0b',
  completed: '#10b981',
  archived: '#6b7280',
};

const PRIORITY_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const MOOD_OPTIONS = [
  { value: 'great', label: 'Great', emoji: '😄' },
  { value: 'good', label: 'Good', emoji: '🙂' },
  { value: 'neutral', label: 'Neutral', emoji: '😐' },
  { value: 'stressed', label: 'Stressed', emoji: '😓' },
  { value: 'blocked', label: 'Blocked', emoji: '🚫' },
];

const groupTasksByStatus = (tasks) => {
  return tasks.reduce(
    (acc, task) => {
      const key = task.status || 'in_progress';
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
      return acc;
    },
    { in_progress: [], review: [], completed: [] }
  );
};

function Avatar({ user, size = 'md' }) {
  const name = user?.name || user?.username || user?.email || '?';
  const initial = (name || 'U')[0].toUpperCase();
  const src = user?.profile_image || user?.profileImage;
  if (src) {
    return (
      <img
        src={src}
        alt=""
        className={`it-updates-avatar it-updates-avatar-img ${size}`}
      />
    );
  }
  return (
    <span className={`it-updates-avatar ${size}`} title={name}>
      {initial}
    </span>
  );
}

const ITUpdatesMain = ({ currentUser, onLogout }) => {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [dashboardData, setDashboardData] = useState(null);
  const [teamOverview, setTeamOverview] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [projectModal, setProjectModal] = useState({ open: false, project: null });
  const [taskModal, setTaskModal] = useState({ open: false, task: null });
  const [eodModal, setEodModal] = useState(false);

  const [allTasksFilters, setAllTasksFilters] = useState({ project_id: '', status: '', priority: '' });
  const [overviewFilters, setOverviewFilters] = useState({ from_date: '', to_date: '', assigned_to: '', project_id: '' });
  const [eodReports, setEodReports] = useState([]);

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

  const visibleTabs = useMemo(() => TABS, []);

  const developers = useMemo(
    () => teamOverview.filter((u) => u.is_it_developer || u.assignee),
    [teamOverview]
  );
  const managers = useMemo(
    () => teamOverview.filter((u) => u.is_it_manager),
    [teamOverview]
  );

  const myTasks = useMemo(() => {
    if (!user) return [];
    const key = user.name || user.username || user.email;
    const id = user.id ?? user.user_id;
    return tasks.filter(
      (t) => t.assignee === key || (id != null && String(t.assigned_to) === String(id))
    );
  }, [tasks, user]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, teamRes, projRes, tasksRes] = await Promise.all([
        itUpdatesApi.getDashboardStats(),
        itUpdatesApi.getTeamOverview({ team: 'it' }),
        itUpdatesApi.getProjects(),
        itUpdatesApi.getTasks({ team: 'it' }),
      ]);
      setDashboardData(statsRes.data);
      setTeamOverview(Array.isArray(teamRes.data) ? teamRes.data : []);
      setProjects(Array.isArray(projRes.data) ? projRes.data : []);
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Something went wrong while loading IT updates.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Refetch when user returns to this browser tab so DB updates are reflected in the UI
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') loadAllData();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [loadAllData]);

  const fetchTasksWithFilters = useCallback(async (filters) => {
    try {
      const res = await itUpdatesApi.getTasks({ ...filters, team: 'it' });
      setTasks(Array.isArray(res.data) ? res.data : []);
    } catch {
      setError('Failed to load tasks');
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'All Tasks' && (allTasksFilters.project_id || allTasksFilters.status || allTasksFilters.priority)) {
      const f = {};
      if (allTasksFilters.project_id) f.project_id = allTasksFilters.project_id;
      if (allTasksFilters.status) f.status = allTasksFilters.status;
      if (allTasksFilters.priority) f.priority = allTasksFilters.priority;
      fetchTasksWithFilters(f);
    } else if (activeTab === 'All Tasks') {
      loadAllData();
    }
  }, [activeTab, allTasksFilters.project_id, allTasksFilters.status, allTasksFilters.priority]);

  const overviewTasks = useMemo(() => tasks, [tasks]);
  useEffect(() => {
    if (activeTab === 'Overview' && (overviewFilters.from_date || overviewFilters.to_date || overviewFilters.assigned_to || overviewFilters.project_id)) {
      fetchTasksWithFilters({
        from_date: overviewFilters.from_date || undefined,
        to_date: overviewFilters.to_date || undefined,
        assigned_to: overviewFilters.assigned_to || undefined,
        project_id: overviewFilters.project_id || undefined,
      });
    } else if (activeTab === 'Overview') {
      loadAllData();
    }
  }, [activeTab, overviewFilters.from_date, overviewFilters.to_date, overviewFilters.assigned_to, overviewFilters.project_id]);

  useEffect(() => {
    if (activeTab === 'EOD Updates') {
      itUpdatesApi.getEodReports()
        .then((res) => setEodReports(Array.isArray(res.data) ? res.data : []))
        .catch(() => setEodReports([]));
    }
  }, [activeTab]);

  const stats = useMemo(() => {
    const d = dashboardData;
    if (!d) return { active_projects: 0, active_tasks: 0, completed_tasks: 0 };
    if (d.stats) return d.stats;
    return {
      active_projects: d.activeProjects ?? 0,
      active_tasks: d.totalTasks ?? 0,
      completed_tasks: d.completedTasksToday ?? 0,
    };
  }, [dashboardData]);

  const dashboardProjects = useMemo(() => {
    const d = dashboardData;
    if (d?.projects?.length) return d.projects;
    return (projects || []).map((p) => ({
      project_id: p.id ?? p.project_id,
      project_name: p.name ?? p.project_name,
      priority: p.priority ?? 'medium',
      total_tasks: p.total_tasks ?? 0,
      completed_tasks: p.completed_tasks ?? 0,
      completion_percentage: p.completion_percentage ?? p.progress ?? 0,
    }));
  }, [dashboardData, projects]);

  const dashboardTaskGroups = useMemo(() => groupTasksByStatus(tasks), [tasks]);
  const myTaskGroups = useMemo(() => groupTasksByStatus(myTasks), [myTasks]);

  const handleDragEnd = useCallback(
    async (result) => {
      if (!result.destination) return;
      const { draggableId, destination } = result;
      const newStatus = destination.droppableId;
      const taskId = draggableId.replace('task-', '');
      const task = tasks.find((t) => String(t.id) === String(taskId));
      if (!task || task.status === newStatus) return;
      setTasks((prev) =>
        prev.map((t) =>
          String(t.id) === String(taskId) ? { ...t, status: newStatus } : t
        )
      );
      try {
        await itUpdatesApi.updateTask(taskId, { status: newStatus });
      } catch {
        setTasks((prev) =>
          prev.map((t) =>
            String(t.id) === String(taskId) ? { ...t, status: task.status } : t
          )
        );
        setError('Failed to update task status');
      }
    },
    [tasks]
  );

  const openProjectModal = (project = null) => setProjectModal({ open: true, project });
  const openTaskModal = (task = null) => setTaskModal({ open: true, task });
  const closeProjectModal = () => setProjectModal({ open: false, project: null });
  const closeTaskModal = () => setTaskModal({ open: false, task: null });

  const handleSaveProject = async (payload) => {
    try {
      if (projectModal.project?.id) {
        await itUpdatesApi.updateProject(projectModal.project.id, payload);
      } else {
        await itUpdatesApi.createProject({
          name: payload.project_name ?? payload.name,
          project_code: payload.project_code,
          description: payload.description,
          status: payload.status,
          priority: payload.priority,
          start_date: payload.start_date,
          end_date: payload.end_date,
        });
      }
      closeProjectModal();
      loadAllData();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save project');
    }
  };

  const handleSaveTask = async (payload) => {
    try {
      const body = {
        title: payload.task_title,
        task_description: payload.task_description ?? payload.description,
        projectId: payload.project_id ?? payload.projectId,
        assigned_to: payload.assigned_to,
        assigned_by: payload.assigned_by,
        status: payload.status,
        priority: payload.priority,
        task_date: payload.task_date,
        dueDate: payload.due_date ?? payload.dueDate,
      };
      if (taskModal.task?.id) {
        await itUpdatesApi.updateTask(taskModal.task.id, body);
      } else {
        const res = await itUpdatesApi.createTask(body);
        const newTaskId = res.data?.id || res.data?.task_id;
        if (newTaskId && payload.requirements?.length > 0) {
          // Change to Promise.all to catch errors, or at least log them
          await Promise.all(
            payload.requirements.map(req => 
              itUpdatesApi.createRequirement(newTaskId, {
                title: req.title,
                status: req.status,
                priority: req.priority,
                due_date: req.due_date || null,
              })
            )
          );
        }
      }
      closeTaskModal();
      loadAllData();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save task');
    }
  };

  const handleSaveEod = async (payload) => {
    try {
      await itUpdatesApi.createEodReport({
        ...payload,
        user_id: user?.id ?? user?.user_id,
      });
      setEodModal(false);
      loadAllData();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save EOD report');
    }
  };

  const handleNavClick = (tabKey) => {
    setActiveTab(tabKey);
    setSidebarOpen(false);
  };

  const renderKanbanColumn = (statusKey, items, isMyTasks) => (
    <div
      key={statusKey}
      className="it-updates-column"
      style={{ borderTopColor: STATUS_COLORS[statusKey] }}
    >
      <div className="it-updates-column-header">
        <span>{STATUS_LABELS[statusKey]}</span>
        <span className="it-updates-column-count">{items.length}</span>
      </div>
      <Droppable droppableId={statusKey}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`it-updates-column-body ${snapshot.isDraggingOver ? 'it-updates-drop-zone' : ''}`}
          >
            {items.map((task, idx) => (
              <Draggable
                key={`task-${task.id}`}
                draggableId={`task-${task.id}`}
                index={idx}
              >
                {(provided, snapshot) => {
                  const projectName = projects.find((p) => String(p.id) === String(task.projectId))?.name ?? projects.find((p) => String(p.id) === String(task.projectId))?.project_name ?? task.projectId ?? 'No project';
                  const desc = (task.task_description || task.description || '').trim();
                  const descSnippet = desc.length > 50 ? desc.slice(0, 50) + '...' : desc;
                  return (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={`it-updates-task-card ${snapshot.isDragging ? 'it-updates-task-card-dragging' : ''}`}
                      onClick={() => openTaskModal(task)}
                    >
                      <div
                        className="it-updates-task-card-priority"
                        style={{
                          backgroundColor: (PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium) + '18',
                          color: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium,
                        }}
                      >
                        {(task.priority || 'medium').toUpperCase()}
                      </div>
                      <div className="it-updates-task-card-title">{task.title}</div>
                      {descSnippet ? (
                        <div className="it-updates-task-card-desc">{descSnippet}</div>
                      ) : null}
                      <div className="it-updates-task-card-tags">
                        <span className="it-updates-task-card-tag">{projectName}</span>
                        <span className="it-updates-task-card-tag">{task.assignee || 'Unassigned'}</span>
                      </div>
                      {task.req_total > 0 && (
                        <div className="it-updates-task-card-reqs">
                          <div className="it-updates-task-card-reqs-label">
                            <MdChecklist size={12} />
                            <span>{task.req_completed}/{task.req_total} subtasks</span>
                          </div>
                          <div className="it-updates-task-card-reqs-bar">
                            <div
                              className="it-updates-task-card-reqs-fill"
                              style={{ width: `${Math.round((task.req_completed / task.req_total) * 100)}%` }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="it-updates-task-card-assigned-by">
                        Assigned by: {task.assigned_by_name || '—'}
                      </div>
                    </div>
                  );
                }}
              </Draggable>
            ))}
            {provided.placeholder}
            {!items.length && (
              <div className="it-updates-empty-column">No tasks</div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );

  const tabConfig = TABS.find((t) => t.key === activeTab);

  return (
    <div className="it-updates-shell">
      {/* ─── Sidebar ─── */}
      {sidebarOpen && (
        <div
          className="it-updates-sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="it-updates-sidebar-brand">
          <img src={logoSrc} alt="IT Updates" className="it-updates-sidebar-logo" />
          <span className="it-updates-sidebar-title">IT Updates</span>
        </div>

        <nav className="it-updates-sidebar-nav">
          <div className="it-updates-sidebar-nav-label">Navigation</div>
          {visibleTabs.map((tab) => {
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
            <Avatar user={user} size="small" />
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

      {/* ─── Main Content ─── */}
      <div className="it-updates-content-area">
        {/* Topbar */}
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
              <h1 className="it-updates-topbar-title">{tabConfig?.label || activeTab}</h1>
              <p className="it-updates-topbar-subtitle">
                {activeTab === 'Dashboard' && 'Overview of your projects and team activity'}
                {activeTab === 'My Tasks' && 'Tasks assigned to you'}
                {activeTab === 'All Tasks' && 'All tasks across projects'}
                {activeTab === 'Projects' && 'Manage your projects'}
                {activeTab === 'Overview' && 'Detailed task overview and filters'}
                {activeTab === 'EOD Updates' && 'End-of-day reports from the team'}
              </p>
            </div>
          </div>
          <div className="it-updates-topbar-right">
            <button
              type="button"
              className="it-updates-btn it-updates-btn-secondary"
              onClick={() => setEodModal(true)}
              title="Submit EOD Report"
            >
              <MdOutlineAssignment size={16} />
              <span>EOD</span>
            </button>
            <button
              type="button"
              className="it-updates-btn it-updates-btn-icon"
              onClick={loadAllData}
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
          {activeTab === 'Dashboard' && (
            <>
              <section className="it-updates-stats-row">
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Active Projects</div>
                  <div className="it-updates-stat-value">
                    {stats.active_projects ?? 0}
                  </div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Completed Tasks Today</div>
                  <div className="it-updates-stat-value">
                    {dashboardData?.completedTasksToday ?? stats.completed_tasks ?? 0}
                  </div>
                </div>
              </section>

              <section className="it-updates-dashboard-sections">
                <div className="it-updates-panel it-updates-panel-full">
                  <div className="it-updates-panel-header">
                    <h2>Project Progress</h2>
                  </div>
                  <div className="it-updates-dashboard-project-grid">
                    {dashboardProjects.map((project) => (
                      <div key={project.project_id ?? project.id} className="it-updates-dashboard-project-card">
                        <div className="it-updates-dashboard-project-top">
                          <span className="it-updates-dashboard-project-name">
                            {project.project_name ?? project.name}
                          </span>
                          <span
                            className="it-updates-dashboard-project-badge"
                            style={{
                              backgroundColor: PRIORITY_COLORS[project.priority]
                                ? `${PRIORITY_COLORS[project.priority]}18`
                                : '#f3f4f6',
                              color: PRIORITY_COLORS[project.priority] || '#374151',
                            }}
                          >
                            {(project.priority || 'medium').toUpperCase()}
                          </span>
                        </div>
                        <div className="it-updates-progress-bar">
                          <div
                            className="it-updates-progress-fill"
                            style={{
                              width: `${project.completion_percentage ?? project.progress ?? 0}%`,
                            }}
                          />
                        </div>
                        <div className="it-updates-dashboard-project-meta">
                          <span className="it-updates-dashboard-project-pct">
                            {project.completion_percentage ?? project.progress ?? 0}%
                          </span>
                          <span className="it-updates-dashboard-project-tasks">
                            {project.completed_tasks ?? 0}/{project.total_tasks ?? 0} tasks
                          </span>
                        </div>
                      </div>
                    ))}
                    {!dashboardProjects.length && (
                      <div className="it-updates-empty">No projects yet. Create one from the Projects tab.</div>
                    )}
                  </div>
                </div>

                {/* Team Activity moved to Admin dashboard */}
              </section>
            </>
          )}

          {activeTab === 'My Tasks' && (
            <>
              <div className="it-updates-tasks-header">
                <h2 className="it-updates-tasks-title">My Tasks</h2>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={() => openTaskModal(null)}
                >
                  <MdAdd size={18} />
                  Add task
                </button>
              </div>
              <DragDropContext onDragEnd={handleDragEnd}>
                <section className="it-updates-columns">
                  {(['in_progress', 'review', 'completed']).map((statusKey) =>
                    renderKanbanColumn(
                      statusKey,
                      myTaskGroups[statusKey] || [],
                      true
                    )
                  )}
                </section>
              </DragDropContext>
            </>
          )}

          {activeTab === 'All Tasks' && (
            <>
              <div className="it-updates-tasks-header">
                <h2 className="it-updates-tasks-title">All Tasks</h2>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={() => openTaskModal(null)}
                >
                  <MdAdd size={18} />
                  Add task
                </button>
              </div>
              <div className="it-updates-filters">
                <select
                  value={allTasksFilters.project_id}
                  onChange={(e) =>
                    setAllTasksFilters((f) => ({ ...f, project_id: e.target.value }))
                  }
                >
                  <option value="">All projects</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name ?? p.project_name}
                    </option>
                  ))}
                </select>
                <select
                  value={allTasksFilters.status}
                  onChange={(e) =>
                    setAllTasksFilters((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  <option value="">All statuses</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                  <option value="completed">Completed</option>
                </select>
                <select
                  value={allTasksFilters.priority}
                  onChange={(e) =>
                    setAllTasksFilters((f) => ({ ...f, priority: e.target.value }))
                  }
                >
                  <option value="">All priorities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <DragDropContext onDragEnd={handleDragEnd}>
                <section className="it-updates-columns">
                  {(['in_progress', 'review', 'completed']).map((statusKey) =>
                    renderKanbanColumn(
                      statusKey,
                      dashboardTaskGroups[statusKey] || [],
                      false
                    )
                  )}
                </section>
              </DragDropContext>
            </>
          )}

          {activeTab === 'Projects' && (
            <section className="it-updates-panel">
              <div className="it-updates-panel-header">
                <h2>Projects</h2>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={() => openProjectModal(null)}
                >
                  <MdAdd size={18} />
                  Add project
                </button>
              </div>
              <div className="it-updates-projects-grid-cards">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="it-updates-project-card clickable"
                    onClick={() => openProjectModal(project)}
                  >
                    <div className="it-updates-project-top">
                      <span className="it-updates-project-name">
                        {project.name ?? project.project_name}
                      </span>
                      <span
                        className="it-updates-project-badge"
                        style={{
                          backgroundColor: PROJECT_STATUS_COLORS[project.status]
                            ? `${PROJECT_STATUS_COLORS[project.status]}18`
                            : undefined,
                          color: PROJECT_STATUS_COLORS[project.status] || '#374151',
                        }}
                      >
                        {project.status ?? 'active'}
                      </span>
                    </div>
                    {project.project_code && (
                      <div className="it-updates-project-code">{project.project_code}</div>
                    )}
                    <div className="it-updates-project-meta">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <span
                          className="it-updates-priority-dot"
                          style={{
                            backgroundColor: PRIORITY_COLORS[project.priority] || PRIORITY_COLORS.medium,
                          }}
                        />
                        {project.priority}
                      </span>
                    </div>
                    <div className="it-updates-project-meta">
                      <span>{project.total_tasks ?? 0} tasks</span>
                      <span>{project.progress ?? project.completion_percentage ?? 0}%</span>
                    </div>
                    {(project.start_date || project.end_date) && (
                      <div className="it-updates-project-dates">
                        <MdCalendarToday size={12} />
                        {project.start_date && new Date(project.start_date).toLocaleDateString()}
                        {project.end_date && ` – ${new Date(project.end_date).toLocaleDateString()}`}
                      </div>
                    )}
                  </div>
                ))}
                {!projects.length && (
                  <div className="it-updates-empty">
                    No projects yet. Click &quot;Add project&quot; to create one.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'Overview' && (
            <section className="it-updates-panel">
              <div className="it-updates-panel-header">
                <h2>Tasks Overview</h2>
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
                  Developer
                  <select
                    value={overviewFilters.assigned_to}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, assigned_to: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {(developers.length ? developers : teamOverview).map((u) => (
                      <option
                        key={u.user_id ?? u.assignee}
                        value={u.user_id ?? u.assignee}
                      >
                        {u.username ?? u.assignee}
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
                      <option key={p.id} value={p.id}>
                        {p.name ?? p.project_name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="it-updates-table-wrap">
                <table className="it-updates-table-overview">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Task Title</th>
                      <th>Requirements</th>
                      <th>Assigned To</th>
                      <th>Assigned By</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewTasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          {task.task_date
                            ? new Date(task.task_date).toLocaleDateString()
                            : '—'}
                        </td>
                        <td>
                          {projects.find((p) => String(p.id) === String(task.projectId))?.name ??
                            task.projectId ??
                            '—'}
                        </td>
                        <td>{task.title}</td>
                        <td>
                          {task.req_total > 0 ? (
                            <span className="it-updates-table-reqs">
                              {task.req_completed}/{task.req_total}
                            </span>
                          ) : (
                            <span className="it-updates-table-reqs-none">—</span>
                          )}
                        </td>
                        <td>{task.assignee ?? '—'}</td>
                        <td>{task.assigned_by_name ?? '—'}</td>
                        <td>
                          <span
                            className="it-updates-status-badge"
                            style={{
                              backgroundColor: STATUS_COLORS[task.status]
                                ? `${STATUS_COLORS[task.status]}18`
                                : undefined,
                              color: STATUS_COLORS[task.status] || '#374151',
                            }}
                          >
                            {STATUS_LABELS[task.status] ?? task.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!overviewTasks.length && (
                <div className="it-updates-empty">No tasks match the filters.</div>
              )}
            </section>
          )}

          {activeTab === 'EOD Updates' && (
            <section className="it-updates-panel it-updates-panel-full">
              <div className="it-updates-panel-header">
                <h2>EOD Updates</h2>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={() => setEodModal(true)}
                >
                  <MdAdd size={18} />
                  Submit EOD
                </button>
              </div>
              <p className="it-updates-eod-intro">
                View end-of-day reports submitted by the team. Use the <strong>EOD</strong> button in the header to submit your own report.
              </p>
              <div className="it-updates-eod-list">
                {eodReports.length === 0 ? (
                  <div className="it-updates-empty">No EOD reports yet. Click &quot;Submit EOD&quot; or the EOD button in the header to add one.</div>
                ) : (
                  eodReports.map((report) => (
                    <div key={report.report_id ?? report.id} className="it-updates-eod-card">
                      <div className="it-updates-eod-card-header">
                        <span className="it-updates-eod-date">
                          {report.report_date ? new Date(report.report_date).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                        </span>
                        <span className="it-updates-eod-user">{report.username || `User #${report.user_id}`}</span>
                        {report.hours_worked != null && (
                          <span className="it-updates-eod-hours">{report.hours_worked}h</span>
                        )}
                        {report.mood && (
                          <span className="it-updates-eod-mood">{report.mood}</span>
                        )}
                      </div>
                      {report.achievements && (
                        <div className="it-updates-eod-block">
                          <strong>Work Summary</strong>
                          <p>{report.achievements}</p>
                        </div>
                      )}
                      {report.blockers && (
                        <div className="it-updates-eod-block">
                          <strong>Additional Notes</strong>
                          <p>{report.blockers}</p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </main>
      </div>

      {projectModal.open && (
        <ProjectModal
          project={projectModal.project}
          onClose={closeProjectModal}
          onSave={handleSaveProject}
        />
      )}
      {taskModal.open && (
        <TaskModal
          task={taskModal.task}
          projects={projects}
          developers={developers}
          managers={managers}
          onClose={closeTaskModal}
          onSave={handleSaveTask}
          onRefresh={loadAllData}
        />
      )}
      {eodModal && (
        <EodModal
          onClose={() => setEodModal(false)}
          onSave={handleSaveEod}
        />
      )}

      {loading && <div className="it-updates-loading-bar" />}
    </div>
  );
};

function ProjectModal({ project, onClose, onSave }) {
  const [form, setForm] = useState({
    project_name: project?.name ?? project?.project_name ?? '',
    project_code: project?.project_code ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    priority: project?.priority ?? 'medium',
    start_date: project?.start_date ? project.start_date.slice(0, 10) : '',
    end_date: project?.end_date ? project.end_date.slice(0, 10) : '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="it-updates-modal-backdrop" onClick={onClose}>
      <div className="it-updates-modal" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>{project ? 'Edit project' : 'New project'}</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="it-updates-modal-form">
          <label>
            Project name *
            <input
              value={form.project_name}
              onChange={(e) => setForm((f) => ({ ...f, project_name: e.target.value }))}
              required
            />
          </label>
          <label>
            Project code
            <input
              value={form.project_code}
              onChange={(e) => setForm((f) => ({ ...f, project_code: e.target.value }))}
            />
          </label>
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Priority
            <select
              value={form.priority}
              onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Start date (Optional)
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
            />
          </label>
          <label>
            End date (Optional)
            <input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </label>
          <div className="it-updates-modal-actions">
            <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="it-updates-btn it-updates-btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TaskModal({ task, projects, developers, managers, onClose, onSave, onRefresh }) {
  const [form, setForm] = useState({
    task_title: task?.title ?? '',
    task_description: task?.task_description ?? task?.description ?? '',
    project_id: task?.projectId ?? task?.project_id ?? '',
    assigned_to: task?.assigned_to ?? '',
    assigned_by: task?.assigned_by ?? '',
    status: task?.status ?? 'in_progress',
    priority: task?.priority ?? 'medium',
    task_date: task?.task_date ? String(task.task_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    due_date: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
  });

  // Requirements state (only for existing tasks)
  const [requirements, setRequirements] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [showAddReq, setShowAddReq] = useState(false);
  const [editingReqId, setEditingReqId] = useState(null);
  const [reqForm, setReqForm] = useState({
    title: '',
    description: '',
    status: 'pending',
    priority: 'medium',
    due_date: '',
  });

  const isExistingTask = Boolean(task?.id);

  // Load requirements when modal opens for existing task
  useEffect(() => {
    if (isExistingTask) {
      setReqLoading(true);
      itUpdatesApi.getRequirements(task.id)
        .then((res) => setRequirements(Array.isArray(res.data) ? res.data : []))
        .catch(() => setRequirements([]))
        .finally(() => setReqLoading(false));
    }
  }, [isExistingTask, task?.id]);

  const completedReqs = requirements.filter((r) => r.status === 'completed').length;
  const totalReqs = requirements.length;
  const reqProgress = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0;

  const resetReqForm = () => {
    setReqForm({ title: '', description: '', status: 'pending', priority: 'medium', due_date: '' });
    setEditingReqId(null);
  };

  const handleAddRequirement = async () => {
    if (!reqForm.title.trim()) return;
    try {
      if (isExistingTask) {
        const res = await itUpdatesApi.createRequirement(task.id, {
          title: reqForm.title,
          status: reqForm.status,
          priority: reqForm.priority,
          due_date: reqForm.due_date || null,
        });
        setRequirements((prev) => {
          const newList = [...prev, res.data];
          handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = [...prev, {
            id: `temp-${Date.now()}`,
            title: reqForm.title,
            status: reqForm.status,
            priority: reqForm.priority,
            due_date: reqForm.due_date || null,
          }];
          handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to add requirement');
    }
  };

  const handleUpdateRequirement = async () => {
    if (!reqForm.title.trim() || !editingReqId) return;
    try {
      if (isExistingTask && !String(editingReqId).startsWith('temp-')) {
        const res = await itUpdatesApi.updateRequirement(task.id, editingReqId, {
          title: reqForm.title,
          status: reqForm.status,
          priority: reqForm.priority,
          due_date: reqForm.due_date || null,
        });
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === editingReqId ? res.data : r));
          handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === editingReqId ? {
            ...r,
            title: reqForm.title,
            status: reqForm.status,
            priority: reqForm.priority,
            due_date: reqForm.due_date || null,
          } : r));
          handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to update requirement');
    }
  };

  const handleDeleteRequirement = async (reqId) => {
    try {
      if (isExistingTask && !String(reqId).startsWith('temp-')) {
        await itUpdatesApi.deleteRequirement(task.id, reqId);
      }
      setRequirements((prev) => {
        const newList = prev.filter((r) => r.id !== reqId);
        handleStatusTransitions(newList);
        return newList;
      });
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to delete requirement');
    }
  };

  const handleToggleReqStatus = async (req) => {
    const newStatus = req.status === 'completed' ? 'pending' : 'completed';
    try {
      if (isExistingTask && !String(req.id).startsWith('temp-')) {
        const res = await itUpdatesApi.updateRequirement(task.id, req.id, { status: newStatus });
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === req.id ? res.data : r));
          handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === req.id ? { ...r, status: newStatus } : r));
          handleStatusTransitions(newList);
          return newList;
        });
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to toggle status');
    }
  };

  const handleStatusTransitions = async (updatedReqs) => {
    if (!isExistingTask) return;
    
    const allDone = updatedReqs.length > 0 && updatedReqs.every(r => r.status === 'completed');
    const hasPending = updatedReqs.some(r => r.status !== 'completed');

    let newStatus = null;

    // 1. All completed -> Review
    if (allDone && form.status === 'in_progress') {
      newStatus = 'review';
    } 
    // 2. Any pending -> In Progress (if currently review or completed)
    else if (hasPending && (form.status === 'review' || form.status === 'completed')) {
      newStatus = 'in_progress';
    }

    if (newStatus) {
      try {
        setForm(prev => ({ ...prev, status: newStatus }));
        await itUpdatesApi.updateTask(task.id, { ...form, status: newStatus });
        if (onRefresh) onRefresh();
      } catch (err) {
        console.error('Status transition failed:', err);
      }
    }
  };

  const handleManualRework = async () => {
    try {
      const newStatus = 'in_progress';
      setForm(prev => ({ ...prev, status: newStatus }));
      await itUpdatesApi.updateTask(task.id, { ...form, status: newStatus });
      if (onRefresh) onRefresh();
      // Also mark at least one requirement as pending if they are all completed? 
      // User might want to do this manually. For now just move status.
    } catch (err) {
      setError('Failed to set for rework');
    }
  };

  const startEditReq = (req) => {
    setEditingReqId(req.id);
    setReqForm({
      title: req.title,
      description: req.description || '',
      status: req.status,
      priority: req.priority,
      due_date: req.due_date ? String(req.due_date).slice(0, 10) : '',
    });
    setShowAddReq(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      requirements, // Pass local requirements to the save handler
      projectId: form.project_id || undefined,
      due_date: form.due_date || undefined,
    });
  };

  const REQ_STATUS_COLORS = {
    pending: '#94a3b8',
    in_progress: '#6366f1',
    completed: '#10b981',
  };

  const REQ_STATUS_LABELS = {
    pending: 'Pending',
    in_progress: 'In Progress',
    completed: 'Completed',
  };

  return (
    <div className="it-updates-modal-backdrop" onClick={onClose}>
      <div className="it-updates-modal it-updates-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>{task ? 'Edit task' : 'New task'}</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="it-updates-modal-form">
          <label>
            Task title *
            <input
              value={form.task_title}
              onChange={(e) => setForm((f) => ({ ...f, task_title: e.target.value }))}
              required
            />
          </label>

          {/* ═══ Requirements Section ═══ */}
          <div className="req-section">
            <div className="req-section-header">
              <div className="req-section-title-row">
                <MdChecklist size={20} className="req-section-icon" />
                <h3 className="req-section-title">Requirements</h3>
                {totalReqs > 0 && (
                  <span className="req-count-badge">
                    {completedReqs} of {totalReqs} completed
                  </span>
                )}
              </div>
              <button
                type="button"
                className="it-updates-btn it-updates-btn-secondary req-add-btn"
                onClick={() => { resetReqForm(); setShowAddReq(!showAddReq); }}
              >
                <MdAdd size={16} />
                {showAddReq ? 'Cancel' : 'Add'}
              </button>
            </div>

            {/* Progress bar */}
            {totalReqs > 0 && (
              <div className="req-progress-wrap">
                <div className="req-progress-bar">
                  <div
                    className="req-progress-fill"
                    style={{ width: `${reqProgress}%` }}
                  />
                </div>
                <span className="req-progress-label">{reqProgress}%</span>
              </div>
            )}

            {/* Requirements list */}
            {isExistingTask && reqLoading && (
              <p className="req-note">Loading requirements…</p>
            )}
            {(!reqLoading || !isExistingTask) && requirements.length === 0 && !showAddReq && (
              <p className="req-note">No requirements yet. Click "Add" to create one.</p>
            )}

            {(!reqLoading || !isExistingTask) && requirements.map((req) => (
              <div
                key={req.id}
                className={`req-card ${req.status === 'completed' ? 'req-card-completed' : ''}`}
              >
                <div className="req-card-left">
                  <button
                    type="button"
                    className={`req-checkbox ${req.status === 'completed' ? 'req-checkbox-checked' : ''}`}
                    onClick={() => handleToggleReqStatus(req)}
                    title={req.status === 'completed' ? 'Mark as pending' : 'Mark as completed'}
                  >
                    {req.status === 'completed' && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>
                </div>
                <div className="req-card-body">
                  <div className="req-card-top">
                    <span className={`req-card-title ${req.status === 'completed' ? 'req-title-done' : ''}`}>
                      {req.title}
                    </span>
                    <div className="req-card-actions">
                      <button
                        type="button"
                        className="req-action-btn"
                        onClick={() => startEditReq(req)}
                        title="Edit"
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="req-action-btn req-action-btn-danger"
                        onClick={() => handleDeleteRequirement(req.id)}
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                  <div className="req-card-meta">
                    <span
                      className="req-status-badge"
                      style={{
                        backgroundColor: `${REQ_STATUS_COLORS[req.status]}18`,
                        color: REQ_STATUS_COLORS[req.status],
                      }}
                    >
                      {REQ_STATUS_LABELS[req.status] ?? req.status}
                    </span>
                    <span
                      className="req-priority-badge"
                      style={{
                        backgroundColor: `${PRIORITY_COLORS[req.priority] || PRIORITY_COLORS.medium}18`,
                        color: PRIORITY_COLORS[req.priority] || PRIORITY_COLORS.medium,
                      }}
                    >
                      {(req.priority || 'medium').toUpperCase()}
                    </span>
                    {req.due_date && (
                      <span className="req-due-date">
                        Due: {new Date(req.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {showAddReq && (
              <div className="req-form">
                <h4 className="req-form-title">
                  {editingReqId ? 'Edit Requirement' : 'New Requirement'}
                </h4>
                <label>
                  Requirement *
                  <input
                    value={reqForm.title}
                    onChange={(e) => setReqForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="Enter subtask requirement..."
                  />
                </label>
                <div className="req-form-row">
                  <label>
                    Status
                    <select value={reqForm.status} onChange={(e) => setReqForm((f) => ({ ...f, status: e.target.value }))}>
                      <option value="pending">Pending</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>
                  <label>
                    Priority
                    <select value={reqForm.priority} onChange={(e) => setReqForm((f) => ({ ...f, priority: e.target.value }))}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <label>
                    Due date (Optional)
                    <input
                      type="date"
                      value={reqForm.due_date}
                      onChange={(e) => setReqForm((f) => ({ ...f, due_date: e.target.value }))}
                    />
                  </label>
                </div>
                <div className="req-form-actions">
                  <button
                    type="button"
                    className="it-updates-btn it-updates-btn-secondary"
                    onClick={() => { resetReqForm(); setShowAddReq(false); }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="it-updates-btn it-updates-btn-primary"
                    onClick={editingReqId ? handleUpdateRequirement : handleAddRequirement}
                    disabled={!reqForm.title.trim()}
                  >
                    {editingReqId ? 'Update' : 'Add Requirement'}
                  </button>
                </div>
              </div>
            )}
          </div>
          <label>
            Project
            <select
              value={form.project_id}
              onChange={(e) => setForm((f) => ({ ...f, project_id: e.target.value }))}
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name ?? p.project_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assign to 
            <select
              value={form.assigned_to}
              onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
            >
              <option value="">—</option>
              {(developers.length ? developers : [{ assignee: 'Unassigned', user_id: '' }]).map((u) => (
                <option key={u.user_id ?? u.assignee} value={u.user_id ?? u.assignee ?? ''}>
                  {u.username ?? u.assignee}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assigned by 
            <select
              value={form.assigned_by}
              onChange={(e) => setForm((f) => ({ ...f, assigned_by: e.target.value }))}
            >
              <option value="">—</option>
              {(managers.length ? managers : []).map((u) => (
                <option key={u.user_id} value={u.user_id}>
                  {u.username ?? u.assignee}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="in_progress">In Progress</option>
              <option value="review">Review</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label>
            Task date
            <input type="date" value={form.task_date} onChange={(e) => setForm((f) => ({ ...f, task_date: e.target.value }))} />
          </label>
          <label>
            Due date (Optional)
            <input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
          </label>


          <div className="it-updates-modal-actions">
            {isExistingTask && (form.status === 'review' || form.status === 'completed') && (
              <button 
                type="button" 
                className="it-updates-btn it-updates-btn-secondary rework-btn"
                onClick={handleManualRework}
                style={{ marginRight: 'auto', border: '1px solid #ef4444', color: '#ef4444' }}
              >
                ↩ Send for Rework
              </button>
            )}
            <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="it-updates-btn it-updates-btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EodModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    report_date: new Date().toISOString().slice(0, 10),
    achievements: '',
    status: 'on_track',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      mood: form.status, // Map status to mood field in DB
      hours_worked: null,
      blockers: null,
      tomorrow_plan: null,
    });
  };

  return (
    <div className="it-updates-modal-backdrop" onClick={onClose}>
      <div className="it-updates-modal" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>EOD Report</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="it-updates-modal-form">
          <label>
            Report date
            <input
              type="date"
              value={form.report_date}
              onChange={(e) => setForm((f) => ({ ...f, report_date: e.target.value }))}
            />
          </label>
          <label>
            Work summary (How much completed?) *
            <textarea
              value={form.achievements}
              onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))}
              placeholder="e.g. Completed login form, started dashboard API..."
              rows={4}
              required
            />
          </label>
          <label>
            Status
            <select 
              value={form.status} 
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="it-updates-status-select"
            >
              <option value="on_track">🟢 On Track</option>
              <option value="completed_for_day">✅ Completed for today</option>
              <option value="delayed">🟡 Delayed</option>
              <option value="blocked">🔴 Blocked</option>
              <option value="stressed">😰 Stressed / Overloaded</option>
            </select>
          </label>
          <div className="it-updates-modal-actions">
            <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="it-updates-btn it-updates-btn-primary">
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ITUpdatesMain;
