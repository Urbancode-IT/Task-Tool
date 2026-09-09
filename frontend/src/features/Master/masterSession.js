import authApi from '../../api/authApi';
import { toastError } from '../../utils/toast';

/**
 * Confirm the browser still holds a master-console session before publishing.
 *
 * The console and the workspace share one pair of session cookies, so signing in to
 * the workspace in the same browser replaces a master session — including in a
 * console tab that is still open and looks fine. Publishing then fails on the first
 * brand-asset upload ("Brand assets are managed in the master console…"), which reads
 * like a permissions problem when it is really a replaced session. Worse, a profile
 * publish would appear to succeed while the server quietly keeps the master-owned
 * fields, because those are only writable by a master session.
 *
 * Checking first turns both cases into one clear message, and nothing staged is lost:
 * sign in again at /master in another tab and press Publish again.
 *
 * @returns {Promise<boolean>} true when the session may publish.
 */
export async function ensureMasterSession() {
  try {
    const { data } = await authApi.me();
    if (data?.user?.scope === 'master') return true;
  } catch {
    // Treated the same as a non-master session: publishing cannot go ahead.
  }
  toastError(
    'This browser is no longer signed in to the master console — signing in to the workspace replaces that session. Sign in again at /master in another tab, then press Publish again. Nothing you staged here is lost.'
  );
  return false;
}

export default ensureMasterSession;
