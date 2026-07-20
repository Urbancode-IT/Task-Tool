import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  MdCampaign,
  MdCalendarToday,
  MdChecklist,
  MdClose,
  MdAdd,
  MdInsights,
  MdHome,
  MdLink,
  MdLogout,
  MdMenu,
  MdOutlineAssignment,
  MdRefresh,
  MdTableChart,
  MdViewKanban,
  MdEdit,
  MdDelete,
  MdReplay,
} from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import { getDisplayRole } from '../../utils/displayRole';
import { isTaskOverdue } from '../../utils/taskDue';
import { toastSuccess, toastError } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import { taskInPeriod, EMPTY_PERIOD } from '../../utils/taskPeriod';
import { controlKeys, textareaSubmit, escapeCloses } from '../../utils/formKeys';
import PeriodFilter from '../../components/PeriodFilter';
import TaskComments from '../../components/TaskComments';
import ModalKebabMenu from '../../components/ModalKebabMenu';
import ProjectLogo from '../../components/ProjectLogo';
import SidebarUser from '../../components/SidebarUser';
import useSidebarCollapsed from '../../utils/useSidebarCollapsed';
import RequirementTimer from '../../components/RequirementTimer';
import RequirementManualTime from '../../components/RequirementManualTime';
import { BRANCHES } from '../Admin/AdminUserModals';
import MemberDashboard from '../ITUpdates/MemberDashboard';
import Preloader from '../../components/Preloader';
import { sanitizeCommentHtml } from '../../utils/sanitizeHtml';
import '../ITUpdates/ITUpdatesMain.css';

const TABS = [
  { key: 'Dashboard', label: 'Home', icon: MdHome },
  { key: 'My Dashboard', label: 'Dashboard', icon: MdInsights },
  { key: 'My Tasks', label: 'My Tasks', icon: MdChecklist },
  { key: 'All Tasks', label: 'All Tasks', icon: MdViewKanban },
  { key: 'Overview', label: 'Overview', icon: MdTableChart },
  { key: 'Calendar', label: 'Calendar', icon: MdCalendarToday },
  { key: 'Link Hub', label: 'Link Hub', icon: MdLink },
  { key: 'EOD Updates', label: 'EOD Updates', icon: MdOutlineAssignment },
];
const MODULE_TEAM = 'social_media';

const EMPTY_ALL_TASKS_FILTERS = { status: '', priority: '', assignee: '', branch: '', period: EMPTY_PERIOD };
const EMPTY_OVERVIEW_FILTERS = { from_date: '', to_date: '', assigned_to: '' };

const STATUS_LABELS = {
  requirement: 'Requirement',
  idea: 'Idea',
  instagram: 'Instagram',
  meta_ads: 'Meta Ads',
  linkedin: 'Linkedin',
  youtube: 'Youtube',
  google_ads: 'Google Ads',
  gmb: 'GMB',
  completed: 'Completed',
  todo: 'Requirement',
  in_progress: 'Idea',
  review: 'Instagram',
  rework: 'Meta Ads',
};

const STATUS_COLORS = {
  requirement: '#94a3b8',
  idea: '#6366f1',
  instagram: '#e11d48',
  meta_ads: '#2563eb',
  linkedin: '#0284c7',
  youtube: '#dc2626',
  google_ads: '#f59e0b',
  gmb: '#0f766e',
  completed: '#10b981',
  todo: '#94a3b8',
  in_progress: '#6366f1',
  review: '#e11d48',
  rework: '#2563eb',
};

const STATUS_ORDER = [
  'requirement',
  'idea',
  'instagram',
  'meta_ads',
  'linkedin',
  'youtube',
  'google_ads',
  'gmb',
  'completed',
];

const LEGACY_STATUS_ALIASES = {
  todo: 'requirement',
  in_progress: 'idea',
  review: 'instagram',
  rework: 'meta_ads',
};

const normalizeStatusKey = (status) => LEGACY_STATUS_ALIASES[status] || status || 'requirement';
const getStatusLabel = (status) => STATUS_LABELS[normalizeStatusKey(status)] || status;
const getStatusColor = (status) => STATUS_COLORS[normalizeStatusKey(status)] || '#374151';

const PRIORITY_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const CONTENT_TYPE_COLORS = {
  poster: '#0ea5e9',
  blog: '#14b8a6',
  social_post: '#8b5cf6',
  video: '#f97316',
  ad_copy: '#ec4899',
};

const CHANNEL_COLORS = {
  Instagram: '#e11d48',
  Facebook: '#2563eb',
  LinkedIn: '#0284c7',
  YouTube: '#dc2626',
  Website: '#0f766e',
  Email: '#4f46e5',
};

