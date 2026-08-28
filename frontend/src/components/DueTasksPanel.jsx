import { useMemo } from 'react';
import { MdWarningAmber, MdUpcoming, MdCheckCircleOutline } from 'react-icons/md';
import { splitByDue, dueLabel, daysUntilDue, UPCOMING_WINDOW_DAYS } from '../utils/taskDue';
import './DueTasksPanel.css';

/**
 * "Due now" and "Upcoming" for the signed-in user, shown on every sector dashboard.
 *
 * Fed from the `myTasks` list each module already computes, so it needs no request of
 * its own and stays in step with whatever that module has loaded.
 *
 * Due now = overdue or due today. Upcoming = due within the next week. Completed work
 * and tasks with no due date never appear — see utils/taskDue.js.
 */

const PRIORITY_COLORS = {
  urgent: '#dc2626',
  high: '#ea580c',
  medium: '#0284c7',
  low: '#64748b',
};

function TaskLine({ task, onOpen }) {
  const overdue = (daysUntilDue(task) ?? 0) < 0;
  const title = task.title || task.task_title || 'Untitled task';
  const project = task.project_name || task.projectName || '';
  const priority = (task.priority || 'medium').toLowerCase();
  const Tag = onOpen ? 'button' : 'div';

  return (
    <Tag
      {...(onOpen ? { type: 'button', onClick: () => onOpen(task) } : {})}
      className={`dtp-row ${onOpen ? 'clickable' : ''}`}
    >
      <span
        className="dtp-dot"
        style={{ background: PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium }}
        title={`${priority} priority`}
      />
      <span className="dtp-text">
        <span className="dtp-title">{title}</span>
        {project && <span className="dtp-project">{project}</span>}
      </span>
      <span className={`dtp-when ${overdue ? 'overdue' : ''}`}>{dueLabel(task)}</span>
    </Tag>
  );
}

function Bucket({ icon, title, tone, tasks, empty, limit, onOpen }) {
  // An empty list is good news, so it stays neutral — the urgent colouring only
  // applies once there is actually something overdue to look at.
  const applied = tasks.length > 0 ? tone : 'calm';
  // Assigned rather than destructure-renamed: the lint config exempts capitalised
  // *variables* from no-unused-vars but not parameters, and it does not count JSX
  // usage. This is how the rest of the app passes an icon component around.
  const Icon = icon;
  const shown = tasks.slice(0, limit);
  const hidden = tasks.length - shown.length;

  return (
    <section className={`dtp-bucket ${applied}`}>
      <header className="dtp-head">
        <Icon size={16} />
        <h3>{title}</h3>
        <span className="dtp-count">{tasks.length}</span>
      </header>

      {tasks.length === 0 ? (
        <p className="dtp-empty">
          <MdCheckCircleOutline size={15} /> {empty}
        </p>
      ) : (
        <>
          <div className="dtp-list">
            {shown.map((t) => (
              <TaskLine key={t.id ?? t.task_id ?? `${t.title}-${t.due_date}`} task={t} onOpen={onOpen} />
            ))}
          </div>
          {hidden > 0 && (
            <p className="dtp-more">and {hidden} more</p>
          )}
        </>
      )}
    </section>
  );
}

export default function DueTasksPanel({
  tasks,
  onOpenTask,
  limit = 5,
  windowDays = UPCOMING_WINDOW_DAYS,
}) {
  const { dueNow, upcoming } = useMemo(
    () => splitByDue(tasks, windowDays),
    [tasks, windowDays]
  );

  return (
    <div className="dtp-grid">
      <Bucket
        icon={MdWarningAmber}
        title="Due now"
        tone="urgent"
        tasks={dueNow}
        empty="Nothing overdue or due today."
        limit={limit}
        onOpen={onOpenTask}
      />
      <Bucket
        icon={MdUpcoming}
        title={`Upcoming (next ${windowDays} days)`}
        tone="soon"
        tasks={upcoming}
        empty="Nothing due in the next week."
        limit={limit}
        onOpen={onOpenTask}
      />
    </div>
  );
}
