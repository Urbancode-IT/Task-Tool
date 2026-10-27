import React from 'react';
import { MdDeleteOutline } from 'react-icons/md';

/**
 * "Delete this card" action, shown on hover in a task card's top-right corner (beside
 * Duplicate). Render it only for people allowed to delete the task; the delete itself
 * still asks for a reason and is checked and logged by the server.
 *
 * Like DuplicateTaskButton it swallows its pointer events, so a click does not also
 * open the task and a press does not start a drag.
 */
export default function DeleteTaskButton({ onDelete, title = 'Delete task' }) {
  const swallow = (e) => e.stopPropagation();

  return (
    <button
      type="button"
      className="it-updates-task-card-delete"
      title={title}
      aria-label={title}
      onMouseDown={swallow}
      onTouchStart={swallow}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDelete?.();
      }}
    >
      <MdDeleteOutline size={14} />
    </button>
  );
}
