export const TOAST_EVENT = 'app:toast';

export const showToast = (message, type = 'info', duration = 3500) => {
  if (typeof window === 'undefined' || !message) return;
  window.dispatchEvent(
    new CustomEvent(TOAST_EVENT, { detail: { message, type, duration } })
  );
};

export const toastSuccess = (message, duration) => showToast(message, 'success', duration);
export const toastError = (message, duration) => showToast(message, 'error', duration);
export const toastInfo = (message, duration) => showToast(message, 'info', duration);
