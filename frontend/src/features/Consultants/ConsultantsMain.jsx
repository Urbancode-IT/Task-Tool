import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  MdChecklist,
  MdClose,
  MdAdd,
  MdDashboard,
  MdLogout,
  MdMenu,
  MdOutlineAssignment,
  MdRefresh,
  MdTableChart,
  MdViewKanban,
} from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import { getDisplayRole } from '../../utils/displayRole';
import logoSrc from '../../assets/logo.png';
import '../ITUpdates/ITUpdatesMain.css';

const TABS = [
  { key: 'Dashboard', label: 'Dashboard', icon: MdDashboard },
  { key: 'My Tasks', label: 'My Tasks', icon: MdChecklist },
  { key: 'All Tasks', label: 'All Tasks', icon: MdViewKanban },
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

const PRIORITY_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const groupTasksByStatus = (tasks) =>
  tasks.reduce(
    (acc, task) => {
      const key = task.status || 'in_progress';
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
      return acc;
    },
    { in_progress: [], review: [], completed: [] }
  );

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

export default function ConsultantsMain({ currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [tasks, setTasks] = useState([]);
  const [eodReports, setEodReports] = useState([]);
  const [teamOverview, setTeamOverview] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);

  const [taskModal, setTaskModal] = useState({ open: false, task: null });
  const [eodModal, setEodModal] = useState(false);
  const [allTasksFilters, setAllTasksFilters] = useState({ status: '', priority: '' });
  const [overviewFilters, setOverviewFilters] = useState({ from_date: '', to_date: '', assigned_to: '' });

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

  const userId = user?.id ?? user?.user_id ?? null;

  const loadMyTasks = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [tasksRes, teamRes, adminRes] = await Promise.all([
        itUpdatesApi.getTasks({ team: 'consultant' }),
        itUpdatesApi.getTeamOverview({ team: 'consultant' }).catch(() => ({ data: [] })),
        itUpdatesApi.getTeamOverview({ team: 'it' }).catch(() => ({ data: [] })),
      ]);
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      setTeamOverview(Array.isArray(teamRes.data) ? teamRes.data : []);
      const itTeam = Array.isArray(adminRes.data) ? adminRes.data : [];
      setAdminUsers(itTeam.filter((u) => u?.is_it_manager));
    } catch (err) {
      setError(
        err?.response?.data?.message || 'Failed to load consultant tasks.'
      );
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadMyTasks();
  }, [loadMyTasks]);

  useEffect(() => {
    if (!userId) return;
    if (activeTab === 'EOD Updates') {
      itUpdatesApi
        .getEodReports({ user_id: userId })
        .then((res) => setEodReports(Array.isArray(res.data) ? res.data : []))
        .catch(() => setEodReports([]));
    }
  }, [activeTab, userId]);

  const myTasks = useMemo(() => {
    if (!userId) return tasks;
    return tasks.filter(
      (t) =>
        String(t.assigned_to) === String(userId) ||
        (user && (t.assignee === user.name || t.assignee === user.username))
    );
  }, [tasks, userId, user]);

  const myTaskGroups = useMemo(() => groupTasksByStatus(myTasks), [myTasks]);
  const allTaskGroups = useMemo(() => groupTasksByStatus(tasks), [tasks]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (allTasksFilters.status) result = result.filter((t) => t.status === allTasksFilters.status);
    if (allTasksFilters.priority) result = result.filter((t) => t.priority === allTasksFilters.priority);
    return result;
  }, [tasks, allTasksFilters]);

  const overviewTasks = useMemo(() => {
    let result = tasks;
    if (overviewFilters.from_date)
      result = result.filter((t) => t.task_date && t.task_date.slice(0, 10) >= overviewFilters.from_date);
    if (overviewFilters.to_date)
      result = result.filter((t) => t.task_date && t.task_date.slice(0, 10) <= overviewFilters.to_date);
    if (overviewFilters.assigned_to)
      result = result.filter((t) => String(t.assigned_to) === String(overviewFilters.assigned_to));
    return result;
  }, [tasks, overviewFilters]);

  const today = new Date().toISOString().slice(0, 10);
  const completedToday = useMemo(
    () =>
      myTasks.filter(
        (t) =>
          t.status === 'completed' &&
          (t.completed_at?.slice(0, 10) === today ||
            t.task_date?.slice(0, 10) === today)
      ).length,
    [myTasks, today]
  );

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

  const openTaskModal = (task = null) => setTaskModal({ open: true, task });
  const closeTaskModal = () => setTaskModal({ open: false, task: null });

  const handleSaveTask = async (payload) => {
    try {
      const body = {
        title: payload.task_title,
        task_description: payload.task_description ?? payload.description,
        projectId: payload.project_id ?? payload.projectId,
        assigned_to: (payload.assigned_to === '' ? userId : payload.assigned_to),
        assigned_by: payload.assigned_by || null,
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
          await Promise.all(
            payload.requirements.map((req) =>
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
      loadMyTasks();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save task');
    }
  };

  const handleSaveEod = async (payload) => {
    try {
      await itUpdatesApi.createEodReport({
        ...payload,
        user_id: userId,
      });
      setEodModal(false);
      loadMyTasks();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save EOD report');
    }
  };

  const handleNavClick = (tabKey) => {
    setActiveTab(tabKey);
    setSidebarOpen(false);
  };

  const renderKanbanColumn = (statusKey, items) => (
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
            className={`it-updates-column-body ${
              snapshot.isDraggingOver ? 'it-updates-drop-zone' : ''
            }`}
          >
            {items.map((task, idx) => (
              <Draggable
                key={`task-${task.id}`}
                draggableId={`task-${task.id}`}
                index={idx}
              >
                {(providedDrag, snapshotDrag) => (
                  <div
                    ref={providedDrag.innerRef}
                    {...providedDrag.draggableProps}
                    {...providedDrag.dragHandleProps}
                    className={`it-updates-task-card ${
                      snapshotDrag.isDragging
                        ? 'it-updates-task-card-dragging'
                        : ''
                    }`}
                    onClick={() => openTaskModal(task)}
                  >
                    <div
                      className="it-updates-task-card-priority"
                      style={{
                        backgroundColor:
                          (PRIORITY_COLORS[task.priority] ||
                            PRIORITY_COLORS.medium) + '18',
                        color:
                          PRIORITY_COLORS[task.priority] ||
                          PRIORITY_COLORS.medium,
                      }}
                    >
                      {(task.priority || 'medium').toUpperCase()}
                    </div>
                    <div className="it-updates-task-card-title">
                      {task.title}
                    </div>
                    {task.task_description && (
                      <div className="it-updates-task-card-desc">
                        {task.task_description.length > 50
                          ? task.task_description.slice(0, 50) + '...'
                          : task.task_description}
                      </div>
                    )}
                    <div className="it-updates-task-card-assigned-by">
                      Assigned by: {task.assigned_by_name || '—'}
                    </div>
                  </div>
                )}
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
      {sidebarOpen && (
        <div
          className="it-updates-sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="it-updates-sidebar-brand">
          <img src={logoSrc} alt="Workspace" className="it-updates-sidebar-logo" />
          <span className="it-updates-sidebar-title">Consultants</span>
        </div>
        <nav className="it-updates-sidebar-nav">
          <div className="it-updates-sidebar-nav-label">Navigation</div>
          {TABS.map((tab) => {
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
              <h1 className="it-updates-topbar-title">
                {tabConfig?.label || activeTab}
              </h1>
              <p className="it-updates-topbar-subtitle">
                {activeTab === 'Dashboard' && 'Overview of your tasks and progress'}
                {activeTab === 'My Tasks' && 'Tasks assigned to you'}
                {activeTab === 'All Tasks' && 'All tasks in kanban view'}
                {activeTab === 'Overview' && 'Detailed task overview and filters'}
                {activeTab === 'EOD Updates' && 'Your end-of-day reports'}
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
              onClick={loadMyTasks}
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
          {/* ─── Dashboard ─── */}
          {activeTab === 'Dashboard' && (
            <>
              <section className="it-updates-stats-row">
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">My Active Tasks</div>
                  <div className="it-updates-stat-value">
                    {myTasks.filter((t) => t.status !== 'completed').length}
                  </div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">
                    Tasks Completed Today
                  </div>
                  <div className="it-updates-stat-value">{completedToday}</div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">In Review</div>
                  <div className="it-updates-stat-value">
                    {myTasks.filter((t) => t.status === 'review').length}
                  </div>
                </div>
                <div className="it-updates-stat-card">
                  <div className="it-updates-stat-label">Total Tasks</div>
                  <div className="it-updates-stat-value">{myTasks.length}</div>
                </div>
              </section>

              <section className="it-updates-dashboard-sections">
                <div className="it-updates-panel it-updates-panel-full">
                  <div className="it-updates-panel-header">
                    <h2>My Kanban</h2>
                  </div>
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <section className="it-updates-columns">
                      {['in_progress', 'review', 'completed'].map((statusKey) =>
                        renderKanbanColumn(
                          statusKey,
                          myTaskGroups[statusKey] || []
                        )
                      )}
                    </section>
                  </DragDropContext>
                </div>
              </section>
            </>
          )}

          {/* ─── My Tasks ─── */}
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
                  {['in_progress', 'review', 'completed'].map((statusKey) =>
                    renderKanbanColumn(statusKey, myTaskGroups[statusKey] || [])
                  )}
                </section>
              </DragDropContext>
            </>
          )}

          {/* ─── All Tasks ─── */}
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
                  {['in_progress', 'review', 'completed'].map((statusKey) =>
                    renderKanbanColumn(
                      statusKey,
                      groupTasksByStatus(filteredTasks)[statusKey] || []
                    )
                  )}
                </section>
              </DragDropContext>
            </>
          )}

          {/* ─── Overview ─── */}
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
                  Consultant
                  <select
                    value={overviewFilters.assigned_to}
                    onChange={(e) =>
                      setOverviewFilters((f) => ({ ...f, assigned_to: e.target.value }))
                    }
                  >
                    <option value="">All</option>
                    {teamOverview.map((u) => (
                      <option
                        key={u.user_id ?? u.assignee}
                        value={u.user_id ?? u.assignee}
                      >
                        {u.username ?? u.assignee}
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
                      <th>Task Title</th>
                      <th>Assigned To</th>
                      <th>Assigned By</th>
                      <th>Status</th>
                      <th>Priority</th>
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
                        <td>{task.title}</td>
                        <td>{task.assignee ?? '—'}</td>
                        <td>{task.assigned_by_name ?? '—'}</td>
                        <td>
                          <span
                            className="it-updates-status-badge"
                            style={{
                              backgroundColor: STATUS_COLORS[task.status]
                                ? `${STATUS_COLORS[task.status]}18`
                                : undefined,
                              color:
                                STATUS_COLORS[task.status] || '#374151',
                            }}
                          >
                            {STATUS_LABELS[task.status] ?? task.status}
                          </span>
                        </td>
                        <td>{(task.priority || 'medium').toUpperCase()}</td>
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

          {/* ─── EOD Updates ─── */}
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
                Your end-of-day reports. Click <strong>Submit EOD</strong> or the EOD button in the header.
              </p>
              <div className="it-updates-eod-list">
                {eodReports.length === 0 ? (
                  <div className="it-updates-empty">No EOD reports yet.</div>
                ) : (
                  eodReports.map((report) => (
                    <div
                      key={report.report_id ?? report.id}
                      className="it-updates-eod-card"
                    >
                      <div className="it-updates-eod-card-header">
                        <span className="it-updates-eod-date">
                          {report.report_date
                            ? new Date(report.report_date).toLocaleDateString(
                                undefined,
                                {
                                  weekday: 'short',
                                  year: 'numeric',
                                  month: 'short',
                                  day: 'numeric',
                                }
                              )
                            : '—'}
                        </span>
                        <span className="it-updates-eod-user">
                          {report.username || user?.username}
                        </span>
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
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </main>
        {loading && <div className="it-updates-loading-bar" />}
      </div>

      {/* ─── Modals ─── */}
      {taskModal.open && (
        <TaskModal
          task={taskModal.task}
          onClose={closeTaskModal}
          onSave={handleSaveTask}
          onRefresh={loadMyTasks}
          teamMembers={teamOverview}
          assignedByOptions={adminUsers}
        />
      )}
      {eodModal && (
        <EodModal
          onClose={() => setEodModal(false)}
          onSave={handleSaveEod}
        />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Task Modal
───────────────────────────────────────────── */
function TaskModal({ task, onClose, onSave, onRefresh, teamMembers, assignedByOptions }) {
  const [form, setForm] = useState({
    task_title: task?.title ?? '',
    task_description: task?.task_description ?? task?.description ?? '',
    assigned_to: task?.assigned_to ?? '',
    assigned_by: task?.assigned_by ?? '',
    status: task?.status ?? 'in_progress',
    priority: task?.priority ?? 'medium',
    task_date: task?.task_date ? String(task.task_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    due_date: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
  });

  const [requirements, setRequirements] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [showAddReq, setShowAddReq] = useState(false);
  const [editingReqId, setEditingReqId] = useState(null);
  const [reqForm, setReqForm] = useState({
    title: '',
    status: 'pending',
    priority: 'medium',
    due_date: '',
  });

  const isExistingTask = Boolean(task?.id);

  useEffect(() => {
    if (isExistingTask) {
      setReqLoading(true);
      itUpdatesApi
        .getRequirements(task.id)
        .then((res) => setRequirements(Array.isArray(res.data) ? res.data : []))
        .catch(() => setRequirements([]))
        .finally(() => setReqLoading(false));
    }
  }, [isExistingTask, task?.id]);

  const completedReqs = requirements.filter((r) => r.status === 'completed').length;
  const totalReqs = requirements.length;
  const reqProgress = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0;

  const resetReqForm = () => {
    setReqForm({ title: '', status: 'pending', priority: 'medium', due_date: '' });
    setEditingReqId(null);
  };

  const handleAddRequirement = async () => {
    if (!reqForm.title.trim()) return;
    if (isExistingTask) {
      const res = await itUpdatesApi.createRequirement(task.id, {
        title: reqForm.title,
        status: reqForm.status,
        priority: reqForm.priority,
        due_date: reqForm.due_date || null,
      });
      setRequirements((prev) => [...prev, res.data]);
    } else {
      setRequirements((prev) => [
        ...prev,
        { id: `temp-${Date.now()}`, ...reqForm, due_date: reqForm.due_date || null },
      ]);
    }
    resetReqForm();
    setShowAddReq(false);
  };

  const handleUpdateRequirement = async () => {
    if (!reqForm.title.trim() || !editingReqId) return;
    if (isExistingTask && !String(editingReqId).startsWith('temp-')) {
      const res = await itUpdatesApi.updateRequirement(task.id, editingReqId, {
        title: reqForm.title,
        status: reqForm.status,
        priority: reqForm.priority,
        due_date: reqForm.due_date || null,
      });
      setRequirements((prev) => prev.map((r) => (r.id === editingReqId ? res.data : r)));
    } else {
      setRequirements((prev) =>
        prev.map((r) =>
          r.id === editingReqId ? { ...r, ...reqForm, due_date: reqForm.due_date || null } : r
        )
      );
    }
    resetReqForm();
    setShowAddReq(false);
  };

  const handleDeleteRequirement = async (reqId) => {
    if (isExistingTask && !String(reqId).startsWith('temp-')) {
      await itUpdatesApi.deleteRequirement(task.id, reqId);
    }
    setRequirements((prev) => prev.filter((r) => r.id !== reqId));
  };

  const handleToggleReqStatus = async (req) => {
    const newStatus = req.status === 'completed' ? 'pending' : 'completed';
    if (isExistingTask && !String(req.id).startsWith('temp-')) {
      const res = await itUpdatesApi.updateRequirement(task.id, req.id, { status: newStatus });
      setRequirements((prev) => prev.map((r) => (r.id === req.id ? res.data : r)));
    } else {
      setRequirements((prev) =>
        prev.map((r) => (r.id === req.id ? { ...r, status: newStatus } : r))
      );
    }
  };

  const startEditReq = (req) => {
    setEditingReqId(req.id);
    setReqForm({
      title: req.title,
      status: req.status,
      priority: req.priority,
      due_date: req.due_date ? String(req.due_date).slice(0, 10) : '',
    });
    setShowAddReq(true);
  };

  const handleManualRework = async () => {
    try {
      const newStatus = 'in_progress';
      setForm((prev) => ({ ...prev, status: newStatus }));
      await itUpdatesApi.updateTask(task.id, { ...form, status: newStatus });
      if (onRefresh) onRefresh();
    } catch {
      // ignore
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...form,
      requirements,
      due_date: form.due_date || undefined,
    });
  };

  const PRIORITY_C = {
    low: '#10b981',
    medium: '#f59e0b',
    high: '#f97316',
    critical: '#ef4444',
  };

  const REQ_STATUS_COLORS = { pending: '#94a3b8', in_progress: '#6366f1', completed: '#10b981' };
  const REQ_STATUS_LABELS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };

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
          <label>
            Description
            <textarea
              value={form.task_description}
              onChange={(e) => setForm((f) => ({ ...f, task_description: e.target.value }))}
              rows={2}
            />
          </label>

          {/* Requirements */}
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

            {totalReqs > 0 && (
              <div className="req-progress-wrap">
                <div className="req-progress-bar">
                  <div className="req-progress-fill" style={{ width: `${reqProgress}%` }} />
                </div>
                <span className="req-progress-label">{reqProgress}%</span>
              </div>
            )}

            {isExistingTask && reqLoading && <p className="req-note">Loading requirements…</p>}
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
                        <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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
                      <button type="button" className="req-action-btn" onClick={() => startEditReq(req)} title="Edit">✏️</button>
                      <button type="button" className="req-action-btn req-action-btn-danger" onClick={() => handleDeleteRequirement(req.id)} title="Delete">🗑️</button>
                    </div>
                  </div>
                  <div className="req-card-meta">
                    <span className="req-status-badge" style={{ backgroundColor: `${REQ_STATUS_COLORS[req.status]}18`, color: REQ_STATUS_COLORS[req.status] }}>
                      {REQ_STATUS_LABELS[req.status] ?? req.status}
                    </span>
                    <span className="req-priority-badge" style={{ backgroundColor: `${PRIORITY_C[req.priority] || PRIORITY_C.medium}18`, color: PRIORITY_C[req.priority] || PRIORITY_C.medium }}>
                      {(req.priority || 'medium').toUpperCase()}
                    </span>
                    {req.due_date && (
                      <span className="req-due-date">Due: {new Date(req.due_date).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {showAddReq && (
              <div className="req-form">
                <h4 className="req-form-title">{editingReqId ? 'Edit Requirement' : 'New Requirement'}</h4>
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
                    <input type="date" value={reqForm.due_date} onChange={(e) => setReqForm((f) => ({ ...f, due_date: e.target.value }))} />
                  </label>
                </div>
                <div className="req-form-actions">
                  <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={() => { resetReqForm(); setShowAddReq(false); }}>Cancel</button>
                  <button type="button" className="it-updates-btn it-updates-btn-primary" onClick={editingReqId ? handleUpdateRequirement : handleAddRequirement} disabled={!reqForm.title.trim()}>
                    {editingReqId ? 'Update' : 'Add Requirement'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <label>
            Assign to
            <select value={form.assigned_to} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}>
              <option value="">—</option>
              {teamMembers.map((u) => (
                <option key={u.user_id ?? u.assignee} value={u.user_id ?? u.assignee ?? ''}>
                  {u.username ?? u.assignee}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assigned by
            <select value={form.assigned_by} onChange={(e) => setForm((f) => ({ ...f, assigned_by: e.target.value }))}>
              <option value="">—</option>
              {(assignedByOptions || []).map((u) => (
                <option key={u.user_id ?? u.assignee} value={u.user_id ?? u.assignee ?? ''}>
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

/* ─────────────────────────────────────────────
   EOD Modal
───────────────────────────────────────────── */
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
      mood: form.status,
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
            Work summary (What did you complete?) *
            <textarea
              value={form.achievements}
              onChange={(e) => setForm((f) => ({ ...f, achievements: e.target.value }))}
              placeholder="e.g. Completed client follow-up, reviewed proposals..."
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
