import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdCalendarToday,
  MdOutlineAssignment,
  MdDeleteOutline,
  MdErrorOutline,
  MdKeyboardArrowDown,
  MdKeyboardReturn,
  MdViewKanban,
  MdViewList,
} from 'react-icons/md';
import { isTaskOverdue } from '../utils/taskDue';
import { taskInPeriod, CURRENT_MONTH_PERIOD, EMPTY_PERIOD, isAllDates, periodEmptyText } from '../utils/taskPeriod';
import { newestFirst, oldestFirst } from '../utils/taskSort';
import useTaskView from '../utils/useTaskView';
import { toastInfo } from '../utils/toast';
import { taskAssignees } from '../utils/assignees';
import MemberPicker from './MemberPicker';
import PeriodFilter from './PeriodFilter';
import BulkImportButton from './BulkImportButton';
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

/** Up to three assignee avatars, overlapped, with "+n" for the rest. */
function AvatarStack({ people }) {
  if (!people?.length) return <Avatar name="" />;
  if (people.length === 1) return <Avatar name={people[0].username} src={people[0].profile_image} />;
  const shown = people.slice(0, 3);
  const names = people.map((p) => p.username || p.user_id).join(', ');
  return (
    <span className="mtl-avatar-stack" title={names}>
      {shown.map((p) => (
        <Avatar key={p.user_id} name={p.username} src={p.profile_image} />
      ))}
      {people.length > shown.length ? <span className="mtl-avatar mtl-avatar-more">+{people.length - shown.length}</span> : null}
    </span>
  );
}

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
 *   renderBoard(tasks) — draws the module's card board for the filtered tasks; when
 *                        given, a Horizontal / Vertical switch appears and the choice
 *                        is remembered per browser
 *   onBulkImport(rows) — async; adds an "Import" button (CSV) — see BulkImportModal
 *   onBulkDelete(tasks) / canDelete(task) — tick rows in the horizontal view and
 *                        delete them together
 *   assignees / assigners — admins only: Assignee and Assigned-by pickers on "+ Create"
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
  renderBoard,
  onBulkImport,
  onBulkDelete,
  canDelete,
  assignees,
  assigners,
}) {
  const [view, setView] = useTaskView('myTasks.view');
  const showBoard = Boolean(renderBoard) && view === 'vertical';

  // Same filters as the All Tasks board, and the same default: this month's tasks.
  const [filters, setFilters] = useState({ status: '', priority: '', project: '', period: CURRENT_MONTH_PERIOD });
  const setFilter = (key, value) => setFilters((f) => ({ ...f, [key]: value }));

  // A new task must not vanish after "Task created": a task for someone else is
  // explained (it lands in their list), and filters that would hide one's own are cleared.
  const handleQuickCreate = async (data) => {
    const ok = await onQuickCreate(data);
    if (!ok) return ok;
    const meId = currentUser?.id ?? currentUser?.user_id;
    const ids = (data.assignee_ids || []).map(String);
    if (ids.length && !ids.includes(String(meId))) {
      const names = ids.map((id) => {
        const person = (assignees || []).find((m) => String(memberId(m)) === id);
        return person ? memberName(person) : 'another member';
      });
      const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
      toastInfo(`Assigned to ${who}. It shows in their My Tasks and in All Tasks.`);
      return ok;
    }
    setFilters((f) => ({
      ...f,
      status: f.status && f.status !== data.status ? '' : f.status,
      priority: f.priority && f.priority !== 'medium' ? '' : f.priority,
      project: '',
    }));
    return ok;
  };

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
        {onBulkImport ? (
          <BulkImportButton
            onImport={onBulkImport}
            statuses={statuses}
            statusLabel={statusLabel}
            projects={projects}
            assignees={assignees}
            assigners={assigners}
            currentUser={currentUser}
            requireProject={requireProject}
          />
        ) : null}
        {renderBoard ? <ViewSwitch view={view} onChange={setView} /> : null}
      </div>
      {showBoard ? (
        renderBoard(visible)
      ) : (
        <TaskRows
          tasks={visible}
          statuses={statuses}
          statusLabel={statusLabel}
          statusColors={statusColors}
          keyPrefix={keyPrefix}
          onOpenTask={onOpenTask}
          onStatusChange={onStatusChange}
          onUpdateTask={onUpdateTask}
          emptyText={
            !tasks.length
              ? 'No tasks assigned to you yet.'
              : periodEmptyText(filters.period) || 'No tasks match these filters.'
          }
          emptyAction={
            tasks.length && !isAllDates(filters.period)
              ? { label: 'Show all dates', onClick: () => setFilter('period', EMPTY_PERIOD) }
              : undefined
          }
          onBulkDelete={onBulkDelete}
          canDelete={canDelete}
        />
      )}
      {onQuickCreate ? (
        <QuickCreateRow
          status={statuses[0] || 'todo'}
          onCreate={handleQuickCreate}
          projects={projects}
          requireProject={requireProject}
          currentUser={currentUser}
          assignees={assignees}
          assigners={assigners}
        />
      ) : null}
    </div>
  );
}

