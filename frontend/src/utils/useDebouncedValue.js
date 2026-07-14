import { useEffect, useState } from 'react';

/**
 * Debounce a rapidly-changing value — the project-wide helper for search boxes.
 *
 * Keep the raw text in its own state so the input stays fully responsive, and
 * feed this debounced copy into the filtering/`useMemo` (or an API call). The
 * returned value only updates after `delay` ms without a change, so expensive
 * work runs once the user pauses typing instead of on every keystroke.
 *
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebouncedValue(query, 200);
 *   const matches = useMemo(() => filter(list, debouncedQuery), [list, debouncedQuery]);
 *   // <input value={query} onChange={(e) => setQuery(e.target.value)} />
 */
export default function useDebouncedValue(value, delay = 200) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handle);
  }, [value, delay]);

  return debounced;
}
