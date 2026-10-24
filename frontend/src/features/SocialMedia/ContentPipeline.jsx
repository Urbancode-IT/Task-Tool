import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdAssignment,
  MdCheckCircle,
  MdClose,
  MdDelete,
  MdCloudUpload,
  MdEditNote,
  MdExpandLess,
  MdExpandMore,
  MdFactCheck,
  MdFileDownload,
  MdMoreVert,
  MdMovie,
  MdOpenInNew,
  MdPalette,
  MdScheduleSend,
  MdSearch,
  MdStorefront,
  MdVerified,
  MdWebStories,
} from 'react-icons/md';
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaYoutube,
} from 'react-icons/fa';
import { SiGoogleads, SiMeta } from 'react-icons/si';
import itUpdatesApi from '../../api/itUpdatesApi';
import useDebouncedValue from '../../utils/useDebouncedValue';
import { confirmDialog, reasonDialog } from '../../utils/confirm';
import { toastError, toastSuccess } from '../../utils/toast';
import {
  ACTION_LABELS,
  STAGES,
  STATUS_META,
  POSTING_CHANNELS,
  actionsFor,
  channelPostUrl,
  contentKindLabel,
  defaultPostAssignees,
  findPersonByHint,
  formatDisplayDate,
  formatWhen,
  dueLabel,
  hasContentDemo,
  isContentOverdue,
  isPostingColumn,
  isPostingOpen,
  sheetRows,
  stageMeta,
  statusMeta,
  toneStyle,
} from './contentModel';
import './ContentPipeline.css';

const STAGE_ICONS = {
  requirement: MdAssignment,
  content_generation: MdEditNote,
  content_approval: MdFactCheck,
  designing_editing: MdPalette,
  save_to_drive: MdCloudUpload,
  final_approval: MdVerified,
  ready_to_post: MdScheduleSend,
  published: MdCheckCircle,
};

const CHANNEL_ICONS = {
  instagram_post: FaInstagram,
  instagram_story: MdWebStories,
  instagram_reel: MdMovie,
  facebook_post: FaFacebook,
  facebook_story: MdWebStories,
  meta_ads: SiMeta,
  google_ads: SiGoogleads,
  youtube: FaYoutube,
  linkedin: FaLinkedin,
  gmb: MdStorefront,
};

const WORKFLOW_BOARD = STAGES.filter(
  (stage) => !['requirement', 'ready_to_post', 'published'].includes(stage.key),
);

const BOARD_COLUMNS = [
  ...WORKFLOW_BOARD,
  ...POSTING_CHANNELS.map((item) => ({
    key: item.value,
    label: item.label,
    color: item.color,
    short: item.label,
    posting: true,
  })),
];

const PINNED_COLUMNS = BOARD_COLUMNS.filter((column) => column.key === 'content_generation');
const SCROLL_COLUMNS = BOARD_COLUMNS.filter((column) => column.key !== 'content_generation');

function columnIcon(key) {
  if (CHANNEL_ICONS[key]) return CHANNEL_ICONS[key];
  return STAGE_ICONS[key] || MdCheckCircle;
}

function branchName(code) {
  return code || 'Branch not set';
}

function typeName(task, types = []) {
  const code = String(task?.content_type || '').toLowerCase();
  const fetched = types.find((item) => item.code === code)?.label;
  if (fetched) return fetched;
  return contentKindLabel(task);
}

function BranchField({ label = 'Branch', value, branches, onChange, required = false }) {
  const extra = value && !branches.some((item) => item.code === value) ? [{ code: value }] : [];
  return (
    <label className="smc-field">{label}
      <select value={value || ''} required={required} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select branch</option>
        {[...branches, ...extra].map((item) => (
          <option key={item.code} value={item.code}>{item.code}</option>
        ))}
      </select>
    </label>
  );
}

