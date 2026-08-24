import { useState } from 'react';
import { MdMarkEmailRead, MdInfoOutline, MdRestartAlt } from 'react-icons/md';
import {
  MAIL_TYPES, MERGE_FIELDS, effectiveSignature, previewSignature, isOverridden,
} from '../../utils/emailSignatures';
import {
  MAIL_TOKENS, templateField, overriddenCount, isFieldOverridden, setTemplateField,
  resetTemplate, previewParagraphs, fillTokens,
} from '../../utils/mailTemplates';

/**
 * Master console → Company & Branding → Email templates.
 *
 * For every mail Seyal sends: its subject, the heading inside it, the body, the button
 * label and the sign-off. Selecting a mail on the left previews it on the right with
 * sample values filled in.
 *
 * Every box is pre-filled with the wording that currently goes out, so the panel shows
 * the real mail rather than an empty form. Fields left at the default are pruned on
 * publish, which is what keeps a mail tracking the shipped wording (and its audience
 * signature) instead of freezing a copy of it.
 */

const BLOCK_LABEL = {
  quote: 'The quoted comment / task description',
  table: 'The generated table of pending members',
  list: 'The generated list of locked members',
};

function Field({ label, hint, value, onChange, rows, overridden }) {
  const Tag = rows ? 'textarea' : 'input';
  return (
    <label className={`mt-field ${overridden ? 'overridden' : ''}`}>
      <span className="mt-field-top">
        <span className="mt-field-label">{label}</span>
        {overridden && <span className="mt-edited">Edited</span>}
      </span>
      <Tag
        {...(rows ? { rows } : { type: 'text' })}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function EmailSignatures({ value, onChange, templates, onTemplatesChange, company }) {
  const signatures = value || {};
  const tpl = templates || {};
  const [activeMail, setActiveMail] = useState(MAIL_TYPES[0].key);

  const mail = MAIL_TYPES.find((m) => m.key === activeMail) || MAIL_TYPES[0];
  const get = (field) => templateField(tpl, mail.key, field);
  const set = (field, text) => onTemplatesChange(setTemplateField(tpl, mail.key, field, text));
  const edited = (field) => isFieldOverridden(tpl, mail.key, field);

  const sigResolved = effectiveSignature(signatures, mail.key);
  const sigOverridden = isOverridden(signatures, mail.key);
  const sigPreview = previewSignature(sigResolved, { audience: mail.audience, company });

  const companyName = company?.company_name || company?.legal_name || 'Seyal';
  const tokens = Object.keys(MAIL_TOKENS[mail.key] || {});
  const paragraphs = previewParagraphs(get('body'), mail.key);
  const edits = overriddenCount(tpl, mail.key);

  const setSigOverride = (text) => onChange({
    ...signatures,
    email_signatures_by_mail: { ...(signatures.email_signatures_by_mail || {}), [mail.key]: text },
  });
  const resetSig = () => {
    const next = { ...(signatures.email_signatures_by_mail || {}) };
    delete next[mail.key];
    onChange({ ...signatures, email_signatures_by_mail: next });
  };

  return (
    <div className="es-root">
      <div className="es-head">
        <h3><MdMarkEmailRead size={17} /> Email templates</h3>
        <p>
          The subject, wording and sign-off of every mail Seyal sends. Pick a mail below,
          edit it, and see the result on the right. Nothing is applied until you publish.
        </p>
        <p className="es-merge">
          Each mail is edited on its own. A sign-off left untouched follows the standard
          one for its audience, so mails you have not customised stay consistent.
        </p>
      </div>

      {/* Mail picker: one row per mail, showing how many fields it overrides. */}
      <div className="mt-tabs">
        {MAIL_TYPES.map((m) => {
          const n = overriddenCount(tpl, m.key);
          return (
            <button
              type="button"
              key={m.key}
              className={`mt-tab ${activeMail === m.key ? 'active' : ''}`}
              onClick={() => setActiveMail(m.key)}
            >
              <span className="mt-tab-name">{m.label}</span>
              <span className={`es-tag ${m.audience}`}>{m.audience}</span>
              {n > 0 && <span className="mt-tab-count">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="es-split">
        <div className="es-main">
          <div className="mt-editor-head">
            <div>
              <h4 className="es-h4">{mail.label}</h4>
              <p className="es-note">{mail.when}</p>
            </div>
            {edits > 0 && (
              <button
                type="button"
                className="es-reset"
                onClick={() => onTemplatesChange(resetTemplate(tpl, mail.key))}
              >
                <MdRestartAlt size={13} /> Reset this mail
              </button>
            )}
          </div>

          <p className="mt-tokens">
            Placeholders:{' '}
            {tokens.map((t) => (
              <code key={t} title={BLOCK_LABEL[t] || `Replaced with the ${t}`}>{`{${t}}`}</code>
            ))}
          </p>

          <Field
            label="Subject"
            value={get('subject')}
            onChange={(v) => set('subject', v)}
            overridden={edited('subject')}
          />
          <Field
            label="Heading"
            hint="The large title inside the mail, above the body"
            value={get('heading')}
            onChange={(v) => set('heading', v)}
            overridden={edited('heading')}
          />
          <Field
            label="Body"
            hint="Blank line = new paragraph. **text** renders bold. A line containing only a block placeholder is replaced by that block."
            value={get('body')}
            onChange={(v) => set('body', v)}
            rows={9}
            overridden={edited('body')}
          />
          <Field
            label="Button label"
            hint={`Leave blank and the button reads "Open ${companyName}".`}
            value={get('cta')}
            onChange={(v) => set('cta', v)}
            overridden={edited('cta')}
          />

          <h4 className="es-h4">Sign-off</h4>
          <p className="es-note">
            {sigOverridden
              ? 'This mail has its own sign-off.'
              : 'Showing the standard sign-off. Edit it here to give this mail its own.'}
          </p>
          <p className="es-merge">
            Merge fields: {MERGE_FIELDS.join(' ')} — {'{{sender_name}}'} and{' '}
            {'{{sender_title}}'} resolve only where a mail has a human sender; on automated
            mails those lines are dropped rather than left blank.
          </p>
          <div className="mt-sig-row">
            <textarea
              rows={4}
              value={sigResolved}
              onChange={(e) => setSigOverride(e.target.value)}
              spellCheck={false}
            />
            {sigOverridden && (
              <button type="button" className="es-reset" onClick={resetSig}>
                <MdRestartAlt size={13} /> Use the standard
              </button>
            )}
          </div>
        </div>

        <aside className="es-preview">
          <div className="es-preview-label">Preview</div>
          <div className="es-card">
            <div className="es-card-subject">{fillTokens(get('subject'), mail.key)}</div>
            <div className="es-card-heading">{fillTokens(get('heading'), mail.key)}</div>
            {paragraphs.map((para, i) => (
              para.block
                ? <div className="mt-block" key={i}>{BLOCK_LABEL[para.block] || para.block}</div>
                : <p className="es-card-line" key={i}>{stripBold(para.text)}</p>
            ))}
            <div className="es-card-cta">
              {fillTokens(get('cta'), mail.key) || `Open ${companyName} →`}
            </div>
            <div className="es-card-sign">
              {sigPreview
                ? sigPreview.split('\n').map((line, i) => <span key={i}>{line}</span>)
                : <span className="es-card-empty">No signature lines resolve for this mail.</span>}
            </div>
          </div>
          <p className="es-preview-note">
            <MdInfoOutline size={14} />
            Sample values shown for each placeholder. Real ones are filled in when the mail
            is sent.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** Bold markers are shown as plain text in the preview rather than rendered. */
function stripBold(text) {
  return String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1');
}

