export type ReviewKeyboardAction =
  | { type: "category"; index: number }
  | { type: "save" }
  | { type: "save-next" }
  | { type: "next-event" }
  | { type: "previous-event" }
  | { type: "focus-comment" }
  | { type: "escape" };

export interface ReviewKeyboardContext {
  editing: boolean;
  textarea: boolean;
  ctrlOrMeta: boolean;
  alt?: boolean;
}

/** Resolve a review shortcut without depending on browser globals. */
export function resolveReviewKeyboardShortcut(
  key: string,
  context: ReviewKeyboardContext,
): ReviewKeyboardAction | null {
  if (key === "Escape") return { type: "escape" };
  if (context.alt) return null;

  if (key === "Enter" && context.ctrlOrMeta && context.textarea) {
    return { type: "save" };
  }
  if (context.editing) return null;
  if (key === "Enter" && context.ctrlOrMeta) return { type: "save" };
  if (key === "Enter") return { type: "save-next" };

  if (/^[1-6]$/.test(key)) {
    return { type: "category", index: Number(key) - 1 };
  }

  const normalized = key.toLowerCase();
  if (normalized === "j" || key === "ArrowDown") {
    return { type: "next-event" };
  }
  if (normalized === "k" || key === "ArrowUp") {
    return { type: "previous-event" };
  }
  if (normalized === "c") return { type: "focus-comment" };
  return null;
}

export function renderReviewKeyboardUi(): string {
  return `<div class="shortcut-help-wrap">
        <button type="button" class="shortcut-help-button" data-shortcut-help-toggle aria-expanded="false" aria-controls="review-shortcut-help">Keyboard shortcuts</button>
        <div id="review-shortcut-help" class="shortcut-popover" data-shortcut-help hidden>
          <div><strong>Keyboard shortcuts</strong><button type="button" data-shortcut-help-close aria-label="Close keyboard shortcuts">×</button></div>
          <dl>
            <div><dt><kbd>1</kbd>–<kbd>6</kbd></dt><dd>Select category</dd></div>
            <div><dt><kbd>Enter</kbd></dt><dd>Save &amp; Next</dd></div>
            <div><dt><kbd>Ctrl/⌘</kbd> + <kbd>Enter</kbd></dt><dd>Save</dd></div>
            <div><dt><kbd>J</kbd> / <kbd>↓</kbd></dt><dd>Next event</dd></div>
            <div><dt><kbd>K</kbd> / <kbd>↑</kbd></dt><dd>Previous event</dd></div>
            <div><dt><kbd>C</kbd></dt><dd>Focus comment</dd></div>
            <div><dt><kbd>Esc</kbd></dt><dd>Blur or close</dd></div>
          </dl>
        </div>
      </div>
      <dialog class="unsaved-dialog" data-unsaved-dialog aria-labelledby="unsaved-dialog-title" aria-describedby="unsaved-dialog-description">
        <form method="dialog">
          <h2 id="unsaved-dialog-title">Unsaved annotation</h2>
          <p id="unsaved-dialog-description">Save or discard your changes before opening another event.</p>
          <div class="unsaved-actions">
            <button type="button" class="button-primary" data-unsaved-save>Save and continue</button>
            <button type="button" class="button-danger" data-unsaved-discard>Discard</button>
            <button type="button" class="button-secondary" data-unsaved-cancel>Cancel</button>
          </div>
        </form>
      </dialog>`;
}

