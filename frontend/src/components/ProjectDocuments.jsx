import React, { useEffect, useRef, useState } from 'react';
import {
  MdDescription,
  MdAssignment,
  MdVpnKey,
  MdUploadFile,
  MdVisibility,
  MdDownload,
  MdDelete,
  MdAutorenew,
} from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import { toastSuccess, toastError } from '../utils/toast';
import './ProjectDocuments.css';

// The three document slots every project carries. Order is intentional.
const DOC_TYPES = [
  {
    key: 'project_documentation',
    label: 'Project Documentation',
    icon: MdDescription,
    hint: 'Scope, architecture, setup and usage notes.',
  },
  {
    key: 'brd',
    label: 'BRD Document',
    icon: MdAssignment,
    hint: 'Business Requirements Document.',
  },
  {
    key: 'credentials',
    label: 'Credentials Document',
    icon: MdVpnKey,
    hint: 'Access details and credentials for the project.',
  },
];

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB per document
const ACCEPT =
  '.pdf,.doc,.docx,.txt,.rtf,.md,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.csv,.ppt,.pptx';

function formatWhen(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

/**
 * Per-project documents panel: three upload slots (Project Documentation, BRD,
 * Credentials). Any signed-in user can upload, view, download, or remove — the
 * feature is intentionally open per requirement.
 */
export default function ProjectDocuments({ projectId, className = '' }) {
  const [docsByType, setDocsByType] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState(null); // doc_type currently uploading/removing
  const fileInputs = useRef({}); // doc_type -> input element

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setDocsByType({});
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    itUpdatesApi
      .listProjectDocuments(projectId)
      .then((res) => {
        if (cancelled) return;
        const map = {};
        (Array.isArray(res.data) ? res.data : []).forEach((d) => {
          map[d.doc_type] = d;
        });
        setDocsByType(map);
      })
      .catch(() => {
        if (!cancelled) setDocsByType({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const pickFile = (docType) => {
    const input = fileInputs.current[docType];
    if (input) input.click();
  };

  const handleFile = async (docType, file) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toastError('File is too large. Maximum size is 10 MB.');
      return;
    }
    setBusyType(docType);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read file'));
        reader.readAsDataURL(file);
      });
      const res = await itUpdatesApi.uploadProjectDocument(projectId, docType, {
        file_name: file.name,
        mime_type: file.type || null,
        file_data: dataUrl,
      });
      setDocsByType((prev) => ({ ...prev, [docType]: res.data }));
      toastSuccess('Document uploaded.');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Failed to upload document.');
    } finally {
      setBusyType(null);
      const input = fileInputs.current[docType];
      if (input) input.value = '';
    }
  };

  // Fetch the full document (with base64) then open or download it.
  const withFile = async (docType, action) => {
    setBusyType(docType);
    try {
      const res = await itUpdatesApi.getProjectDocument(projectId, docType);
      const doc = res.data;
      if (!doc?.file_data) {
        toastError('Document is unavailable.');
        return;
      }
      if (action === 'view') {
        const win = window.open();
        if (win) {
          win.document.write(
            `<iframe src="${doc.file_data}" style="border:0;width:100vw;height:100vh" title="${doc.file_name || 'document'}"></iframe>`
          );
          win.document.title = doc.file_name || 'Document';
        } else {
          toastError('Pop-up blocked. Allow pop-ups to view the document.');
        }
      } else {
        const a = document.createElement('a');
        a.href = doc.file_data;
        a.download = doc.file_name || `${docType}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      toastError(err?.response?.data?.message || 'Failed to open document.');
    } finally {
      setBusyType(null);
    }
  };

  const removeDoc = async (docType) => {
    if (!window.confirm('Remove this document?')) return;
    setBusyType(docType);
    try {
      await itUpdatesApi.deleteProjectDocument(projectId, docType);
      setDocsByType((prev) => {
        const next = { ...prev };
        delete next[docType];
        return next;
      });
      toastSuccess('Document removed.');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Failed to remove document.');
    } finally {
      setBusyType(null);
    }
  };

  if (!projectId) {
    return <p className="proj-docs-empty">Save the project first to attach documents.</p>;
  }

  return (
    <div className={`proj-docs ${className}`}>
      {DOC_TYPES.map(({ key, label, icon: Icon, hint }) => {
        const doc = docsByType[key];
        const busy = busyType === key;
        return (
          <div key={key} className={`proj-docs-slot ${doc ? 'has-file' : ''}`}>
            <div className="proj-docs-slot-icon">
              <Icon size={22} />
            </div>
            <div className="proj-docs-slot-body">
              <div className="proj-docs-slot-title">{label}</div>
              {doc ? (
                <div className="proj-docs-slot-meta">
                  <span className="proj-docs-file" title={doc.file_name || ''}>
                    {doc.file_name || 'Uploaded file'}
                  </span>
                  <span className="proj-docs-sub">
                    {doc.uploaded_by_name ? `${doc.uploaded_by_name} · ` : ''}
                    {formatWhen(doc.uploaded_at)}
                  </span>
                </div>
              ) : (
                <div className="proj-docs-slot-hint">{hint}</div>
              )}
            </div>
            <div className="proj-docs-slot-actions">
              <input
                type="file"
                accept={ACCEPT}
                ref={(el) => {
                  fileInputs.current[key] = el;
                }}
                onChange={(e) => handleFile(key, e.target.files?.[0])}
                style={{ display: 'none' }}
              />
              {doc ? (
                <>
                  <button
                    type="button"
                    className="proj-docs-btn"
                    onClick={() => withFile(key, 'view')}
                    disabled={busy}
                    title="View"
                  >
                    <MdVisibility size={18} />
                  </button>
                  <button
                    type="button"
                    className="proj-docs-btn"
                    onClick={() => withFile(key, 'download')}
                    disabled={busy}
                    title="Download"
                  >
                    <MdDownload size={18} />
                  </button>
                  <button
                    type="button"
                    className="proj-docs-btn"
                    onClick={() => pickFile(key)}
                    disabled={busy}
                    title="Replace"
                  >
                    <MdAutorenew size={18} />
                  </button>
                  <button
                    type="button"
                    className="proj-docs-btn proj-docs-btn-danger"
                    onClick={() => removeDoc(key)}
                    disabled={busy}
                    title="Remove"
                  >
                    <MdDelete size={18} />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="proj-docs-btn proj-docs-btn-upload"
                  onClick={() => pickFile(key)}
                  disabled={busy || loading}
                >
                  <MdUploadFile size={18} />
                  {busy ? 'Uploading…' : 'Upload'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