const groupTasksByStatus = (tasks) =>
  tasks.reduce(
    (acc, task) => {
      const key = normalizeStatusKey(task.status);
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
      return acc;
    },
    STATUS_ORDER.reduce((acc, status) => ({ ...acc, [status]: [] }), {})
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
        title={name}
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

export default function SocialMediaMain({ currentUser, onLogout }) {
  const [activeTab, setActiveTab] = useState('Dashboard');
  const [loading, setLoading] = useState(false);
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed } = useSidebarCollapsed();

  const [tasks, setTasks] = useState([]);
  const [eodReports, setEodReports] = useState([]);
  const [teamOverview, setTeamOverview] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);

  const [taskModal, setTaskModal] = useState({ open: false, task: null });
  const [eodModal, setEodModal] = useState(false);
  const [allTasksFiltersApplied, setAllTasksFiltersApplied] = useState(EMPTY_ALL_TASKS_FILTERS);
  const [overviewFiltersApplied, setOverviewFiltersApplied] = useState(EMPTY_OVERVIEW_FILTERS);
  const [linkHubMissingOnly, setLinkHubMissingOnly] = useState(false);

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

  const isAdmin = useMemo(
    () => Array.isArray(user?.permissions) && user.permissions.includes('admin.access'),
    [user]
  );

  // Delete is available to admins and the task's creator/assigner.
  const canDeleteTask = (task) =>
    isAdmin ||
    (userId != null &&
      (String(task?.assigned_by) === String(userId) || String(task?.created_by) === String(userId)));

  const handleDeleteTask = async (task) => {
    if (!task) return false;
    const label = task.title || task.task_title || 'this task';
    if (
      !(await confirmDialog({
        title: 'Delete task?',
        message: `"${label}" and its requirements will be permanently removed. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return false;
    try {
      await itUpdatesApi.deleteTask(task.id, { team: MODULE_TEAM });
      setTasks((prev) => prev.filter((t) => String(t.id) !== String(task.id)));
      toastSuccess('Task deleted');
      return true;
    } catch {
      toastError('Failed to delete task');
      return false;
    }
  };

  const loadMyTasks = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError('');
    try {
      const [tasksRes, teamRes, adminRes] = await Promise.all([
        itUpdatesApi.getTasks({ team: MODULE_TEAM }),
        itUpdatesApi.getTeamOverview({ team: MODULE_TEAM }).catch(() => ({ data: [] })),
        itUpdatesApi.getTeamOverview({ team: 'it' }).catch(() => ({ data: [] })),
      ]);
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      setTeamOverview(Array.isArray(teamRes.data) ? teamRes.data : []);
      const itTeam = Array.isArray(adminRes.data) ? adminRes.data : [];
      setAdminUsers(itTeam.filter((u) => u?.is_it_manager));
    } catch (err) {
      setError(
        err?.response?.data?.message || 'Failed to load social media tasks.'
      );
    } finally {
      setLoading(false);
      setBooted(true);
    }
  }, [userId]);

  const refreshTasksOnly = useCallback(async () => {
    if (!userId) return;
    setError('');
    try {
      const tasksRes = await itUpdatesApi.getTasks({ team: MODULE_TEAM });
      setTasks(Array.isArray(tasksRes?.data) ? tasksRes.data : []);
    } catch {
      setError('Failed to load tasks');
    }
  }, [userId]);

  const refreshEodReportsOnly = useCallback(async () => {
    if (!userId) return;
    setError('');
    try {
      const res = await itUpdatesApi.getEodReports({ user_id: userId, team: MODULE_TEAM });
      setEodReports(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setError('Failed to load EOD reports');
    }
  }, [userId]);

  useEffect(() => {
    loadMyTasks();
  }, [loadMyTasks]);

  useEffect(() => {
    if (!userId) return;
    if (activeTab === 'EOD Updates') {
      itUpdatesApi
        .getEodReports({ user_id: userId, team: MODULE_TEAM })
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

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (allTasksFiltersApplied.status) result = result.filter((t) => t.status === allTasksFiltersApplied.status);
    if (allTasksFiltersApplied.priority) result = result.filter((t) => t.priority === allTasksFiltersApplied.priority);
    if (allTasksFiltersApplied.assignee)
      result = result.filter((t) => String(t.assigned_to) === String(allTasksFiltersApplied.assignee));
    if (allTasksFiltersApplied.branch)
      result = result.filter((t) => t.assignee_branch === allTasksFiltersApplied.branch);
    if (allTasksFiltersApplied.period)
      result = result.filter((t) => taskInPeriod(t, allTasksFiltersApplied.period));
    return result;
  }, [tasks, allTasksFiltersApplied]);

  const overviewTasks = useMemo(() => {
    let result = tasks;
    if (overviewFiltersApplied.from_date)
      result = result.filter((t) => t.task_date && t.task_date.slice(0, 10) >= overviewFiltersApplied.from_date);
    if (overviewFiltersApplied.to_date)
      result = result.filter((t) => t.task_date && t.task_date.slice(0, 10) <= overviewFiltersApplied.to_date);
    if (overviewFiltersApplied.assigned_to)
      result = result.filter((t) => String(t.assigned_to) === String(overviewFiltersApplied.assigned_to));
    return result;
  }, [tasks, overviewFiltersApplied]);

  const calendarTasks = useMemo(() => {
    const toKey = (t) =>
      t.target_date || t.publish_date || (t.task_date ? String(t.task_date).slice(0, 10) : '');
    return [...tasks]
      .filter((t) => Boolean(toKey(t)))
      .sort((a, b) => String(toKey(a)).localeCompare(String(toKey(b))));
  }, [tasks]);

  const linkHubTasks = useMemo(() => {
    const hasAnyLink = (t) => Boolean(t.design_link || t.content_doc_link || t.publish_link);
    const hasMissingLink = (t) => !t.design_link || !t.content_doc_link || !t.publish_link;
    return tasks.filter((t) => {
      if (!hasAnyLink(t)) return false;
      if (!linkHubMissingOnly) return true;
      return hasMissingLink(t);
    });
  }, [tasks, linkHubMissingOnly]);

  const handleCopyLink = useCallback(async (link) => {
    try {
      if (!link) return;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      }
    } catch (_) {
      // no-op fallback
    }
  }, []);

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
        await itUpdatesApi.updateTask(taskId, { status: newStatus, team: MODULE_TEAM });
        toastSuccess(`Task moved to ${getStatusLabel(newStatus)}`);
      } catch {
        setTasks((prev) =>
          prev.map((t) =>
            String(t.id) === String(taskId) ? { ...t, status: task.status } : t
          )
        );
        setError('Failed to update task status');
        toastError('Failed to update task status');
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
        campaign_name: payload.campaign_name,
        content_type: payload.content_type,
        channel: payload.channel,
        design_link: payload.design_link,
        content_doc_link: payload.content_doc_link,
        publish_link: payload.publish_link,
        target_date: payload.target_date,
        publish_date: payload.publish_date,
        projectId: payload.project_id ?? payload.projectId,
        assigned_to: (payload.assigned_to === '' ? userId : payload.assigned_to),
        assigned_by: payload.assigned_by || null,
        status: payload.status,
        priority: payload.priority,
        task_date: payload.task_date,
        dueDate: payload.due_date ?? payload.dueDate,
      };
      const isEdit = Boolean(taskModal.task?.id);
      if (isEdit) {
        await itUpdatesApi.updateTask(taskModal.task.id, { ...body, team: MODULE_TEAM });
      } else {
        const res = await itUpdatesApi.createTask({ ...body, team: MODULE_TEAM });
        const newTaskId = res.data?.id || res.data?.task_id;
        if (newTaskId && payload.requirements?.length > 0) {
          await Promise.all(
            payload.requirements.map((req) =>
              itUpdatesApi.createRequirement(newTaskId, {
                title: req.title,
                status: req.status,
                priority: req.priority,
                due_date: req.due_date || null,
                team: MODULE_TEAM,
              })
            )
          );
        }
      }
      await refreshTasksOnly();
      toastSuccess(isEdit ? 'Task updated' : 'Task created');
      return true;
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to save task';
      setError(msg);
      toastError(msg);
      return false;
    }
  };

  const handleSaveEod = async (payload) => {
    try {
      await itUpdatesApi.createEodReport({
        ...payload,
        user_id: userId,
        team: MODULE_TEAM,
      });
      setEodModal(false);
      await refreshEodReportsOnly();
      toastSuccess('EOD report submitted');
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to save EOD report';
      setError(msg);
      toastError(msg);
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
                {(providedDrag, snapshotDrag) => {
                  const overdue = isTaskOverdue(task);
                  return (
                  <div
                    ref={providedDrag.innerRef}
                    {...providedDrag.draggableProps}
                    {...providedDrag.dragHandleProps}
                    className={[
                      'it-updates-task-card',
                      snapshotDrag.isDragging && 'it-updates-task-card-dragging',
                      overdue && 'it-updates-task-card-overdue',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => openTaskModal(task)}
                  >
                    <div className="it-updates-task-card-toprow">
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
                      {overdue ? (
                        <span className="it-updates-task-card-pending-tag" title="Past due date">
                          Pending
                        </span>
                      ) : null}
                    </div>
                    <div className="it-updates-task-card-title">{task.title}</div>
                    <div className="it-updates-task-card-desc">
                      <span
                        className="it-updates-status-badge"
                        style={{
                          backgroundColor: `${CONTENT_TYPE_COLORS[task.content_type] || '#64748b'}18`,
                          color: CONTENT_TYPE_COLORS[task.content_type] || '#334155',
                          marginRight: '0.4rem',
                        }}
                      >
                        {(task.content_type || 'asset').replace('_', ' ')}
                      </span>
                      <span
                        className="it-updates-status-badge"
                        style={{
                          backgroundColor: `${CHANNEL_COLORS[task.channel] || '#64748b'}18`,
                          color: CHANNEL_COLORS[task.channel] || '#334155',
                        }}
                      >
                        {task.channel || 'Channel TBD'}
                      </span>
                    </div>
                    {(task.project_name || task.campaign_name) ? (
                      <span className="it-updates-task-card-project" title={task.project_name || task.campaign_name}>
                        {task.project_name || task.campaign_name}
                      </span>
                    ) : null}
                    {Number(task.req_total) > 0 && (
                      <div className="it-updates-task-card-reqs">
                        <div className="it-updates-task-card-reqs-label">
                          <MdChecklist size={12} />
                          <span>
                            {Number(task.req_completed) || 0}/{Number(task.req_total)} subtasks
                          </span>
                        </div>
                        <div className="it-updates-task-card-reqs-bar">
                          <div
                            className="it-updates-task-card-reqs-fill"
                            style={{
                              width: `${Math.round(
                                ((Number(task.req_completed) || 0) / Number(task.req_total)) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                    <div className="it-updates-task-card-footer">
                      <ProjectLogo
                        src={task.project_logo}
                        name={task.project_name}
                        size={26}
                        className="it-updates-task-card-logo"
                      />
                      <div className="it-updates-task-card-people">
                        {task.assigned_by_name ? (
                          <span className="it-updates-task-card-person">
                            <Avatar user={{ username: task.assigned_by_name, profile_image: task.assigned_by_profile_image }} />
                          </span>
                        ) : null}
                        <span className="it-updates-task-card-person">
                          <Avatar user={{ username: task.assignee, profile_image: task.assignee_profile_image }} />
                        </span>
                      </div>
                    </div>
                    {task.status === 'completed' &&
                      (task.reviewed_by_username || task.review_comment) && (
                        <div className="it-updates-task-card-review">
                          {task.reviewed_by_username ? (
                            <span>Reviewed by {task.reviewed_by_username}</span>
                          ) : null}
                          {task.review_comment ? (
                            <span className="it-updates-task-card-review-comment">{task.review_comment}</span>
                          ) : null}
                        </div>
                      )}
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
    <div className={`it-updates-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {sidebarOpen && (
        <div
          className="it-updates-sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav className="it-updates-sidebar-nav">
          <div className="it-updates-sidebar-nav-label"></div>
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
          <SidebarUser user={user} onLogout={onLogout} />
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
                {activeTab === 'Dashboard' && 'Overview of your campaigns and tasks'}
                {activeTab === 'My Dashboard' && (isAdmin ? "Members' working hours, projects and leave" : 'Your working hours, projects and leave')}
                {activeTab === 'My Tasks' && 'Tasks assigned to you'}
                {activeTab === 'All Tasks' && 'All tasks in kanban view'}
                {activeTab === 'Overview' && 'Detailed task overview and filters'}
                {activeTab === 'Calendar' && 'Scheduled and published content timeline'}
                {activeTab === 'Link Hub' && 'Design, content, and publish links in one place'}
                {activeTab === 'EOD Updates' && 'Your end-of-day reports'}
              </p>
            </div>
          </div>
          <div className="it-updates-topbar-right">
            {(activeTab === 'My Tasks' || activeTab === 'All Tasks') && (
              <button
                type="button"
                className="it-updates-btn it-updates-btn-primary"
                onClick={() => openTaskModal(null)}
              >
                <MdAdd size={18} />
                Add task
              </button>
            )}
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
          {!booted && <Preloader label="Loading your workspace…" />}
          {booted && loading && <Preloader label="Loading…" />}
          {activeTab === 'My Dashboard' && (
            <MemberDashboard currentUser={user} members={teamOverview} isAdmin={isAdmin} team={MODULE_TEAM} />
          )}
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
                  <div className="it-updates-stat-label">Channel Tasks</div>
                  <div className="it-updates-stat-value">
                    {myTasks.filter((t) =>
                      ['instagram', 'meta_ads', 'linkedin', 'youtube', 'google_ads', 'gmb'].includes(
                        normalizeStatusKey(t.status)
                      )
                    ).length}
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
                    <h2>
                      <MdCampaign size={20} style={{ marginRight: '0.4rem', verticalAlign: 'middle' }} />
                      My Campaigns &amp; Tasks
                    </h2>
                  </div>
                  <DragDropContext onDragEnd={handleDragEnd}>
                    <div className="it-updates-kanban-wrap social-media-kanban-wrap">
                      <section className="it-updates-columns social-media-columns">
                        {STATUS_ORDER.map((statusKey) =>
                          renderKanbanColumn(
                            statusKey,
                            myTaskGroups[statusKey] || []
                          )
                        )}
                      </section>
                    </div>
                  </DragDropContext>
                </div>
              </section>
            </>
          )}

          {/* ─── My Tasks ─── */}
          {activeTab === 'My Tasks' && (
            <>
              <DragDropContext onDragEnd={handleDragEnd}>
                <div className="it-updates-kanban-wrap social-media-kanban-wrap">
                  <section className="it-updates-columns social-media-columns">
                    {STATUS_ORDER.map((statusKey) =>
                      renderKanbanColumn(statusKey, myTaskGroups[statusKey] || [])
                    )}
                  </section>
                </div>
              </DragDropContext>
            </>
          )}

          {/* ─── All Tasks ─── */}
          {activeTab === 'All Tasks' && (
            <>
              <div className="it-updates-filters">
                <select
                  value={allTasksFiltersApplied.status}
                  onChange={(e) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  <option value="">Statuses</option>
                  {STATUS_ORDER.map((status) => (
                    <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                  ))}
                </select>
                <select
                  value={allTasksFiltersApplied.priority}
                  onChange={(e) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, priority: e.target.value }))
                  }
                >
                  <option value="">Priorities</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                <select
                  value={allTasksFiltersApplied.assignee}
                  onChange={(e) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, assignee: e.target.value }))
                  }
                >
                  <option value="">Members</option>
                  {teamOverview.map((u) => (
                    <option key={u.user_id ?? u.assignee} value={u.user_id ?? u.assignee ?? ''}>
                      {u.username ?? u.assignee}
                    </option>
                  ))}
                </select>
                <select
                  value={allTasksFiltersApplied.branch}
                  onChange={(e) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, branch: e.target.value }))
                  }
                >
                  <option value="">Branches</option>
                  {BRANCHES.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <PeriodFilter
                  value={allTasksFiltersApplied.period}
                  onChange={(period) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, period }))
                  }
                />
              </div>
              <DragDropContext onDragEnd={handleDragEnd}>
                <div className="it-updates-kanban-wrap social-media-kanban-wrap">
                  <section className="it-updates-columns social-media-columns">
                    {STATUS_ORDER.map((statusKey) =>
                      renderKanbanColumn(
                        statusKey,
                        groupTasksByStatus(filteredTasks)[statusKey] || []
                      )
                    )}
                  </section>
                </div>
              </DragDropContext>
            </>
          )}

          {/* ─── Overview ─── */}
          {activeTab === 'Overview' && (
            <section className="it-updates-panel">
              <div className="it-updates-overview-filters">
                <label>
                  From date
                  <input
                    type="date"
                    value={overviewFiltersApplied.from_date}
                    onChange={(e) =>
                      setOverviewFiltersApplied((f) => ({ ...f, from_date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  To date
                  <input
                    type="date"
                    value={overviewFiltersApplied.to_date}
                    onChange={(e) =>
                      setOverviewFiltersApplied((f) => ({ ...f, to_date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Team Member
                  <select
                    value={overviewFiltersApplied.assigned_to}
                    onChange={(e) =>
                      setOverviewFiltersApplied((f) => ({ ...f, assigned_to: e.target.value }))
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
                              backgroundColor: `${getStatusColor(task.status)}18`,
                              color: getStatusColor(task.status),
                            }}
                          >
                            {getStatusLabel(task.status)}
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

          {/* ─── Calendar ─── */}
          {activeTab === 'Calendar' && (
            <section className="it-updates-panel it-updates-panel-full">
              <div className="it-updates-panel-header">
                <h2>Content Calendar</h2>
              </div>
              <div className="it-updates-table-wrap">
                <table className="it-updates-table-overview">
                  <thead>
                    <tr>
                      <th>Target Date</th>
                      <th>Publish Date</th>
                      <th>Title</th>
                      <th>Campaign</th>
                      <th>Type</th>
                      <th>Channel</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendarTasks.map((task) => (
                      <tr key={`cal-${task.id}`}>
                        <td>{task.target_date ? new Date(task.target_date).toLocaleDateString() : '—'}</td>
                        <td>{task.publish_date ? new Date(task.publish_date).toLocaleDateString() : '—'}</td>
                        <td>{task.title}</td>
                        <td>{task.campaign_name || '—'}</td>
                        <td>
                          {task.content_type ? (
                            <span
                              className="it-updates-status-badge"
                              style={{
                                backgroundColor: `${CONTENT_TYPE_COLORS[task.content_type] || '#64748b'}18`,
                                color: CONTENT_TYPE_COLORS[task.content_type] || '#334155',
                              }}
                            >
                              {task.content_type.replace('_', ' ')}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          {task.channel ? (
                            <span
                              className="it-updates-status-badge"
                              style={{
                                backgroundColor: `${CHANNEL_COLORS[task.channel] || '#64748b'}18`,
                                color: CHANNEL_COLORS[task.channel] || '#334155',
                              }}
                            >
                              {task.channel}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          <span
                            className="it-updates-status-badge"
                            style={{
                              backgroundColor: `${getStatusColor(task.status)}18`,
                              color: getStatusColor(task.status),
                            }}
                          >
                            {getStatusLabel(task.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!calendarTasks.length && (
                <div className="it-updates-empty">No scheduled items yet. Add target or publish dates in tasks.</div>
              )}
            </section>
          )}

          {/* ─── Link Hub ─── */}
          {activeTab === 'Link Hub' && (
            <section className="it-updates-panel it-updates-panel-full">
              <div className="it-updates-panel-header">
                <h2>Link Hub</h2>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={linkHubMissingOnly}
                    onChange={(e) => setLinkHubMissingOnly(e.target.checked)}
                  />
                  Show only missing links
                </label>
              </div>
              <div className="it-updates-table-wrap">
                <table className="it-updates-table-overview">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Campaign</th>
                      <th>Type</th>
                      <th>Design</th>
                      <th>Content Doc</th>
                      <th>Published</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkHubTasks.map((task) => (
                      <tr key={`link-${task.id}`}>
                        <td>{task.title}</td>
                        <td>{task.campaign_name || '—'}</td>
                        <td>
                          {task.content_type ? (
                            <span
                              className="it-updates-status-badge"
                              style={{
                                backgroundColor: `${CONTENT_TYPE_COLORS[task.content_type] || '#64748b'}18`,
                                color: CONTENT_TYPE_COLORS[task.content_type] || '#334155',
                              }}
                            >
                              {task.content_type.replace('_', ' ')}
                            </span>
                          ) : '—'}
                        </td>
                        <td>
                          {task.design_link ? (
                            <div style={{ display: 'inline-flex', gap: '0.45rem', alignItems: 'center' }}>
                              <a href={task.design_link} target="_blank" rel="noreferrer">Open</a>
                              <button
                                type="button"
                                className="it-updates-btn it-updates-btn-secondary"
                                onClick={() => handleCopyLink(task.design_link)}
                                style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                              >
                                Copy
                              </button>
                            </div>
                          ) : '—'}
                        </td>
                        <td>
                          {task.content_doc_link ? (
                            <div style={{ display: 'inline-flex', gap: '0.45rem', alignItems: 'center' }}>
                              <a href={task.content_doc_link} target="_blank" rel="noreferrer">Open</a>
                              <button
                                type="button"
                                className="it-updates-btn it-updates-btn-secondary"
                                onClick={() => handleCopyLink(task.content_doc_link)}
                                style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                              >
                                Copy
                              </button>
                            </div>
                          ) : '—'}
                        </td>
                        <td>
                          {task.publish_link ? (
                            <div style={{ display: 'inline-flex', gap: '0.45rem', alignItems: 'center' }}>
                              <a href={task.publish_link} target="_blank" rel="noreferrer">Open</a>
                              <button
                                type="button"
                                className="it-updates-btn it-updates-btn-secondary"
                                onClick={() => handleCopyLink(task.publish_link)}
                                style={{ padding: '0.15rem 0.45rem', fontSize: '0.75rem' }}
                              >
                                Copy
                              </button>
                            </div>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!linkHubTasks.length && (
                <div className="it-updates-empty">No links yet. Add design/content/publish links in tasks.</div>
              )}
            </section>
          )}

          {/* ─── EOD Updates ─── */}
          {activeTab === 'EOD Updates' && (
            <section className="it-updates-panel it-updates-panel-full">
              <div className="it-updates-panel-header">
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
                          {/* Achievements may be rich-text HTML (submitted from a
                              module with the rich editor) or plain text — render it
                              safely so HTML never shows up as raw tags. */}
                          <div
                            className="it-updates-eod-richtext tc-rendered"
                            dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(report.achievements) }}
                          />
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
          currentUser={user}
          onClose={closeTaskModal}
          onSave={handleSaveTask}
          onRefresh={loadMyTasks}
          teamMembers={teamOverview.filter((u) => u.is_active !== false)}
          assignedByOptions={adminUsers}
          canDelete={canDeleteTask(taskModal.task)}
          onDelete={async () => {
            if (await handleDeleteTask(taskModal.task)) closeTaskModal();
          }}
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
function TaskModal({ task, currentUser, onClose, onSave, onRefresh, teamMembers, assignedByOptions, canDelete = false, onDelete }) {
  const [reqExpanded, setReqExpanded] = useState(false);
  const [form, setForm] = useState({
    task_title: task?.title ?? '',
    task_description: task?.task_description ?? task?.description ?? '',
    campaign_name: task?.campaign_name ?? '',
    content_type: task?.content_type ?? 'poster',
    channel: task?.channel ?? 'Instagram',
    design_link: task?.design_link ?? '',
    content_doc_link: task?.content_doc_link ?? '',
    publish_link: task?.publish_link ?? '',
    target_date: task?.target_date ? String(task.target_date).slice(0, 10) : '',
    publish_date: task?.publish_date ? String(task.publish_date).slice(0, 10) : '',
    assigned_to: task?.assigned_to ?? '',
    assigned_by: task?.assigned_by ?? '',
    status: task?.id != null ? normalizeStatusKey(task?.status) : 'requirement',
    priority: task?.priority ?? 'medium',
    task_date: task?.task_date ? String(task.task_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    due_date: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
  });

  const [requirements, setRequirements] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [showAddReq, setShowAddReq] = useState(false);
  const [editingReqId, setEditingReqId] = useState(null);
  const [reqForm, setReqForm] = useState({ title: '' });

  const isExistingTask = Boolean(task?.id);
  const [saveState, setSaveState] = useState({ saving: false, saved: false });
  const [reviewNote, setReviewNote] = useState('');

  useEffect(() => {
    if (!isExistingTask) return;
    let cancelled = false;
    void (async () => {
      setReqLoading(true);
      try {
        const res = await itUpdatesApi.getRequirements(task.id, { team: MODULE_TEAM });
        if (!cancelled) setRequirements(Array.isArray(res.data) ? res.data : []);
      } catch {
        if (!cancelled) setRequirements([]);
      } finally {
        if (!cancelled) setReqLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isExistingTask, task?.id]);

  const completedReqs = requirements.filter((r) => r.status === 'completed').length;
  const totalReqs = requirements.length;
  const reqProgress = totalReqs > 0 ? Math.round((completedReqs / totalReqs) * 100) : 0;

  const resetReqForm = () => {
    setReqForm({ title: '' });
    setEditingReqId(null);
  };

  const handleStatusTransitions = async (updatedReqs) => {
    if (!isExistingTask) return;

    const allDone =
      updatedReqs.length > 0 && updatedReqs.every((r) => r.status === 'completed');
    const hasPending = updatedReqs.some((r) => r.status !== 'completed');

    let newStatus = null;
    if (allDone && form.status === 'requirement') {
      newStatus = 'idea';
    } else if (hasPending && form.status === 'completed') {
      newStatus = 'requirement';
    }

    if (newStatus) {
      try {
        setForm((prev) => ({ ...prev, status: newStatus }));
        await itUpdatesApi.updateTask(task.id, { status: newStatus, team: MODULE_TEAM });
        if (onRefresh) onRefresh();
      } catch (err) {
        console.error('Status transition failed:', err);
      }
    }
  };

  const handleAddRequirement = async () => {
    if (!reqForm.title.trim()) return;
    try {
      if (isExistingTask) {
        const res = await itUpdatesApi.createRequirement(
          task.id,
          {
            title: reqForm.title,
            status: 'pending',
            priority: 'medium',
            due_date: null,
            team: MODULE_TEAM,
          },
          { team: MODULE_TEAM }
        );
        setRequirements((prev) => {
          const newList = [...prev, res.data];
          void handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = [
            ...prev,
            {
              id: `temp-${Date.now()}`,
              title: reqForm.title,
              status: 'pending',
              priority: 'medium',
              due_date: null,
            },
          ];
          void handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch {
      // ignore
    }
  };

  const handleUpdateRequirement = async () => {
    if (!reqForm.title.trim() || !editingReqId) return;
    try {
      if (isExistingTask && !String(editingReqId).startsWith('temp-')) {
        const existingReq = requirements.find((r) => String(r.id) === String(editingReqId));
        const res = await itUpdatesApi.updateRequirement(
          task.id,
          editingReqId,
          {
            title: reqForm.title,
            status: existingReq?.status ?? 'pending',
            priority: existingReq?.priority ?? 'medium',
            due_date: existingReq?.due_date ?? null,
            team: MODULE_TEAM,
          },
          { team: MODULE_TEAM }
        );
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === editingReqId ? res.data : r));
          void handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = prev.map((r) =>
            r.id === editingReqId ? { ...r, title: reqForm.title } : r
          );
          void handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch {
      // ignore
    }
  };

  const handleDeleteRequirement = async (reqId) => {
    try {
      if (isExistingTask && !String(reqId).startsWith('temp-')) {
        await itUpdatesApi.deleteRequirement(task.id, reqId, { team: MODULE_TEAM });
      }
      setRequirements((prev) => {
        const newList = prev.filter((r) => r.id !== reqId);
        void handleStatusTransitions(newList);
        return newList;
      });
    } catch {
      // ignore
    }
  };

  const handleToggleReqStatus = async (req) => {
    const newStatus = req.status === 'completed' ? 'pending' : 'completed';
    // A requirement cannot be ticked complete without recorded work time.
    if (newStatus === 'completed') {
      const hasTime = Number(req.timeSpentSeconds || 0) > 0 || Boolean(req.timerRunning);
      if (!hasTime) {
        toastError('Please enter the time you worked on this requirement first.');
        return;
      }
    }
    try {
      if (isExistingTask && !String(req.id).startsWith('temp-')) {
        const res = await itUpdatesApi.updateRequirement(
          task.id,
          req.id,
          { status: newStatus, team: MODULE_TEAM },
          { team: MODULE_TEAM }
        );
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === req.id ? res.data : r));
          void handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = prev.map((r) =>
            r.id === req.id ? { ...r, status: newStatus } : r
          );
          void handleStatusTransitions(newList);
          return newList;
        });
      }
    } catch {
      // ignore
    }
  };

  const startEditReq = (req) => {
    setEditingReqId(req.id);
    setReqForm({ title: req.title });
    setShowAddReq(true);
  };

  const handleCompleteFromReview = async () => {
    try {
      setForm((prev) => ({ ...prev, status: 'completed' }));
      await itUpdatesApi.updateTask(task.id, {
        ...form,
        status: 'completed',
        review_comment: reviewNote.trim() || undefined,
        team: MODULE_TEAM,
      });
      setReviewNote('');
      if (onRefresh) onRefresh();
      toastSuccess('Task marked complete');
      onClose();
    } catch {
      toastError('Failed to mark task complete');
    }
  };

  const handleManualRework = async () => {
    try {
      const newStatus = 'rework';
      setForm((prev) => ({ ...prev, status: newStatus }));
      await itUpdatesApi.updateTask(task.id, {
        ...form,
        status: newStatus,
        review_comment: reviewNote.trim() || undefined,
        team: MODULE_TEAM,
      });
      setReviewNote('');
      if (onRefresh) onRefresh();
      toastSuccess('Task sent for rework');
    } catch {
      toastError('Failed to send task for rework');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (saveState.saving) return;

    if (!form.task_title.trim()) {
      toastError('Task title is required.');
      return;
    }
    if (!String(form.assigned_to ?? '').trim()) {
      toastError('Please assign this task to a staff member.');
      return;
    }

    setSaveState({ saving: true, saved: false });
    let ok = false;
    try {
      ok = await onSave({
        ...form,
        requirements,
        due_date: form.due_date || undefined,
      });
    } catch {
      ok = false;
    }

    if (ok) {
      setSaveState({ saving: false, saved: true });
      window.setTimeout(() => onClose(), 900);
    } else {
      setSaveState({ saving: false, saved: false });
    }
  };

  return (
    <div className="it-updates-modal-backdrop">
      <div className="it-updates-modal it-updates-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>{task ? 'Edit task' : 'New task'}</h2>
          <div className="it-updates-modal-header-actions">
            {isExistingTask && canDelete && onDelete && (
              <ModalKebabMenu
                actions={[
                  { label: 'Delete task', icon: <MdDelete size={16} />, onClick: onDelete, danger: true },
                ]}
              />
            )}
            <button type="button" className="it-updates-modal-close" onClick={onClose}>
              <MdClose size={22} />
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={escapeCloses(onClose)} className="it-updates-modal-form">
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
              onKeyDown={textareaSubmit}
              rows={2}
            />
          </label>
          <label>
            Campaign name
            <input
              value={form.campaign_name}
              onChange={(e) => setForm((f) => ({ ...f, campaign_name: e.target.value }))}
              placeholder="e.g. Summer Launch 2026"
            />
          </label>
          <label>
            Content type
            <select
              value={form.content_type}
              onChange={(e) => setForm((f) => ({ ...f, content_type: e.target.value }))}
            >
              <option value="poster">Poster</option>
              <option value="blog">Blog</option>
              <option value="social_post">Social Post</option>
              <option value="video">Video/Reel</option>
              <option value="ad_copy">Ad Copy</option>
            </select>
          </label>
          <label>
            Channel
            <select
              value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
            >
              <option value="Instagram">Instagram</option>
              <option value="Facebook">Facebook</option>
              <option value="LinkedIn">LinkedIn</option>
              <option value="YouTube">YouTube</option>
              <option value="Website">Website</option>
              <option value="Email">Email</option>
            </select>
          </label>
          <label>
            Design link
            <input
              value={form.design_link}
              onChange={(e) => setForm((f) => ({ ...f, design_link: e.target.value }))}
              placeholder="https://..."
            />
          </label>
          <label>
            Content doc link
            <input
              value={form.content_doc_link}
              onChange={(e) => setForm((f) => ({ ...f, content_doc_link: e.target.value }))}
              placeholder="https://..."
            />
          </label>
          <label>
            Publish link
            <input
              value={form.publish_link}
              onChange={(e) => setForm((f) => ({ ...f, publish_link: e.target.value }))}
              placeholder="https://..."
            />
          </label>
          <label>
            Target publish date
            <input
              type="date"
              value={form.target_date}
              onChange={(e) => setForm((f) => ({ ...f, target_date: e.target.value }))}
            />
          </label>
          <label>
            Actual publish date
            <input
              type="date"
              value={form.publish_date}
              onChange={(e) => setForm((f) => ({ ...f, publish_date: e.target.value }))}
            />
          </label>

          {isExistingTask &&
            task?.status === 'completed' &&
            (task?.review_comment || task?.reviewed_by_username || task?.reviewed_at) && (
              <div className="it-updates-review-meta">
                <div className="it-updates-review-meta-title">Last review</div>
                {task.reviewed_by_username ? (
                  <div className="it-updates-review-meta-row">
                    <span className="it-updates-review-meta-label">Reviewer</span>
                    <span>{task.reviewed_by_username}</span>
                  </div>
                ) : null}
                {task.reviewed_at ? (
                  <div className="it-updates-review-meta-row">
                    <span className="it-updates-review-meta-label">When</span>
                    <span>{new Date(task.reviewed_at).toLocaleString()}</span>
                  </div>
                ) : null}
                {task.review_comment ? (
                  <div className="it-updates-review-meta-comment">{task.review_comment}</div>
                ) : null}
              </div>
            )}

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

            {(!reqLoading || !isExistingTask) && requirements.length > 0 && (
              <div className="req-table-box" role="table" aria-label="Requirements table">
                <div className="req-table-header" role="row">
                  <div className="req-th req-th-done" role="columnheader">Done</div>
                  <div className="req-th req-th-title" role="columnheader">Requirement</div>
                  <div className="req-th req-th-actions" role="columnheader">Actions</div>
                </div>
                {(reqExpanded ? requirements : requirements.slice(0, 2)).map((req) => (
                  <div key={req.id} className={`req-table-row ${req.status === 'completed' ? 'req-row-completed' : ''}`} role="row">
                    <div className="req-td req-td-done">
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
                    <div className="req-td req-td-title">
                      <span className={`req-row-title ${req.status === 'completed' ? 'req-title-done' : ''}`}>{req.title}</span>
                    </div>
                    <div className="req-td req-td-actions">
                      <RequirementTimer
                        req={req}
                        taskId={task.id}
                        team={MODULE_TEAM}
                        disabled={String(req.id).startsWith('temp-')}
                        onUpdate={(u) => setRequirements((prev) => prev.map((r) => (r.id === req.id ? u : r)))}
                      />
                      <RequirementManualTime
                        req={req}
                        taskId={task.id}
                        team={MODULE_TEAM}
                        disabled={String(req.id).startsWith('temp-')}
                        onUpdate={(u) => setRequirements((prev) => prev.map((r) => (r.id === req.id ? u : r)))}
                      />
                      <button type="button" className="req-action-btn" onClick={() => startEditReq(req)} title="Edit" aria-label="Edit"><MdEdit size={15} /></button>
                      <button type="button" className="req-action-btn req-action-btn-danger" onClick={() => handleDeleteRequirement(req.id)} title="Delete" aria-label="Delete"><MdDelete size={15} /></button>
                    </div>
                  </div>
                ))}
                {totalReqs > 2 && (
                  <button type="button" className="req-show-more" onClick={() => setReqExpanded((v) => !v)}>
                    {reqExpanded ? 'Show less' : `Show all ${totalReqs} requirements ▾`}
                  </button>
                )}
              </div>
            )}

            {showAddReq && (
              <div className="req-form">
                <h4 className="req-form-title">{editingReqId ? 'Edit Requirement' : 'New Requirement'}</h4>
                <label>
                  Requirement *
                  <input
                    value={reqForm.title}
                    onChange={(e) => setReqForm((f) => ({ ...f, title: e.target.value }))}
                    onKeyDown={controlKeys({
                      onEnter: () => {
                        if (!reqForm.title.trim()) return;
                        (editingReqId ? handleUpdateRequirement : handleAddRequirement)();
                      },
                      onEscape: () => { resetReqForm(); setShowAddReq(false); },
                    })}
                    placeholder="Enter subtask requirement..."
                    autoFocus
                  />
                </label>
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
            Status
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>{STATUS_LABELS[status]}</option>
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

          {isExistingTask && form.status === 'review' && (
            <div className="it-updates-rework-block">
              <p className="it-updates-review-actions-hint">
                No changes needed? Mark complete. Otherwise send back for rework (optional note applies to either action).
              </p>
              <label className="it-updates-rework-label">
                Review note (optional)
                <textarea
                  className="it-updates-rework-textarea"
                  rows={2}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  onKeyDown={textareaSubmit}
                  placeholder="e.g. Approved as-is / Please update section 2…"
                />
              </label>
              <div className="it-updates-review-actions">
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={handleCompleteFromReview}
                >
                  Mark complete
                </button>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-secondary rework-btn"
                  onClick={handleManualRework}
                  style={{ border: '1px solid #ef4444', color: '#ef4444' }}
                >
                  <MdReplay size={16} /> Send for rework
                </button>
              </div>
            </div>
          )}

          {isExistingTask && (
            <TaskComments
              taskId={task.id}
              team={MODULE_TEAM}
              currentUser={currentUser}
              canComment={Boolean(currentUser?.id ?? currentUser?.user_id)}
            />
          )}

          <div className="it-updates-modal-actions">
            <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="it-updates-btn it-updates-btn-primary"
              disabled={saveState.saving || saveState.saved}
              style={
                saveState.saved
                  ? {
                      background: 'var(--clr-success)',
                      boxShadow: '0 6px 20px rgba(16, 185, 129, 0.35)',
                    }
                  : undefined
              }
            >
              {saveState.saved ? 'Saved' : saveState.saving ? 'Saving...' : 'Save'}
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
    if (!form.report_date) {
      toastError('Report date is required.');
      return;
    }
    if (!form.achievements.trim()) {
      toastError('Please add a work summary before submitting.');
      return;
    }
    onSave({
      ...form,
      mood: form.status,
      hours_worked: null,
      blockers: null,
      tomorrow_plan: null,
    });
  };

  return (
    <div className="it-updates-modal-backdrop">
      <div className="it-updates-modal" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>EOD Report</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={escapeCloses(onClose)} className="it-updates-modal-form">
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
              onKeyDown={textareaSubmit}
              placeholder="e.g. Completed social media posts, ran ad campaigns..."
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
              <option value="on_track">On Track</option>
              <option value="completed_for_day">Completed for today</option>
              <option value="delayed">Delayed</option>
              <option value="blocked">Blocked</option>
              <option value="stressed">Stressed / Overloaded</option>
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
