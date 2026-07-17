import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  MdLogout,
  MdRefresh,
  MdAdd,
  MdClose,
  MdCheck,
  MdOutlineAssignment,
  MdDashboard,
  MdChecklist,
  MdViewKanban,
  MdFolder,
  MdTableChart,
  MdMenu,
  MdCalendarToday,
  MdEdit,
  MdDelete,
  MdHome,
  MdReplay,
  MdWarningAmber,
} from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import { getDisplayRole } from '../../utils/displayRole';
import { isTaskOverdue } from '../../utils/taskDue';
import { toastSuccess, toastError } from '../../utils/toast';
import { taskInPeriod, EMPTY_PERIOD } from '../../utils/taskPeriod';
import { controlKeys, textareaSubmit, escapeCloses } from '../../utils/formKeys';
import ProjectSearchSelect from '../../components/ProjectSearchSelect';
import PeriodFilter from '../../components/PeriodFilter';
import TaskComments from '../../components/TaskComments';
import ProjectLogo from '../../components/ProjectLogo';
import ProjectDocuments from '../../components/ProjectDocuments';
import ProjectRequirements from '../../components/ProjectRequirements';
import MemberPicker from '../../components/MemberPicker';
import Preloader from '../../components/Preloader';
import LeadModal from '../../components/LeadModal';
import ModalKebabMenu from '../../components/ModalKebabMenu';
import SidebarUser from '../../components/SidebarUser';
import useSidebarCollapsed from '../../utils/useSidebarCollapsed';
import usePersistedState from '../../utils/usePersistedState';
import { confirmDialog } from '../../utils/confirm';
import RequirementTimer from '../../components/RequirementTimer';
import RequirementManualTime from '../../components/RequirementManualTime';
import CommentEditor from '../../components/CommentEditor';
import EodReportCard from '../../components/EodReportCard';
import { sanitizeCommentHtml } from '../../utils/sanitizeHtml';
import { BRANCHES } from '../Admin/AdminUserModals';
import MemberDashboard from './MemberDashboard';
import './ITUpdatesMain.css';

// Adapter so the shared comment thread posts to project-comment endpoints
// (@mention → email, same as tasks/EOD).
const projectCommentApi = {
  getComments: (id) => itUpdatesApi.getProjectComments(id),
  addComment: (id, body) => itUpdatesApi.addProjectComment(id, body),
  updateComment: (id, commentId, body) => itUpdatesApi.updateProjectComment(id, commentId, body),
  deleteComment: (id, commentId, userId) => itUpdatesApi.deleteProjectComment(id, commentId, userId),
  likeComment: (id, commentId, userId) => itUpdatesApi.likeProjectComment(id, commentId, userId),
};

const TABS = [
  { key: 'Dashboard', label: 'Home', icon: MdHome },
  { key: 'My Dashboard', label: 'Dashboard', icon: MdDashboard },
  { key: 'My Tasks', label: 'My Tasks', icon: MdChecklist },
  { key: 'All Tasks', label: 'All Tasks', icon: MdViewKanban },
  { key: 'Projects', label: 'Projects', icon: MdFolder },
  { key: 'Overview', label: 'Overview', icon: MdTableChart },
  { key: 'EOD Updates', label: 'EOD Updates', icon: MdOutlineAssignment },
];
const MODULE_TEAM = 'it';

const OVERVIEW_PAGE_SIZE = 20;
const EOD_PAGE_SIZE = 20;
const EMPTY_ALL_TASKS_FILTERS = { project_id: '', status: '', priority: '', assignee: '', branch: '', period: EMPTY_PERIOD };
const EMPTY_OVERVIEW_FILTERS = { from_date: '', to_date: '', assigned_to: '', project_id: '' };

const STATUS_LABELS = {
  todo: 'To do',
  prospect: 'Prospect',
  in_progress: 'In Progress',
  review: 'Review',
  rework: 'Rework',
  completed: 'Completed',
};

// External Projects (freelancing) relabels the task states as a client/lead flow,
// with an extra "Prospect" stage between Incoming Leads and Converted Clients.
const EXTERNAL_STATUS_LABELS = {
  todo: 'Incoming Leads',
  prospect: 'Prospect',
  in_progress: 'Converted Clients',
  review: 'In Progress',
  rework: 'Dropped Clients',
  completed: 'Delivered projects',
};

// Column order per sector. External inserts 'prospect' after 'todo'.
const DEFAULT_STATUSES = ['todo', 'in_progress', 'review', 'rework', 'completed'];
const EXTERNAL_STATUSES = ['todo', 'prospect', 'in_progress', 'review', 'rework', 'completed'];

