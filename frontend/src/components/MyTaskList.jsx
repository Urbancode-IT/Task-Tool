import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdCalendarToday,
  MdCheckBox,
  MdErrorOutline,
  MdKeyboardArrowDown,
  MdKeyboardReturn,
} from 'react-icons/md';
import { isTaskOverdue } from '../utils/taskDue';
import { taskInPeriod, CURRENT_MONTH_PERIOD } from '../utils/taskPeriod';
import { newestFirst } from '../utils/taskSort';
import PeriodFilter from './PeriodFilter';
import './MyTaskList.css';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
// Project filter value for tasks that have no project.
const NO_PROJECT = '__none__';
const PRIORITY_COLORS = {
  low: '#10b981',
  medium: '#f59e0b',
  high: '#f97316',
  critical: '#ef4444',
};

const dueYmd = (task) => {
  const raw = task?.dueDate ?? task?.due_date;
  return raw ? String(raw).slice(0, 10) : '';
};

const formatDue = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

// Opens the browser's date picker for a hidden <input type="date">.
const openPicker = (input) => {
  if (!input) return;
  try {
    input.showPicker();
  } catch {
    input.focus();
    input.click();
  }
};

function Avatar({ name, src }) {
  if (src) return <img className="mtl-avatar" src={src} alt="" title={name} />;
  return (
    <span className="mtl-avatar" title={name || 'Unassigned'}>
      {(name || '?')[0].toUpperCase()}
    </span>
  );
}

/**
 * Jira-style list for "My Tasks": one row per task with its key, title, and inline
 * status / due date / priority controls, plus a "+ Create" row that adds a task from
 * its title alone. "All Tasks" keeps the Kanban board.
 *
 *   tasks         — the current user's tasks
 *   statuses      — status keys in board order (first one is used for new tasks)
 *   statusLabel   — key → display text
 *   statusColors  — key → colour
 *   keyPrefix     — short code shown before the task id (e.g. "IT-42")
 *   onOpenTask    — open the full task form
 *   onStatusChange(task, status) / onUpdateTask(task, patch) — inline edits
 *   onQuickCreate({ title, status, projectId }) — async, truthy on success
 *   projects / requireProject — optional project picker on the create row
 */
export default function MyTaskList({
  tasks = [],
  statuses = [],
  statusLabel = (k) => k,
  statusColors = {},
  keyPrefix = 'TASK',
  onOpenTask,
  onStatusChange,
  onUpdateTask,
  onQuickCreate,
  projects,
  requireProject = false,
  currentUser,
}) {
  // Same filters as the All Tasks board, and the same default: this month's tasks.
  const [filters, setFilters] = useState({ status: '', priority: '', project: '', period: CURRENT_MONTH_PERIOD });
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  const projectOptions = useMemo(() => {
    const names = new Set(tasks.map((t) => (t.project_name || '').trim()).filter(Boolean));
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const visible = useMemo(
    () =>
      newestFirst(tasks).filter(
        (t) =>
          (!filters.status || t.status === filters.status) &&
          (!filters.priority || (t.priority || 'medium') === filters.priority) &&
          (!filters.project ||
            (filters.project === NO_PROJECT ? !t.project_name : t.project_name === filters.project)) &&
          taskInPeriod(t, filters.period)
      ),
    [tasks, filters]
  );

  return (
    <div className="mtl">
      <div className="it-updates-filters">
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
          <option value="">Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)} aria-label="Priority">
          <option value="">Priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
        {projectOptions.length ? (
          <select value={filters.project} onChange={(e) => setFilter('project', e.target.value)} aria-label="Project">
            <option value="">Projects</option>
            {projectOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            <option value={NO_PROJECT}>No project</option>
          </select>
        ) : null}
        <PeriodFilter value={filters.period} onChange={(period) => setFilter('period', period)} />
      </div>
      {visible.length ? (
        <ul className="mtl-list">
          {visible.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={statuses}
              statusLabel={statusLabel}
              statusColors={statusColors}
              keyPrefix={keyPrefix}
              onOpenTask={onOpenTask}
              onStatusChange={onStatusChange}
              onUpdateTask={onUpdateTask}
            />
          ))}
        </ul>
      ) : (
        <div className="mtl-empty">
          {tasks.length ? 'No tasks match these filters.' : 'No tasks assigned to you yet.'}
        </div>
      )}
      {onQuickCreate ? (
        <CreateRow
          status={statuses[0] || 'todo'}
          onCreate={onQuickCreate}
          projects={projects}
          requireProject={requireProject}
          currentUser={currentUser}
        />
      ) : null}
    </div>
  );
}