/** The Horizontal / Vertical layout switch shown at the end of a filter bar. */
export function ViewSwitch({ view, onChange }) {
  return (
    <div className="mtl-view-switch" role="group" aria-label="Card layout">
      <button
        type="button"
        className={view === 'horizontal' ? 'active' : ''}
        aria-pressed={view === 'horizontal'}
        onClick={() => onChange('horizontal')}
        title="Horizontal: one row per task"
        aria-label="Horizontal view"
      >
        <MdViewList size={18} />
      </button>
      <button
        type="button"
        className={view === 'vertical' ? 'active' : ''}
        aria-pressed={view === 'vertical'}
        onClick={() => onChange('vertical')}
        title="Vertical: cards in status columns"
        aria-label="Vertical view"
      >
        <MdViewKanban size={18} />
      </button>
    </div>
  );
}

/**
 * The horizontal layout on its own: one row per task, newest first, with inline
 * status / due date / priority. Used by My Tasks and by the All Tasks pages, which
 * keep their own filter bars.
 */
export function TaskRows({
  tasks = [],
  statuses = [],
  statusLabel = (k) => k,
  statusColors = {},
  keyPrefix = 'TASK',
  onOpenTask,
  onStatusChange,
  onUpdateTask,
  emptyText = 'No tasks match these filters.',
  emptyAction, // optional { label, onClick } shown under the empty message
  onBulkDelete,
  canDelete = () => true,
}) {
  // A queue: the first task added is on top and new tasks join the end, next to "+ Create".
  const rows = useMemo(() => oldestFirst(tasks), [tasks]);
  // Bulk delete: tick rows, then delete them together. Only tasks the user may delete
  // can be ticked; ids that leave the list (filtered out, deleted) drop from the selection.
  const [picked, setPicked] = useState(() => new Set());
  const deletable = useMemo(
    () => (onBulkDelete ? rows.filter((t) => canDelete(t)) : []),
    [rows, onBulkDelete, canDelete]
  );
  const selected = deletable.filter((t) => picked.has(String(t.id)));
  const allPicked = deletable.length > 0 && selected.length === deletable.length;
  const [deleting, setDeleting] = useState(false);

  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setPicked(allPicked ? new Set() : new Set(deletable.map((t) => String(t.id))));
  const deleteSelected = async () => {
    if (!selected.length || deleting) return;
    setDeleting(true);
    const done = await onBulkDelete(selected);
    setDeleting(false);
    if (done) setPicked(new Set());
  };

  if (!rows.length) {
    return (
      <div className="mtl-empty">
        {emptyText}
        {emptyAction ? (
          <button type="button" className="mtl-empty-action" onClick={emptyAction.onClick}>
            {emptyAction.label}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="mtl-rows">
      {onBulkDelete && deletable.length ? (
        <div className={`mtl-bulkbar${selected.length ? ' mtl-bulkbar-active' : ''}`}>
          <label className="mtl-check">
            <input
              type="checkbox"
              checked={allPicked}
              ref={(el) => {
                if (el) el.indeterminate = selected.length > 0 && !allPicked;
              }}
              onChange={toggleAll}
              aria-label="Select all tasks"
            />
          </label>
          <span className="mtl-bulkbar-text">
            {selected.length ? `${selected.length} selected` : 'Select tasks to delete them together'}
          </span>
          {selected.length ? (
            <>
              <button type="button" className="mtl-bulkbar-clear" onClick={() => setPicked(new Set())}>
                Clear
              </button>
              <button type="button" className="mtl-bulkbar-delete" onClick={deleteSelected} disabled={deleting}>
                <MdDeleteOutline size={16} />
                {deleting ? 'Deleting…' : `Delete ${selected.length}`}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      <ul className="mtl-list">
        {rows.map((task) => (
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
            selectable={Boolean(onBulkDelete)}
            canSelect={Boolean(onBulkDelete) && canDelete(task)}
            selected={picked.has(String(task.id))}
            onToggle={() => toggle(String(task.id))}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  task,
  statuses,
  statusLabel,
  statusColors,
  keyPrefix,
  onOpenTask,
  onStatusChange,
  onUpdateTask,
  selectable = false,
  canSelect = false,
  selected = false,
  onToggle,
}) {
  const dateRef = useRef(null);
  const overdue = isTaskOverdue(task);
  const ymd = dueYmd(task);
  const priority = task.priority || 'medium';
  const color = statusColors[task.status] || '#94a3b8';
  // Controls inside the row must not also open the task.
  const stop = (e) => e.stopPropagation();

  return (
    <li
      className={`mtl-row${task.status === 'completed' ? ' mtl-row-done' : ''}${selected ? ' mtl-row-selected' : ''}`}
      onClick={() => onOpenTask?.(task)}
    >
      {selectable ? (
        <label className="mtl-check" onClick={stop} title={canSelect ? 'Select' : 'Only the owner or an admin can delete this task'}>
          <input
            type="checkbox"
            checked={selected}
            disabled={!canSelect}
            onChange={onToggle}
            aria-label={`Select ${task.title}`}
          />
        </label>
      ) : null}
      <span className={`mtl-type${overdue ? ' mtl-type-overdue' : ''}`} title={overdue ? 'Past due date' : 'Task'}>
        {overdue ? <MdErrorOutline size={17} /> : <MdOutlineAssignment size={17} />}
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

      <AvatarStack people={taskAssignees(task)} />
    </li>
  );
}

const memberId = (m) => m?.user_id ?? m?.id;
const memberName = (m) => m?.username || m?.name || m?.email || 'Unknown';
// "Me" is always the first choice, so a picker lists everyone else; null hides the picker.
const othersThan = (list, meId) =>
  Array.isArray(list)
    ? list.filter((m) => memberId(m) != null && String(memberId(m)) !== String(meId))
    : null;

/**
 * "+ Create" at the foot of a list. Enter adds the task and keeps the row open for
 * the next one; Escape, or clicking away from an empty row, closes it.
 *
 * With `assignees` / `assigners` (admins), the row also has Assignee and Assigned-by
 * pickers so a task can be created for someone else; both default to "Me". Without
 * them the task is the current user's own.
 */
export function QuickCreateRow({ status, onCreate, projects, requireProject, currentUser, assignees, assigners }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState([]);
  const [assignerId, setAssignerId] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);
  const hasProjects = Array.isArray(projects) && projects.length > 0;
  const meId = currentUser?.id ?? currentUser?.user_id;
  // Assignees list everyone, me included, so a task can be shared with me and others.
  const assigneeChoices = useMemo(
    () => (Array.isArray(assignees) ? assignees.filter((m) => memberId(m) != null) : null),
    [assignees]
  );
  const assignerChoices = useMemo(() => othersThan(assigners, meId), [assigners, meId]);

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
    const ok = await onCreate({
      title: text,
      status,
      projectId: projectId || null,
      // Only sent when an admin picked someone; otherwise the task is the user's own.
      ...(assigneeIds.length ? { assignee_ids: assigneeIds } : {}),
      ...(assignerId ? { assigned_by: assignerId } : {}),
    });
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
        <MdOutlineAssignment size={17} />
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
      {assigneeChoices ? (
        <div className="mtl-create-person mtl-create-assignees">
          <span>Assignees</span>
          <MemberPicker
            members={assigneeChoices}
            by="id"
            multiple
            value={assigneeIds}
            onChange={setAssigneeIds}
            placeholder="Me"
            searchPlaceholder="Search people…"
            ariaLabel="Assignees"
          />
        </div>
      ) : null}
      {assignerChoices ? (
        <div className="mtl-create-person mtl-create-assignees">
          <span>Assigned by</span>
          <MemberPicker
            members={assignerChoices}
            by="id"
            value={assignerId}
            onChange={setAssignerId}
            emptyLabel="Me"
            searchPlaceholder="Search people…"
            ariaLabel="Assigned by"
          />
        </div>
      ) : null}
      {assigneeIds.length ? (
        <AvatarStack
          people={assigneeIds.map((id) => {
            const m = assigneeChoices?.find((x) => String(memberId(x)) === id);
            return { user_id: id, username: m ? memberName(m) : id, profile_image: m?.profile_image };
          })}
        />
      ) : (
        <Avatar name={currentUser?.name || currentUser?.username} src={currentUser?.profile_image} />
      )}
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
