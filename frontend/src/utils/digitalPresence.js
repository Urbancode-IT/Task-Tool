/**
 * Digital presence — the company's public profile URLs, stored on the company profile
 * under `social`.
 *
 * Master console → Company & Branding owns these. The server keeps the stored values
 * for a non-master caller, so nothing else can overwrite them.
 *
 * Shape and validation live here rather than in the component, which keeps that file
 * exporting only a component as the react-refresh lint rule requires.
 */

// Order and labels for the editor.
export const SOCIAL_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://www.linkedin.com/company/…' },
  { key: 'instagram', label: 'Instagram', placeholder: 'https://www.instagram.com/…' },
  { key: 'youtube', label: 'YouTube', placeholder: 'https://www.youtube.com/@…' },
  { key: 'facebook', label: 'Facebook', placeholder: 'https://www.facebook.com/…' },
  { key: 'twitter', label: 'Twitter / X', placeholder: 'https://x.com/…' },
  { key: 'website', label: 'Corporate Website', placeholder: 'https://example.com' },
];

export const SOCIAL_KEYS = SOCIAL_FIELDS.map((f) => f.key);

/** Mirrors COMPANY_VALIDATORS.url on the server. */
const URL_RX = /^https?:\/\/[^\s.]+\.[^\s]+$/i;

export const EMPTY_PRESENCE = Object.fromEntries(SOCIAL_KEYS.map((k) => [k, '']));

/** Read the social URLs off a loaded profile. Always returns every key. */
export function presenceFrom(profile) {
  const src = profile?.social || {};
  return Object.fromEntries(
    SOCIAL_KEYS.map((k) => [k, typeof src[k] === 'string' ? src[k] : '']),
  );
}

export function samePresence(a, b) {
  return SOCIAL_KEYS.every((k) => (a?.[k] || '') === (b?.[k] || ''));
}

/**
 * Blank is fine; anything filled has to be an absolute http(s) URL. A bare
 * `example.com` is rejected rather than saved as a relative link that would resolve
 * against the app's own origin.
 */
export function badPresenceUrl(value) {
  const v = String(value || '').trim();
  return Boolean(v) && !URL_RX.test(v);
}

/** Labels of every field the server would reject, for the caller's Publish guard. */
export function presenceErrors(presence) {
  return SOCIAL_FIELDS.filter((f) => badPresenceUrl(presence?.[f.key])).map((f) => f.label);
}
