import React from 'react';
import { MdContentCopy } from 'react-icons/md';

/**
 * "Duplicate this card" action, shown on hover in a task card's top-right corner.
 *
 * A task card is both a click target (opens the task) and a drag handle, so this
 * button has to swallow the pointer events it receives: a click would otherwise open
 * the source task behind it, and mousedown/touchstart would start a drag.
 */
export default function DuplicateTaskButton({ onDuplicate, title = 'Duplicate task' }) {
  const swallow = (e) => e.stopPropagation();

  return (
    <button
      type="button"
      className="it-updates-task-card-duplicate"
      title={title}
      aria-label={title}
      onMouseDown={swallow}
      onTouchStart={swallow}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onDuplicate?.();
      }}
    >
      <MdContentCopy size={13} />
    </button>
  );
}
