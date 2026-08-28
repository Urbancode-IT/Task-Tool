import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  MdEdit, MdDragIndicator, MdSave, MdRestartAlt, MdSearch, MdViewSidebar,
  MdSpaceDashboard, MdClose, MdVisibility, MdBadge, MdPublic, MdMarkEmailRead,
} from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { toastError, toastSuccess } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import {
  SECTOR_SIDEBARS, MODULE_LABELS, LABEL_DEFAULTS, sectionItem,
} from '../../branding/labels';
import { NAV_ICONS, NAV_ICON_NAMES } from '../../branding/navIcons';
import BrandIdentity, { identityFrom, sameIdentity, EMPTY_IDENTITY } from './BrandIdentity';
import DigitalPresence from './DigitalPresence';
import EmailSignatures from './EmailSignatures';
import {
  signaturesFrom, sameSignatures, pruneSignatures, EMPTY_SIGNATURES,
} from '../../utils/emailSignatures';
import {
  templatesFrom, sameTemplates, pruneTemplates, EMPTY_TEMPLATES,
} from '../../utils/mailTemplates';
import {
  presenceFrom, samePresence, presenceErrors, EMPTY_PRESENCE,
} from '../../utils/digitalPresence';
import { notifyBrandingChanged } from '../../branding/BrandingContext';
import './MasterBranding.css';

/* The icon a row previews: the override if set, else the coded default, else nothing. */
const previewIcon = (iconName, fallbackName) =>
  NAV_ICONS[iconName] || NAV_ICONS[fallbackName] || null;

/**
 * Coded default icon per label id, so a row can show what it looks like today and
 * "Reset" can return to it. Kept here rather than imported from each module: the
 * modules own their nav arrays, and importing seven feature files into the master
 * console just to read an icon would pull their whole dependency graphs in.
 */
const DEFAULT_ICON_NAMES = {
  'module.it_updates': 'MdFolderSpecial',
  'module.external_projects': 'MdPublic',
  'module.consultants': 'MdPeople',
  'module.creative_team': 'MdCampaign',
  'module.social_media': 'MdShare',
  'module.legal_finance': 'MdGavel',
  'module.admin': 'MdAdminPanelSettings',

  'section.home': 'MdHome',
  'section.dashboard': 'MdInsights',
  'section.my_dashboard': 'MdInsights',
  'section.my_tasks': 'MdChecklist',
  'section.all_tasks': 'MdViewKanban',
  'section.projects': 'MdFolder',
  'section.overview': 'MdTableChart',
  'section.eod_updates': 'MdOutlineAssignment',
  'section.calendar': 'MdCalendarMonth',
  'section.link_hub': 'MdLink',
  'section.client_crm': 'MdHandshake',

  'section.admin_dashboard': 'MdDashboard',
  'section.review_tasks': 'MdFactCheck',
  'section.overdue_tasks': 'MdPendingActions',
  'section.admin_overview': 'MdTableChart',
  'section.users': 'MdPeople',
  'section.departments': 'MdBusiness',
  'section.locked_users': 'MdLock',
  'section.invoices': 'MdReceiptLong',
  'section.credentials': 'MdVpnKey',
};

/**
 * One line of orientation per pane, shown under the console's own page title. Keyed by
 * group kind so a new pane cannot silently inherit another pane's description.
 */
const BAR_HINT = {
  identity: 'Who the company is. The name and tagline appear on the sign-in screen and the top bar.',
  presence: 'Public profile links for the company.',
  signatures: 'Subject, wording and sign-off for every mail Seyal sends.',
  sectors: 'Pick a list, edit an item, drag to reorder. The preview updates as you go.',
  sidebar: 'Pick a list, edit an item, drag to reorder. The preview updates as you go.',
};

/**
 * The brand name a reset falls back to. `company_name` is required by the server's
 * profile validator, so it cannot simply be blanked — this matches the coded fallback in
 * branding/BrandingContext.jsx and DEFAULT_BRAND in backend/mailer.js.
 */
const DEFAULT_COMPANY_NAME = 'Seyal';

const PICKER_W = 316;
const PICKER_H = 336;
const PICKER_GAP = 10;

