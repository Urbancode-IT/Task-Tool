/**
 * "Duplicate card" support.
 *
 * Every task modal in the app decides between create and update from `task.id`, and
 * the create path posts `payload.requirements` once the new task has an id. So a
 * duplicate is simply the source task with its id stripped: the modal opens prefilled
 * in create mode, and saving writes a new task instead of overwriting the original.
 */

/** Title marker so a copy is distinguishable on the board before it is edited. */
const COPY_SUFFIX = ' (Copy)';

export function makeTaskDuplicate(task) {
  if (!task) return null;
  const sourceId = task.id ?? task.task_id ?? null;
  const sourceTitle = String(task.title ?? task.task_title ?? '').trim();
  const copyTitle = sourceTitle ? `${sourceTitle}${COPY_SUFFIX}` : '';

  return {
    ...task,
    // No id: the modal treats this as a new task, so nothing can overwrite the source.
    id: undefined,
    task_id: undefined,
    // Lets the modal copy the source task's subtasks in as drafts.
    duplicated_from: sourceId,
    title: copyTitle,
    task_title: copyTitle,
    // The copy is work being created today, so let the modal default the task date
    // instead of inheriting the original's. The due date is kept — it is usually the
    // reason for duplicating — and can be changed before saving.
    task_date: undefined,
    // Progress and review history belong to the original only.
    completed_at: null,
    reviewed_by: null,
    reviewed_by_username: null,
    review_comment: null,
    req_total: 0,
    req_completed: 0,
  };
}

/**
 * Map the source task's subtasks to unsaved drafts. `temp-` ids are what the modals
 * already give subtasks typed before a task exists; the save path turns them into real
 * rows against the new task id. Progress is not copied — the drafts start pending.
 */
export function toSubtaskDrafts(rows) {
  const stamp = Date.now();
  return (Array.isArray(rows) ? rows : []).filter(Boolean).map((req, idx) => ({
    id: `temp-${stamp}-${idx}`,
    title: req.title ?? '',
    status: 'pending',
    priority: req.priority ?? 'medium',
    due_date: req.due_date ?? null,
  }));
}
