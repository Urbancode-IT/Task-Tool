import usePersistedState from './usePersistedState';

// "horizontal" = one row per task; "vertical" = the card board in status columns.
export const TASK_VIEWS = ['horizontal', 'vertical'];

/** Remembered Horizontal / Vertical choice for a task page (`key` keeps pages separate). */
export default function useTaskView(key, defaultView = 'horizontal') {
  return usePersistedState(key, defaultView, (v) => (TASK_VIEWS.includes(v) ? v : defaultView));
}
