import { useCallback, useState } from 'react';

// Cards a board column shows at first, and how many more each "Show more" adds.
export const COLUMN_PAGE = 25;

/**
 * Per-column card limits for a task board. limitFor(status) is how many cards that
 * column shows; showMore(status) reveals the next COLUMN_PAGE.
 */
export function useColumnLimits() {
  const [limits, setLimits] = useState({});
  const limitFor = useCallback((key) => limits[key] || COLUMN_PAGE, [limits]);
  const showMore = useCallback(
    (key) => setLimits((prev) => ({ ...prev, [key]: (prev[key] || COLUMN_PAGE) + COLUMN_PAGE })),
    []
  );
  return { limitFor, showMore };
}
