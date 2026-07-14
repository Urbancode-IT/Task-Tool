import { useCallback, useEffect, useState } from 'react';

const KEY = 'sidebarCollapsed';
const listeners = new Set();

function read() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

let current = read();

function setGlobal(next) {
  current = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    /* ignore storage errors */
  }
  listeners.forEach((fn) => fn(next));
}

/**
 * Shared sidebar collapse state (Jira-style icon-rail toggle).
 *
 * The toggle lives in the top header bar while the sidebar it controls is
 * rendered by the active module — two separate component trees in the same tab.
 * A module-level listener set keeps every hook instance in sync instantly, and
 * the value is mirrored to localStorage so it survives reloads and syncs across
 * browser tabs.
 *
 *   const { collapsed, toggle } = useSidebarCollapsed();
 */
export default function useSidebarCollapsed() {
  const [collapsed, setLocal] = useState(current);

  useEffect(() => {
    const fn = (v) => setLocal(v);
    listeners.add(fn);
    setLocal(current); // catch any change between initial render and mount
    const onStorage = (e) => {
      if (e.key === KEY) {
        current = read();
        setLocal(current);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const toggle = useCallback(() => setGlobal(!current), []);

  return { collapsed, toggle };
}
