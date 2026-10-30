// Tasks can have several assignees. The API sends assignee_ids (every assignee, in
// the order picked) and assignees [{ user_id, username, profile_image }], and keeps
// assigned_to as the first of them. These helpers read either shape, so tasks from
// before the change (assigned_to only) still work.

/** Every assignee id of a task, as strings. */
export function taskAssigneeIds(task) {
  const ids = Array.isArray(task?.assignee_ids) ? task.assignee_ids : [];
  const list = ids.length ? ids : task?.assigned_to != null && task.assigned_to !== '' ? [task.assigned_to] : [];
  return [...new Set(list.map(String))];
}

/** True when the user is one of the task's assignees. */
export function isAssignedTo(task, userId) {
  if (userId == null || userId === '') return false;
  return taskAssigneeIds(task).includes(String(userId));
}

/** The people on a task, for avatars and names. Falls back to the single assignee. */
export function taskAssignees(task) {
  if (Array.isArray(task?.assignees) && task.assignees.length) return task.assignees;
  if (task?.assigned_to == null || task.assigned_to === '') return [];
  return [{ user_id: task.assigned_to, username: task.assignee, profile_image: task.assignee_profile_image }];
}

/** "Asha", "Asha, Ravi" or "Asha +2" for compact places. */
export function assigneeLabel(task, { max = 2, empty = 'Unassigned' } = {}) {
  const names = taskAssignees(task).map((a) => a.username || String(a.user_id));
  if (!names.length) return empty;
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max - 1).join(', ')} +${names.length - (max - 1)}`;
}

/** Form value for a task: the assignee ids as strings (empty for a new task). */
export function initialAssigneeIds(task) {
  return taskAssigneeIds(task);
}

/** People to draw on a task card: the assignees, or one placeholder when unassigned. */
export function cardAssignees(task) {
  const people = taskAssignees(task);
  return people.length ? people : [{ user_id: 'unassigned', username: task?.assignee || 'Unassigned' }];
}