/** Compact searchable select for board cells (Category / Course). */
function RowSearchSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select…',
  ariaLabel,
  disabled = false,
  addLabel,
  onAdd,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [menuBox, setMenuBox] = useState(null);
  const wrapRef = useRef(null);
  const selected = options.find((item) => String(item.value) === String(value));
  const display = open ? draft : (selected?.label || '');

  const placeMenu = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, 200);
    const left = Math.min(rect.left, window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 240 && rect.top > spaceBelow;
    setMenuBox({
      top: openUp ? undefined : rect.bottom + 4,
      bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
      left: Math.max(8, left),
      width,
    });
  };

  useEffect(() => {
    const onDoc = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)
        && !event.target.closest?.('.smc-row-search-menu')) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    placeMenu();
    const onMove = () => placeMenu();
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q || q === String(selected?.label || '').toLowerCase()) return options;
    return options.filter((item) => String(item.label).toLowerCase().includes(q));
  }, [options, draft, selected?.label]);

  const pick = (nextValue, nextLabel) => {
    onChange(nextValue);
    setDraft(nextLabel || '');
    setOpen(false);
  };

  return (
    <div className={`smc-row-search${open ? ' open' : ''}${disabled ? ' disabled' : ''}`} ref={wrapRef}>
      <div className="smc-row-search-field">
        <MdSearch size={14} className="smc-row-search-icon" />
        <input
          type="text"
          value={display}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
            placeMenu();
          }}
          onFocus={() => {
            if (disabled) return;
            setDraft(selected?.label || '');
            setOpen(true);
            placeMenu();
          }}
        />
      </div>
      {open && !disabled && menuBox && (
        <ul
          className="smc-row-search-menu smc-row-search-menu--fixed"
          role="listbox"
          style={{
            top: menuBox.top,
            bottom: menuBox.bottom,
            left: menuBox.left,
            width: menuBox.width,
          }}
        >
          <li>
            <button
              type="button"
              className={!value ? 'active' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                pick('', '');
              }}
            >
              {placeholder}
            </button>
          </li>
          {matches.map((item) => (
            <li key={String(item.value)}>
              <button
                type="button"
                className={String(value) === String(item.value) ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(item.value, item.label);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="smc-row-search-empty">No matches</li>}
          {addLabel && onAdd ? (
            <li className="smc-row-search-add">
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  onAdd(draft.trim());
                }}
              >
                <MdAdd size={15} /> {addLabel}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function CourseEditorModal({
  mode,
  category = '',
  initialCourse = '',
  busy = false,
  onClose,
  onSubmit,
}) {
  const [courseType, setCourseType] = useState(category || '');
  const [courseName, setCourseName] = useState(initialCourse || '');
  const isCategory = mode === 'category';
  const title = isCategory ? 'Add category' : 'Add course';

  return (
    <div className="smc-overlay center middle" onMouseDown={onClose}>
      <div
        className="smc-modal smc-course-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smc-course-editor-title"
      >
        <div className="smc-modal-head">
          <div>
            <h2 id="smc-course-editor-title">{title}</h2>
            <p className="smc-kicker">
              {isCategory
                ? 'Create a category and its first course'
                : `New course under ${category || 'this category'}`}
            </p>
          </div>
          <button type="button" className="smc-icon-btn" onClick={onClose} aria-label="Close"><MdClose /></button>
        </div>
        <form
          className="smc-course-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({
              course_type: String(courseType || category || '').trim(),
              course_name: String(courseName || '').trim(),
            });
          }}
        >
          {isCategory ? (
            <label className="smc-field wide">Category
              <input
                autoFocus
                value={courseType}
                onChange={(event) => setCourseType(event.target.value)}
                placeholder="e.g. Fullstack Development"
                required
              />
            </label>
          ) : (
            <div className="smc-course-category-chip">
              <span>Category</span>
              <strong>{category}</strong>
            </div>
          )}
          <label className="smc-field wide">Course name
            <input
              autoFocus={!isCategory}
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              placeholder="e.g. Python full stack"
              required
            />
          </label>
          <div className="smc-actions">
            <button type="submit" className="smc-btn smc-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : isCategory ? 'Add category' : 'Add course'}
            </button>
            <button type="button" className="smc-btn" onClick={onClose} disabled={busy}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FilterSearch({
  value = '',
  onChange,
  options = [],
  allLabel = 'All',
  placeholder = 'Search…',
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const wrapRef = useRef(null);
  const selected = options.find((item) => String(item.value) === String(value));
  const display = open ? draft : (selected?.label || '');

  useEffect(() => {
    const onDoc = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q || q === String(selected?.label || '').toLowerCase()) return options;
    return options.filter((item) => String(item.label).toLowerCase().includes(q));
  }, [options, draft, selected?.label]);

  return (
    <div className={`smc-filter-search${open ? ' open' : ''}`} ref={wrapRef}>
      <div className="smc-filter-search-field">
        <MdSearch size={15} className="smc-filter-search-icon" />
        <input
          type="text"
          value={display}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          onChange={(event) => {
            setDraft(event.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setDraft(selected?.label || '');
            setOpen(true);
          }}
        />
        {(value || (open && draft)) ? (
          <button
            type="button"
            className="smc-filter-search-clear"
            aria-label="Clear"
            onClick={() => {
              onChange('');
              setDraft('');
              setOpen(false);
            }}
          >
            <MdClose size={14} />
          </button>
        ) : null}
      </div>
      {open && (
        <ul className="smc-filter-search-menu" role="listbox">
          <li>
            <button
              type="button"
              className={!value ? 'active' : ''}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange('');
                setDraft('');
                setOpen(false);
              }}
            >
              {allLabel}
            </button>
          </li>
          {matches.map((item) => (
            <li key={String(item.value)}>
              <button
                type="button"
                className={String(value) === String(item.value) ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange(item.value);
                  setDraft(item.label);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="smc-filter-search-empty">No matches</li>}
        </ul>
      )}
    </div>
  );
}

function isPreviewImage(file) {
  return String(file?.mime || '').startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(file?.name || '');
}

function isPreviewVideo(file) {
  return String(file?.mime || '').startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file?.name || '');
}

function DriveFilePreview({ taskId, file, localUrl }) {
  const image = isPreviewImage(file);
  const video = !image && isPreviewVideo(file);
  const [src, setSrc] = useState(localUrl || '');

  useEffect(() => {
    if (localUrl) {
      setSrc(localUrl);
      return undefined;
    }
    if (!image && !video) return undefined;
    let url = '';
    let active = true;
    itUpdatesApi.getSocialContentFile(taskId, file.id)
      .then((res) => {
        url = URL.createObjectURL(res.data);
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [taskId, file.id, image, video, localUrl]);

  if (!image && !video) return null;
  if (!src) return <span className="smc-drive-file-wait">…</span>;
  if (video) return <video className="smc-drive-preview" src={src} muted playsInline />;
  return <img className="smc-drive-preview" src={src} alt="" />;
}

function fileLabel(file, onlyStage) {
  if (onlyStage === 'designing_editing' || file?.kind === 'final') return 'Design';
  if (file?.kind === 'reference') return 'Reference';
  if (file?.kind === 'rework') return 'Rework';
  if (file?.kind === 'poster' || file?.kind === 'image') return 'Design';
  return 'File';
}

function fileKind(file) {
  const mime = String(file?.type || '').toLowerCase();
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime === 'application/pdf') return 'media';
  return '';
}

function driveFolderHint(task) {
  const branch = String(task?.content_branch || '').trim();
  const brand = /^jz/i.test(branch) ? 'JZ' : /^uc/i.test(branch) ? 'UC' : 'UC or JZ';
  const type = String(task?.content_type || '').toLowerCase();
  const folder = type === 'poster' ? 'Posters'
    : type === 'website' ? 'Website'
    : type === 'reel' ? 'Reels'
    : type === 'ad' ? 'Ads'
    : type === 'carousel' ? 'Carousels'
    : type === 'gmb' ? 'GMB'
    : 'the type folder';
  const date = String(task?.production?.sheet_date || task?.due_date || '').slice(0, 10);
  const year = /^\d{4}/.test(date) ? date.slice(0, 4) : String(new Date().getFullYear());
  return `${year} / ${brand} / ${folder}`;
}

function isDesignFile(file) {
  return file?.stage === 'designing_editing' || file?.kind === 'final';
}

function DriveUploads({ task, onTask, onlyStage = '', readOnly = false }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const localPreviews = useRef(new Map());
  const storedFiles = Array.isArray(task?.production?.drive_files) ? task.production.drive_files : [];
  const files = storedFiles.filter((file) => {
    if (!onlyStage) return true;
    if (file.stage === onlyStage) return true;
    return onlyStage === 'content_generation' && !file.stage && !isDesignFile(file);
  });
  const folder = task?.production?.drive_folder_url || '';

  useEffect(() => () => {
    localPreviews.current.forEach((url) => URL.revokeObjectURL(url));
    localPreviews.current.clear();
  }, []);

  const upload = async (list) => {
    if (readOnly) return;
    const chosen = [...(list || [])];
    if (!chosen.length) return;
    setError('');
    const tooBig = chosen.find((file) => file.size > 20 * 1024 * 1024);
    if (tooBig) {
      setError('Each file must be 20 MB or smaller.');
      return;
    }
    const unsupported = chosen.find((file) => !fileKind(file));
    if (unsupported) {
      setError('Drop an image, PDF, or video.');
      return;
    }
    setBusy(true);
    let current = task;
    try {
      for (let index = 0; index < chosen.length; index += 1) {
        const file = chosen[index];
        const report = (loadedPercent) => {
          if (loadedPercent == null) {
            setProgress({ name: file.name, index: index + 1, count: chosen.length, percent: null, saving: true });
            return;
          }
          const saving = loadedPercent >= 100;
          const portion = Math.min(95, loadedPercent);
          const percent = Math.round(((index + portion / 100) / chosen.length) * 100);
          setProgress({ name: file.name, index: index + 1, count: chosen.length, percent, saving });
        };
        report(0);
        const previousIds = new Set((current?.production?.drive_files || []).map((item) => item.id));
        const { data } = await itUpdatesApi.uploadSocialContentFile(current, fileKind(file), file, report, onlyStage);
        const added = (data?.production?.drive_files || []).find((item) => !previousIds.has(item.id));
        if (added && /^(image|video)\//.test(file.type || '')) {
          localPreviews.current.set(added.id, URL.createObjectURL(file));
          setPreviewVersion((value) => value + 1);
        }
        current = data;
        onTask?.(data);
        setProgress({
          name: file.name,
          index: index + 1,
          count: chosen.length,
          percent: Math.round(((index + 1) / chosen.length) * 100),
          saving: false,
        });
      }
      toastSuccess('Saved to Drive');
    } catch (err) {
      const message = err?.response?.data?.message || 'Could not upload to Drive.';
      setError(message);
      toastError(message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const remove = async (file) => {
    if (readOnly) return;
    if (!(await confirmDialog({
      title: 'Remove this file?',
      message: file.name || 'It will be removed from Drive.',
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    setBusy(true);
    try {
      const { data } = await itUpdatesApi.removeSocialContentFile(task.id, file.id);
      onTask?.(data);
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not remove the file.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="smc-drive-box">
      <p className="smc-note">
        {onlyStage === 'designing_editing'
          ? `Upload the design here. It is saved in DM Root, then ${driveFolderHint(task)}.`
          : 'Files added in this step are shown here.'}
      </p>
      {!readOnly ? (
        <label
          className={`smc-drive-drop${dragOver ? ' over' : ''}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            if (!busy) upload(event.dataTransfer.files);
          }}
        >
          <MdCloudUpload size={28} />
          {progress ? (
            <div
              className="smc-drive-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent ?? undefined}
              aria-label={`Uploading ${progress.name}`}
            >
              <div className="smc-drive-progress-meta">
                <span>{progress.name}</span>
                <span>{progress.saving ? 'Saving to Drive…' : `${progress.percent}%`}</span>
              </div>
              {progress.count > 1 ? <small>File {progress.index} of {progress.count}</small> : null}
              <div className="smc-drive-progress-track">
                <div
                  className={`smc-drive-progress-bar${progress.saving || progress.percent == null ? ' saving' : ''}`}
                  style={{ width: `${progress.percent ?? 100}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <span>Drop files here</span>
              <small>or click to browse. Images, PDFs, and videos.</small>
            </>
          )}
          <input
            type="file"
            multiple
            accept="image/*,application/pdf,video/*"
            disabled={busy}
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      ) : null}
      {error ? <p className="smc-note">{error}</p> : null}
      {folder && (!onlyStage || onlyStage === 'content_generation') ? (
        <a className="smc-drive-link" href={folder} target="_blank" rel="noreferrer">
          <span className="smc-drive-link-icon"><MdCloudUpload /></span>
          <span className="smc-drive-link-copy">
            <strong>Drive folder</strong>
            <span>{folder}</span>
          </span>
        </a>
      ) : null}
      {files.length > 0 && (
        <ul className="smc-drive-files">
          {files.map((file) => (
            <li key={file.id}>
              <a className="smc-drive-file-open" href={file.url} target="_blank" rel="noreferrer">
                {(isPreviewImage(file) || isPreviewVideo(file)) ? (
                  <DriveFilePreview
                    taskId={task.id}
                    file={file}
                    localUrl={previewVersion >= 0 ? localPreviews.current.get(file.id) : ''}
                  />
                ) : <span className="smc-drive-preview smc-drive-preview-empty" />}
                <span className="smc-drive-file-copy">
                  <strong>{fileLabel(file, onlyStage)}</strong>
                  <span>{file.name}</span>
                </span>
              </a>
              {!readOnly ? (
                <button type="button" className="smc-link" disabled={busy} onClick={() => remove(file)}>Remove</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContentSheetForm({ task, updateField, updateProduction, onTask, people = [], onAssign, meId = null }) {
  const production = task.production || {};
  const writerId = production.content_writer_id || task.assigned_to || meId || '';
  const writerName = String(production.content_writer || task.assignee || '').trim();
  const approverId = production.content_approver_id || '';
  const canWriteContent = !production.content_writer_id && !task.assigned_to
    || (meId != null && String(writerId) === String(meId));

  return (
    <>
      <label className="smc-field">Who will add the content
        <select
          value={writerId}
          onChange={(event) => {
            const next = event.target.value ? Number(event.target.value) : null;
            const person = people.find((item) => String(item.user_id) === String(next || ''));
            const name = person?.username || '';
            updateField('assigned_to', next);
            updateProduction('content_writer', name);
            updateProduction('content_writer_id', next ? String(next) : '');
            onAssign?.(next, name);
          }}
        >
          <option value="">Choose who will add the content</option>
          {people.map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.username}
            </option>
          ))}
        </select>
      </label>
      <label className="smc-field">Who will approve the content
        <select
          value={approverId}
          onChange={(event) => {
            const next = event.target.value ? String(event.target.value) : '';
            const person = people.find((item) => String(item.user_id) === next);
            updateProduction('content_approver_id', next);
            updateProduction('content_approver', person?.username || '');
          }}
        >
          <option value="">Choose who will approve the content</option>
          {approvalAdmins(people).map((person) => (
            <option key={person.user_id} value={person.user_id}>
              {person.username}
            </option>
          ))}
        </select>
      </label>
      <label className="smc-field wide">Requirements
        <textarea
          className="smc-requirements-box"
          value={production.requirements || ''}
          onChange={(event) => updateProduction('requirements', event.target.value)}
          placeholder="What should this content cover?"
        />
      </label>
      {!canWriteContent ? (
        <p className="smc-note">
          Waiting for {writerName || 'the assigned person'} to add the content.
        </p>
      ) : null}
      <label className="smc-field wide">Content
        <textarea
          className="smc-content-box"
          value={task.draft_script || ''}
          disabled={!canWriteContent}
          onChange={(event) => updateField('draft_script', event.target.value)}
          placeholder={canWriteContent
            ? 'Write the script, caption, or poster copy here'
            : 'Only the assigned person can write the content'}
        />
      </label>
      <label className="smc-field wide">Content demo URL
        <input
          value={production.demo_url || ''}
          disabled={!canWriteContent}
          onChange={(event) => updateProduction('demo_url', event.target.value)}
          placeholder="https://"
        />
      </label>
      <DriveUploads task={task} onTask={onTask} onlyStage="content_generation" readOnly={!canWriteContent} />
      {production.demo_image ? (
        <div className="smc-demo">
          <img src={production.demo_image} alt={production.demo_image_name || 'Demo'} />
          {canWriteContent ? (
            <button
              type="button"
              className="smc-link"
              onClick={() => {
                updateProduction('demo_image', '');
                updateProduction('demo_image_name', '');
              }}
            >
              Remove image
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}


function stageHelp(stage) {
  if (stage === 'requirement') return 'This is only the idea. Press Start content when someone is ready to write the poster or reel.';
  if (stage === 'content_generation') return 'Add the requirement, choose who writes the content, and which admin will approve it. Then submit for approval.';
  if (stage === 'content_approval') return 'Admin reviews the content here. When approving, pick a Creative Team designer — not the content approver.';
  if (stage === 'final_approval') return '';
  if (stage === 'designing_editing') return '';
  if (stage === 'save_to_drive') return '';
  if (isPostingColumn(stage)) return '';
  if (stage === 'ready_to_post' || stage === 'published') return '';
  return '';
}

function TaskPage({
  task,
  branches,
  people,
  meId = null,
  notice,
  feedback,
  setFeedback,
  events,
  busy,
  actions,
  showHistory,
  updateField,
  updateProduction,
  onTask,
  onAssign,
  onSave,
  onAction,
  onBack,
  asForm = false,
  viewStage = null,
}) {
  const stage = viewStage || shownStage(task) || task.pipeline_stage;
  const posting = isPostingColumn(stage);
  const channel = posting ? stageMeta(stage) : null;
  const canAct = posting ? isPostingOpen(task) : stage === shownStage(task);
  const timing = dueLabel(task);
  const postUrl = posting ? channelPostUrl(task, stage) : '';
  const links = task.production?.post_links || {};
  const showPosterPick = stage === 'final_approval' || posting;
  const pickingDesigner = !showPosterPick && ['content_approval', 'designing_editing'].includes(stage);
  const contentApproverId = String(task.production?.content_approver_id || '');
  const contentApproverName = String(task.production?.content_approver || '').trim();
  // Designer pick must not reuse the content approver id left on assigned_to.
  const designerSelectValue = pickingDesigner && stage === 'content_approval'
    && String(task.assigned_to || '') === contentApproverId
    ? ''
    : (task.assigned_to || '');
  const keepCurrent = (person) => {
    if (String(person.user_id) !== String(task.assigned_to || '')) return false;
    if (stage === 'content_approval' && String(person.user_id) === contentApproverId) return false;
    return true;
  };
  const assigneeChoices = pickingDesigner
    ? people.filter((person) => isDesigner(person) || keepCurrent(person))
    : showPosterPick
      ? people.filter((person) => isPoster(person) || keepCurrent(person))
      : people;
  return (
    <div className={asForm ? 'smc-stage-form' : 'smc-work'}>
      {!asForm && <button type="button" className="smc-back" onClick={onBack}>← Back to board</button>}
      {!asForm && <div className="smc-work-head">
        <div>
          <p className="smc-kicker">{task.code} · {branchName(task.content_branch, branches)}</p>
          <h2>{task.title}</h2>
        </div>
        <div className="smc-work-status">
          <StatusPill status={task.workflow_status} />
          <span className={timing.urgent ? 'smc-meta overdue' : 'smc-meta'}>{timing.text}</span>
        </div>
      </div>}
      <section className="smc-work-card">
        {isContentOverdue(task) && <div className="smc-now-banner">This date has passed.</div>}
        {stageHelp(stage) ? <p className="smc-note">{stageHelp(stage)}</p> : null}
        {notice && <div className="smc-banner ok">{notice}</div>}
        <div className="smc-work-grid">
          {stage === 'content_approval' && contentApproverName ? (
            <p className="smc-note">Content approver: <strong>{contentApproverName}</strong> (admin). Choose a designer below when you approve.</p>
          ) : null}
          {stage !== 'content_generation' && <label className="smc-field">{showPosterPick ? 'Who will post this' : pickingDesigner ? 'Who will design this' : 'Who is doing this'}
            <select
              value={pickingDesigner && stage === 'content_approval' ? designerSelectValue : (task.assigned_to || '')}
              onChange={(event) => updateField('assigned_to', event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">{showPosterPick ? 'Choose who will post' : pickingDesigner ? 'Choose a designer' : 'Choose a person'}</option>
              {assigneeChoices.map((person) => (
                <option key={person.user_id} value={person.user_id}>
                  {person.username}
                </option>
              ))}
            </select>
          </label>}
          {stage === 'requirement' && (
            <>
              <label className="smc-field wide">Idea
                <input value={task.task_title || ''} onChange={(event) => updateField('task_title', event.target.value)} placeholder="Ayutha Pooja poster" />
              </label>
              <BranchField
                value={task.content_branch || ''}
                branches={branches}
                onChange={(code) => updateField('content_branch', code)}
              />
              <label className="smc-field">Needed by
                <input type="date" value={task.due_date ? String(task.due_date).slice(0, 10) : ''} onChange={(event) => updateField('due_date', event.target.value)} />
              </label>
            </>
          )}
          {stage === 'content_generation' && (
            <div className="smc-work-grid wide">
              <ContentSheetForm
                task={task}
                updateField={updateField}
                updateProduction={updateProduction}
                onTask={onTask}
                people={people}
                onAssign={onAssign}
                meId={meId}
              />
            </div>
          )}
          {(stage === 'content_approval' || stage === 'final_approval' || stage === 'designing_editing') && (
            <div className="smc-field wide">
              <SheetSummary task={task} />
              {task.production?.demo_image ? <img className="smc-demo-inline" src={task.production.demo_image} alt={task.production.demo_image_name || 'Demo'} /> : null}
              {task.drive_url && stage !== 'designing_editing' && (
                <a className="smc-drive-link" href={task.drive_url} target="_blank" rel="noreferrer">
                  <span className="smc-drive-link-icon"><MdCloudUpload /></span>
                  <span className="smc-drive-link-copy">
                    <strong>Drive file</strong>
                    <span>{task.drive_url}</span>
    </span>
                </a>
              )}
            </div>
          )}
          {stage === 'designing_editing' && canAct && (
            <label className="smc-field">Who will final approve
              <select
                value={task.production?.final_approver_id || ''}
                onChange={(event) => {
                  const next = event.target.value ? String(event.target.value) : '';
                  const person = people.find((item) => String(item.user_id) === next);
                  updateProduction('final_approver_id', next);
                  updateProduction('final_approver', person?.username || '');
                }}
              >
                <option value="">Choose who will final approve</option>
                {approvalAdmins(people).map((person) => (
                  <option key={person.user_id} value={person.user_id}>
                    {person.username}
                  </option>
                ))}
              </select>
            </label>
          )}
          {stage === 'designing_editing' && canAct && task.workflow_status === 'in_progress' && (
            <label className="smc-field wide">Google Drive link
              <input value={task.drive_url || ''} onChange={(event) => updateField('drive_url', event.target.value)} placeholder="https://drive.google.com/..." />
            </label>
          )}
          {(stage === 'content_approval' || stage === 'final_approval') && canAct && (
            <label className="smc-field wide">What needs rework
              <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Write this only if you press Needs Rework" />
            </label>
          )}
          {stage !== 'content_generation' && (
            <DriveUploads task={task} onTask={onTask} onlyStage={stage} />
          )}
          {posting && (
            canAct ? (
              <label className="smc-field wide">{channel?.label || 'Post'} URL
                <input
                  value={links[stage] || postUrl || ''}
                  onChange={(event) => updateProduction('post_links', { ...links, [stage]: event.target.value })}
                  placeholder={`https://… (${channel?.label || 'post'} link)`}
                />
              </label>
            ) : postUrl ? (
              <div className="smc-posted">
                <a href={postUrl} target="_blank" rel="noreferrer">
                  <strong>{channel?.label}</strong>
                  <span>{postUrl}</span>
                </a>
              </div>
            ) : (
              <p className="smc-note">Available after Final Approval.</p>
            )
          )}
          {!canAct && !posting && STAGES.findIndex((item) => item.key === stage) > STAGES.findIndex((item) => item.key === shownStage(task)) && (
            <p className="smc-note">This stage is not reached yet.</p>
          )}
        </div>
        {task.review_comment && (stage === 'content_approval' || stage === 'final_approval' || stage === 'content_generation') && (
          <p className="smc-feedback">Last rework note: {task.review_comment}</p>
        )}
        <div className="smc-actions smc-work-actions">
          <button type="button" className="smc-btn" onClick={onSave} disabled={busy}>Save</button>
          {canAct && actions.filter((item) => item.action !== 'block').map((item) => (
            <button
              key={item.action}
              type="button"
              className={`smc-btn ${item.danger ? 'smc-btn-danger' : item.primary ? 'smc-btn-primary' : ''}`}
              disabled={busy}
              onClick={() => onAction(item.action)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <details className="smc-work-card smc-history" open={showHistory}>
        <summary>History</summary>
        <ul className="smc-activity">
          {events.length === 0 && <li>No history yet.</li>}
          {events.map((item) => (
            <li key={item.id}>
              <strong>{ACTION_LABELS[item.action] || item.action}</strong>
              {' '}by {item.actor_name}
              {item.feedback ? <div className="smc-feedback">{item.feedback}</div> : null}
              <small>{formatWhen(item.created_at)} · {stageMeta(item.to_stage).label} · {statusMeta(item.to_status).label}</small>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function SheetSummary({ task }) {
  const rows = sheetRows(task);
  if (!rows.length) return null;
  return (
    <dl className="smc-dl">
      {rows.map((item) => (
        <React.Fragment key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

const CONSEQUENTIAL = new Set([
  'approve_content',
  'reject_content',
  'revise_content',
  'complete_design',
  'save_to_drive',
  'approve_final',
  'reject_final',
  'revise_final',
  'confirm_publish',
]);

function exportContentCsv(rows, types = []) {
  const header = ['#', 'Task ID', 'Category', 'Course', 'Campaign', 'Branch', 'Content Type', 'Stage', 'Status', 'Assigned To', 'Deadline', 'Platforms', 'Progress', 'Drive URL'];
  const lines = rows.map((task, index) => {
    const cells = [
      index + 1,
      task.code,
      task.production?.course_type || '',
      task.production?.course || task.title || '',
      task.campaign_name || '',
      branchName(task.content_branch),
      typeName(task, types),
      stageMeta(task.pipeline_stage).label,
      statusMeta(task.workflow_status).label,
      task.assignee || '',
      formatDisplayDate(task.due_date) || '',
      (task.platforms || []).join(' '),
      `${Number(task.progress) || 0}%`,
      task.drive_url || '',
    ];
    return cells.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',');
  });
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'social-content.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function StatusPill({ status }) {
  const meta = statusMeta(status);
  if (!meta.label) return <span className="smc-muted">—</span>;
  return <span className="smc-pill" style={toneStyle(meta.tone)}>{meta.label}</span>;
}

function shownStage(task) {
  return task?.pipeline_stage === 'requirement' ? 'content_generation' : task?.pipeline_stage;
}

function roleText(person) {
  const names = person?.role_names;
  if (Array.isArray(names)) return names.join(' ');
  return String(names || person?.role || '');
}

function isDesigner(person) {
  const text = roleText(person).toLowerCase();
  return text.includes('creative team') || text.includes('creative_team') || text.includes('designer');
}

/** Only Yogesh and Vidhya Lakshmi post to channels. */
function isPoster(person) {
  const name = String(person?.username || '').toLowerCase();
  return name.includes('yogesh') || name.includes('vidhya');
}

/** Admins who approve content and final approval. */
const APPROVAL_ADMIN_HINTS = ['sivagaminathan', 'ruban', 'jayapradh', 'krithika', 'pushparaj'];

function isApprovalAdmin(person) {
  const name = String(person?.username || '').toLowerCase();
  return APPROVAL_ADMIN_HINTS.some((hint) => name.includes(hint));
}

function approvalAdmins(people = []) {
  return (people || []).filter(isApprovalAdmin);
}

function PostAssigneePick({ task, channel, people, onChange, onOpen }) {
  const stored = task?.production?.post_assignees?.[channel] || {};
  const fallback = defaultPostAssignees(people)[channel] || {};
  const current = stored.id ? stored : fallback;
  const choices = (people || []).filter(isPoster);
  const label = stageMeta(channel).label;
  return (
    <div className="smc-lane-meta smc-lane-meta--post">
      <select
        className="smc-inline"
        value={current.id || ''}
        aria-label={`${label} assignee`}
        title="Who will post this channel"
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onChange?.(task.id, channel, event.target.value)}
      >
        <option value="">Assignee</option>
        {choices.map((person) => (
          <option key={person.user_id} value={String(person.user_id)}>{person.username}</option>
        ))}
      </select>
      <button
        type="button"
        className="smc-post-open"
        title={`Open ${label} — paste the live URL to mark green`}
        aria-label={`Open ${label} post link`}
        onClick={(event) => {
          event.stopPropagation();
          onOpen?.();
        }}
      >
        <MdOpenInNew size={15} />
      </button>
    </div>
  );
}

function assignedName(task) {
  if (task?.assigned_to == null || task.assigned_to === '') return '';
  const name = String(task.assignee || '').trim();
  if (!name || name.toLowerCase() === 'unassigned') return '';
  return name;
}

function cellPerson(task, columnKey, hold) {
  if (columnKey === 'content_generation') {
    const writer = String(task?.production?.content_writer || '').trim();
    if (writer) return writer;
    const actor = String(task?.stage_actors?.content_generation || '').trim();
    if (actor) return actor;
    if (hold) return assignedName(task) || 'Unassigned';
  }
  if (hold && columnKey === 'content_approval') {
    return String(task?.production?.content_approver || '').trim()
      || assignedName(task)
      || 'Unassigned';
  }
  if (hold && columnKey === 'final_approval') {
    return String(task?.production?.final_approver || '').trim()
      || assignedName(task)
      || 'Unassigned';
  }
  if (isPostingColumn(columnKey)) {
    const poster = task?.production?.post_assignees?.[columnKey];
    const named = String(poster?.name || '').trim();
    if (named) return named;
    if (hold) return 'Unassigned';
  }
  if (hold) return assignedName(task) || 'Unassigned';
  const actors = task?.stage_actors || {};
  const named = actors[columnKey]
    || (isPostingColumn(columnKey) ? (actors.ready_to_post || actors.published || '') : '');
  return named || 'Unassigned';
}

function reworkStageKey(task) {
  if (String(task?.workflow_status || '') !== 'needs_revision') return '';
  const stage = shownStage(task);
  if (stage === 'content_generation') return 'content_approval';
  if (stage === 'designing_editing') return 'final_approval';
  return '';
}

function flowState(task, columnKey) {
  if (columnKey === reworkStageKey(task)) return 'rework';
  if (isPostingColumn(columnKey)) {
    if (!isPostingOpen(task)) return '';
    return channelPostUrl(task, columnKey) ? 'done' : 'hold';
  }
  const order = STAGES.findIndex((stage) => stage.key === columnKey);
  const current = STAGES.findIndex((stage) => stage.key === shownStage(task));
  if (isPostingOpen(task) || shownStage(task) === 'published' || task.workflow_status === 'published') {
    return order >= 0 && order < STAGES.findIndex((stage) => stage.key === 'ready_to_post') ? 'done' : '';
  }
  if (current < 0 || order < 0) return '';
  if (order < current) return 'done';
  if (order === current) return 'hold';
  return '';
}

function renderStageCell(task, stage, { menuFor, setMenuFor, openTask, className = '', people = [], onPostAssignee }) {
  const extra = className ? ` ${className}` : '';
  const writerNamed = String(task?.production?.content_writer || '').trim();
  const waitingForDemo = stage.key === 'content_generation'
    && shownStage(task) === 'content_generation'
    && !hasContentDemo(task)
    && !writerNamed;
  if (waitingForDemo) {
    return (
      <div key={stage.key} className={`smc-lane-cell wait${extra}`}>
        <button type="button" className="smc-lane-add" onClick={() => openTask(task, stage.key)}>
          <MdAdd size={16} /> Add
        </button>
      </div>
    );
  }
  const state = flowState(task, stage.key);
  // Before Final Approval: incomplete light-red, no name.
  if (stage.posting && !isPostingOpen(task)) {
    return (
      <button
        key={stage.key}
        type="button"
        className={`smc-lane-cell empty${extra}`}
        onClick={() => openTask(task, stage.key)}
        aria-label={`Open ${stage.label}`}
      />
    );
  }
  // After Final Approval: solid red + Branch-style dropdown (Yogesh / Vidhya).
  if (stage.posting && state === 'hold') {
    return (
      <div key={stage.key} className={`smc-lane-cell hold smc-lane-cell--post-assign${extra}`}>
        <PostAssigneePick
          task={task}
          channel={stage.key}
          people={people}
          onChange={onPostAssignee}
          onOpen={() => openTask(task, stage.key)}
        />
      </div>
    );
  }
  if (state === 'rework') {
    return (
      <div key={stage.key} className={`smc-lane-cell rework${extra}`}>
        <article className="smc-card rework" onClick={() => openTask(task, stage.key)}>
          <span className="smc-card-label" title="Rework">Rework</span>
        </article>
      </div>
    );
  }
  if (!state) {
    return (
      <button
        key={stage.key}
        type="button"
        className={`smc-lane-cell empty${extra}`}
        onClick={() => openTask(task, stage.key)}
        aria-label={`Open ${stage.label}`}
      />
    );
  }
  const hold = state === 'hold';
  const person = cellPerson(task, stage.key, hold);
  return (
    <div key={stage.key} className={`smc-lane-cell ${state}${extra}`}>
      <article
        className={`smc-card ${state}`}
        onClick={() => openTask(task, stage.key)}
      >
        {hold && !stage.posting && (
          <button
            type="button"
            className="smc-kebab"
            aria-label="Task actions"
            aria-expanded={menuFor?.id === task.id}
            onClick={(event) => {
              event.stopPropagation();
              if (menuFor?.id === task.id) {
                setMenuFor(null);
                return;
              }
              const rect = event.currentTarget.getBoundingClientRect();
              setMenuFor({
                id: task.id,
                top: rect.bottom + 4,
                left: Math.max(8, rect.right - 180),
              });
            }}
          >
            <MdMoreVert size={16} />
          </button>
        )}
        <span className="smc-card-label" title={person}>{person}</span>
      </article>
    </div>
  );
}

export default function ContentPipeline({
  currentUser,
  members = [],
  focusTaskId = null,
  onFocusConsumed,
}) {
  const canManage = useMemo(() => {
    const perms = currentUser?.permissions || [];
    return perms.includes('admin.access') || perms.includes('social_media.manage');
  }, [currentUser]);
  const meId = currentUser?.id ?? currentUser?.user_id ?? null;

  const [items, setItems] = useState([]);
  const [branches, setBranches] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebouncedValue(query, 200);
  const [branch, setBranch] = useState('');
  const [contentType, setContentType] = useState('');
  const [status, setStatus] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [showStages, setShowStages] = useState(false);
  const [assignee, setAssignee] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [menuFor, setMenuFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState(null);
  const [viewStage, setViewStage] = useState(null);
  const [events, setEvents] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [courses, setCourses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [courseEditor, setCourseEditor] = useState(null);
  const [courseEditorBusy, setCourseEditorBusy] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pinScrollRef = useRef(null);
  const stageScrollRef = useRef(null);
  const syncingScroll = useRef(false);

  const syncBoardScroll = (source) => (event) => {
    if (syncingScroll.current) return;
    const top = event.currentTarget.scrollTop;
    const other = source === 'pin' ? stageScrollRef.current : pinScrollRef.current;
    if (!other || other.scrollTop === top) return;
    syncingScroll.current = true;
    other.scrollTop = top;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  };

  const people = useMemo(() => {
    const source = assignees.length ? assignees : members;
    const list = (source || []).filter((person) => person && person.is_active !== false);
    if (meId != null && !list.some((person) => String(person.user_id) === String(meId))) {
      list.unshift({
        user_id: meId,
        username: currentUser?.name || currentUser?.username || 'Me',
        is_active: true,
      });
    }
    return list;
  }, [assignees, members, currentUser, meId]);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await itUpdatesApi.getSocialContentList();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load the content pipeline.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    itUpdatesApi.getBranches()
      .then(({ data }) => {
        if (!cancelled) setBranches(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    itUpdatesApi.getContentUsers()
      .then(({ data }) => {
        if (!cancelled) setAssignees(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setAssignees([]);
      });
    itUpdatesApi.getContentTypes()
      .then(({ data }) => {
        if (!cancelled) setContentTypes(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setContentTypes([]);
      });
    itUpdatesApi.getCourses()
      .then(({ data }) => {
        if (cancelled) return;
        setCourses(Array.isArray(data?.courses) ? data.courses : []);
        setCategories(Array.isArray(data?.categories) ? data.categories : []);
      })
      .catch(() => {
        if (!cancelled) {
          setCourses([]);
          setCategories([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reloadCourses = useCallback(async () => {
    try {
      const { data } = await itUpdatesApi.getCourses();
      setCourses(Array.isArray(data?.courses) ? data.courses : []);
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
      return data;
    } catch {
      return null;
    }
  }, []);

  const categoryChoices = useMemo(() => {
    const set = new Set(categories);
    items.forEach((task) => {
      const type = task.production?.course_type;
      if (type) set.add(type);
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [categories, items]);

  const coursesForCategory = useCallback((category) => {
    if (!category) return [];
    return courses.filter((item) => item.course_type === category);
  }, [courses]);

  const branchChoices = useMemo(() => {
    const known = new Set(branches.map((item) => item.code));
    const extra = [...new Set(items.map((task) => task.content_branch).filter((code) => code && !known.has(code)))];
    return [
      ...branches.map((item) => ({ value: item.code, label: item.code })),
      ...extra.map((code) => ({ value: code, label: code })),
    ];
  }, [branches, items]);

  const matched = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return items.filter((task) => {
      if (branch && task.content_branch !== branch) return false;
      if (contentType && task.content_type !== contentType) return false;
      if (status && task.workflow_status !== status) return false;
      if (assignee && String(task.assigned_to) !== String(assignee)) return false;
      const rowDate = String(task.production?.sheet_date || task.due_date || '').slice(0, 10);
      if (dateFrom && (!rowDate || rowDate < dateFrom)) return false;
      if (dateTo && (!rowDate || rowDate > dateTo)) return false;
      if (!q) return true;
      const hay = `${task.code} ${task.title} ${task.campaign_name || ''} ${task.content_branch} ${task.production?.course_type || ''} ${task.production?.course || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, debouncedQuery, branch, contentType, status, assignee, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    if (!stageFilter) return matched;
    if (isPostingColumn(stageFilter)) {
      return matched.filter((task) => isPostingOpen(task));
    }
    return matched.filter((task) => shownStage(task) === stageFilter);
  }, [matched, stageFilter]);

  const sorted = useMemo(() => (
    [...filtered].sort((a, b) => {
      const aId = Number(a.task_id ?? a.id) || 0;
      const bId = Number(b.task_id ?? b.id) || 0;
      if (aId !== bId) return aId - bId;
      const aDate = String(a.production?.sheet_date || a.due_date || '').slice(0, 10);
      const bDate = String(b.production?.sheet_date || b.due_date || '').slice(0, 10);
      return aDate.localeCompare(bDate);
    })
  ), [filtered]);

  useLayoutEffect(() => {
    const pin = pinScrollRef.current;
    const stage = stageScrollRef.current;
    if (!pin || !stage) return undefined;

    const laneRows = (root) => [...root.children].filter((node) => (
      node.classList.contains('smc-lane-head') || node.classList.contains('smc-lane-row')
    ));

    const align = () => {
      const inner = stage.querySelector('.smc-board-scroll-inner');
      if (!inner) return;
      const left = laneRows(pin);
      const right = laneRows(inner);
      const count = Math.min(left.length, right.length);
      for (let index = 0; index < count; index += 1) {
        left[index].style.height = '';
        right[index].style.height = '';
      }
      const heights = [];
      for (let index = 0; index < count; index += 1) {
        heights.push(Math.max(left[index].offsetHeight, right[index].offsetHeight));
      }
      for (let index = 0; index < count; index += 1) {
        const px = `${heights[index]}px`;
        left[index].style.height = px;
        right[index].style.height = px;
      }
    };

    align();
    window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, [sorted, loading]);

  const columnCounts = useMemo(() => {
    const counts = Object.fromEntries(BOARD_COLUMNS.map((column) => [column.key, 0]));
    matched.forEach((task) => {
      const current = shownStage(task);
      if (counts[current] != null) counts[current] += 1;
      if (current === 'requirement' && counts.content_generation != null) counts.content_generation += 1;
      if (isPostingOpen(task)) {
        POSTING_CHANNELS.forEach((channel) => {
          if (channelPostUrl(task, channel.value)) counts[channel.value] += 1;
        });
      }
    });
    return counts;
  }, [matched]);

  const replaceTask = (task) => {
    setItems((prev) => {
      const exists = prev.some((item) => String(item.id) === String(task.id));
      if (!exists) return [...prev, task];
      return prev.map((item) => (String(item.id) === String(task.id) ? { ...item, ...task } : item));
    });
    setSelected((current) => (current && String(current.id) === String(task.id) ? { ...current, ...task } : current));
  };

  const openTask = async (task, stageKey) => {
    setMenuFor(null);
    const stage = stageKey || shownStage(task) || task.pipeline_stage;
    setViewStage(stage);
    setSelected(task);
    setFeedback('');
    setNotice('');
    try {
      const { data } = await itUpdatesApi.getSocialContent(task.id);
      setSelected(data);
      setEvents(Array.isArray(data.events) ? data.events : []);
      replaceTask(data);
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not open this task.');
    }
  };

  useEffect(() => {
    if (!focusTaskId || loading) return undefined;
    const match = itemsRef.current.find((item) => String(item.id) === String(focusTaskId));
    let cancelled = false;
    (async () => {
      try {
        if (match) {
          await openTask(match);
        } else {
          const { data } = await itUpdatesApi.getSocialContent(focusTaskId);
          if (cancelled || !data) return;
          replaceTask(data);
          setViewStage(shownStage(data) || data.pipeline_stage);
          setSelected(data);
          setEvents(Array.isArray(data.events) ? data.events : []);
        }
      } catch {
        /* ignore — still clear focus */
      } finally {
        if (!cancelled) onFocusConsumed?.();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Open once when My Tasks hands us a pipeline task id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTaskId, loading]);

  const closeTask = () => {
    setSelected(null);
    setViewStage(null);
  };

  const updateField = (key, value) => {
    setSelected((current) => (current ? { ...current, [key]: value } : current));
  };

  const updateProduction = (key, value) => {
    setSelected((current) => (
      current ? { ...current, production: { ...(current.production || {}), [key]: value } } : current
    ));
  };

  const saveTask = async ({ quiet = false } = {}) => {
    if (!selected) return false;
    setBusy(true);
    setNotice('');
    try {
      const production = { ...(selected.production || {}) };
      let assignedTo = selected.assigned_to || null;
      // Like before: if nobody was chosen, default to the logged-in person.
      if (!assignedTo && !production.content_writer_id && meId != null) {
        const me = people.find((person) => String(person.user_id) === String(meId));
        assignedTo = meId;
        production.content_writer_id = String(meId);
        production.content_writer = me?.username
          || currentUser?.username
          || currentUser?.name
          || '';
      }
      const { data } = await itUpdatesApi.updateSocialContent(selected.id, {
        task_title: selected.task_title,
        task_description: selected.task_description,
        content_branch: selected.content_branch,
        content_type: selected.content_type,
        campaign_name: selected.campaign_name,
        objective: selected.objective,
        target_audience: selected.target_audience,
        key_message: selected.key_message,
        cta: selected.cta,
        platforms: selected.platforms,
        priority: selected.priority,
        assigned_to: assignedTo,
        due_date: selected.due_date ? String(selected.due_date).slice(0, 10) : null,
        reference_urls: selected.reference_urls,
        progress: selected.progress,
        draft_script: selected.draft_script,
        draft_caption: selected.draft_caption,
        draft_hashtags: selected.draft_hashtags,
        design_link: selected.design_link,
        content_doc_link: selected.content_doc_link,
        drive_url: selected.drive_url,
        asset_notes: selected.asset_notes,
        scheduled_at: selected.scheduled_at || null,
        production,
      });
      replaceTask(data);
      if (!quiet) {
        setNotice('Saved.');
        toastSuccess('Saved');
      }
      return true;
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not save this task.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (action, source) => {
    let task = source || selected;
    if (!task) return;
    const needsFeedback = ['reject_content', 'revise_content', 'reject_final', 'revise_final'].includes(action);
    if (needsFeedback && feedback.trim().length < 5) {
      setSelected(task);
      setNotice('');
      toastError('Write what needs to be reworked.');
      return;
    }
    if (action === 'submit_for_approval' && selected && String(selected.id) === String(task.id)) {
      const kind = selected.production?.sheet_kind;
      const poster = selected.production?.poster_content || '';
      const reelScript = selected.production?.reel_script || selected.draft_script || '';
      const curriculum = selected.production?.curriculum || '';
      const posterLink = selected.production?.poster_link || '';
      const content = String(selected.draft_script || '').trim();
      const demoUrl = String(selected.production?.demo_url || '').trim();
      const demoImage = String(selected.production?.demo_image || '').trim();
      const hasSheet = Boolean(poster.trim() || reelScript.trim() || curriculum.trim() || posterLink.trim() || selected.drive_url);
      if (!content && !demoUrl && !demoImage && !hasSheet && !kind) {
        toastError('Write the content first.');
        return;
      }
      if (!String(selected.production?.content_approver_id || '').trim()) {
        toastError('Choose who will approve the content.');
        return;
      }
      const saved = await saveTask({ quiet: true });
      if (!saved) return;
    }
    if (action === 'approve_content') {
      const designerId = task.assigned_to;
      const approverId = String(task.production?.content_approver_id || '');
      if (!designerId || String(designerId) === approverId) {
        setSelected(task);
        toastError('Choose who will design this (Creative Team).');
        return;
      }
    }
    if (action === 'approve_final' && !task.assigned_to) {
      const poster = findPersonByHint(people, 'yogesh') || findPersonByHint(people, 'vidhya');
      if (!poster) {
        setSelected(task);
        toastError('Choose who will post this.');
        return;
      }
      task = { ...task, assigned_to: poster.user_id };
    }
    if (action === 'complete_design' || action === 'save_to_drive') {
      if (!/^https?:\/\//i.test(String(task.drive_url || '').trim())) {
        setSelected(task);
        toastError('Add the Google Drive link.');
        return;
      }
      if (!String(task.production?.final_approver_id || '').trim()) {
        setSelected(task);
        toastError('Choose who will final approve.');
        return;
      }
    }
    const channelKey = isPostingColumn(viewStage) ? viewStage : null;
    if (action === 'save_channel_post' || action === 'confirm_publish') {
      const channel = channelKey || (Array.isArray(task.platforms) ? task.platforms[0] : '');
      if (!channel || !isPostingColumn(channel)) {
        setSelected(task);
        toastError('Open a posting column to save its link.');
        return;
      }
      const url = channelPostUrl(
        { ...task, production: { ...(task.production || {}), post_links: { ...(task.production?.post_links || {}) } } },
        channel,
      ) || String(task.production?.post_links?.[channel] || '').trim();
      if (!/^https?:\/\//i.test(url)) {
        setSelected(task);
        toastError(`Add the ${stageMeta(channel).label} post URL.`);
        return;
      }
    }
    if (CONSEQUENTIAL.has(action)) {
      const ok = await confirmDialog({
        title: ACTION_LABELS[action] || 'Update this task?',
        message: `${task.code} will move according to the workflow. Task history is kept.`,
        confirmLabel: 'Continue',
        danger: action.startsWith('reject') || action.startsWith('revise'),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const channel = channelKey || null;
      const links = { ...(task.production?.post_links || {}) };
      let production = task.production || {};
      if (action === 'approve_final') {
        const defaults = defaultPostAssignees(people);
        const existing = production.post_assignees || {};
        const post_assignees = { ...defaults };
        Object.keys(existing).forEach((key) => {
          if (existing[key]?.id) post_assignees[key] = existing[key];
        });
        production = { ...production, post_assignees };
      }
      const payload = {
        action: action === 'confirm_publish' ? 'save_channel_post' : action,
        feedback: feedback.trim(),
        draft_script: task.draft_script,
        draft_caption: task.draft_caption,
        draft_hashtags: task.draft_hashtags,
        design_link: task.design_link,
        content_doc_link: task.content_doc_link,
        drive_url: task.drive_url,
        scheduled_at: task.scheduled_at,
        published_url: task.published_url,
        platforms: task.platforms || [],
        production,
        publication_confirmed: true,
        assigned_to: task.assigned_to || undefined,
      };
      if ((action === 'save_channel_post' || action === 'confirm_publish') && channel) {
        payload.channel = channel;
        payload.production = {
          ...(task.production || {}),
          post_links: { ...links, [channel]: links[channel] || channelPostUrl(task, channel) },
        };
      }
      const { data } = await itUpdatesApi.transitionSocialContent(task.id, payload);
      replaceTask(data);
      closeTask();
      setEvents(Array.isArray(data.events) ? data.events : []);
      setFeedback('');
      setNotice(ACTION_LABELS[action] || 'Task updated.');
      toastSuccess(ACTION_LABELS[action] || 'Task updated');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not move this task.');
    } finally {
      setBusy(false);
    }
  };

  const patchRow = async (taskId, patch) => {
    setItems((prev) => prev.map((item) => {
      if (String(item.id) !== String(taskId)) return item;
      const next = { ...item, ...patch };
      if (patch.task_title != null) next.title = patch.task_title;
      if (patch.production) next.production = { ...(item.production || {}), ...patch.production };
      return next;
    }));
    try {
      const { data } = await itUpdatesApi.updateSocialContent(taskId, patch);
      replaceTask(data);
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not save this row.');
      try {
        const { data } = await itUpdatesApi.getSocialContent(taskId);
        replaceTask(data);
      } catch {
        /* keep optimistic value until refresh */
      }
    }
  };

  const latestTask = (taskId) => itemsRef.current.find((item) => String(item.id) === String(taskId));

  const saveRowField = (taskId, field, value) => {
    const task = latestTask(taskId);
    if (!task) return;
    if (field === 'date') {
      const due = value || null;
      patchRow(task.id, {
        due_date: due,
        production: { ...(task.production || {}), sheet_date: due },
      });
      return;
    }
    if (field === 'branch') {
      patchRow(task.id, { content_branch: value || null });
      return;
    }
    if (field === 'type') {
      patchRow(task.id, { content_type: value || null });
      return;
    }
    if (field === 'category') {
      const category = String(value || '').trim();
      const keepCourse = courses.some(
        (item) => item.course_type === category && item.course_id === task.production?.course_id,
      );
      const courseName = keepCourse ? (task.production?.course || task.title || '') : '';
      const courseId = keepCourse ? (task.production?.course_id || '') : '';
      const title = courseName || category || 'Untitled';
      patchRow(task.id, {
        task_title: title,
        task_description: title,
        production: {
          ...(task.production || {}),
          course_type: category,
          course_id: courseId,
          course: courseName,
          content_topics: courseName || category,
        },
      });
      return;
    }
    if (field === 'course') {
      const courseId = String(value || '').trim();
      const match = courses.find((item) => item.course_id === courseId);
      const category = match?.course_type || task.production?.course_type || '';
      const courseName = match?.course_name || '';
      const title = courseName || category || 'Untitled';
      patchRow(task.id, {
        task_title: title,
        task_description: title,
        production: {
          ...(task.production || {}),
          course_type: category,
          course_id: courseId,
          course: courseName,
          content_topics: courseName || category,
        },
      });
      return;
    }
  };

  const savePostAssignee = (taskId, channel, userId) => {
    const task = latestTask(taskId);
    if (!task || !channel) return;
    const person = people.find((item) => String(item.user_id) === String(userId || ''));
    const current = { ...(task.production?.post_assignees || {}) };
    if (!person) delete current[channel];
    else current[channel] = { id: String(person.user_id), name: person.username };
    patchRow(task.id, {
      production: {
        ...(task.production || {}),
        post_assignees: current,
      },
    });
  };

  const applyCourseSelection = async (taskId, course) => {
    if (!course) return;
    await reloadCourses();
    setCourses((prev) => {
      if (prev.some((item) => item.course_id === course.course_id)) return prev;
      return [...prev, course];
    });
    setCategories((prev) => (
      prev.includes(course.course_type) ? prev : [...prev, course.course_type].sort((a, b) => a.localeCompare(b))
    ));
    const title = course.course_name || course.course_type || 'Untitled';
    patchRow(taskId, {
      task_title: title,
      task_description: title,
      production: {
        ...(latestTask(taskId)?.production || {}),
        course_type: course.course_type,
        course_id: course.course_id,
        course: course.course_name,
        content_topics: course.course_name,
      },
    });
  };

  const openCategoryEditor = (task, draftName = '') => {
    setCourseEditor({
      mode: 'category',
      taskId: task.id,
      category: draftName || '',
      initialCourse: '',
    });
  };

  const openCourseEditor = (task, draftName = '') => {
    const category = String(task.production?.course_type || '').trim();
    if (!category) {
      toastError('Choose a category first.');
      return;
    }
    setCourseEditor({
      mode: 'course',
      taskId: task.id,
      category,
      initialCourse: draftName,
    });
  };

  const submitCourseEditor = async ({ course_type: type, course_name: name }) => {
    if (!courseEditor) return;
    if (!String(type || '').trim()) {
      toastError('Enter a category.');
      return;
    }
    if (!String(name || '').trim()) {
      toastError('Enter a course name.');
      return;
    }
    setCourseEditorBusy(true);
    try {
      const { data } = await itUpdatesApi.createCourse({
        course_type: String(type).trim(),
        course_name: String(name).trim(),
      });
      await applyCourseSelection(courseEditor.taskId, data);
      setCourseEditor(null);
      toastSuccess(courseEditor.mode === 'category' ? 'Category and course added' : 'Course added');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not save.');
    } finally {
      setCourseEditorBusy(false);
    }
  };

  const removeRow = async (task) => {
    const label = task.code || task.title || 'This row';
    const reason = await reasonDialog({
      title: 'Delete this row?',
      message: `${label} will be removed from the pipeline. A copy is kept in the delete log.`,
      confirmLabel: 'Delete',
      danger: true,
      reasonLabel: 'Why are you deleting this row?',
      placeholder: 'e.g. duplicate row, created by mistake, cancelled',
    });
    if (!reason) return;
    try {
      await itUpdatesApi.deleteSocialContent(task.id, reason);
      setItems((prev) => prev.filter((item) => String(item.id) !== String(task.id)));
      setSelected((current) => (current && String(current.id) === String(task.id) ? null : current));
      toastSuccess('Row deleted');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not delete this row.');
    }
  };

  const addRow = async () => {
    if (adding) return;
    setAdding(true);
    try {
      const due = todayIso();
      const { data } = await itUpdatesApi.createSocialContent({
        task_title: 'Untitled',
        task_description: 'Untitled',
        content_branch: '',
        content_type: '',
        due_date: due,
        platforms: [],
        priority: 'medium',
        production: {
          course: '',
          course_type: '',
          course_id: '',
          sheet_date: due,
          content_topics: '',
        },
      });
      setItems((prev) => [...prev, data]);
      toastSuccess('Row added');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not add a row.');
    } finally {
      setAdding(false);
    }
  };

  const activeViewStage = viewStage || (selected ? shownStage(selected) : null);
  const viewingChannel = isPostingColumn(activeViewStage);
  const canActOnView = Boolean(
    selected
    && activeViewStage
    && (viewingChannel ? isPostingOpen(selected) : activeViewStage === shownStage(selected)),
  );
  const actions = canActOnView ? actionsFor(selected, canManage, meId) : [];
  const boardMenuTask = menuFor
    ? (sorted.find((item) => String(item.id) === String(menuFor.id))
      || items.find((item) => String(item.id) === String(menuFor.id))
      || null)
    : null;
  const filtersActive = Boolean(query || branch || contentType || status || assignee || dateFrom || dateTo || stageFilter);

  const clearFilters = () => {
    setQuery('');
    setBranch('');
    setContentType('');
    setStatus('');
    setAssignee('');
    setDateFrom('');
    setDateTo('');
    setStageFilter('');
  };

  const contentModal = Boolean(selected && activeViewStage === 'content_generation');

  return (
    <div className="smc-page">
      <div className="smc-stage-bar">
        <button
          type="button"
          className={`smc-stage-toggle${showStages ? ' open' : ''}${stageFilter ? ' filtered' : ''}`}
          aria-expanded={showStages}
          onClick={() => setShowStages((open) => !open)}
        >
          {showStages ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
          <span>Stages</span>
          {stageFilter ? (
            <em className="smc-stage-toggle-chip">{stageMeta(stageFilter).label}</em>
          ) : (
            <em>Pipeline & posting filters</em>
          )}
        </button>
        {showStages && stageFilter ? (
          <button
            type="button"
            className="smc-btn smc-btn-ghost smc-stage-clear"
            onClick={() => setStageFilter('')}
          >
            Clear stage
          </button>
        ) : null}
      </div>

      {showStages && (
        <div className="smc-stepper" aria-label="Workflow stages">
          {[
            { key: 'pipeline', label: 'Pipeline', columns: BOARD_COLUMNS.filter((item) => !item.posting) },
            { key: 'posting', label: 'Posting', columns: BOARD_COLUMNS.filter((item) => item.posting) },
          ].map((group) => (
            <div key={group.key} className="smc-stepper-group">
              <span className="smc-stepper-label">{group.label}</span>
              <div className="smc-stepper-track">
                {group.columns.map((stage) => {
                  const Icon = columnIcon(stage.key);
                  const count = columnCounts[stage.key] || 0;
                  const selectedStage = stageFilter === stage.key;
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      className={`smc-step${selectedStage ? ' active' : ''}${stage.posting ? ' posting' : ''}`}
                      aria-pressed={selectedStage}
                      onClick={() => setStageFilter(selectedStage ? '' : stage.key)}
                      title={stage.label}
                    >
                      <span className="smc-step-icon" style={{ background: stage.color }}>
                        <Icon size={15} />
                      </span>
                      <span className="smc-step-copy">
                        <strong>{stage.label}</strong>
                        <em>{count} {count === 1 ? 'task' : 'tasks'}</em>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="smc-toolbar">
        <div className="smc-filter-grid">
          <label className="smc-filter-item smc-filter-search-wide">
            <span className="smc-filter-label">Search</span>
            <div className="smc-search">
              <MdSearch size={16} color="#94a3b8" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Task, title, or branch"
                aria-label="Search content"
              />
        </div>
          </label>
          <label className="smc-filter-item">
            <span className="smc-filter-label">Branch</span>
            <FilterSearch
              value={branch}
              onChange={setBranch}
              options={branchChoices.map((item) => ({ value: item.value, label: item.label }))}
              allLabel="All branches"
              placeholder="All branches"
              ariaLabel="Branch"
            />
          </label>
          <label className="smc-filter-item">
            <span className="smc-filter-label">Content type</span>
            <FilterSearch
              value={contentType}
              onChange={setContentType}
              options={contentTypes.map((item) => ({ value: item.code, label: item.label }))}
              allLabel="All content types"
              placeholder="All types"
              ariaLabel="Content type"
            />
          </label>
          <label className="smc-filter-item">
            <span className="smc-filter-label">Status</span>
            <FilterSearch
              value={status}
              onChange={setStatus}
              options={Object.entries(STATUS_META).map(([key, meta]) => ({ value: key, label: meta.label }))}
              allLabel="All statuses"
              placeholder="All statuses"
              ariaLabel="Status"
            />
          </label>
          <label className="smc-filter-item">
            <span className="smc-filter-label">Assignee</span>
            <FilterSearch
              value={assignee}
              onChange={setAssignee}
              options={people.map((person) => ({ value: String(person.user_id), label: person.username }))}
              allLabel="All assignees"
              placeholder="All assignees"
              ariaLabel="Assigned user"
            />
          </label>
          <label className="smc-filter-item smc-filter-date">
            <span className="smc-filter-label">From</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="From date" />
          </label>
          <label className="smc-filter-item smc-filter-date">
            <span className="smc-filter-label">To</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="To date" />
          </label>
          <div className="smc-filter-actions">
            {filtersActive && (
              <button type="button" className="smc-btn smc-btn-ghost" onClick={clearFilters}>Clear</button>
            )}
            <button type="button" className="smc-btn smc-export" onClick={() => exportContentCsv(sorted, contentTypes)}>
              <MdFileDownload size={16} /> Export
          </button>
          </div>
        </div>
      </div>

      {error && <div className="smc-banner" role="alert">{error}</div>}
      {loading && <p className="smc-note">Loading content…</p>}
      {!loading && items.length === 0 && !error && (
        <div className="smc-banner">No content yet. Press Add at the bottom to create a row.</div>
      )}

      {!loading && (
        <div className="smc-board">
          <div className="smc-board-frame">
            <div className="smc-board-pin" ref={pinScrollRef} onScroll={syncBoardScroll('pin')}>
              <div className="smc-lane-head smc-lane-head--pin">
                <div className="smc-lane-label">#</div>
                <div className="smc-lane-label">Delete</div>
                <div className="smc-lane-label">Date</div>
                <div className="smc-lane-label">Branch</div>
                <div className="smc-lane-label">Content Type</div>
                <div className="smc-lane-label">Category</div>
                <div className="smc-lane-label">Course</div>
                {PINNED_COLUMNS.map((stage) => (
                  <div key={stage.key} className="smc-lane-label">
                    <span className="smc-step-icon" style={{ background: stage.color, width: 22, height: 22 }}>
                      {React.createElement(columnIcon(stage.key), { size: 13 })}
                    </span>
                    {stage.label}
                  </div>
                ))}
              </div>
              {sorted.length === 0 && <div className="smc-empty">No tasks</div>}
              {sorted.map((task, rowIndex) => {
                const dateValue = String(task.production?.sheet_date || task.due_date || '').slice(0, 10);
                const categoryValue = task.production?.course_type || '';
                const courseValue = task.production?.course_id || '';
                const rowCourses = coursesForCategory(categoryValue);
                const courseOptions = courseValue && !rowCourses.some((item) => item.course_id === courseValue)
                  ? [...rowCourses, {
                    course_id: courseValue,
                    course_name: task.production?.course || task.title || courseValue,
                    course_type: categoryValue,
                  }]
                  : rowCourses;
                return (
                  <div key={task.id} className="smc-lane-row smc-lane-row--pin">
                    <div className="smc-lane-meta">{rowIndex + 1}</div>
                    <div className="smc-lane-meta smc-lane-meta--delete">
                      <button type="button" className="smc-row-delete" aria-label={`Delete row ${rowIndex + 1}`} onClick={() => removeRow(task)}>
                        <MdDelete size={16} />
                      </button>
                    </div>
                    <div className="smc-lane-meta">
                      <input
                        type="date"
                        className="smc-inline"
                        value={dateValue}
                        aria-label="Date"
                        onChange={(event) => saveRowField(task.id, 'date', event.target.value)}
                      />
                    </div>
                    <div className="smc-lane-meta">
                      <select
                        className="smc-inline"
                        value={task.content_branch || ''}
                        aria-label="Branch"
                        onChange={(event) => saveRowField(task.id, 'branch', event.target.value)}
                      >
                        <option value="">Branch</option>
                        {branchChoices.map((item) => (
                          <option key={item.value} value={item.value}>{item.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="smc-lane-meta">
                      <select
                        className="smc-inline"
                        value={task.content_type || ''}
                        aria-label="Content type"
                        onChange={(event) => saveRowField(task.id, 'type', event.target.value)}
                      >
                        <option value="">Type</option>
                        {contentTypes.map((item) => (
                          <option key={item.code} value={item.code}>{item.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="smc-lane-meta smc-lane-meta--search">
                      <RowSearchSelect
                        value={categoryValue}
                        ariaLabel="Category"
                        placeholder="Category"
                        options={categoryChoices.map((item) => ({ value: item, label: item }))}
                        onChange={(next) => saveRowField(task.id, 'category', next)}
                        addLabel="Add category"
                        onAdd={(draft) => openCategoryEditor(task, draft)}
                      />
                    </div>
                    <div className="smc-lane-meta smc-lane-meta--search">
                      <RowSearchSelect
                        value={courseValue}
                        ariaLabel="Course"
                        placeholder={categoryValue ? 'Course' : 'Pick category first'}
                        disabled={!categoryValue}
                        options={courseOptions.map((item) => ({
                          value: item.course_id,
                          label: item.course_name,
                        }))}
                        onChange={(next) => saveRowField(task.id, 'course', next)}
                        addLabel={categoryValue ? 'Add course' : undefined}
                        onAdd={categoryValue ? (draft) => openCourseEditor(task, draft) : undefined}
                      />
                    </div>
                    {PINNED_COLUMNS.map((stage) => renderStageCell(task, stage, {
                      menuFor, setMenuFor, openTask, people, onPostAssignee: savePostAssignee,
                    }))}
                  </div>
                );
              })}
            </div>
            <div className="smc-board-scroll" ref={stageScrollRef} onScroll={syncBoardScroll('stage')}>
              <div className="smc-board-scroll-inner">
                <div className="smc-lane-head smc-lane-head--scroll">
                  {SCROLL_COLUMNS.map((stage) => (
                    <div key={stage.key} className={`smc-lane-label${stage.posting ? ' posting' : ''}`}>
                      <span className="smc-step-icon" style={{ background: stage.color, width: 22, height: 22 }}>
                        {React.createElement(columnIcon(stage.key), { size: 13 })}
                      </span>
                      {stage.label}
                    </div>
                  ))}
                </div>
                {sorted.map((task) => (
                  <div key={task.id} className="smc-lane-row smc-lane-row--scroll">
                    {SCROLL_COLUMNS.map((stage) => renderStageCell(task, stage, {
                      menuFor, setMenuFor, openTask, people, onPostAssignee: savePostAssignee,
                    }))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="smc-lane-foot">
            <button type="button" className="smc-btn smc-btn-primary smc-add-row" onClick={addRow} disabled={adding}>
              <MdAdd size={18} /> {adding ? 'Adding…' : 'Add row'}
                </button>
            </div>
          {menuFor && boardMenuTask && (
            <>
              <button type="button" className="smc-menu-backdrop" aria-label="Close menu" onClick={() => setMenuFor(null)} />
              <div className="smc-menu smc-menu-fixed" style={{ top: menuFor.top, left: menuFor.left }}>
                <button type="button" onClick={() => { setMenuFor(null); openTask(boardMenuTask, shownStage(boardMenuTask)); }}>Open details</button>
                {actionsFor(boardMenuTask, canManage, meId).filter((item) => !item.feedback && item.action !== 'save_channel_post').slice(0, 2).map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    onClick={() => { setMenuFor(null); runAction(item.action, boardMenuTask); }}
                  >
                          {item.label}
                  </button>
                      ))}
                  </div>
                </>
              )}
        </div>
      )}

      {courseEditor && (
        <CourseEditorModal
          key={`${courseEditor.mode}-${courseEditor.taskId}-${courseEditor.category}-${courseEditor.initialCourse}`}
          mode={courseEditor.mode}
          category={courseEditor.category}
          initialCourse={courseEditor.initialCourse}
          busy={courseEditorBusy}
          onClose={() => {
            if (!courseEditorBusy) setCourseEditor(null);
          }}
          onSubmit={submitCourseEditor}
        />
      )}

      {selected && !contentModal && (
        <div className="smc-overlay center middle" onMouseDown={closeTask}>
          <div className="smc-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="smc-stage-title">
            <div className="smc-modal-head">
              <div>
                <h2 id="smc-stage-title">{stageMeta(activeViewStage).label}</h2>
                <p className="smc-kicker">{selected.code} · {selected.title}</p>
              </div>
              <button type="button" className="smc-icon-btn" onClick={closeTask} aria-label="Close"><MdClose /></button>
            </div>
            <TaskPage
              task={selected}
              branches={branches}
              people={people}
              meId={meId}
              notice={notice}
              feedback={feedback}
              setFeedback={setFeedback}
              events={events}
              busy={busy}
              actions={actions}
              showHistory
              updateField={updateField}
              updateProduction={updateProduction}
              onTask={replaceTask}
              onAssign={(assignedTo) => patchRow(selected.id, { assigned_to: assignedTo })}
              onSave={() => saveTask()}
              onAction={runAction}
              onBack={closeTask}
              asForm
              viewStage={activeViewStage}
            />
          </div>
        </div>
      )}

      {contentModal && selected && (
        <div className="smc-overlay center middle" onMouseDown={closeTask}>
          <div className="smc-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="smc-content-title">
            <div className="smc-modal-head">
              <div>
                <h2 id="smc-content-title">Content</h2>
                <p className="smc-kicker">{selected.code} · {selected.title}</p>
              </div>
              <button type="button" className="smc-icon-btn" onClick={closeTask} aria-label="Close"><MdClose /></button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (canActOnView) runAction('submit_for_approval');
              }}
            >
              {notice && <div className="smc-banner ok">{notice}</div>}
              <ContentSheetForm
                task={selected}
                updateField={updateField}
                updateProduction={updateProduction}
                onTask={replaceTask}
                people={people}
                meId={meId}
                onAssign={(assignedTo, name) => patchRow(selected.id, {
                  assigned_to: assignedTo,
                  production: {
                    ...(selected.production || {}),
                    content_writer: name || '',
                    content_writer_id: assignedTo ? String(assignedTo) : '',
                  },
                })}
              />
              <div className="smc-actions">
                {canActOnView && actions.some((item) => item.action === 'submit_for_approval') && (
                  <button type="submit" className="smc-btn smc-btn-primary" disabled={busy}>Submit content</button>
                )}
                <button type="button" className="smc-btn" disabled={busy} onClick={() => saveTask()}>Save</button>
                <button type="button" className="smc-btn" onClick={closeTask}>Cancel</button>
                    </div>
              <details className="smc-work-card smc-history" open>
                <summary>History</summary>
                <ul className="smc-activity">
                  {events.length === 0 && <li>No history yet.</li>}
                  {events.map((item) => (
                    <li key={item.id}>
                      <strong>{ACTION_LABELS[item.action] || item.action}</strong>
                      {' '}by {item.actor_name}
                      {item.feedback ? <div className="smc-feedback">{item.feedback}</div> : null}
                      <small>{formatWhen(item.created_at)} · {stageMeta(item.to_stage).label} · {statusMeta(item.to_status).label}</small>
                    </li>
                  ))}
                </ul>
              </details>
            </form>
              </div>
        </div>
      )}

    </div>
  );
}
