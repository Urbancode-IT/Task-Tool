/**
 * Keyboard shortcuts for forms (project-wide convention).
 *
 *   Enter            → submit the form / run the primary action
 *   Shift + Enter    → insert a newline (inside text areas / editors)
 *   Escape           → close the modal or cancel the open sub-form
 *
 * IME composition (e.isComposing) is always ignored so Enter can confirm a
 * composition without submitting.
 */

/**
 * onKeyDown for a single control that should run its own action on Enter instead of
 * submitting the surrounding <form> — e.g. the "add requirement" sub-form that lives
 * inside the task form. Stops propagation so the parent form neither submits (Enter)
 * nor closes (Escape).
 */
export function controlKeys({ onEnter, onEscape } = {}) {
  return (e) => {
    if (e.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey && onEnter) {
      e.preventDefault();
      e.stopPropagation();
      onEnter();
    } else if (e.key === 'Escape' && onEscape) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
    }
  };
}

/**
 * onKeyDown for a <textarea> inside a <form>: plain Enter submits the form (via the
 * form's onSubmit handler), Shift+Enter inserts a newline.
 */
export function textareaSubmit(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  const form = e.currentTarget.form;
  if (!form || typeof form.requestSubmit !== 'function') return;
  e.preventDefault();
  form.requestSubmit();
}

/**
 * onKeyDown for a modal/form container: Escape calls `onClose`. Safe to attach to a
 * <form> or modal wrapper; Enter is left to native form submission / field handlers.
 */
export function escapeCloses(onClose) {
  return (e) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    e.preventDefault();
    onClose?.();
  };
}