function TaskRow({ task, statuses, statusLabel, statusColors, keyPrefix, onOpenTask, onStatusChange, onUpdateTask }) {
  const dateRef = useRef(null);
  const overdue = isTaskOverdue(task);
  const ymd = dueYmd(task);
  const priority = task.priority || 'medium';
  const color = statusColors[task.status] || '#94a3b8';
  // Controls inside the row must not also open the task.
  const stop = (e) => e.stopPropagation();

  return (
    <li
      className={`mtl-row${task.status === 'completed' ? ' mtl-row-done' : ''}`}
      onClick={() => onOpenTask?.(task)}
    >
      <span className={`mtl-type${overdue ? ' mtl-type-overdue' : ''}`} title={overdue ? 'Past due date' : 'Task'}>
        {overdue ? <MdErrorOutline size={17} /> : <MdCheckBox size={17} />}
      </span>
      <span className="mtl-key">
        {keyPrefix}-{task.id}
      </span>
      <span className="mtl-title" title={task.title}>
        {task.title}
      </span>
      {task.project_name ? (
        <span className="mtl-project" title={task.project_name}>
          {task.project_name}
        </span>
      ) : null}

      <label className="mtl-status" style={{ '--mtl-status': color }} onClick={stop}>
        <select
          value={task.status}
          onChange={(e) => onStatusChange?.(task, e.target.value)}
          aria-label="Status"
        >
          {/* A status this board no longer lists still shows as itself. */}
          {!statuses.includes(task.status) && <option value={task.status}>{statusLabel(task.status)}</option>}
          {statuses.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <MdKeyboardArrowDown size={15} />
      </label>

      <span className="mtl-due-wrap" onClick={stop}>
        <button
          type="button"
          className={`mtl-due${overdue ? ' mtl-due-overdue' : ''}${ymd ? '' : ' mtl-due-empty'}`}
          onClick={() => openPicker(dateRef.current)}
          title={ymd ? 'Change due date' : 'Set due date'}
        >
          <MdCalendarToday size={14} />
          {ymd ? formatDue(ymd) : 'Due date'}
        </button>
        <input
          ref={dateRef}
          type="date"
          className="mtl-due-input"
          tabIndex={-1}
          aria-label="Due date"
          value={ymd}
          onChange={(e) => onUpdateTask?.(task, { dueDate: e.target.value || null })}
        />
      </span>

      <label className="mtl-priority" style={{ '--mtl-priority': PRIORITY_COLORS[priority] }} onClick={stop}>
        <select
          value={priority}
          onChange={(e) => onUpdateTask?.(task, { priority: e.target.value })}
          aria-label="Priority"
          title="Priority"
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p[0].toUpperCase() + p.slice(1)}
            </option>
          ))}
        </select>
      </label>

      <Avatar name={task.assignee} src={task.assignee_profile_image} />
    </li>
  );
}

/**
 * "+ Create" at the foot of the list. Enter adds the task and keeps the row open for
 * the next one; Escape, or clicking away from an empty row, closes it.
 */
function CreateRow({ status, onCreate, projects, requireProject, currentUser }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const hasProjects = Array.isArray(projects) && projects.length > 0;

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    setTitle('');
    setOpen(false);
  };

  const submit = async (e) => {
    e.preventDefault();
    const text = title.trim();
    if (!text || saving || (requireProject && !projectId)) return;
    setSaving(true);
    const ok = await onCreate({ title: text, status, projectId: projectId || null });
    setSaving(false);
    if (ok) setTitle('');
    // Re-enabling the input drops focus, so put it back for the next task.
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!open) {
    return (
      <button type="button" className="mtl-create-trigger" onClick={() => setOpen(true)}>
        <MdAdd size={18} />
        Create
      </button>
    );
  }

  return (
    <form
      className="mtl-create"
      onSubmit={submit}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget) && !title.trim() && !saving) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.isComposing) {
          e.preventDefault();
          close();
        }
      }}
    >
      <span className="mtl-type">
        <MdCheckBox size={17} />
      </span>
      <input
        ref={inputRef}
        className="mtl-create-input"
        placeholder="What needs to be done?"
        maxLength={255}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={saving}
      />
      {hasProjects ? (
        <select
          className="mtl-create-project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          aria-label="Project"
        >
          <option value="">{requireProject ? 'Select project…' : 'No project'}</option>
          {projects.map((p) => {
            const id = p.project_id ?? p.id;
            return (
              <option key={id} value={id}>
                {p.name || p.project_name}
              </option>
            );
          })}
        </select>
      ) : null}
      <Avatar name={currentUser?.name || currentUser?.username} src={currentUser?.profile_image} />
      <button
        type="submit"
        className="mtl-create-submit"
        disabled={!title.trim() || saving || (requireProject && !projectId)}
        title={requireProject && !projectId ? 'Select a project first' : 'Create (Enter)'}
      >
        {saving ? 'Adding…' : 'Create'}
        <MdKeyboardReturn size={14} />
      </button>
    </form>
  );
}
