import { MdCheckCircle, MdLink, MdOpenInNew, MdWarningAmber } from 'react-icons/md';
import {
  SOCIAL_FIELDS, SOCIAL_KEYS, EMPTY_PRESENCE, badPresenceUrl,
} from '../../utils/digitalPresence';

/**
 * Master console → Company & Branding → Digital presence.
 *
 * The editor for the company's public profile URLs. The field set, the shape and the
 * URL rule all live in `utils/digitalPresence.js`.
 */

function LinkField({ field, value, onChange }) {
  const bad = badPresenceUrl(value);
  const filled = Boolean(String(value || '').trim()) && !bad;
  return (
    <label className={`dp-field ${bad ? 'invalid' : ''}`}>
      <span className="dp-field-top">
        <span className="dp-label">{field.label}</span>
        {filled && <MdCheckCircle size={14} className="dp-ok" aria-hidden />}
      </span>
      <span className="dp-input-row">
        <MdLink size={15} className="dp-input-icon" aria-hidden />
        <input
          type="url"
          inputMode="url"
          value={value || ''}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
        {filled && (
          /* noreferrer as well as noopener: the target is someone else's public
             profile and has no business knowing which console linked to it. */
          <a
            className="dp-open"
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${field.label} in a new tab`}
          >
            <MdOpenInNew size={14} />
          </a>
        )}
      </span>
      {bad && (
        <small className="dp-msg">
          <MdWarningAmber size={13} /> Must start with http:// or https://
        </small>
      )}
    </label>
  );
}

export default function DigitalPresence({ value, onChange }) {
  const presence = value || EMPTY_PRESENCE;
  const set = (key, v) => onChange({ ...presence, [key]: v });
  const filled = SOCIAL_KEYS.filter((k) => String(presence[k] || '').trim()).length;

  return (
    <div className="dp-root">
      <div className="dp-head">
        <h3>Digital presence</h3>
        <p>
          Public profile links for the company. Optional — leave a network blank if there
          is no account for it. {filled} of {SOCIAL_KEYS.length} set.
        </p>
      </div>

      <div className="dp-grid">
        {SOCIAL_FIELDS.map((f) => (
          <LinkField
            key={f.key}
            field={f}
            value={presence[f.key]}
            onChange={(v) => set(f.key, v)}
          />
        ))}
      </div>
    </div>
  );
}
