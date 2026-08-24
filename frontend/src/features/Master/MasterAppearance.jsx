import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdSave, MdClose, MdRestartAlt, MdPalette, MdCheck, MdWarningAmber, MdVisibility,
  MdCloudUpload, MdDelete, MdImage,
} from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { toastError, toastSuccess } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import {
  notifyBrandingChanged, previewPalette, revertPalette, derivedScale, useBranding,
} from '../../branding/BrandingContext';
import './MasterAppearance.css';

/**
 * Ready-made palettes. `primary` does the work — the whole tint/shade scale, the page
 * ground and the on-brand text colour are derived from it. Secondary and accent are
 * used only on brand surfaces.
 */
const PRESETS = [
  // The house palette. The brand blue from the Seyal logo (#0054c4) with the two steps
  // either side of it in index.css, so choosing this publishes a theme identical to the
  // built-in stylesheet.
  { name: 'Seyal Blue', primary: '#0054c4', secondary: '#00429b', accent: '#337bd4' },
  { name: 'Urbancode Blue', primary: '#0b2e91', secondary: '#0f172a', accent: '#f59e0b' },
  { name: 'Ocean', primary: '#0369a1', secondary: '#0c4a6e', accent: '#06b6d4' },
  { name: 'Forest', primary: '#15803d', secondary: '#14532d', accent: '#84cc16' },
  { name: 'Plum', primary: '#6d28d9', secondary: '#2e1065', accent: '#ec4899' },
  { name: 'Ember', primary: '#c2410c', secondary: '#7c2d12', accent: '#f59e0b' },
  { name: 'Crimson', primary: '#be123c', secondary: '#4c0519', accent: '#fb7185' },
  { name: 'Teal', primary: '#0f766e', secondary: '#134e4a', accent: '#2dd4bf' },
  { name: 'Graphite', primary: '#334155', secondary: '#0f172a', accent: '#64748b' },
];

/**
 * Brand assets. Choosing a file only stages it: the image is read locally for the
 * preview and nothing is sent until Publish, which is also what applies the colours.
 * So the whole section is one atomic change the master admin opts into.
 *
 * The seal plus either signature are what gate an invoice being issued, which is why
 * neither signature is marked required on its own.
 */
const ASSET_META = [
  { key: 'logo', label: 'Primary Logo', hint: 'App shell, login screen and invoices' },
  { key: 'favicon', label: 'Favicon', hint: 'Browser tab icon' },
  { key: 'signature', label: 'Director Signature', hint: 'Scanned wet signature' },
  { key: 'digital_signature', label: 'Digital Signature', hint: 'Used in place of the scan' },
  { key: 'seal', label: 'Company Seal', hint: 'Required on every invoice' },
];

const MAX_ASSET_BYTES = 2 * 1024 * 1024;

const FIELDS = [
  { key: 'primary', label: 'Primary', hint: 'Drives the whole theme: buttons, links, highlights, page ground' },
  { key: 'secondary', label: 'Secondary', hint: 'Brand surfaces only — never applied to text colours' },
  { key: 'accent', label: 'Accent', hint: 'Gradients and small highlights' },
];

const isHex = (v) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '').trim());
const same = (a, b) =>
  ['primary', 'secondary', 'accent'].every((k) => (a?.[k] || '') === (b?.[k] || ''));

