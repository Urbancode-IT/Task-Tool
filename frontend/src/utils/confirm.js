export const CONFIRM_EVENT = 'app:confirm';

/**
 * Promise-based replacement for window.confirm — shows the app's own styled
 * dialog (rendered once by <ConfirmDialog>) instead of a native browser pop-up.
 * Resolves true when confirmed, false when cancelled/dismissed.
 *
 *   if (!(await confirmDialog({ title: 'Delete task?', message: '…', danger: true }))) return;
 */
export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
} = {}) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent(CONFIRM_EVENT, {
        detail: { title, message, confirmLabel, cancelLabel, danger, resolve },
      })
    );
  });
}