/**
 * Where to put the panel: to the right of the trigger by preference, flipped left when
 * that would overflow, and clamped vertically so it always sits fully on screen.
 * Plain function, called from a click or a scroll handler — never during render.
 */
function placeFor(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = r.right + PICKER_GAP;
  if (left + PICKER_W > vw - 8) left = r.left - PICKER_W - PICKER_GAP;
  if (left < 8) left = Math.max(8, vw - PICKER_W - 8);
  let top = r.top;
  if (top + PICKER_H > vh - 8) top = Math.max(8, vh - PICKER_H - 8);
  return { top, left };
}

/**
 * Icon chooser, floated beside its trigger.
 *
 * Rendered through a portal with position: fixed rather than inline in the row, for
 * two reasons: an inline panel grew the row every time it opened, and an absolutely
 * positioned one would be clipped by the editor's scroll container.
 *
 * `pos` is measured by the parent's click handler and kept there, so this component
 * never reads a ref during render.
 */
function IconPicker({ anchorRef, pos, onMove, value, onPick, onUseDefault, onClose }) {
  const [query, setQuery] = useState('');
  const panelRef = useRef(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? NAV_ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : NAV_ICON_NAMES;
  }, [query]);

  useEffect(() => {
    // A fixed panel would drift from its trigger on scroll, so follow it. Capture
    // phase catches the editor's own scroll container, not just the window.
    const reposition = () => onMove();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onMove, onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="mb-picker"
      style={{ top: pos.top, left: pos.left, width: PICKER_W }}
      role="dialog"
      aria-label="Choose an icon"
    >
      <div className="mb-picker-head">
        <span>Choose an icon</span>
        <button type="button" onClick={onClose} aria-label="Close">
          <MdClose size={15} />
        </button>
      </div>
      <div className="mb-picker-search">
        <MdSearch size={16} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search icons"
          autoFocus
        />
      </div>
      <div className="mb-picker-grid">
        {shown.map((name) => {
          const Ico = NAV_ICONS[name];
          return (
            <button
              key={name}
              type="button"
              className={`mb-picker-item ${value === name ? 'selected' : ''}`}
              title={name}
              onClick={() => onPick(name)}
            >
              <Ico size={19} />
            </button>
          );
        })}
        {shown.length === 0 && <div className="mb-picker-empty">No icon matches “{query}”.</div>}
      </div>
      <div className="mb-picker-foot">
        <span>{shown.length} of {NAV_ICON_NAMES.length} icons</span>
        {onUseDefault && (
          <button type="button" className="mb-picker-reset" onClick={onUseDefault}>
            <MdRestartAlt size={14} /> Use default
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

/** One row in the editor: collapsed by default, expands to reveal the fields. */
/**
 * One draggable row: its icon, its display name, and nothing else.
 *
 * Both edits happen in place rather than in a panel that unfolds below the row. The
 * pencil turns the name into a text box; the icon opens the picker directly. The old
 * disclosure body meant two clicks and a jumping list to rename one item.
 */
function NavRow({ item, index, draft, expanded, onToggle, onChange, fallbackName }) {
  // Null when closed; the measured {top,left} when open.
  const [pickerPos, setPickerPos] = useState(null);
  const iconBtnRef = useRef(null);
  const inputRef = useRef(null);
  const pickerOpen = pickerPos !== null;
  const togglePicker = () => setPickerPos(pickerOpen ? null : placeFor(iconBtnRef.current));
  const closePicker = useCallback(() => setPickerPos(null), []);
  const movePicker = useCallback(() => setPickerPos(placeFor(iconBtnRef.current)), []);
  const codedIcon = DEFAULT_ICON_NAMES[item.id];
  const iconName = draft.icon || '';
  const Ico = previewIcon(iconName, codedIcon);
  const name = draft.label ?? '';
  const fallback = fallbackName || LABEL_DEFAULTS[item.id] || item.default;
  const customised = Boolean(name.trim() || iconName);

  // Focus and select on open, so the pencil lands the caret in the box ready to type.
  useEffect(() => {
    if (!expanded) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [expanded]);

  return (
    <Draggable draggableId={item.id} index={index}>
      {(drag, snap) => (
        <div
          ref={drag.innerRef}
          {...drag.draggableProps}
          className={'mb-row ' + (expanded ? 'editing ' : '') + (snap.isDragging ? 'dragging' : '')}
          title={item.id}
        >
          <div className="mb-row-head">
            <span
              className="mb-grip"
              {...drag.dragHandleProps}
              title="Drag to reorder"
              aria-label={'Reorder ' + fallback}
            >
              <MdDragIndicator size={20} />
            </span>

            <button
              ref={iconBtnRef}
              type="button"
              className={'mb-row-icon ' + (pickerOpen ? 'open' : '')}
              onClick={togglePicker}
              aria-expanded={pickerOpen}
              title={'Change the icon for ' + fallback}
            >
              {Ico ? <Ico size={18} /> : <span className="mb-row-noicon" />}
            </button>

            {expanded ? (
              <input
                ref={inputRef}
                className="mb-row-input"
                value={name}
                placeholder={fallback}
                aria-label={'Display name for ' + fallback}
                onChange={(e) => onChange({ label: e.target.value })}
                // Enter and Escape both just leave the box: every keystroke is already
                // in the draft, and Publish is what actually applies it.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    onToggle();
                  }
                }}
                onBlur={onToggle}
              />
            ) : (
              <span className="mb-row-name">{name.trim() || fallback}</span>
            )}

            {customised && !expanded && <span className="mb-row-tag">edited</span>}

            <button
              type="button"
              className="mb-row-editbtn"
              // Blur fires before click, so by the time this runs the row has already
              // closed — which reads as a plain toggle either way.
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggle}
              title={expanded ? 'Done' : 'Rename ' + fallback}
              aria-label={expanded ? 'Done editing' : 'Rename ' + fallback}
            >
              <MdEdit size={17} />
            </button>
          </div>

          {pickerOpen && (
            <IconPicker
              anchorRef={iconBtnRef}
              pos={pickerPos}
              onMove={movePicker}
              value={iconName || codedIcon}
              onPick={(n) => { onChange({ icon: n }); closePicker(); }}
              onUseDefault={iconName ? () => { onChange({ icon: '' }); closePicker(); } : null}
              onClose={closePicker}
            />
          )}
        </div>
      )}
    </Draggable>
  );
}

/** One entry in the nested sidebar. */
function SideItem({ group, active, editedCount, onSelect }) {
  const Icon = group.icon;
  return (
    <button
      type="button"
      className={`mb-side-item ${active ? 'active' : ''}`}
      onClick={onSelect}
    >
      <Icon size={17} className="mb-side-icon" />
      <span className="mb-side-name">{group.title}</span>
      {editedCount > 0 && <span className="mb-side-dot" title={`${editedCount} customised`} />}
      {/* Identity is a form, not a list, so it carries no count. */}
      {group.items.length > 0 && <span className="mb-side-count">{group.items.length}</span>}
    </button>
  );
}

/**
 * Master console → Company & Branding.
 *
 * Three columns: pick a list on the left, edit it in the middle, and see the result
 * on the right. The preview renders from the unsaved draft, so a drag or a rename
 * shows immediately rather than only after publishing.
 */
export default function MasterBranding() {
  const [profile, setProfile] = useState(null);
  const [labels, setLabels] = useState({});
  const [icons, setIcons] = useState({});
  const [order, setOrder] = useState({});
  // { 'module.creative_team': { labels: {...}, icons: {...} } } — a section's name and
  // icon live under the sector that shows it, so two sectors can differ.
  const [bySector, setBySector] = useState({});
  const [selected, setSelected] = useState('identity');
  // Identity and navigation share one profile and one Publish, so editing both in a
  // single visit cannot have one overwrite the other.
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [savedIdentity, setSavedIdentity] = useState(EMPTY_IDENTITY);
  const [presence, setPresence] = useState(EMPTY_PRESENCE);
  const [savedPresence, setSavedPresence] = useState(EMPTY_PRESENCE);
  const [signatures, setSignatures] = useState(EMPTY_SIGNATURES);
  const [savedSignatures, setSavedSignatures] = useState(EMPTY_SIGNATURES);
  const [templates, setTemplates] = useState(EMPTY_TEMPLATES);
  const [savedTemplates, setSavedTemplates] = useState(EMPTY_TEMPLATES);
  const [openRow, setOpenRow] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getCompanyProfile();
      const p = data?.data || data || {};
      // dbPublishCompanyProfile merges the body's `assets` over the stored blob, so
      // carrying a snapshot taken at load would resurrect an asset deleted from
      // Appearance in the meantime.
      const { assets: _assets, ...profileWithoutAssets } = p;
      setProfile(profileWithoutAssets);
      setLabels({ ...(p.labels || {}) });
      setIcons({ ...(p.navigation?.icons || {}) });
      setOrder({ ...(p.navigation?.order || {}) });
      setBySector({ ...(p.navigation?.bySector || {}) });
      const id = identityFrom(p);
      setIdentity(id);
      setSavedIdentity(id);
      const pres = presenceFrom(p);
      setPresence(pres);
      setSavedPresence(pres);
      const sig = signaturesFrom(p);
      setSignatures(sig);
      setSavedSignatures(sig);
      const tpl = templatesFrom(p);
      setTemplates(tpl);
      setSavedTemplates(tpl);
      setDirty(false);
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to load the company profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const nameOf = useCallback((id) => labels[id] || LABEL_DEFAULTS[id] || id, [labels]);

  // Sidebar entries: the top bar first, then one per sector, each showing its own
  // icon and name so the list mirrors the product's actual top bar.
  const groups = useMemo(
    () => [
      {
        key: 'identity',
        title: 'Brand identity',
        subtitle: 'Name, tagline, purpose and values',
        icon: MdBadge,
        items: [],
        kind: 'identity',
      },
      {
        key: 'presence',
        title: 'Digital presence',
        subtitle: 'Public profile links',
        icon: MdPublic,
        items: [],
        kind: 'presence',
      },
      {
        key: 'signatures',
        title: 'Email templates',
        subtitle: 'Subject, body and sign-off per mail',
        icon: MdMarkEmailRead,
        items: [],
        kind: 'signatures',
      },
      {
        key: 'sectors',
        title: 'Sectors',
        subtitle: 'Order and names of the top bar',
        icon: MdSpaceDashboard,
        items: MODULE_LABELS,
        kind: 'sectors',
      },
      ...SECTOR_SIDEBARS.map((s) => ({
        key: s.sector,
        title: nameOf(s.sector),
        subtitle: 'Sidebar shown inside this sector',
        icon: NAV_ICONS[icons[s.sector] || DEFAULT_ICON_NAMES[s.sector]] || MdViewSidebar,
        items: s.sections.map(sectionItem),
        kind: 'sidebar',
      })),
    ],
    [nameOf, icons]
  );

  const group = groups.find((g) => g.key === selected) || groups[0];

  /**
   * Draft values for one row. The top bar list edits sectors, which sit outside any
   * sector and so use the shared maps; every other list edits sections inside one
   * sector and reads and writes that sector's own map.
   */
  const draftFor = useCallback(
    (id) =>
      group.kind === 'sectors'
        ? { label: labels[id] ?? '', icon: icons[id] ?? '' }
        : {
            label: bySector[group.key]?.labels?.[id] ?? '',
            icon: bySector[group.key]?.icons?.[id] ?? '',
          },
    [group, labels, icons, bySector]
  );

  /** What a row reads if its override is cleared. */
  const fallbackFor = useCallback(
    (id) => (group.kind === 'sectors' ? LABEL_DEFAULTS[id] : labels[id] || LABEL_DEFAULTS[id]) || id,
    [group, labels]
  );

  const orderedItems = useCallback(
    (g) => {
      const saved = Array.isArray(order[g.key]) ? order[g.key] : [];
      if (!saved.length) return g.items;
      const rank = new Map(saved.map((id, i) => [id, i]));
      return g.items
        .map((item, i) => ({ item, i, r: rank.has(item.id) ? rank.get(item.id) : Infinity }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.item);
    },
    [order]
  );

  const editedIn = useCallback(
    (g) => {
      if (g.kind === 'sectors') return g.items.filter((i) => labels[i.id] || icons[i.id]).length;
      const cfg = bySector[g.key];
      if (!cfg) return 0;
      return g.items.filter((i) => cfg.labels?.[i.id] || cfg.icons?.[i.id]).length;
    },
    [labels, icons, bySector]
  );

  /** Total pending overrides across every list, for the header count. */
  const totalEdits = useMemo(() => {
    const sectorIds = new Set(MODULE_LABELS.map((m) => m.id));
    const shared = new Set([...Object.keys(labels), ...Object.keys(icons)]);
    let n = [...shared].filter((k) => sectorIds.has(k)).length;
    for (const cfg of Object.values(bySector)) {
      n += new Set([...Object.keys(cfg.labels || {}), ...Object.keys(cfg.icons || {})]).size;
    }
    return n + Object.keys(order).length;
  }, [labels, icons, bySector, order]);

  const onDragEnd = (result) => {
    const { source, destination } = result;
    if (!destination || destination.index === source.index) return;
    const ids = orderedItems(group).map((i) => i.id);
    const [moved] = ids.splice(source.index, 1);
    ids.splice(destination.index, 0, moved);
    setOrder((prev) => ({ ...prev, [group.key]: ids }));
    setDirty(true);
  };

  const changeRow = (id, patch) => {
    if (group.kind === 'sectors') {
      if ('label' in patch) {
        setLabels((prev) => {
          const next = { ...prev };
          if (patch.label.trim()) next[id] = patch.label;
          else delete next[id];
          return next;
        });
      }
      if ('icon' in patch) {
        setIcons((prev) => {
          const next = { ...prev };
          if (patch.icon) next[id] = patch.icon;
          else delete next[id];
          return next;
        });
      }
    } else {
      setBySector((prev) => {
        const sector = group.key;
        const cur = prev[sector] || { labels: {}, icons: {} };
        const nextLabels = { ...(cur.labels || {}) };
        const nextIcons = { ...(cur.icons || {}) };
        if ('label' in patch) {
          if (patch.label.trim()) nextLabels[id] = patch.label;
          else delete nextLabels[id];
        }
        if ('icon' in patch) {
          if (patch.icon) nextIcons[id] = patch.icon;
          else delete nextIcons[id];
        }
        const next = { ...prev };
        // Drop the sector entirely once it holds nothing, so the payload stays lean.
        if (Object.keys(nextLabels).length || Object.keys(nextIcons).length) {
          next[sector] = { labels: nextLabels, icons: nextIcons };
        } else {
          delete next[sector];
        }
        return next;
      });
    }
    setDirty(true);
  };

  const save = async () => {
    if (!profile) return;
    const badLinks = presenceErrors(presence);
    if (badLinks.length) {
      toastError(`Fix these links before publishing: ${badLinks.join(', ')}.`);
      return;
    }
    setSaving(true);
    try {
      // Overrides identical to the audience default are dropped, so a pre-filled box the
      // user never edited keeps inheriting instead of being frozen. Computed once and
      // used for the body, the working state and the baseline alike — pruning only the
      // baseline would leave the form reading "Unpublished" for ever.
      const cleanSignatures = pruneSignatures(signatures);
      // Same reasoning for templates: a field left at the shipped wording is not stored,
      // so the mail keeps following the default if that default ever changes.
      const cleanTemplates = pruneTemplates(templates);
      // Merge over the loaded profile so nothing outside navigation is disturbed.
      const next = {
        ...profile,
        ...identity,
        social: { ...(profile.social || {}), ...presence },
        ...cleanSignatures,
        email_templates_by_mail: cleanTemplates,
        labels,
        navigation: { ...(profile.navigation || {}), icons, order, bySector },
      };
      await adminApi.publishCompanyProfile(next);
      setProfile(next);
      setSavedIdentity(identity);
      setSavedPresence(presence);
      setSignatures(cleanSignatures);
      setSavedSignatures(cleanSignatures);
      setTemplates(cleanTemplates);
      setSavedTemplates(cleanTemplates);
      setDirty(false);
      // Tell every mounted BrandingProvider to refetch, so the change is live at once.
      notifyBrandingChanged();
      toastSuccess('Navigation published');
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to publish');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'Reloads the published navigation and throws away everything unpublished.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) load();
  };

  /**
   * Everything this section owns, back to what the code ships: identity, brand kit,
   * digital presence, mail templates and sign-offs, and every navigation override.
   *
   * Staged, not applied — Publish is still what writes it, and Discard reloads the
   * published profile, so a reset pressed by mistake costs nothing.
   */
  const resetAll = async () => {
    const ok = await confirmDialog({
      title: 'Reset Company & Branding to defaults?',
      message: 'Clears the brand identity and kit, the digital presence links, every mail '
        + `template and sign-off, and all navigation renames, icons and ordering. The brand `
        + `name returns to "${DEFAULT_COMPANY_NAME}" because it cannot be left blank. `
        + 'Nothing is applied until you press Publish.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    setIdentity({ ...EMPTY_IDENTITY, company_name: DEFAULT_COMPANY_NAME });
    setPresence(EMPTY_PRESENCE);
    setSignatures(EMPTY_SIGNATURES);
    setTemplates(EMPTY_TEMPLATES);
    setLabels({});
    setIcons({});
    setOrder({});
    setBySector({});
    // Navigation dirtiness is tracked separately from the form state.
    setDirty(true);
  };

  const resetGroup = async () => {
    const ok = await confirmDialog({
      title: `Reset ${group.title}?`,
      message: 'Clears every name, icon and order override for this list. Publish to apply.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    if (group.kind === 'sectors') {
      const ids = new Set(group.items.map((i) => i.id));
      setLabels((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.has(k))));
      setIcons((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !ids.has(k))));
    } else {
      setBySector((prev) => {
        const next = { ...prev };
        delete next[group.key];
        return next;
      });
    }
    setOrder((prev) => {
      const next = { ...prev };
      delete next[group.key];
      return next;
    });
    setDirty(true);
  };

  if (loading) return <div className="admin-loading">Loading navigation…</div>;

  const identityDirty = !sameIdentity(identity, savedIdentity)
    || !samePresence(presence, savedPresence)
    || !sameSignatures(signatures, savedSignatures)
    || !sameTemplates(templates, savedTemplates);
  const anyDirty = dirty || identityDirty;
  const items = orderedItems(group);
  const reordered = Array.isArray(order[group.key]) && order[group.key].length > 0;
  const q = filter.trim().toLowerCase();
  // Filtering hides rows but must not enable a drag that would reorder a partial list.
  const shown = q
    ? items.filter((i) => {
        const d = draftFor(i.id);
        return (d.label || fallbackFor(i.id)).toLowerCase().includes(q);
      })
    : items;
  const select = (key) => { setSelected(key); setOpenRow(null); setFilter(''); };

  return (
    <section className="admin-panel mb-shell">
      <header className="mb-bar">
        {/* No heading here: the console shell already renders the section name, and
            each pane carries its own title. */}
        <div className="mb-bar-text">
          <p>{BAR_HINT[group.kind] || BAR_HINT.sidebar}</p>
        </div>
        <div className="mb-bar-actions">
          {group.kind !== 'identity' && totalEdits > 0 && (
            <span className="mb-count">{totalEdits} override{totalEdits === 1 ? '' : 's'}</span>
          )}
          <button type="button" className="mb-discard" onClick={resetAll} disabled={saving}>
            <MdRestartAlt size={14} /> Reset
          </button>
          {anyDirty && (
            <button type="button" className="mb-discard" onClick={discard} disabled={saving}>
              <MdClose size={14} /> Discard
            </button>
          )}
          <button
            type="button"
            className="it-updates-btn it-updates-btn-primary"
            onClick={save}
            disabled={saving || !anyDirty}
          >
            <MdSave size={16} /> {saving ? 'Publishing…' : anyDirty ? 'Publish' : 'Published'}
          </button>
        </div>
      </header>

      <div className="mb-split">
        <nav className="mb-side">
          <div className="mb-side-label">Identity</div>
          {groups.filter((g) => ['identity', 'presence', 'signatures'].includes(g.kind)).map((g) => (
            <SideItem
              key={g.key}
              group={g}
              active={selected === g.key}
              editedCount={0}
              onSelect={() => select(g.key)}
            />
          ))}

          <div className="mb-side-label">Top bar</div>
          {groups.filter((g) => g.kind === 'sectors').map((g) => (
            <SideItem
              key={g.key}
              group={g}
              active={selected === g.key}
              editedCount={editedIn(g)}
              onSelect={() => select(g.key)}
            />
          ))}
          <div className="mb-side-label">Sidebar per sector</div>
          {groups.filter((g) => g.kind === 'sidebar').map((g) => (
            <SideItem
              key={g.key}
              group={g}
              active={selected === g.key}
              editedCount={editedIn(g)}
              onSelect={() => select(g.key)}
            />
          ))}
        </nav>

        {group.kind === 'identity' ? (
          <div className="mb-editor mb-editor-wide">
            <BrandIdentity value={identity} onChange={setIdentity} />
          </div>
        ) : group.kind === 'presence' ? (
          <div className="mb-editor mb-editor-wide">
            <DigitalPresence value={presence} onChange={setPresence} />
          </div>
        ) : group.kind === 'signatures' ? (
          <div className="mb-editor mb-editor-wide">
            {/* The preview merges in the company name, phone and website, so it needs
                the loaded profile as well as the templates. */}
            <EmailSignatures
              value={signatures}
              onChange={setSignatures}
              templates={templates}
              onTemplatesChange={setTemplates}
              company={{ ...profile, ...identity }}
            />
          </div>
        ) : (
          <>
          <div className="mb-editor">
            <div className="mb-editor-head">
              <div>
                <h3>{group.title}</h3>
                <p>
                  {group.subtitle} · {items.length} item{items.length === 1 ? '' : 's'}
                  {reordered && ' · custom order'}
                </p>
              </div>
              {items.length > 6 && (
                <div className="mb-filter">
                  <MdSearch size={15} />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter"
                    onKeyDown={(e) => { if (e.key === 'Escape') setFilter(''); }}
                  />
                  {filter && (
                    <button type="button" onClick={() => setFilter('')} aria-label="Clear filter">
                      <MdClose size={14} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {q && (
              <p className="mb-filter-note">
                Showing {shown.length} of {items.length}. Clear the filter to drag and reorder.
              </p>
            )}

            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId={group.key} isDropDisabled={Boolean(q)}>
                {(drop) => (
                  <div ref={drop.innerRef} {...drop.droppableProps} className="mb-list">
                    {shown.map((item) => (
                      <NavRow
                        key={item.id}
                        item={item}
                        index={items.indexOf(item)}
                        expanded={openRow === item.id}
                        draft={draftFor(item.id)}
                        fallbackName={fallbackFor(item.id)}
                        onToggle={() => setOpenRow(openRow === item.id ? null : item.id)}
                        onChange={(patch) => changeRow(item.id, patch)}
                      />
                    ))}
                    {drop.placeholder}
                    {shown.length === 0 && (
                      <div className="admin-empty">Nothing matches “{filter}”.</div>
                    )}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

            <footer className="mb-editor-foot">
              <span>
                {group.kind === 'sectors'
                  ? 'Sets the left-to-right order of the top bar.'
                  : 'Names, icons and order here apply to this sector only.'}
              </span>
              <button type="button" className="mb-link-btn mb-link-danger" onClick={resetGroup}>
                <MdRestartAlt size={15} /> Reset this list
              </button>
            </footer>
          </div>

          <aside className="mb-preview">
            <div className="mb-preview-label">
              <MdVisibility size={14} /> Preview
            </div>
            <div className={`mb-preview-box ${group.kind === 'sectors' ? 'topbar' : 'sidebar'}`}>
              {items.map((item) => {
                const d = draftFor(item.id);
                const Ico = previewIcon(d.icon, DEFAULT_ICON_NAMES[item.id]);
                return (
                  <div className="mb-preview-item" key={item.id}>
                    {Ico ? <Ico size={16} /> : <span className="mb-row-noicon" />}
                    <span>{d.label?.trim() || fallbackFor(item.id)}</span>
                  </div>
                );
              })}
            </div>
            <p className="mb-preview-note">
              {group.kind === 'sectors'
                ? 'How the top bar will read, left to right.'
                : 'How this sector’s sidebar will read, top to bottom.'}
            </p>
          </aside>
          </>
        )}
      </div>
    </section>
  );
}
