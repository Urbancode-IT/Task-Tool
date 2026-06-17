import { MdLock, MdLogout } from 'react-icons/md';

/**
 * Full-screen lock shown when the current user missed an EOD report. The app behind
 * is blurred and non-interactive; only an admin can unlock the account, so there is
 * no self-service action other than logging out.
 * Props: lockDate (YYYY-MM-DD | null), onLogout
 */
export default function EodLockScreen({ lockDate, onLogout }) {
  return (
    <div className="eod-lock-overlay" role="dialog" aria-modal="true" aria-label="Account locked">
      <div className="eod-lock-card">
        <div className="eod-lock-icon">
          <MdLock size={30} />
        </div>
        <h2 className="eod-lock-title">Access paused</h2>
        <p className="eod-lock-text">
          You did not submit your EOD report
          {lockDate ? ` for ${lockDate}` : ''}. Submitting daily end-of-day reports is
          mandatory, so your account is locked.
        </p>
        <p className="eod-lock-text eod-lock-text-muted">
          Your access will be restored only after an admin reviews and approves your
          account. Please reach out to your administrator.
        </p>
        <div className="eod-lock-badge">Reported to admin</div>
        <button type="button" className="eod-lock-logout" onClick={onLogout}>
          <MdLogout size={16} />
          Log out
        </button>
      </div>
    </div>
  );
}
