import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import apiClient from '../api/client';
import { LABEL_DEFAULTS, setLabelOverrides } from './labels';

/**
 * Single source of truth for the company identity across the app.
 *
 * The published company profile drives the login screen, the app shell, the tab
 * title, the favicon and the brand colours. It is fetched once from the public
 * `/api/branding` endpoint (no auth, so the login screen can use it) and refreshed
 * whenever the admin publishes a change — see BRANDING_EVENT below.
 */

// Matches the current static assets, so an unconfigured profile looks unchanged.
const FALLBACK = {
  company_name: 'Seyal',
  legal_name: '',
  tagline: '',
  website: '',
  colors: { primary: '', secondary: '', accent: '' },
  logo: '/logo-icon.png',
  favicon: '/favicon.png?v=3',
  // Overrides only; anything absent falls back to the coded default.
  labels: {},
};

/** Dispatch on `window` after publishing so every mounted consumer refetches. */
export const BRANDING_EVENT = 'branding:updated';
const STORAGE_KEY = 'seyal.branding';
// Assets are base64 data URLs; anything larger is left out rather than risking a
// QuotaExceededError that would break every other localStorage write.
const MAX_CACHED = 900 * 1024;

const BrandingContext = createContext(FALLBACK);

export const useBranding = () => useContext(BrandingContext);

/**
 * Resolve a renameable name: `label('section.my_tasks')`.
 *
 * Falls back to the catalogue default, then to an explicit fallback, so a name is
 * never blank even if the id is unknown or the profile has not loaded.
 * @returns {(id: string, fallback?: string) => string}
 */
export function useLabels() {
  const { labels } = useContext(BrandingContext);
  return useCallback(
    (id, fallback) => labels?.[id] || LABEL_DEFAULTS[id] || fallback || '',
    [labels]
  );
}

/** Merge a server payload over the fallback, ignoring blank fields. */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return FALLBACK;
  const colors = raw.colors || {};
  return {
    company_name: raw.company_name || raw.legal_name || FALLBACK.company_name,
    legal_name: raw.legal_name || '',
    tagline: raw.tagline || '',
    website: raw.website || '',
    colors: {
      primary: colors.primary || '',
      secondary: colors.secondary || '',
      accent: colors.accent || '',
    },
    logo: raw.logo || FALLBACK.logo,
    favicon: raw.favicon || FALLBACK.favicon,
    // Blank entries are dropped so an emptied field reverts to the coded default
    // rather than rendering an empty tab.
    labels: Object.fromEntries(
      Object.entries(raw.labels || {}).filter(([, v]) => typeof v === 'string' && v.trim())
    ),
  };
}

/** Read the last known branding so the first paint is not the wrong brand. */
function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalise(JSON.parse(raw)) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

function writeCache(value) {
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_CACHED) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, json);
  } catch { /* private mode or quota — the network fetch still works */ }
}

/** Swap the tab icon. Reuses one managed link so repeated updates do not stack up. */
function applyFavicon(href) {
  if (!href) return;
  let link = document.querySelector('link[data-branding-icon]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    link.setAttribute('data-branding-icon', '');
    document.head.appendChild(link);
  }
  link.href = href;
  // The static tags in index.html would otherwise win on some browsers.
  document.querySelectorAll('link[rel="icon"]:not([data-branding-icon]), link[rel="shortcut icon"]')
    .forEach((el) => el.parentNode?.removeChild(el));
}

/* ── colour maths, so one picked colour can drive a whole scale ── */

/** '#rgb' or '#rrggbb' → {r,g,b}. Returns null for anything unparseable. */
function parseHex(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

const toHex = ({ r, g, b }) =>
  `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

/** Blend `rgb` toward `target` by `amount` (0 = unchanged, 1 = fully target). */
const mix = (rgb, target, amount) => ({
  r: rgb.r + (target.r - rgb.r) * amount,
  g: rgb.g + (target.g - rgb.g) * amount,
  b: rgb.b + (target.b - rgb.b) * amount,
});

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/** WCAG relative luminance, used to pick legible text over a brand fill. */
function luminance({ r, g, b }) {
  const chan = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

/**
 * Push the configured palette onto the design tokens in index.css.
 *
 * The whole primary scale is derived from the single picked colour, because
 * components use the tints and shades directly (hover states, soft backgrounds,
 * the preloader ring); overriding only 500/600 leaves the rest at the old brand.
 *
 * Neutrals and semantic colours (success/warning/danger) are never touched — they
 * carry body and label text, so repainting them can make wording disappear.
 */
function applyColors({ primary, secondary, accent }) {
  const root = document.documentElement;
  const set = (name, value) => {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  };

  const base = parseHex(primary);
  if (!base) {
    // Nothing configured (or an invalid value): fall back to the stylesheet.
    [
      '--clr-primary-50', '--clr-primary-100', '--clr-primary-200', '--clr-primary-300',
      '--clr-primary-400', '--clr-primary-500', '--clr-primary-600', '--clr-primary-700',
      '--clr-accent-400', '--clr-accent-500', '--brand-blue', '--brand-indigo',
      '--brand-violet', '--brand-gradient', '--brand-gradient-soft', '--brand-on',
      '--brand-secondary', '--surface-bg',
    ].forEach((n) => root.style.removeProperty(n));
    return;
  }

  const tint = (amount) => toHex(mix(base, WHITE, amount));
  set('--clr-primary-50', tint(0.92));
  set('--clr-primary-100', tint(0.84));
  set('--clr-primary-200', tint(0.68));
  set('--clr-primary-300', tint(0.48));
  set('--clr-primary-400', tint(0.24));
  set('--clr-primary-500', primary);
  set('--clr-primary-600', primary);
  set('--clr-primary-700', toHex(mix(base, BLACK, 0.22)));

  const accentBase = parseHex(accent) || base;
  set('--clr-accent-400', toHex(mix(accentBase, WHITE, 0.24)));
  set('--clr-accent-500', toHex(accentBase));

  set('--brand-blue', primary);
  set('--brand-indigo', primary);
  set('--brand-violet', primary);
  set('--brand-gradient', primary);
  set('--brand-gradient-soft', tint(0.92));
  // Text drawn on a brand-filled surface: white on dark brands, near-black on light
  // ones, so a pale primary does not leave buttons with unreadable labels.
  set('--brand-on', luminance(base) > 0.5 ? '#0f172a' : '#ffffff');

  // The page sits on a barely-tinted white drawn from the brand, so switching the
  // primary colour visibly re-themes the whole app rather than just its accents.
  set('--surface-bg', tint(0.965));

  // Secondary is exposed for brand surfaces only. It is deliberately not mapped
  // onto any neutral, since those tokens colour text.
  set('--brand-secondary', parseHex(secondary) ? secondary : '');
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(readCache);

  const refresh = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/branding', { skipAuthRefresh: true });
      const next = normalise(data);
      setBranding(next);
      writeCache(next);
    } catch {
      // Offline or the endpoint is unavailable — keep the cached/fallback brand.
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    window.addEventListener(BRANDING_EVENT, refresh);
    return () => window.removeEventListener(BRANDING_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    document.title = branding.company_name;
    applyFavicon(branding.favicon);
    applyColors(branding.colors);
    // Mirrored for the non-hook readers in labels.js.
    setLabelOverrides(branding.labels);
  }, [branding]);

  const value = useMemo(() => ({ ...branding, refresh }), [branding, refresh]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/** Tell every mounted consumer that the published branding changed. */
export function notifyBrandingChanged() {
  window.dispatchEvent(new CustomEvent(BRANDING_EVENT));
}

export default BrandingContext;
