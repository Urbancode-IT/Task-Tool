import { useMemo, useState } from 'react';
import { MdAdd, MdClose, MdInfoOutline } from 'react-icons/md';

/**
 * Brand value pillars offered in the dropdown. A curated list keeps wording
 * consistent across the company rather than each admin inventing a phrasing.
 * "Add your own" stays available for anything the list does not cover.
 */
export const BRAND_VALUE_OPTIONS = [
  'Integrity', 'Innovation', 'Customer First', 'Accountability', 'Collaboration',
  'Excellence', 'Transparency', 'Respect', 'Ownership', 'Agility',
  'Craftsmanship', 'Continuous Learning', 'Empathy', 'Reliability', 'Simplicity',
  'Sustainability', 'Diversity & Inclusion', 'Data Driven', 'Speed', 'Trust',
  'Quality', 'Teamwork', 'Passion', 'Curiosity', 'Boldness',
];

export const MAX_BRAND_VALUES = 10;

/** Blank identity, matching the shape stored on the company profile. */
export const EMPTY_IDENTITY = {
  company_name: '',
  legal_name: '',
  tagline: '',
  mission: '',
  vision: '',
  story: '',
  brand_values: [],
  // Where the downloadable logo pack and the written guidelines live. Reference links
  // only — nothing in the app reads them, they are for whoever needs the assets.
  brand_kit: { url: '', guidelines: '' },
};

/** Read the identity fields off a loaded profile, normalising the array. */
export function identityFrom(profile) {
  const p = profile || {};
  return {
    company_name: p.company_name || '',
    legal_name: p.legal_name || '',
    tagline: p.tagline || '',
    mission: p.mission || '',
    vision: p.vision || '',
    story: p.story || '',
    brand_values: Array.isArray(p.brand_values) ? p.brand_values.filter(Boolean) : [],
    brand_kit: {
      url: p.brand_kit?.url || '',
      guidelines: p.brand_kit?.guidelines || '',
    },
  };
}

export function sameIdentity(a, b) {
  const keys = ['company_name', 'legal_name', 'tagline', 'mission', 'vision', 'story'];
  if (keys.some((k) => (a?.[k] || '') !== (b?.[k] || ''))) return false;
  const kitKeys = ['url', 'guidelines'];
  if (kitKeys.some((k) => (a?.brand_kit?.[k] || '') !== (b?.brand_kit?.[k] || ''))) return false;
  const av = a?.brand_values || [];
  const bv = b?.brand_values || [];
  return av.length === bv.length && av.every((v, i) => v === bv[i]);
}

