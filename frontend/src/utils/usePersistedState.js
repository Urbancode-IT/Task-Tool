import { useEffect, useState } from 'react';

/**
 * useState whose value is mirrored to localStorage under `key`, so it survives a
 * page reload (e.g. keeping the user on the same module/section after refresh).
 *
 * `sanitize(stored)` optionally validates the restored value — return a safe
 * value to use, or the default. Handy when a saved tab is no longer available.
 *
 *   const [tab, setTab] = usePersistedState('itUpdates.activeTab', 'Dashboard');
 */
export default function usePersistedState(key, defaultValue, sanitize) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      const parsed = JSON.parse(raw);
      return sanitize ? sanitize(parsed) : parsed;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore storage errors (private mode, quota) */
    }
  }, [key, value]);

  return [value, setValue];
}