/** Dependency-free page client for shortcuts and safe event navigation. */
export const REVIEW_KEYBOARD_CLIENT_SCRIPT = String.raw`
    (() => {
      const page = document.querySelector('[data-review-page]');
      const annotation = document.querySelector('[data-annotation-root]');
      const dialog = document.querySelector('[data-unsaved-dialog]');
      const saveContinue = dialog && dialog.querySelector('[data-unsaved-save]');
      const discard = dialog && dialog.querySelector('[data-unsaved-discard]');
      const cancel = dialog && dialog.querySelector('[data-unsaved-cancel]');
      const helpToggle = document.querySelector('[data-shortcut-help-toggle]');
      const help = document.querySelector('[data-shortcut-help]');
      const helpClose = document.querySelector('[data-shortcut-help-close]');
      if (!page || !annotation || !dialog || !saveContinue || !discard || !cancel) return;

      let pendingHref = null;
      let awaitingSaveContinuation = false;
      let navigating = false;
      const list = document.querySelector('[data-event-list]');
      const comment = annotation.querySelector('[name="comment"]');

      const isDirty = () => annotation.dataset.annotationDirty === 'true';
      const saveListState = (focusOnArrival) => {
        try {
          if (list) sessionStorage.setItem('review:event-list-scroll', String(list.scrollTop));
          if (focusOnArrival) sessionStorage.setItem('review:restore-keyboard-focus', 'true');
        } catch (_) {}
      };
      const navigateNow = (href, focusOnArrival) => {
        navigating = true;
        saveListState(focusOnArrival);
        window.location.assign(href);
      };
      const requestNavigation = (href, focusOnArrival) => {
        if (!href) return;
        if (!isDirty()) {
          navigateNow(href, focusOnArrival);
          return;
        }
        pendingHref = href;
        dialog.dataset.focusOnArrival = String(Boolean(focusOnArrival));
        if (!dialog.open) dialog.showModal();
      };
      const closeDialog = () => {
        pendingHref = null;
        awaitingSaveContinuation = false;
        if (dialog.open) dialog.close();
      };
      const setHelpOpen = (open) => {
        if (!help || !helpToggle) return;
        help.hidden = !open;
        helpToggle.setAttribute('aria-expanded', String(open));
        if (open) helpClose && helpClose.focus();
        else helpToggle.focus();
      };

      try {
        const storedScroll = sessionStorage.getItem('review:event-list-scroll');
        if (list && storedScroll !== null) list.scrollTop = Number(storedScroll) || 0;
        sessionStorage.removeItem('review:event-list-scroll');
        if (sessionStorage.getItem('review:restore-keyboard-focus') === 'true') {
          sessionStorage.removeItem('review:restore-keyboard-focus');
          page.focus({ preventScroll: true });
        }
      } catch (_) {}

      document.addEventListener('review:navigate-request', (event) => {
        if (!event.detail || !event.detail.href) return;
        event.preventDefault();
        requestNavigation(event.detail.href, Boolean(event.detail.focusOnArrival));
      });

      document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = event.target instanceof Element ? event.target.closest('[data-event-row], [data-load-more]') : null;
        if (!target || !target.href) return;
        event.preventDefault();
        requestNavigation(target.href, target.matches('[data-event-row]'));
      });

      saveContinue.addEventListener('click', () => {
        if (!pendingHref) return closeDialog();
        awaitingSaveContinuation = true;
        if (dialog.open) dialog.close();
        annotation.dispatchEvent(new CustomEvent('review:annotation-save-request', {
          detail: { action: 'save' }
        }));
      });
      discard.addEventListener('click', () => {
        const href = pendingHref;
        const focusOnArrival = dialog.dataset.focusOnArrival === 'true';
        pendingHref = null;
        if (dialog.open) dialog.close();
        if (href) navigateNow(href, focusOnArrival);
      });
      cancel.addEventListener('click', closeDialog);
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDialog();
      });

      document.addEventListener('review:annotation-saved', () => {
        if (!awaitingSaveContinuation || !pendingHref) return;
        const href = pendingHref;
        const focusOnArrival = dialog.dataset.focusOnArrival === 'true';
        pendingHref = null;
        awaitingSaveContinuation = false;
        navigateNow(href, focusOnArrival);
      });

      helpToggle && helpToggle.addEventListener('click', () => setHelpOpen(help.hidden));
      helpClose && helpClose.addEventListener('click', () => setHelpOpen(false));
      document.addEventListener('click', (event) => {
        if (!help || help.hidden || !helpToggle) return;
        if (help.contains(event.target) || helpToggle.contains(event.target)) return;
        help.hidden = true;
        helpToggle.setAttribute('aria-expanded', 'false');
      });

      const editableTarget = (target) => target instanceof Element && Boolean(target.closest('input, select, textarea, [contenteditable]:not([contenteditable="false"])'));
      const requestSave = (action) => annotation.dispatchEvent(new CustomEvent('review:annotation-save-request', { detail: { action } }));
      const adjacentRow = (direction) => {
        const rows = [...document.querySelectorAll('[data-event-row]')];
        const currentIndex = rows.findIndex((row) => row.getAttribute('aria-current') === 'true' || row.dataset.eventId === page.dataset.selectedEventId);
        const targetIndex = currentIndex < 0 ? (direction > 0 ? 0 : rows.length - 1) : currentIndex + direction;
        return rows[targetIndex] || null;
      };

      document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented) return;
        const editing = editableTarget(event.target);
        const inTextarea = event.target instanceof Element && Boolean(event.target.closest('textarea'));
        let action = null;
        if (event.key === 'Escape') action = 'escape';
        else if (event.altKey) return;
        else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && inTextarea) action = 'save';
        else if (editing) return;
        else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) action = 'save';
        else if (event.key === 'Enter') action = 'next';
        else if (/^[1-6]$/.test(event.key)) action = 'category-' + event.key;
        else if (event.key.toLowerCase() === 'j' || event.key === 'ArrowDown') action = 'row-next';
        else if (event.key.toLowerCase() === 'k' || event.key === 'ArrowUp') action = 'row-previous';
        else if (event.key.toLowerCase() === 'c') action = 'comment';
        if (!action) return;

        if (action === 'escape') {
          if (dialog.open) {
            event.preventDefault();
            closeDialog();
          } else if (help && !help.hidden) {
            event.preventDefault();
            setHelpOpen(false);
          } else if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
          }
          return;
        }
        event.preventDefault();
        if (action.startsWith('category-')) {
          annotation.querySelectorAll('input[name="category"]')[Number(action.slice(-1)) - 1]?.click();
        } else if (action === 'save') {
          requestSave('save');
        } else if (action === 'next') {
          requestSave('next');
        } else if (action === 'comment') {
          comment && comment.focus();
        } else {
          const row = adjacentRow(action === 'row-next' ? 1 : -1);
          if (row) requestNavigation(row.href, true);
        }
      });

      window.addEventListener('beforeunload', (event) => {
        if (!navigating && isDirty()) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    })();`;