/** Relative luminance, to warn when a primary is too pale for white button text. */
function lum(hex) {
  const s = String(hex || '').replace('#', '');
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const ch = (i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

function ColorField({ field, value, onChange }) {
  const valid = isHex(value);
  return (
    <div className="ma-field">
      <div className="ma-field-top">
        <span className="ma-field-label">{field.label}</span>
        {!valid && value && <span className="ma-invalid">Not a hex colour</span>}
      </div>
      <div className={`ma-input-row ${valid ? '' : 'invalid'}`}>
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${field.label} colour`}
        />
        <input
          className="ma-hex"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          spellCheck="false"
        />
      </div>
      <small>{field.hint}</small>
    </div>
  );
}

/**
 * Master console → Appearance.
 *
 * Edits the three brand colours on the company profile. The palette is applied to the
 * live design tokens while editing, so the console itself repaints and the theme can
 * be judged against real UI rather than a swatch. Nothing reaches other users until
 * Publish.
 */
export default function MasterAppearance() {
  const branding = useBranding();
  const [profile, setProfile] = useState(null);
  const [colors, setColors] = useState({ primary: '', secondary: '', accent: '' });
  const [published, setPublished] = useState({ primary: '', secondary: '', accent: '' });
  const [assets, setAssets] = useState({});
  // Staged, unpublished asset changes: a data URL to upload, or null to delete on
  // Publish. Absent key = leave whatever is published alone.
  const [stagedAssets, setStagedAssets] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAsset, setBusyAsset] = useState('');
  // Held in a ref so the unmount cleanup always sees the latest published palette.
  const publishedRef = useRef(published);
  publishedRef.current = published;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getCompanyProfile();
      const p = data?.data || data || {};
      const c = {
        primary: p.colors?.primary || '',
        secondary: p.colors?.secondary || '',
        accent: p.colors?.accent || '',
      };
      // Assets are held separately and never round-tripped through a profile publish.
      // dbPublishCompanyProfile merges the body's `assets` over the stored blob, so
      // carrying a stale snapshot here would resurrect an asset deleted since load.
      const { assets: loadedAssets, ...profileWithoutAssets } = p;
      setProfile(profileWithoutAssets);
      setColors(c);
      setPublished(c);
      setAssets(loadedAssets || {});
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to load the company profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Paint the draft palette live. Only valid hex values are applied, so typing a
  // partial value does not blank the theme mid-keystroke.
  useEffect(() => {
    if (loading) return;
    previewPalette({
      primary: isHex(colors.primary) ? colors.primary : published.primary,
      secondary: isHex(colors.secondary) ? colors.secondary : published.secondary,
      accent: isHex(colors.accent) ? colors.accent : published.accent,
    });
  }, [colors, published, loading]);

  // Leaving the section must not strand an unpublished theme on screen.
  useEffect(() => () => revertPalette(publishedRef.current), []);

  const assetsDirty = Object.keys(stagedAssets).length > 0;
  const dirty = !same(colors, published) || assetsDirty;
  const scale = useMemo(() => derivedScale(colors.primary, colors.accent), [colors]);
  const primaryLum = lum(colors.primary);
  const paleWarning = primaryLum !== null && primaryLum > 0.5;
  const activePreset = PRESETS.find((p) => same(p, colors));

  const set = (key, value) => setColors((prev) => ({ ...prev, [key]: value }));

  const applyPreset = (p) =>
    setColors({ primary: p.primary, secondary: p.secondary, accent: p.accent });

  /**
   * Publish everything staged, in one action.
   *
   * Assets go first: they have their own endpoints (the profile body cannot express a
   * deletion, since the server merges `assets` rather than replacing it). If one fails
   * the run stops and the rest stays staged, so nothing is silently half-applied and
   * Publish can simply be pressed again.
   */
  const save = async () => {
    if (!profile) return;
    if (colors.primary && !isHex(colors.primary)) {
      toastError('Primary must be a hex colour such as #2563eb.');
      return;
    }
    setSaving(true);
    try {
      let liveAssets = assets;
      for (const [type, dataUrl] of Object.entries(stagedAssets)) {
        setBusyAsset(type);
        const { data } = dataUrl
          ? await adminApi.uploadCompanyAsset(type, dataUrl)
          : await adminApi.deleteCompanyAsset(type);
        liveAssets = data?.assets || {};
      }
      setBusyAsset('');
      setAssets(liveAssets);
      setStagedAssets({});

      const next = { ...profile, colors: { ...(profile.colors || {}), ...colors } };
      await adminApi.publishCompanyProfile(next);
      setProfile(next);
      setPublished(colors);
      notifyBrandingChanged();
      toastSuccess('Appearance published');
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to publish');
    } finally {
      setBusyAsset('');
      setSaving(false);
    }
  };

  /**
   * Staging only — no request. The file is read to a data URL so it can be previewed
   * here, and nothing reaches the server or any other user until Publish.
   */
  const stageAsset = async (type, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_ASSET_BYTES) {
      toastError('Image is too large. Please choose one under 2 MB.');
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('read failed'));
      r.readAsDataURL(file);
    }).catch(() => '');
    if (!dataUrl) {
      toastError('Could not read that file.');
      return;
    }
    setStagedAssets((prev) => ({ ...prev, [type]: dataUrl }));
  };

  /**
   * Also staging only. A staged-but-unpublished upload is simply dropped; a published
   * asset is marked for deletion with `null` and removed when Publish runs.
   */
  const stageRemoval = (type) => {
    setStagedAssets((prev) => {
      const next = { ...prev };
      if (prev[type]) {
        delete next[type];
        return next;
      }
      if (assets[type]) next[type] = null;
      else delete next[type];
      return next;
    });
  };

  /**
    * Back to what the code ships: no stored palette, no uploaded assets.
    *
    * Staged like every other edit here — the colours revert on screen and the assets are
    * marked for removal, but nothing is written until Publish, so Discard still undoes it.
    */
  const resetAll = async () => {
    const ok = await confirmDialog({
      title: 'Reset appearance to defaults?',
      message: 'Clears the three brand colours and marks the logo, favicon, both signatures '
        + 'and the seal for removal. Nothing is applied until you press Publish.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    setColors({ primary: '', secondary: '', accent: '' });
    // Only stage a removal for assets that actually exist.
    setStagedAssets(Object.fromEntries(
      ASSET_META.filter((a) => assets[a.key]).map((a) => [a.key, null]),
    ));
  };

  const discard = async () => {
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'Returns to the published colours and drops any staged logo, signature or seal.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) {
      setColors(published);
      setStagedAssets({});
    }
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: 'Clear the colours?',
      message: 'Clears all three colours, so the app falls back to the palette in the stylesheet. Publish to apply.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (ok) setColors({ primary: '', secondary: '', accent: '' });
  };

  if (loading) return <div className="admin-loading">Loading theme…</div>;

  return (
    <section className="admin-panel ma-shell">
      <header className="ma-bar">
        <div>
          <p>
            One colour themes the whole application. Changes paint here immediately;
            nobody else sees them until you publish.
          </p>
        </div>
        <div className="ma-bar-actions">
          {dirty && <span className="ma-dirty">Unpublished</span>}
          <button type="button" className="ma-ghost" onClick={resetAll} disabled={saving}>
            <MdRestartAlt size={14} /> Reset
          </button>
          {dirty && (
            <button type="button" className="ma-ghost" onClick={discard} disabled={saving}>
              <MdClose size={14} /> Discard
            </button>
          )}
          <button
            type="button"
            className="it-updates-btn it-updates-btn-primary"
            onClick={save}
            disabled={saving || !dirty}
          >
            <MdSave size={16} /> {saving ? 'Publishing…' : dirty ? 'Publish' : 'Published'}
          </button>
        </div>
      </header>

      <div className="ma-split">
        <div className="ma-main">
          <h3 className="ma-h3"><MdImage size={16} /> Visual identity</h3>
          <p className="ma-note">
            Nothing is applied until you press Publish — a staged image is previewed here
            only. PNG with a transparent background works best. Maximum 2 MB.
          </p>
          <div className="ma-assets">
            {ASSET_META.map((a) => {
              const staged = Object.prototype.hasOwnProperty.call(stagedAssets, a.key);
              // A staged null means "delete on publish", so the box must read as empty.
              const src = staged ? stagedAssets[a.key] : assets[a.key];
              const busy = busyAsset === a.key;
              return (
                <div className="ma-asset" key={a.key}>
                  <span className="ma-asset-label">
                    {a.label}
                    {staged && (
                      <span className="ma-asset-pending">
                        {src ? 'New' : 'Removing'}
                      </span>
                    )}
                  </span>
                  <span className="ma-asset-hint">{a.hint}</span>
                  <div className={`ma-asset-box ${busy ? 'busy' : ''} ${staged ? 'staged' : ''}`}>
                    {src ? (
                      <>
                        <img src={src} alt={a.label} />
                        <button
                          type="button"
                          className="ma-asset-remove"
                          onClick={() => stageRemoval(a.key)}
                          disabled={busy || saving}
                          aria-label={`Remove ${a.label}`}
                        >
                          <MdDelete size={15} />
                        </button>
                      </>
                    ) : (
                      <label className="ma-asset-drop">
                        <MdCloudUpload size={22} />
                        <span>{busy ? 'Uploading…' : 'Choose'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          hidden
                          disabled={busy || saving}
                          onChange={(e) => { stageAsset(a.key, e.target.files?.[0]); e.target.value = ''; }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <h3 className="ma-h3"><MdPalette size={16} /> Preset themes</h3>
          <div className="ma-presets">
            {PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`ma-preset ${activePreset?.name === p.name ? 'active' : ''}`}
                onClick={() => applyPreset(p)}
                title={`${p.name} — ${p.primary}`}
              >
                <span className="ma-preset-swatches">
                  <span style={{ background: p.primary }} />
                  <span style={{ background: p.secondary }} />
                  <span style={{ background: p.accent }} />
                </span>
                <span className="ma-preset-name">{p.name}</span>
                {activePreset?.name === p.name && <MdCheck size={15} className="ma-preset-tick" />}
              </button>
            ))}
          </div>

          <h3 className="ma-h3">Colours</h3>
          <div className="ma-fields">
            {FIELDS.map((f) => (
              <ColorField key={f.key} field={f} value={colors[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>

          {paleWarning && (
            <p className="ma-warn">
              <MdWarningAmber size={15} />
              That primary is light. Button labels switch to dark text automatically, but
              check the samples on the right before publishing.
            </p>
          )}

          {scale && (
            <>
              <h3 className="ma-h3">Derived scale</h3>
              <p className="ma-note">
                Generated from the primary. Components use these directly, which is why one
                colour re-themes everything.
              </p>
              <div className="ma-scale">
                {['50', '100', '200', '300', '400', '500', '700'].map((k) => (
                  <div className="ma-scale-cell" key={k}>
                    <span style={{ background: scale[k] }} />
                    <em>{k}</em>
                  </div>
                ))}
                <div className="ma-scale-cell">
                  <span style={{ background: scale.accent }} />
                  <em>accent</em>
                </div>
                <div className="ma-scale-cell">
                  <span style={{ background: scale.surface, borderColor: 'var(--clr-slate-200)' }} />
                  <em>page</em>
                </div>
              </div>
            </>
          )}

          <div className="ma-foot">
            <span>Neutrals and success/warning/danger are never repainted — they carry text.</span>
            <button type="button" className="ma-link" onClick={clearAll}>
              <MdRestartAlt size={15} /> Clear the colours only
            </button>
          </div>
        </div>

        <aside className="ma-preview">
          <div className="ma-preview-label"><MdVisibility size={14} /> Samples</div>
          <div className="ma-sample">
            <button type="button" className="it-updates-btn it-updates-btn-primary ma-sample-btn">
              Primary button
            </button>
            <button type="button" className="it-updates-btn it-updates-btn-secondary ma-sample-btn">
              Secondary
            </button>
            <div className="ma-sample-chips">
              <span className="ma-chip">Chip</span>
              <span className="ma-chip solid">Active</span>
            </div>
            <div className="ma-sample-card">
              <div className="ma-sample-card-label">Total users</div>
              <div className="ma-sample-card-value">22</div>
            </div>
            <div className="ma-sample-nav">
              <span className="active">Selected nav</span>
              <span>Idle nav</span>
            </div>
            <a className="ma-sample-link" href="#appearance" onClick={(e) => e.preventDefault()}>
              A text link
            </a>
          </div>
          <p className="ma-preview-note">
            The console itself is repainted too, so the sidebar and buttons around you are
            already showing the draft theme. Current brand: {branding.company_name}.
          </p>
        </aside>
      </div>
    </section>
  );
}
