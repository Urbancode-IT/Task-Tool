import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdChevronLeft, MdChevronRight, MdClose, MdDownload } from 'react-icons/md';
import { attachmentUrl } from '../../api/chatApi';

/**
 * Full-screen viewer for chat images, opened in the same tab. Escape or a click on the
 * dark backdrop closes it; arrow keys move between the images of the same message.
 */
export default function MediaViewer({ files, startIndex = 0, onClose }) {
  const [index, setIndex] = useState(startIndex);
  const file = files[index];
  const many = files.length > 1;

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Close the viewer only, not the chat window behind it.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' && many) {
        e.preventDefault();
        setIndex((i) => (i + 1) % files.length);
      } else if (e.key === 'ArrowLeft' && many) {
        e.preventDefault();
        setIndex((i) => (i - 1 + files.length) % files.length);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [files.length, many, onClose]);

  if (!file) return null;
  const step = (delta) => (e) => {
    e.stopPropagation();
    setIndex((i) => (i + delta + files.length) % files.length);
  };

  return createPortal(
    <div
      className="chat-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={file.file_name}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="chat-viewer-bar">
        <span className="chat-viewer-name">
          {file.file_name}
          {many ? ` · ${index + 1} of ${files.length}` : ''}
        </span>
        <a className="chat-viewer-btn" href={attachmentUrl(file.id, true)} title="Download" aria-label="Download">
          <MdDownload size={22} />
        </a>
        <button type="button" className="chat-viewer-btn" onClick={onClose} title="Close (Esc)" aria-label="Close">
          <MdClose size={24} />
        </button>
      </div>
      {many ? (
        <button type="button" className="chat-viewer-nav prev" onClick={step(-1)} aria-label="Previous image">
          <MdChevronLeft size={34} />
        </button>
      ) : null}
      <img key={file.id} className="chat-viewer-img" src={attachmentUrl(file.id)} alt={file.file_name} />
      {many ? (
        <button type="button" className="chat-viewer-nav next" onClick={step(1)} aria-label="Next image">
          <MdChevronRight size={34} />
        </button>
      ) : null}
    </div>,
    document.body
  );
}