function CharField({ label, hint, value, onChange, max, rows }) {
  const over = max && value.length > max;
  const Tag = rows ? 'textarea' : 'input';
  return (
    <label className="bi-field">
      <span className="bi-field-top">
        <span className="bi-label">{label}</span>
        {max ? (
          <span className={`bi-count ${over ? 'over' : ''}`}>{value.length}/{max}</span>
        ) : null}
      </span>
      <Tag
        {...(rows ? { rows } : { type: 'text' })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/**
 * Brand identity editor: the name, tagline and the narrative fields, plus the value
 * pillars chosen from a dropdown.
 *
 * Deliberately stateless about persistence — the parent owns the profile and the single
 * Publish action, so editing identity and navigation in one visit cannot have one
 * overwrite the other.
 */
export default function BrandIdentity({ value, onChange }) {
  const [picking, setPicking] = useState('');
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const set = (key, v) => onChange({ ...value, [key]: v });
  const setKit = (key, v) => onChange({
    ...value,
    brand_kit: { ...(value?.brand_kit || {}), [key]: v },
  });
  // Memoised so the `available` list below has a stable dependency.
  const values = useMemo(() => value.brand_values || [], [value.brand_values]);
  const full = values.length >= MAX_BRAND_VALUES;

  const available = useMemo(
    () => BRAND_VALUE_OPTIONS.filter(
      (o) => !values.some((v) => v.toLowerCase() === o.toLowerCase())
    ),
    [values]
  );

  const addValue = (v) => {
    const t = String(v || '').trim();
    if (!t || full) return;
    if (values.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    set('brand_values', [...values, t]);
  };

  const removeValue = (i) => set('brand_values', values.filter((_, idx) => idx !== i));

  return (
    <div className="bi-wrap">
      <section className="bi-block">
        <h3 className="bi-h3">Name &amp; tagline</h3>
        <div className="bi-grid">
          <CharField
            label="Brand name"
            hint="Shown in the top bar, on the login screen, in the browser tab and on emails."
            value={value.company_name}
            onChange={(v) => set('company_name', v)}
            max={60}
          />
          <CharField
            label="Legal name"
            hint="The registered entity, used on invoices. Leave blank to use the brand name."
            value={value.legal_name}
            onChange={(v) => set('legal_name', v)}
            max={120}
          />
        </div>
        <CharField
          label="Tagline"
          hint="One line under the wordmark on the sign-in screen."
          value={value.tagline}
          onChange={(v) => set('tagline', v)}
          max={120}
        />
      </section>

      <section className="bi-block">
        <h3 className="bi-h3">Purpose</h3>
        <div className="bi-grid">
          <CharField
            label="Mission"
            hint="What the company does today."
            value={value.mission}
            onChange={(v) => set('mission', v)}
            max={400}
            rows={3}
          />
          <CharField
            label="Vision"
            hint="Where it is heading."
            value={value.vision}
            onChange={(v) => set('vision', v)}
            max={400}
            rows={3}
          />
        </div>
        <CharField
          label="Company story"
          hint="A short description used in profiles and introductions."
          value={value.story}
          onChange={(v) => set('story', v)}
          max={1200}
          rows={5}
        />
      </section>

      <section className="bi-block">
        <h3 className="bi-h3">
          Brand values
          <span className="bi-h3-count">{values.length}/{MAX_BRAND_VALUES}</span>
        </h3>
        <p className="bi-note">
          <MdInfoOutline size={14} />
          Pick from the list so wording stays consistent. Order is the order you add them.
        </p>

        {values.length > 0 && (
          <div className="bi-chips">
            {values.map((v, i) => (
              <span className="bi-chip" key={`${v}-${i}`}>
                {v}
                <button type="button" onClick={() => removeValue(i)} aria-label={`Remove ${v}`}>
                  <MdClose size={14} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="bi-picker-row">
          <select
            value={picking}
            onChange={(e) => {
              addValue(e.target.value);
              setPicking('');
            }}
            disabled={full || available.length === 0}
            aria-label="Add a brand value"
          >
            <option value="">
              {full
                ? `Limit of ${MAX_BRAND_VALUES} reached`
                : available.length === 0
                  ? 'All listed values added'
                  : 'Choose a value…'}
            </option>
            {available.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>

          {!showCustom ? (
            <button
              type="button"
              className="bi-link"
              onClick={() => setShowCustom(true)}
              disabled={full}
            >
              <MdAdd size={15} /> Add your own
            </button>
          ) : (
            <div className="bi-custom">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Custom value"
                maxLength={40}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addValue(custom);
                    setCustom('');
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCustom(false);
                    setCustom('');
                  }
                }}
              />
              <button
                type="button"
                className="bi-link"
                onClick={() => { addValue(custom); setCustom(''); }}
                disabled={!custom.trim() || full}
              >
                Add
              </button>
              <button
                type="button"
                className="bi-link bi-link-muted"
                onClick={() => { setShowCustom(false); setCustom(''); }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Reference links, migrated from the retired Admin → Company & Branding screen.
          Nothing in the app reads them; they are where people find the assets. */}
      <section className="bi-block">
        <h3 className="bi-h3">Brand kit</h3>
        <div className="bi-grid">
          <CharField
            label="Asset pack URL"
            hint="Where the logo pack lives — Drive, Dropbox, anywhere"
            value={value?.brand_kit?.url || ''}
            onChange={(v) => setKit('url', v)}
          />
          <CharField
            label="Guidelines"
            hint="Link to, or a short summary of, the usage rules"
            value={value?.brand_kit?.guidelines || ''}
            onChange={(v) => setKit('guidelines', v)}
            rows={3}
          />
        </div>
      </section>
    </div>
  );
}