const STATUS_COLORS = {
  todo: '#94a3b8',
  prospect: '#06b6d4',
  in_progress: '#6366f1',
  review: '#8b5cf6',
  rework: '#f97316',
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
    { todo: [], in_progress: [], review: [], rework: [], completed: [] }
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
        title={name}
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

/**
 * Reusable Kanban board: status columns (todo → completed) with draggable cards.
 * Shared by the IT Updates sector and the Management → Director tasks panel.
 *   tasks       — flat task array (grouped by status internally)
 *   onDragEnd   — @hello-pangea/dnd drag handler (move card → new status)
 *   onCardClick — open the task (edit/requirements)
 *   projectById — Map of projectId → project (pass an empty Map when N/A)
 */
export function TaskBoard({ tasks = [], onDragEnd, onCardClick, projectById, statusLabels = STATUS_LABELS, statuses = DEFAULT_STATUSES }) {
  const groups = useMemo(() => groupTasksByStatus(tasks), [tasks]);
  const pById = projectById || new Map();

  const renderColumn = (statusKey, items) => (
    <div
      key={statusKey}
      className="it-updates-column"
      style={{ borderTopColor: STATUS_COLORS[statusKey] }}
    >
      <div className="it-updates-column-header">
        <span>{statusLabels[statusKey]}</span>
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
              <Draggable key={`task-${task.id}`} draggableId={`task-${task.id}`} index={idx}>
                {(provided, snapshot) => {
                  const cardProject =
                    task?.projectId != null ? pById.get(String(task.projectId)) : null;
                  const desc = (task.task_description || task.description || '').trim();
                  const descSnippet = desc.length > 50 ? desc.slice(0, 50) + '...' : desc;
                  const overdue = isTaskOverdue(task);
                  return (
                    <div
                      ref={provided.innerRef}
                      {...provided.draggableProps}
                      {...provided.dragHandleProps}
                      className={[
                        'it-updates-task-card',
                        snapshot.isDragging && 'it-updates-task-card-dragging',
                        overdue && 'it-updates-task-card-overdue',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => onCardClick?.(task)}
                    >
                      <div className="it-updates-task-card-toprow">
                        <div
                          className="it-updates-task-card-priority"
                          style={{
                            backgroundColor: (PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium) + '18',
                            color: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium,
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
                      {descSnippet ? (
                        <div className="it-updates-task-card-desc">{descSnippet}</div>
                      ) : null}
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
                      <div className="it-updates-task-card-footer">
                        <ProjectLogo
                          src={cardProject?.logo || task.project_logo}
                          name={cardProject?.name || cardProject?.project_name || task.project_name}
                          size={26}
                          className="it-updates-task-card-logo"
                        />
                        <div className="it-updates-task-card-people">
                          {task.assigned_by_name ? (
                            <span className="it-updates-task-card-person">
                              <Avatar
                                user={{ username: task.assigned_by_name, profile_image: task.assigned_by_profile_image }}
                                size="small"
                              />
                            </span>
                          ) : null}
                          <span className="it-updates-task-card-person">
                            <Avatar
                              user={{ username: task.assignee, profile_image: task.assignee_profile_image }}
                              size="small"
                            />
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
            {!items.length && <div className="it-updates-empty-column">No tasks</div>}
          </div>
        )}
      </Droppable>
    </div>
  );

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="it-updates-kanban-wrap">
        <section
          className="it-updates-columns"
          style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }}
        >
          {statuses.map((statusKey) =>
            renderColumn(statusKey, groups[statusKey] || [])
          )}
        </section>
      </div>
    </DragDropContext>
  );
}

// Keep only the tasks that belong to this sector's projects, so Internal and
// External never show each other's cards. Project-less tasks are Internal,
// except Client CRM leads (is_crm) which live only on the External CRM board.
function scopeTasksToProjects(taskList, projList, scope) {
  const idSet = new Set((projList || []).map((p) => String(p.project_id ?? p.id)));
  return (taskList || []).filter(Boolean).filter((t) => {
    const pv = t.projectId ?? t.project_id;
    if (pv == null || pv === '') return t.is_crm ? scope === 'external' : scope === 'internal';
    return idSet.has(String(pv));
  });
}

const ITUpdatesMain = ({ currentUser, onLogout, scope = 'internal' }) => {
  const isExternalScope = scope === 'external';
  // Persisted per scope so a reload restores the same section. A stored tab that
  // no longer belongs to this scope falls back to Dashboard.
  const [activeTab, setActiveTab] = usePersistedState(
    `itUpdates.activeTab.${scope}`,
    'Dashboard',
    (v) => {
      const keys = isExternalScope
        ? ['Dashboard', 'My Dashboard', 'Tasks', 'My Tasks', 'All Tasks', 'Projects', 'Overview', 'EOD Updates']
        : ['Dashboard', 'My Dashboard', 'My Tasks', 'All Tasks', 'Projects', 'Overview', 'EOD Updates'];
      return keys.includes(v) ? v : 'Dashboard';
    }
  );
  const [loading, setLoading] = useState(false);
  // Tracks the first data fetch so the full preloader shows only on initial load.
  const [booted, setBooted] = useState(false);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { collapsed } = useSidebarCollapsed();

  const [dashboardData, setDashboardData] = useState(null);
  const [teamOverview, setTeamOverview] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);

  const [projectModal, setProjectModal] = useState({ open: false, project: null });
  const [taskModal, setTaskModal] = useState({ open: false, task: null });
  const [eodModal, setEodModal] = useState(false);

  const [allTasksFiltersApplied, setAllTasksFiltersApplied] = useState(EMPTY_ALL_TASKS_FILTERS);
  // Backlogs toggle on the task board: when on, the board shows only overdue cards.
  const [showBacklogsOnly, setShowBacklogsOnly] = useState(false);
  const [overviewFiltersApplied, setOverviewFiltersApplied] = useState(EMPTY_OVERVIEW_FILTERS);
  const [eodReports, setEodReports] = useState([]);
  // EOD tab: optional date filter + pagination (20 per page).
  const [eodDateFilter, setEodDateFilter] = useState('');
  const [eodPage, setEodPage] = useState(0);
  const filteredEodReports = useMemo(
    () =>
      eodDateFilter
        ? eodReports.filter((r) => String(r.report_date ?? '').slice(0, 10) === eodDateFilter)
        : eodReports,
    [eodReports, eodDateFilter]
  );
  const eodPageCount = Math.max(1, Math.ceil(filteredEodReports.length / EOD_PAGE_SIZE));
  useEffect(() => {
    setEodPage(0);
  }, [eodDateFilter, eodReports]);
  const pagedEodReports = useMemo(() => {
    const start = eodPage * EOD_PAGE_SIZE;
    return filteredEodReports.slice(start, start + EOD_PAGE_SIZE);
  }, [filteredEodReports, eodPage]);

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

  const visibleTabs = useMemo(() => {
    if (!isExternalScope) return TABS;
    // External: the projects dashboard is the default "Dashboard" tab; the personal
    // member dashboard becomes "My Dashboard". Tasks is a single merged tab.
    return [
      { key: 'Dashboard', label: 'Dashboard', icon: MdDashboard },
      { key: 'My Dashboard', label: 'My Dashboard', icon: MdHome },
      { key: 'Tasks', label: 'Client CRM', icon: MdViewKanban },
      { key: 'My Tasks', label: 'My Tasks', icon: MdChecklist },
      { key: 'All Tasks', label: 'All Tasks', icon: MdViewKanban },
      { key: 'Projects', label: 'Projects', icon: MdFolder },
      { key: 'Overview', label: 'Overview', icon: MdTableChart },
      { key: 'EOD Updates', label: 'EOD Updates', icon: MdOutlineAssignment },
    ];
  }, [isExternalScope]);

  // Task board column labels + order: freelancing flow (with Prospect) for External.
  // Only the Client CRM tab uses the freelancing headings (with Prospect). My Tasks /
  // All Tasks use the same standard columns as Internal, in both sectors.
  const isClientCrm = isExternalScope && activeTab === 'Tasks';
  const boardStatusLabels = isClientCrm ? EXTERNAL_STATUS_LABELS : STATUS_LABELS;
  const boardStatuses = isClientCrm ? EXTERNAL_STATUSES : DEFAULT_STATUSES;

  // The External dashboard pipeline chart always reflects the CRM (freelancing) stages.
  const pipelineStatuses = isExternalScope ? EXTERNAL_STATUSES : DEFAULT_STATUSES;
  const pipelineLabels = isExternalScope ? EXTERNAL_STATUS_LABELS : STATUS_LABELS;

  // Count of task cards in each pipeline stage (for the External dashboard chart).
  const stageCounts = useMemo(() => {
    const counts = {};
    pipelineStatuses.forEach((s) => {
      counts[s] = 0;
    });
    (tasks || []).forEach((t) => {
      // The External pipeline chart reflects only Client CRM cards.
      if (isExternalScope && !t.is_crm) return;
      const s = t.status || 'in_progress';
      counts[s] = (counts[s] || 0) + 1;
    });
    return counts;
  }, [tasks, pipelineStatuses, isExternalScope]);

  const isAdmin = useMemo(
    () => Array.isArray(user?.permissions) && user.permissions.includes('admin.access'),
    [user]
  );

  const developers = useMemo(
    () => teamOverview.filter((u) => Boolean(u.is_it_developer)),
    [teamOverview]
  );

  // Adapter so the shared TaskComments thread posts to EOD-report comment endpoints.
  const eodCommentApi = useMemo(
    () => ({
      getComments: (id) => itUpdatesApi.getEodReportComments(id),
      addComment: (id, body) => itUpdatesApi.addEodReportComment(id, body),
      updateComment: (id, commentId, body) => itUpdatesApi.updateEodReportComment(id, commentId, body),
      deleteComment: (id, commentId, userId) => itUpdatesApi.deleteEodReportComment(id, commentId, userId),
      likeComment: (id, commentId, userId) => itUpdatesApi.likeEodReportComment(id, commentId, userId),
    }),
    []
  );
  const managers = useMemo(
    () => teamOverview.filter((u) => u.is_it_manager),
    [teamOverview]
  );

  const myTasks = useMemo(() => {
    if (!user) return [];
    const key = user.name || user.username || user.email;
    const id = user.id ?? user.user_id;
    // Exclude Client CRM cards — those live only on the CRM board.
    return tasks.filter(
      (t) =>
        !t.is_crm &&
        (t.assignee === key || (id != null && String(t.assigned_to) === String(id)))
    );
  }, [tasks, user]);

  const loadAllData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsRes, teamRes, projRes, tasksRes] = await Promise.all([
        itUpdatesApi.getDashboardStats(),
        itUpdatesApi.getTeamOverview({ team: 'it' }),
        itUpdatesApi.getProjects(undefined, scope),
        itUpdatesApi.getTasks({ team: 'it' }),
      ]);
      setDashboardData(statsRes.data);
      setTeamOverview(Array.isArray(teamRes.data) ? teamRes.data.filter(Boolean) : []);
      const projList = Array.isArray(projRes.data) ? projRes.data.filter(Boolean) : [];
      setProjects(projList);
      // Scope tasks to this sector's projects so Internal/External don't mix cards.
      setTasks(scopeTasksToProjects(tasksRes.data, projList, scope));
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Something went wrong while loading IT updates.'
      );
    } finally {
      setLoading(false);
      setBooted(true);
    }
  }, [scope]);

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
    setLoading(true);
    try {
      const res = await itUpdatesApi.getTasks({ ...filters, team: 'it' });
      setTasks(scopeTasksToProjects(res.data, projects, scope));
    } catch {
      setError('Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, [projects, scope]);

  // All Tasks filters client-side; ensure we hold the full task list (the Overview
  // tab can narrow `tasks` server-side, so reload when entering All Tasks).
  useEffect(() => {
    if (activeTab === 'All Tasks' || activeTab === 'Tasks') loadAllData();
  }, [activeTab, loadAllData]);

  const allTasksFiltered = useMemo(() => {
    let result = tasks;
    const f = allTasksFiltersApplied;
    if (f.project_id) result = result.filter((t) => String(t.projectId) === String(f.project_id));
    if (f.status) result = result.filter((t) => t.status === f.status);
    if (f.priority) result = result.filter((t) => t.priority === f.priority);
    if (f.assignee) result = result.filter((t) => String(t.assigned_to) === String(f.assignee));
    if (f.branch) result = result.filter((t) => t.assignee_branch === f.branch);
    if (f.period) result = result.filter((t) => taskInPeriod(t, f.period));
    if (showBacklogsOnly) result = result.filter((t) => isTaskOverdue(t));
    return result;
  }, [tasks, allTasksFiltersApplied, showBacklogsOnly]);

  const overviewTasks = useMemo(() => tasks, [tasks]);

  // Overview pagination: show 20 rows at a time, page through the rest.
  const [overviewPage, setOverviewPage] = useState(0);
  const overviewPageCount = Math.max(1, Math.ceil(overviewTasks.length / OVERVIEW_PAGE_SIZE));
  // Reset to the first page whenever the underlying list changes (new data / filters).
  useEffect(() => {
    setOverviewPage(0);
  }, [overviewTasks]);
  const pagedOverviewTasks = useMemo(() => {
    const start = overviewPage * OVERVIEW_PAGE_SIZE;
    return overviewTasks.slice(start, start + OVERVIEW_PAGE_SIZE);
  }, [overviewTasks, overviewPage]);

  // Backlogs: overdue, not-completed tasks — most overdue first.
  const overdueTasks = useMemo(
    () =>
      (tasks || [])
        .filter((t) => isTaskOverdue(t))
        .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || ''))),
    [tasks]
  );

  // Inline editor for Overview table (enabled only when you click the pencil icon)
  const [inlineEditingTaskId, setInlineEditingTaskId] = useState(null);
  const [inlineDraft, setInlineDraft] = useState(null);
  const [inlineSaving, setInlineSaving] = useState(false);
  const [inlineReqLoading, setInlineReqLoading] = useState(false);
  const [inlineRequirements, setInlineRequirements] = useState([]);

  const inlineEditing = (taskId) => String(inlineEditingTaskId ?? '') === String(taskId ?? '');

  const buildInlineDraftFromTask = (t) => ({
    projectId: t?.projectId ?? '',
    assigned_to: t?.assigned_to ?? t?.assignee ?? '',
    assigned_by: t?.assigned_by ?? '',
    status: t?.status ?? 'in_progress',
    priority: t?.priority ?? 'medium',
    dueDate: t?.dueDate ? String(t.dueDate).slice(0, 10) : '',
  });

  const startInlineEdit = async (task) => {
    if (!task?.id) return;
    if (inlineSaving) return;

    // Toggle off if clicking the same pencil again
    if (inlineEditing(task.id)) {
      setInlineEditingTaskId(null);
      setInlineDraft(null);
      setInlineReqLoading(false);
      setInlineRequirements([]);
      return;
    }

    setInlineEditingTaskId(task.id);
    setInlineDraft(buildInlineDraftFromTask(task));
    setInlineSaving(false);
    setInlineReqLoading(true);

    try {
      const res = await itUpdatesApi.getRequirements(task.id, { team: MODULE_TEAM });
      const list = Array.isArray(res?.data) ? res.data : [];
      setInlineRequirements(
        list.filter(Boolean).map((r) => ({
          id: r.id ?? r.requirement_id ?? r.req_id ?? r.requirementId,
          title: r.title ?? '',
          description: r.description ?? null,
          status: r.status ?? 'pending',
          priority: r.priority ?? 'medium',
          due_date: r.due_date ?? r.dueDate ?? null,
        }))
      );
    } catch {
      setInlineRequirements([]);
    } finally {
      setInlineReqLoading(false);
    }
  };

  const cancelInlineEdit = () => {
    if (inlineSaving) return;
    setInlineEditingTaskId(null);
    setInlineDraft(null);
    setInlineReqLoading(false);
    setInlineRequirements([]);
  };

  const saveInlineEdit = async () => {
    if (!inlineEditingTaskId || !inlineDraft) return;
    if (inlineSaving) return;

    setInlineSaving(true);
    setError('');
    try {
      const taskId = inlineEditingTaskId;
      const draft = inlineDraft;

      const reqs = Array.isArray(inlineRequirements) ? inlineRequirements : [];
      const allDone = reqs.length > 0 && reqs.every((r) => String(r.status) === 'completed');
      const hasPending = reqs.some((r) => String(r.status) !== 'completed');

      let nextStatus = draft.status ?? 'in_progress';
      if (allDone && nextStatus === 'in_progress') nextStatus = 'review';
      else if (hasPending && (nextStatus === 'rework' || nextStatus === 'completed')) {
        nextStatus = 'in_progress';
      }

      const patch = {
        team: MODULE_TEAM,
        projectId: draft.projectId === '' ? null : draft.projectId,
        assigned_to: draft.assigned_to === '' ? null : draft.assigned_to,
        assigned_by: draft.assigned_by === '' ? null : draft.assigned_by,
        status: nextStatus,
        priority: draft.priority ?? 'medium',
        dueDate: draft.dueDate === '' ? null : draft.dueDate,
      };

      await itUpdatesApi.updateTask(taskId, patch);

      await loadAllData();
      cancelInlineEdit();
      toastSuccess('Task updated');
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to save inline edit';
      setError(msg);
      toastError(msg);
      await loadAllData();
      cancelInlineEdit();
    } finally {
      setInlineSaving(false);
    }
  };
  useEffect(() => {
    if (activeTab === 'Overview' && (overviewFiltersApplied.from_date || overviewFiltersApplied.to_date || overviewFiltersApplied.assigned_to || overviewFiltersApplied.project_id)) {
      fetchTasksWithFilters({
        from_date: overviewFiltersApplied.from_date || undefined,
        to_date: overviewFiltersApplied.to_date || undefined,
        assigned_to: overviewFiltersApplied.assigned_to || undefined,
        project_id: overviewFiltersApplied.project_id || undefined,
      });
    } else if (activeTab === 'Overview') {
      loadAllData();
    }
  }, [activeTab, overviewFiltersApplied.from_date, overviewFiltersApplied.to_date, overviewFiltersApplied.assigned_to, overviewFiltersApplied.project_id]);

  useEffect(() => {
    if (activeTab === 'EOD Updates') {
      // Team-wide feed: show every teammate's report without waiting for the
      // current user to submit their own (matches the post-submit refetch).
      itUpdatesApi.getEodReports()
        .then((res) => setEodReports(Array.isArray(res.data) ? res.data : []))
        .catch(() => setEodReports([]));
    }
  }, [activeTab]);

  const stats = useMemo(() => {
    // External dashboard is derived from that sector's own projects.
    if (isExternalScope) {
      const list = (projects || []).filter(Boolean);
      return {
        active_projects: list.filter((p) => (p.status || 'active') === 'active').length,
        active_tasks: list.reduce((s, p) => s + (p.total_tasks || 0), 0),
        completed_tasks: list.reduce((s, p) => s + (p.completed_tasks || 0), 0),
      };
    }
    const d = dashboardData;
    if (!d) return { active_projects: 0, active_tasks: 0, completed_tasks: 0 };
    if (d.stats) return d.stats;
    return {
      active_projects: d.activeProjects ?? 0,
      active_tasks: d.totalTasks ?? 0,
      completed_tasks: d.completedTasksToday ?? 0,
    };
  }, [dashboardData, projects, isExternalScope]);

  const dashboardProjects = useMemo(() => {
    const fromState = () =>
      (projects || []).filter(Boolean).map((p) => ({
        project_id: p?.id ?? p?.project_id,
        project_name: p?.name ?? p?.project_name,
        priority: p?.priority ?? 'medium',
        total_tasks: p?.total_tasks ?? 0,
        completed_tasks: p?.completed_tasks ?? 0,
        completion_percentage: p?.completion_percentage ?? p?.progress ?? 0,
      }));
    // External: always use this sector's (external) projects, not the global list.
    if (isExternalScope) return fromState();
    const d = dashboardData;
    if (d?.projects?.length) return d.projects;
    return fromState();
  }, [dashboardData, projects, isExternalScope]);

  const projectLinks = useMemo(
    () => (projects || []).filter((p) => Boolean((p.project_url || '').trim())),
    [projects]
  );

  const projectNameById = useMemo(() => {
    const map = new Map();
    (projects || []).forEach((p) => {
      const id = p?.id ?? p?.project_id;
      if (id == null) return;
      const name = p?.name ?? p?.project_name;
      if (name != null) map.set(String(id), name);
    });
    return map;
  }, [projects]);

  const projectById = useMemo(() => {
    const map = new Map();
    (projects || []).forEach((p) => {
      const id = p?.id ?? p?.project_id;
      if (id != null) map.set(String(id), p);
    });
    return map;
  }, [projects]);


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
        toastSuccess(`Task moved to ${boardStatusLabels[newStatus] || newStatus}`);
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

  const openProjectModal = (project = null) => setProjectModal({ open: true, project });
  const openTaskModal = (task = null) => setTaskModal({ open: true, task });
  const [leadModal, setLeadModal] = useState({ open: false, lead: null });
  const openLeadModal = (lead = null) => setLeadModal({ open: true, lead });
  const closeLeadModal = () => setLeadModal({ open: false, lead: null });

  // Create/update a Client CRM lead (stored as an is_crm task with lead_details).
  const handleSaveLead = async (form, { isEdit, silent = false } = {}) => {
    try {
      const body = {
        title: form.business_name.trim(),
        task_description: form.description,
        status: form.status || 'todo',
        is_crm: true,
        lead_details: {
          client_name: form.client_name,
          mobile: form.mobile,
          email: form.email,
          website: form.website,
          location: form.location,
          service: form.service,
          additional_requirement: form.additional_requirement,
          lead_source: form.lead_source,
          industry: form.industry,
          client_type: form.client_type,
        },
        team: MODULE_TEAM,
      };
      let newLeadId = null;
      if (isEdit && leadModal.lead?.id) {
        await itUpdatesApi.updateTask(leadModal.lead.id, body);
      } else {
        const res = await itUpdatesApi.createTask(body);
        newLeadId = res.data?.id || res.data?.task_id || null;
      }
      const tasksRes = await itUpdatesApi.getTasks({ team: MODULE_TEAM });
      setTasks(scopeTasksToProjects(tasksRes?.data, projects, scope));
      if (!silent) toastSuccess(isEdit ? 'Lead updated' : 'Lead added');
      // On create, return the new id so the modal can post its buffered comments.
      return isEdit ? true : newLeadId || true;
    } catch (e) {
      if (!silent) toastError(e?.response?.data?.message || 'Failed to save lead');
      return false;
    }
  };
  const closeProjectModal = () => setProjectModal({ open: false, project: null });
  const closeTaskModal = () => setTaskModal({ open: false, task: null });


  // Delete is available to admins and the task's creator/assigner.
  const myId = user?.id ?? user?.user_id ?? null;
  const canDeleteTask = (task) =>
    isAdmin ||
    (myId != null &&
      (String(task?.assigned_by) === String(myId) || String(task?.created_by) === String(myId)));

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

  const handleSaveProject = async (payload, opts = {}) => {
    try {
      const normalizedProjectCode =
        payload?.project_code != null && String(payload.project_code).trim() !== ''
          ? String(payload.project_code).trim()
          : null;
      const body = {
        name: payload.project_name ?? payload.name,
        project_code: normalizedProjectCode,
        project_url: payload.project_url,
        logo: payload.logo ?? null,
        description: payload.description,
        status: payload.status,
        priority: payload.priority,
        start_date: payload.start_date,
        end_date: payload.end_date,
        owner_user_id: payload.owner_user_id || null,
        owner_name: payload.owner_name || null,
        teammates: payload.teammates ?? [],
        client_name: payload.client_name ?? null,
        project_type: payload.project_type === 'external' ? 'external' : 'internal',
      };
      const isEdit = Boolean(projectModal.project?.id);
      if (isEdit) {
        await itUpdatesApi.updateProject(projectModal.project.id, body);
      } else {
        await itUpdatesApi.createProject(body);
      }
      const [statsRes, projRes] = await Promise.all([
        itUpdatesApi.getDashboardStats(),
        itUpdatesApi.getProjects(undefined, scope),
      ]);
      setDashboardData(statsRes?.data ?? null);
      setProjects(Array.isArray(projRes?.data) ? projRes.data.filter(Boolean) : []);
      if (!opts.silent) toastSuccess(isEdit ? 'Project updated' : 'Project created');
      return true;
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to save project';
      setError(msg);
      toastError(msg);
      return false;
    }
  };

  // Project delete: available to admins and the project owner.
  const canDeleteProject = (project) =>
    isAdmin || (myId != null && String(project?.owner_user_id) === String(myId));

  const handleDeleteProject = async (project) => {
    if (!project?.id) return false;
    const label = project.name || project.project_name || 'this project';
    if (
      !(await confirmDialog({
        title: 'Delete project?',
        message: `"${label}" will be deleted and its linked tasks unlinked. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return false;
    try {
      await itUpdatesApi.deleteProject(project.id);
      const [statsRes, projRes] = await Promise.all([
        itUpdatesApi.getDashboardStats(),
        itUpdatesApi.getProjects(undefined, scope),
      ]);
      setDashboardData(statsRes?.data ?? null);
      setProjects(Array.isArray(projRes?.data) ? projRes.data.filter(Boolean) : []);
      toastSuccess('Project deleted');
      return true;
    } catch (e) {
      const msg = e?.response?.data?.message || 'Failed to delete project';
      setError(msg);
      toastError(msg);
      return false;
    }
  };

  const handleSaveTask = async (payload, opts = {}) => {
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
      const isEdit = Boolean(taskModal.task?.id);
      if (isEdit) {
        await itUpdatesApi.updateTask(taskModal.task.id, { ...body, team: MODULE_TEAM });
      } else {
        // Cards created on the Client CRM board are flagged so they stay out of the
        // ordinary task boards (and vice-versa) even if a project changes sector.
        const res = await itUpdatesApi.createTask({ ...body, is_crm: isClientCrm, team: MODULE_TEAM });
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
                team: MODULE_TEAM,
              })
            )
          );
        }
      }
      const [tasksRes, statsRes] = await Promise.all([
        itUpdatesApi.getTasks({ team: MODULE_TEAM }),
        itUpdatesApi.getDashboardStats(),
      ]);
      setTasks(scopeTasksToProjects(tasksRes?.data, projects, scope));
      setDashboardData(statsRes?.data ?? null);
      if (!opts.silent) toastSuccess(isEdit ? 'Task updated' : 'Task created');
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
        user_id: user?.id ?? user?.user_id,
      });
      setEodModal(false);
      const eodRes = await itUpdatesApi.getEodReports();
      setEodReports(Array.isArray(eodRes?.data) ? eodRes.data : []);
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

  // Board rendering moved to the shared <TaskBoard> component (module scope above).

  const tabConfig = visibleTabs.find((t) => t.key === activeTab);

  return (
    <div className={`it-updates-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      {/* ─── Sidebar ─── */}
      {sidebarOpen && (
        <div
          className="it-updates-sidebar-overlay visible"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`it-updates-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <nav className="it-updates-sidebar-nav">
          <div className="it-updates-sidebar-nav-label"></div>
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
              <h1 className="it-updates-topbar-title">{tabConfig?.label || activeTab}</h1>
              <p className="it-updates-topbar-subtitle">
                {activeTab === 'Dashboard' && 'Overview of your projects and team activity'}
                {activeTab === 'My Dashboard' && (isAdmin ? "Members' working hours, projects and leave" : 'Your working hours, projects and leave')}
                {activeTab === 'My Tasks' && 'Tasks assigned to you'}
                {activeTab === 'All Tasks' && 'All tasks across projects'}
                {activeTab === 'Tasks' && 'Client pipeline across external projects'}
                {activeTab === 'Projects' && 'Manage your projects'}
                {activeTab === 'Overview' && 'Detailed task overview and filters'}
                {activeTab === 'EOD Updates' && 'End-of-day reports from the team'}
              </p>
            </div>
          </div>
          <div className="it-updates-topbar-right">
            {(activeTab === 'My Tasks' || activeTab === 'All Tasks' || activeTab === 'Tasks') && (
              <button
                type="button"
                className="it-updates-btn it-updates-btn-primary"
                onClick={() => (activeTab === 'Tasks' ? openLeadModal(null) : openTaskModal(null))}
              >
                <MdAdd size={18} />
                {activeTab === 'Tasks' ? 'Add lead' : 'Add task'}
              </button>
            )}
            {activeTab === 'Projects' && (
              <button
                type="button"
                className="it-updates-btn it-updates-btn-primary"
                onClick={() => openProjectModal(null)}
              >
                <MdAdd size={18} />
                Add project
              </button>
            )}
            {activeTab !== 'Tasks' && (
              <button
                type="button"
                className="it-updates-btn it-updates-btn-secondary"
                onClick={() => setEodModal(true)}
                title="Submit EOD Report"
              >
                <MdOutlineAssignment size={16} />
                <span>EOD</span>
              </button>
            )}
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
          {!booted && <Preloader label="Loading your workspace…" />}
          {booted && loading && <Preloader label="Loading…" />}
          {activeTab === 'My Dashboard' && (
            <MemberDashboard
              currentUser={user}
              members={teamOverview}
              isAdmin={isAdmin}
              projectType={scope}
            />
          )}
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
                  <div className="it-updates-stat-label">
                    {isExternalScope ? 'Tasks Completed' : 'Completed Tasks Today'}
                  </div>
                  <div className="it-updates-stat-value">
                    {isExternalScope
                      ? stats.completed_tasks ?? 0
                      : dashboardData?.completedTasksToday ?? stats.completed_tasks ?? 0}
                  </div>
                </div>
              </section>

              {isExternalScope && (
                <section className="it-updates-panel it-updates-panel-full">
                  <div className="it-updates-panel-header">
                    <h2>Pipeline by stage</h2>
                  </div>
                  {(() => {
                    const maxCount = Math.max(1, ...pipelineStatuses.map((s) => stageCounts[s] || 0));
                    return (
                      <div className="ext-pipeline-chart">
                        {pipelineStatuses.map((s) => {
                          const count = stageCounts[s] || 0;
                          const pct = Math.round((count / maxCount) * 100);
                          return (
                            <div key={s} className="ext-pipeline-col">
                              <div className="ext-pipeline-count">{count}</div>
                              <div className="ext-pipeline-track">
                                <div
                                  className="ext-pipeline-bar"
                                  style={{ height: `${pct}%`, backgroundColor: STATUS_COLORS[s] }}
                                />
                              </div>
                              <div className="ext-pipeline-label" title={pipelineLabels[s]}>
                                {pipelineLabels[s]}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </section>
              )}

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
                            <ProjectLogo src={project.logo} name={project.project_name ?? project.name} size={20} />
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

                <div className="it-updates-panel it-updates-panel-full">
                  <div className="it-updates-panel-header">
                    <h2>Project Links</h2>
                  </div>
                  <div className="it-updates-project-links-list">
                    {!isExternalScope && (
                      <div className="it-updates-project-link-row">
                        <span className="it-updates-project-link-name">Inout</span>
                        <a
                          className="it-updates-project-link-url"
                          href="https://inout.urbancode.tech/attendance"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          https://inout.urbancode.tech/attendance
                        </a>
                      </div>
                    )}
                    {projectLinks.map((project) => (
                      <div key={`link-${project.id ?? project.project_id}`} className="it-updates-project-link-row">
                        <span className="it-updates-project-link-name">
                          {project.name ?? project.project_name}
                        </span>
                        <a
                          className="it-updates-project-link-url"
                          href={project.project_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {project.project_url}
                        </a>
                      </div>
                    ))}
                    {!projectLinks.length && isExternalScope && (
                      <div className="it-updates-empty">No project URLs added yet.</div>
                    )}
                  </div>
                </div>

                {/* Team Activity moved to Admin dashboard */}
              </section>
            </>
          )}

          {activeTab === 'My Tasks' && (
            <TaskBoard
              tasks={myTasks}
              onDragEnd={handleDragEnd}
              onCardClick={openTaskModal}
              projectById={projectById}
              statusLabels={boardStatusLabels}
              statuses={boardStatuses}
            />
          )}

          {(activeTab === 'All Tasks' || activeTab === 'Tasks') && (
            <>
              <div className="it-updates-filters">
                <ProjectSearchSelect
                  projects={projects}
                  value={allTasksFiltersApplied.project_id}
                  onChange={(id) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, project_id: id }))
                  }
                />
                <select
                  value={allTasksFiltersApplied.status}
                  onChange={(e) =>
                    setAllTasksFiltersApplied((f) => ({ ...f, status: e.target.value }))
                  }
                >
                  <option value="">Statuses</option>
                  {boardStatuses.map((s) => (
                    <option key={s} value={s}>{boardStatusLabels[s]}</option>
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
                  {(developers.length ? developers : teamOverview).map((u) => (
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
                <button
                  type="button"
                  className={`it-updates-backlog-toggle${showBacklogsOnly ? ' active' : ''}`}
                  onClick={() => setShowBacklogsOnly((v) => !v)}
                  aria-pressed={showBacklogsOnly}
                  title={showBacklogsOnly ? 'Show all cards' : 'Show only overdue cards'}
                >
                  <MdWarningAmber size={16} />
                  Backlogs
                  {overdueTasks.length > 0 && (
                    <span className="it-updates-backlog-toggle-count">{overdueTasks.length}</span>
                  )}
                </button>
              </div>
              <TaskBoard
                tasks={allTasksFiltered.filter((t) =>
                  activeTab === 'Tasks' ? t.is_crm === true : t.is_crm !== true
                )}
                onDragEnd={handleDragEnd}
                onCardClick={activeTab === 'Tasks' ? openLeadModal : openTaskModal}
                projectById={projectById}
                statusLabels={boardStatusLabels}
                statuses={boardStatuses}
              />
            </>
          )}

          {activeTab === 'Projects' && (
            <section className="it-updates-panel">
              <div className="it-updates-projects-grid-cards">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="it-updates-project-card clickable"
                    onClick={() => openProjectModal(project)}
                  >
                    <div className="it-updates-project-top">
                      <span className="it-updates-project-name">
                        <ProjectLogo src={project.logo} name={project.name ?? project.project_name} size={20} />
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
                    <div className="it-updates-project-meta">
                      <span>Owner: {project.owner_name ?? project.owner ?? 'Not set'}</span>
                    </div>
                    {(Array.isArray(project.teammates) && project.teammates.length > 0) || project.teammates_text ? (
                      <div className="it-updates-project-meta">
                        <span>
                          Team: {Array.isArray(project.teammates) ? project.teammates.join(', ') : project.teammates_text}
                        </span>
                      </div>
                    ) : null}
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
                  Developer
                  <select
                    value={overviewFiltersApplied.assigned_to}
                    onChange={(e) =>
                      setOverviewFiltersApplied((f) => ({ ...f, assigned_to: e.target.value }))
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
                  <ProjectSearchSelect
                    projects={projects}
                    value={overviewFiltersApplied.project_id}
                    onChange={(id) =>
                      setOverviewFiltersApplied((f) => ({ ...f, project_id: id }))
                    }
                    placeholder="All"
                  />
                </label>
              </div>
              <div className="it-updates-table-wrap">
                <table className="it-updates-table-overview">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Project</th>
                      <th>Assigned To</th>
                      <th>Assigned By</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th className="it-updates-th-actions">Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedOverviewTasks.map((task) => (
                      <tr
                        key={task.id}
                        onClick={() => {
                          if (inlineEditing(task.id)) return;
                          openTaskModal(task);
                        }}
                        style={{ cursor: inlineEditing(task.id) ? 'default' : 'pointer' }}
                      >
                        <td>
                          {task.task_date
                            ? new Date(task.task_date).toLocaleDateString()
                            : '—'}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <select
                              className="it-updates-table-edit"
                              value={String(inlineDraft?.projectId ?? '')}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), projectId: e.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {projects.map((p) => (
                                <option key={p.id} value={String(p.id)}>
                                  {p.name ?? p.project_name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            task?.projectId != null
                              ? projectNameById.get(String(task.projectId)) || task.projectId || '—'
                              : '—'
                          )}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <select
                              className="it-updates-table-edit"
                              value={String(inlineDraft?.assigned_to ?? '')}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), assigned_to: e.target.value }))}
                            >
                              <option value="">Unassigned</option>
                              {(developers.length ? developers : teamOverview).map((u) => (
                                <option key={u.user_id ?? u.assignee} value={String(u.user_id ?? u.assignee ?? '')}>
                                  {u.username ?? u.assignee}
                                </option>
                              ))}
                            </select>
                          ) : (
                            task.assignee ?? '—'
                          )}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <select
                              className="it-updates-table-edit"
                              value={String(inlineDraft?.assigned_by ?? '')}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), assigned_by: e.target.value }))}
                            >
                              <option value="">—</option>
                              {(managers || []).map((u) => (
                                <option key={u.user_id ?? u.id ?? u.assignee} value={String(u.user_id ?? u.id ?? u.assignee ?? '')}>
                                  {u.username ?? u.assignee}
                                </option>
                              ))}
                            </select>
                          ) : (
                            task.assigned_by_name ?? '—'
                          )}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <select
                              className="it-updates-table-edit"
                              value={inlineDraft?.status ?? 'in_progress'}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), status: e.target.value }))}
                            >
                              <option value="todo">{STATUS_LABELS.todo}</option>
                              <option value="in_progress">{STATUS_LABELS.in_progress}</option>
                              <option value="review">{STATUS_LABELS.review}</option>
                              <option value="rework">{STATUS_LABELS.rework}</option>
                              <option value="completed">{STATUS_LABELS.completed}</option>
                            </select>
                          ) : (
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
                          )}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <select
                              className="it-updates-table-edit"
                              value={inlineDraft?.priority ?? 'medium'}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), priority: e.target.value }))}
                            >
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                              <option value="critical">Critical</option>
                            </select>
                          ) : (
                            (task.priority || 'medium').toUpperCase()
                          )}
                        </td>
                        <td>
                          {inlineEditing(task.id) ? (
                            <input
                              className="it-updates-table-edit"
                              type="date"
                              value={inlineDraft?.dueDate ?? ''}
                              disabled={inlineSaving || inlineReqLoading}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setInlineDraft((prev) => ({ ...(prev || {}), dueDate: e.target.value }))}
                            />
                          ) : (
                            task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'
                          )}
                        </td>
                        <td className="it-updates-td-actions">
                          {!inlineEditing(task.id) ? (
                            <button
                              type="button"
                              className="it-updates-icon-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                startInlineEdit(task);
                              }}
                              disabled={inlineSaving || inlineReqLoading}
                              title="Inline edit"
                            >
                              <MdEdit size={18} />
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                              <button
                                type="button"
                                className="it-updates-icon-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveInlineEdit();
                                }}
                                disabled={inlineSaving || inlineReqLoading}
                                title="Save"
                              >
                                <MdCheck size={18} />
                              </button>
                              <button
                                type="button"
                                className="it-updates-icon-btn it-updates-icon-btn-danger"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelInlineEdit();
                                }}
                                disabled={inlineSaving || inlineReqLoading}
                                title="Cancel"
                              >
                                <MdClose size={18} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!overviewTasks.length && (
                <div className="it-updates-empty">No tasks match the filters.</div>
              )}
              {overviewTasks.length > OVERVIEW_PAGE_SIZE && (
                <div className="it-updates-pagination">
                  <span className="it-updates-pagination-info">
                    {overviewPage * OVERVIEW_PAGE_SIZE + 1}–
                    {Math.min((overviewPage + 1) * OVERVIEW_PAGE_SIZE, overviewTasks.length)} of{' '}
                    {overviewTasks.length}
                  </span>
                  <div className="it-updates-pagination-actions">
                    <button
                      type="button"
                      className="it-updates-btn it-updates-btn-secondary"
                      onClick={() => setOverviewPage((p) => Math.max(0, p - 1))}
                      disabled={overviewPage === 0}
                    >
                      Previous
                    </button>
                    <span className="it-updates-pagination-page">
                      Page {overviewPage + 1} of {overviewPageCount}
                    </span>
                    <button
                      type="button"
                      className="it-updates-btn it-updates-btn-secondary"
                      onClick={() => setOverviewPage((p) => Math.min(overviewPageCount - 1, p + 1))}
                      disabled={overviewPage >= overviewPageCount - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

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
                <div className="it-updates-eod-filter">
                  <input
                    type="date"
                    value={eodDateFilter}
                    onChange={(e) => setEodDateFilter(e.target.value)}
                    title="Filter reports by date"
                  />
                  {eodDateFilter && (
                    <button
                      type="button"
                      className="it-updates-btn it-updates-btn-secondary"
                      onClick={() => setEodDateFilter('')}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
              <p className="it-updates-eod-intro">
                View end-of-day reports submitted by the team. Use the <strong>EOD</strong> button in the header to submit your own report.
              </p>
              <div className="it-updates-eod-list">
                {filteredEodReports.length === 0 ? (
                  <div className="it-updates-empty">
                    {eodDateFilter
                      ? 'No EOD reports for the selected date.'
                      : 'No EOD reports yet. Click "Submit EOD" or the EOD button in the header to add one.'}
                  </div>
                ) : (
                  pagedEodReports.map((report) => (
                    <EodReportCard
                      key={report.report_id ?? report.id}
                      report={report}
                      currentUser={user}
                      isAdmin={(user?.permissions || []).includes('admin.access')}
                      members={teamOverview.map((u) => ({ id: u.user_id, name: u.username, image: u.profile_image }))}
                      commentApi={eodCommentApi}
                      onUpdate={(updated) =>
                        setEodReports((prev) => prev.map((r) => (r.report_id === updated.report_id ? updated : r)))
                      }
                      onDelete={(id) => setEodReports((prev) => prev.filter((r) => r.report_id !== id))}
                    />
                  ))
                )}
              </div>
              {filteredEodReports.length > EOD_PAGE_SIZE && (
                <div className="it-updates-pagination">
                  <span className="it-updates-pagination-info">
                    {eodPage * EOD_PAGE_SIZE + 1}–
                    {Math.min((eodPage + 1) * EOD_PAGE_SIZE, filteredEodReports.length)} of{' '}
                    {filteredEodReports.length}
                  </span>
                  <div className="it-updates-pagination-actions">
                    <button
                      type="button"
                      className="it-updates-btn it-updates-btn-secondary"
                      onClick={() => setEodPage((p) => Math.max(0, p - 1))}
                      disabled={eodPage === 0}
                    >
                      Previous
                    </button>
                    <span className="it-updates-pagination-page">
                      Page {eodPage + 1} of {eodPageCount}
                    </span>
                    <button
                      type="button"
                      className="it-updates-btn it-updates-btn-secondary"
                      onClick={() => setEodPage((p) => Math.min(eodPageCount - 1, p + 1))}
                      disabled={eodPage >= eodPageCount - 1}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
        </main>
      </div>

      {projectModal.open && (
        <ProjectModal
          project={projectModal.project}
          teammatesOptions={teamOverview}
          currentUser={user}
          defaultProjectType={scope}
          onClose={closeProjectModal}
          onSave={handleSaveProject}
          canDelete={Boolean(projectModal.project?.id) && canDeleteProject(projectModal.project)}
          onDelete={async () => {
            if (await handleDeleteProject(projectModal.project)) closeProjectModal();
          }}
        />
      )}
      {taskModal.open && (
        <TaskModal
          task={taskModal.task}
          currentUser={user}
          projects={projects}
          developers={developers}
          managers={managers}
          statuses={boardStatuses}
          statusLabels={boardStatusLabels}
          onClose={closeTaskModal}
          onSave={handleSaveTask}
          onRefresh={loadAllData}
          onError={(msg) => setError(msg)}
          canDelete={canDeleteTask(taskModal.task)}
          onDelete={async () => {
            if (await handleDeleteTask(taskModal.task)) closeTaskModal();
          }}
        />
      )}
      {leadModal.open && (
        <LeadModal
          lead={leadModal.lead}
          statuses={boardStatuses}
          statusLabels={boardStatusLabels}
          canDelete={canDeleteTask(leadModal.lead)}
          currentUser={user}
          team={MODULE_TEAM}
          onClose={closeLeadModal}
          onSave={handleSaveLead}
          onDelete={async () => {
            if (await handleDeleteTask(leadModal.lead)) closeLeadModal();
          }}
        />
      )}
      {eodModal && (
        <EodModal
          onClose={() => setEodModal(false)}
          onSave={handleSaveEod}
          members={teamOverview.map((u) => ({
            id: u.user_id,
            name: u.username ?? u.assignee,
            image: u.profile_image,
          }))}
        />
      )}

      {loading && <div className="it-updates-loading-bar" />}
    </div>
  );
};

function ProjectModal({ project, teammatesOptions, currentUser, defaultProjectType = 'internal', onClose, onSave, canDelete = false, onDelete }) {
  const initialTeammates = Array.isArray(project?.teammates)
    ? project.teammates
    : typeof project?.teammates_text === 'string'
      ? project.teammates_text.split(',').map((v) => v.trim()).filter(Boolean)
      : [];
  const [isTeammatesOpen, setIsTeammatesOpen] = useState(false);
  const teammatesDropdownRef = useRef(null);
  const teammateChoices = useMemo(
    () =>
      [...new Set((teammatesOptions || []).map((u) => (u.username ?? u.assignee ?? '').trim()))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [teammatesOptions]
  );
  const [form, setForm] = useState({
    project_name: project?.name ?? project?.project_name ?? '',
    client_name: project?.client_name ?? '',
    project_code: project?.project_code ?? '',
    project_url: project?.project_url ?? '',
    logo: project?.logo ?? '',
    description: project?.description ?? '',
    status: project?.status ?? 'active',
    priority: project?.priority ?? 'medium',
    start_date: project?.start_date ? project.start_date.slice(0, 10) : '',
    end_date: project?.end_date ? project.end_date.slice(0, 10) : '',
    owner_user_id: project?.owner_user_id ? String(project.owner_user_id) : '',
    owner_name: project?.owner_name ?? project?.owner ?? '',
    teammates: initialTeammates,
    project_type: project?.project_type ?? defaultProjectType,
  });
  const [saveState, setSaveState] = useState({ saving: false, saved: false });
  // The sector this modal was opened in ('internal' | 'external').
  const isExternalSector = defaultProjectType === 'external';

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!teammatesDropdownRef.current) return;
      if (!teammatesDropdownRef.current.contains(event.target)) {
        setIsTeammatesOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastError('Please choose an image file for the logo.');
      return;
    }
    if (file.size > 512 * 1024) {
      toastError('Logo is too large. Please choose an image under 512 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result || '') }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.project_name.trim()) {
      toastError('Project name is required.');
      return;
    }
    // Existing projects auto-save each edit; explicit submit only creates new ones.
    if (project?.id || saveState.saving) return;
    setSaveState({ saving: true, saved: false });
    const ok = await onSave(form);
    if (ok) {
      setSaveState({ saving: false, saved: true });
      window.setTimeout(() => onClose(), 900);
    } else {
      setSaveState({ saving: false, saved: false });
    }
  };

  // Auto-save every edit of an existing project (debounced, silent, stays open).
  const autoSaveSkip = useRef(true);
  useEffect(() => {
    if (!project?.id) return;
    if (autoSaveSkip.current) {
      autoSaveSkip.current = false;
      return;
    }
    if (!form.project_name.trim()) return;
    const h = setTimeout(async () => {
      setSaveState({ saving: true, saved: false });
      const ok = await onSave(form, { silent: true });
      setSaveState({ saving: false, saved: ok });
    }, 700);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  return (
    <div className="it-updates-modal-backdrop">
      <div className="it-updates-modal" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>{project ? 'Edit project' : 'New project'}</h2>
          <div className="it-updates-modal-header-actions">
            {project?.id && canDelete && onDelete && (
              <ModalKebabMenu
                actions={[
                  { label: 'Delete project', icon: <MdDelete size={16} />, onClick: onDelete, danger: true },
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
            Project name *
            <input
              value={form.project_name}
              onChange={(e) => setForm((f) => ({ ...f, project_name: e.target.value }))}
              required
            />
          </label>
          {isExternalSector && (
            <label>
              Client's name
              <input
                value={form.client_name}
                onChange={(e) => setForm((f) => ({ ...f, client_name: e.target.value }))}
                placeholder="Client / company name"
              />
            </label>
          )}
          <label>
            Project URL
            <input
              type="url"
              placeholder="https://example.com"
              value={form.project_url}
              onChange={(e) => setForm((f) => ({ ...f, project_url: e.target.value }))}
            />
          </label>
          <label>
            Logo
            <span className="it-updates-file-input">
              <input type="file" accept="image/*" onChange={handleLogoChange} />
              <span className="it-updates-file-btn">
                <MdAdd size={16} />
                Choose image
              </span>
              <span className="it-updates-file-name">
                {form.logo ? 'Image selected' : 'No file chosen'}
              </span>
            </span>
          </label>
          {form.logo && (
            <div className="it-updates-logo-preview">
              <img src={form.logo} alt="Project logo preview" />
              <span>Logo selected</span>
              <button
                type="button"
                className="it-updates-logo-remove"
                onClick={() => setForm((f) => ({ ...f, logo: '' }))}
              >
                Remove
              </button>
            </div>
          )}
          <label>
            Description
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              onKeyDown={textareaSubmit}
              rows={3}
            />
          </label>
          {isExternalSector && (
            <label>
              Owner
              <MemberPicker
                members={teammatesOptions}
                value={form.owner_name}
                onChange={(v) =>
                  setForm((f) => {
                    const m = (teammatesOptions || []).find((u) => (u.username ?? u.assignee) === v);
                    return { ...f, owner_name: v, owner_user_id: m ? String(m.user_id) : '' };
                  })
                }
                placeholder="Select an owner from the IT team…"
              />
            </label>
          )}
          <label>
            Project sector
            <select
              value={form.project_type}
              onChange={(e) => setForm((f) => ({ ...f, project_type: e.target.value }))}
            >
              <option value="internal">Internal Projects</option>
              <option value="external">External Projects</option>
            </select>
          </label>
          <label className={isExternalSector ? 'it-updates-form-row-full' : undefined}>
            Teammates involved
            <MemberPicker
              members={teammatesOptions}
              multiple
              value={form.teammates}
              onChange={(arr) => setForm((f) => ({ ...f, teammates: arr }))}
              placeholder="Select teammates from the IT team…"
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
          {project?.id ? (
            <div className="it-updates-project-docs it-updates-form-row-full">
              <div className="it-updates-project-docs-label">Documents</div>
              <ProjectDocuments projectId={project.id} />
            </div>
          ) : (
            <p className="it-updates-project-docs-hint it-updates-form-row-full">
              Save the project to attach its Project Documentation, BRD, and Credentials.
            </p>
          )}
          {isExternalSector && project?.id && (
            <div className="it-updates-form-row-full">
              <ProjectRequirements projectId={project.id} initial={project.requirements} />
            </div>
          )}
          {isExternalSector && project?.id && (
            <div className="it-updates-form-row-full">
              <div className="it-updates-project-docs-label">Comments</div>
              <TaskComments
                taskId={project.id}
                team="it"
                currentUser={currentUser}
                canComment={Boolean(currentUser?.id ?? currentUser?.user_id)}
                api={projectCommentApi}
              />
            </div>
          )}
          <div className="it-updates-modal-actions">
            {project?.id ? null : (
              <button
                type="submit"
                className="it-updates-btn it-updates-btn-primary"
                disabled={saveState.saving}
              >
                {saveState.saving ? 'Creating…' : 'Create project'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export function TaskModal({ task, currentUser, projects, developers, managers, onClose, onSave, onRefresh, onError, canDelete = false, onDelete, team: teamProp = MODULE_TEAM, hideProject = false, hideTimer = false, statuses = DEFAULT_STATUSES, statusLabels = STATUS_LABELS }) {
  // Shadow the module default so every internal team reference follows the prop.
  // This lets other sectors (e.g. director tasks) reuse this modal unchanged.
  const MODULE_TEAM = teamProp;
  const [reqExpanded, setReqExpanded] = useState(false);
  const [form, setForm] = useState({
    task_title: task?.title ?? '',
    task_description: task?.task_description ?? task?.description ?? '',
    project_id: task?.projectId ?? task?.project_id ?? '',
    assigned_to: task?.assigned_to ?? '',
    assigned_by: task?.assigned_by ?? '',
    status: task?.id != null ? (task?.status ?? 'in_progress') : 'todo',
    priority: task?.priority ?? 'medium',
    task_date: task?.task_date ? String(task.task_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    due_date: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
  });

  // Requirements state (only for existing tasks)
  const [requirements, setRequirements] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [showAddReq, setShowAddReq] = useState(false);
  const [editingReqId, setEditingReqId] = useState(null);
  const [reqForm, setReqForm] = useState({ title: '' });

  const isExistingTask = Boolean(task?.id);
  const [saveState, setSaveState] = useState({ saving: false, saved: false });
  const [reviewNote, setReviewNote] = useState('');

  // Load requirements when modal opens for existing task
  useEffect(() => {
    if (!isExistingTask) return;
    let cancelled = false;
    void (async () => {
      setReqLoading(true);
      try {
        const res = await itUpdatesApi.getRequirements(task.id, { team: MODULE_TEAM });
        if (!cancelled) setRequirements(Array.isArray(res.data) ? res.data.filter(Boolean) : []);
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

  const handleAddRequirement = async () => {
    if (!reqForm.title.trim()) return;
    try {
      if (isExistingTask) {
        const res = await itUpdatesApi.createRequirement(task.id, {
          title: reqForm.title,
          status: 'pending',
          priority: 'medium',
          due_date: null,
          team: MODULE_TEAM,
        }, { team: MODULE_TEAM });
        setRequirements((prev) => {
          const newList = res?.data ? [...prev, res.data] : prev;
          handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = [...prev, {
            id: `temp-${Date.now()}`,
            title: reqForm.title,
            status: 'pending',
            priority: 'medium',
            due_date: null,
          }];
          handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch (err) {
      onError?.(err?.response?.data?.message || 'Failed to add requirement');
    }
  };

  const handleUpdateRequirement = async () => {
    if (!reqForm.title.trim() || !editingReqId) return;
    try {
      if (isExistingTask && !String(editingReqId).startsWith('temp-')) {
        const existingReq = requirements.find((r) => String(r.id) === String(editingReqId));
        const res = await itUpdatesApi.updateRequirement(task.id, editingReqId, {
          title: reqForm.title,
          status: existingReq?.status ?? 'pending',
          priority: existingReq?.priority ?? 'medium',
          due_date: existingReq?.due_date ?? null,
          team: MODULE_TEAM,
        }, { team: MODULE_TEAM });
        setRequirements((prev) => {
          const newList = res?.data ? prev.map((r) => (r.id === editingReqId ? res.data : r)) : prev;
          handleStatusTransitions(newList);
          return newList;
        });
      } else {
        setRequirements((prev) => {
          const newList = prev.map((r) => (r.id === editingReqId ? {
            ...r,
            title: reqForm.title,
          } : r));
          handleStatusTransitions(newList);
          return newList;
        });
      }
      resetReqForm();
      setShowAddReq(false);
    } catch (err) {
      onError?.(err?.response?.data?.message || 'Failed to update requirement');
    }
  };

  const handleDeleteRequirement = async (reqId) => {
    try {
      if (isExistingTask && !String(reqId).startsWith('temp-')) {
        await itUpdatesApi.deleteRequirement(task.id, reqId, { team: MODULE_TEAM });
      }
      setRequirements((prev) => {
        const newList = prev.filter((r) => r.id !== reqId);
        handleStatusTransitions(newList);
        return newList;
      });
    } catch (err) {
      onError?.(err?.response?.data?.message || 'Failed to delete requirement');
    }
  };

  const handleToggleReqStatus = async (req) => {
    const newStatus = req.status === 'completed' ? 'pending' : 'completed';
    // A requirement cannot be ticked complete without recorded work time —
    // unless the timer is hidden for this modal (e.g. director tasks).
    if (!hideTimer && newStatus === 'completed') {
      const hasTime = Number(req.timeSpentSeconds || 0) > 0 || Boolean(req.timerRunning);
      if (!hasTime) {
        toastError('Please enter the time you worked on this requirement first.');
        return;
      }
    }
    try {
      if (isExistingTask && !String(req.id).startsWith('temp-')) {
        const res = await itUpdatesApi.updateRequirement(task.id, req.id, { status: newStatus, team: MODULE_TEAM }, { team: MODULE_TEAM });
        setRequirements((prev) => {
          const newList = res?.data ? prev.map((r) => (r.id === req.id ? res.data : r)) : prev;
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
      onError?.(err?.response?.data?.message || 'Failed to toggle status');
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
    // 2. Any pending -> In Progress (rework/completed only; stay in Review so "Send for Rework" stays available)
    else if (hasPending && (form.status === 'rework' || form.status === 'completed')) {
      newStatus = 'in_progress';
    }

    if (newStatus) {
      try {
        setForm(prev => ({ ...prev, status: newStatus }));
        await itUpdatesApi.updateTask(task.id, { ...form, status: newStatus, team: MODULE_TEAM });
        if (onRefresh) onRefresh();
      } catch (err) {
        console.error('Status transition failed:', err);
      }
    }
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
      onError?.('Failed to mark task complete');
      toastError('Failed to mark task complete');
    }
  };

  const handleManualRework = async () => {
    try {
      const newStatus = 'rework';
      setForm(prev => ({ ...prev, status: newStatus }));
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
      onError?.('Failed to set for rework');
      toastError('Failed to send task for rework');
    }
  };

  const startEditReq = (req) => {
    setEditingReqId(req.id);
    setReqForm({ title: req.title });
    setShowAddReq(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.task_title.trim()) {
      toastError('Task title is required.');
      return;
    }
    if (!String(form.assigned_to ?? '').trim()) {
      toastError('Please assign this task to a staff member.');
      return;
    }
    // Existing tasks auto-save each edit; explicit submit only creates new ones.
    if (isExistingTask || saveState.saving) return;

    setSaveState({ saving: true, saved: false });
    let ok = false;
    try {
      ok = await onSave({
        ...form,
        requirements, // Pass local requirements to the save handler
        projectId: form.project_id || undefined,
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

  // Auto-save every edit of an existing task (debounced, silent, stays open).
  const taskAutoSaveSkip = useRef(true);
  useEffect(() => {
    if (!isExistingTask) return;
    if (taskAutoSaveSkip.current) {
      taskAutoSaveSkip.current = false;
      return;
    }
    if (!form.task_title.trim() || !String(form.assigned_to ?? '').trim()) return;
    const h = setTimeout(async () => {
      setSaveState({ saving: true, saved: false });
      let ok = false;
      try {
        ok = await onSave(
          { ...form, projectId: form.project_id || undefined, due_date: form.due_date || undefined },
          { silent: true }
        );
      } catch {
        ok = false;
      }
      setSaveState({ saving: false, saved: ok });
    }, 700);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

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
            Status
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {statuses.map((s) => (
                <option key={s} value={s}>{statusLabels[s]}</option>
              ))}
            </select>
          </label>

          {isExistingTask &&
            (task?.status === 'completed' || task?.status === 'rework') &&
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

          <label>
            Description
            <textarea
              value={form.task_description}
              onChange={(e) => setForm((f) => ({ ...f, task_description: e.target.value }))}
              onKeyDown={textareaSubmit}
              rows={3}
              placeholder="Describe the task…"
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

            {(!reqLoading || !isExistingTask) && requirements.length > 0 && (
              <div className="req-table-box" role="table" aria-label="Requirements table">
                <div className="req-table-header" role="row">
                  <div className="req-th req-th-done" role="columnheader">Done</div>
                  <div className="req-th req-th-title" role="columnheader">Requirement</div>
                  <div className="req-th req-th-actions" role="columnheader">Actions</div>
                </div>
                {(reqExpanded ? requirements : requirements.slice(0, 2)).filter(Boolean).map((req) => (
                  <div
                    key={req.id}
                    className={`req-table-row ${req.status === 'completed' ? 'req-row-completed' : ''}`}
                    role="row"
                  >
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
                      <span className={`req-row-title ${req.status === 'completed' ? 'req-title-done' : ''}`}>
                        {req.title}
                      </span>
                    </div>
                    <div className="req-td req-td-actions">
                      {!hideTimer && (
                        <>
                          <RequirementTimer
                            req={req}
                            taskId={task?.id}
                            team={MODULE_TEAM}
                            disabled={String(req.id).startsWith('temp-')}
                            onUpdate={(u) => setRequirements((prev) => prev.map((r) => (r.id === req.id ? u : r)))}
                          />
                          <RequirementManualTime
                            req={req}
                            taskId={task?.id}
                            team={MODULE_TEAM}
                            disabled={String(req.id).startsWith('temp-')}
                            onUpdate={(u) => setRequirements((prev) => prev.map((r) => (r.id === req.id ? u : r)))}
                          />
                        </>
                      )}
                      <button type="button" className="req-action-btn" onClick={() => startEditReq(req)} title="Edit" aria-label="Edit">
                        <MdEdit size={15} />
                      </button>
                      <button type="button" className="req-action-btn req-action-btn-danger" onClick={() => handleDeleteRequirement(req.id)} title="Delete" aria-label="Delete">
                        <MdDelete size={15} />
                      </button>
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
                <h4 className="req-form-title">
                  {editingReqId ? 'Edit Requirement' : 'New Requirement'}
                </h4>
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
          {!hideProject && (
            <label>
              Project
              <ProjectSearchSelect
                projects={projects}
                value={form.project_id}
                onChange={(id) => setForm((f) => ({ ...f, project_id: id }))}
                placeholder="Search projects..."
              />
            </label>
          )}
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
            {isExistingTask ? null : (
              <button
                type="submit"
                className="it-updates-btn it-updates-btn-primary"
                disabled={saveState.saving}
              >
                {saveState.saving ? 'Creating…' : 'Create task'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

function EodModal({ onClose, onSave, members = [] }) {
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));

  const handleEditorSubmit = (html) => {
    if (!reportDate) {
      toastError('Report date is required.');
      return;
    }
    const plain = String(html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!plain) {
      toastError('Please add a work summary before submitting.');
      return;
    }
    onSave({
      report_date: reportDate,
      achievements: html,
      mood: null,
      hours_worked: null,
      blockers: null,
      tomorrow_plan: null,
    });
  };

  return (
    <div className="it-updates-modal-backdrop">
      <div className="it-updates-modal" onClick={(e) => e.stopPropagation()} onKeyDown={escapeCloses(onClose)}>
        <div className="it-updates-modal-header">
          <h2>EOD Report</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <div className="it-updates-eod-form">
          <label className="it-updates-eod-date">
            Report date
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
            />
          </label>
          <div className="it-updates-eod-field">
            <span className="it-updates-eod-field-label">Work summary (How much completed?) *</span>
            <CommentEditor
              members={members}
              placeholder="Write your end-of-day summary. Type @ to mention someone."
              submitLabel="Submit EOD"
              onSubmit={handleEditorSubmit}
              onCancel={onClose}
              autoFocus
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ITUpdatesMain;
