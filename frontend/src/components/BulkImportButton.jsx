import React, { useState } from 'react';
import { MdUploadFile } from 'react-icons/md';
import BulkImportModal from './BulkImportModal';

/**
 * "Import" button for a task filter bar; opens the CSV import window. Used by My Tasks
 * and the All Tasks pages. Props are passed straight to BulkImportModal.
 */
export default function BulkImportButton({ onImport, statuses, statusLabel, projects, assignees, assigners, currentUser, requireProject }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="mtl-import-btn" onClick={() => setOpen(true)} title="Import tasks from a CSV file">
        <MdUploadFile size={17} />
        Import
      </button>
      {open ? (
        <BulkImportModal
          onClose={() => setOpen(false)}
          onImport={onImport}
          statuses={statuses}
          statusLabel={statusLabel}
          projects={projects}
          assignees={assignees}
          assigners={assigners}
          currentUser={currentUser}
          requireProject={requireProject}
        />
      ) : null}
    </>
  );
}
