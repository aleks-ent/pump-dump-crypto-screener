export type ReviewAnnotationCategory =
  | "sustained_move"
  | "wick_spike"
  | "volume_only"
  | "market_move"
  | "illiquid_noise"
  | "unclear";

export type ReviewAnnotationConfidence = "high" | "medium" | "low";

export interface ReviewAnnotationEvent {
  id: string;
  category?: ReviewAnnotationCategory | null;
  confidence?: ReviewAnnotationConfidence | null;
  comment?: string | null;
}

export interface ReviewEventNavigationItem {
  id: string;
  status: "unreviewed" | "reviewed" | "unclear";
}

const CATEGORIES: ReadonlyArray<{
  value: ReviewAnnotationCategory;
  label: string;
  hint: string;
}> = [
  { value: "sustained_move", label: "Sustained move", hint: "Directional move with continuation" },
  { value: "wick_spike", label: "Wick spike", hint: "Brief spike without continuation" },
  { value: "volume_only", label: "Volume only", hint: "Activity increased without a price move" },
  { value: "market_move", label: "Market move", hint: "Moved with the broader market" },
  { value: "illiquid_noise", label: "Illiquid noise", hint: "Sparse, unreliable, or untradeable market" },
  { value: "unclear", label: "Unclear", hint: "Insufficient or ambiguous evidence" },
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Choose the next loaded row without wrapping. An unreviewed row wins over a
 * reviewed row later in the same filtered result set.
 */
export function findNextReviewEventId(
  events: ReadonlyArray<ReviewEventNavigationItem>,
  currentEventId: string,
): string | null {
  const currentIndex = events.findIndex((event) => event.id === currentEventId);
  const following = events.slice(currentIndex < 0 ? 0 : currentIndex + 1);
  return (
    following.find((event) => event.status === "unreviewed")?.id ??
    following[0]?.id ??
    null
  );
}

export function renderReviewAnnotation(event: ReviewAnnotationEvent | null): string {
  const eventId = event ? escapeHtml(event.id) : "";
  const hasExistingAnnotation = event?.category != null;
  const confidence = hasExistingAnnotation ? (event?.confidence ?? "") : "high";
  const disabled = event == null ? " disabled" : "";

  return `<aside class="annotation-panel" aria-label="Annotation" data-annotation-root data-event-id="${eventId}" data-annotation-state="${event ? "ready" : "disabled"}" data-annotation-dirty="false">
      <header><p class="eyebrow">Human annotation</p><h2>Classify event</h2></header>
      <form data-annotation-form>
        <fieldset${disabled}>
          <legend>Category</legend>
          <div class="category-list">
            ${CATEGORIES.map(
              (category, index) => `<label class="category-option" data-category="${category.value}">
                <input type="radio" name="category" value="${category.value}"${event?.category === category.value ? " checked" : ""}>
                <kbd>${index + 1}</kbd><span><strong>${category.label}</strong><small>${category.hint}</small></span>
              </label>`,
            ).join("")}
          </div>
          <label class="field-label" for="review-confidence">Confidence <span>optional</span></label>
          <select id="review-confidence" name="confidence">
            <option value=""${confidence === "" ? " selected" : ""}>Not specified</option>
            <option value="high"${confidence === "high" ? " selected" : ""}>High</option>
            <option value="medium"${confidence === "medium" ? " selected" : ""}>Medium</option>
            <option value="low"${confidence === "low" ? " selected" : ""}>Low</option>
          </select>
          <label class="field-label" for="review-comment">Comment <span>optional</span></label>
          <textarea id="review-comment" name="comment" rows="4" maxlength="4000" placeholder="What happened during this pump event?">${escapeHtml(event?.comment ?? "")}</textarea>
          <div class="save-actions">
            <button type="submit" class="button-secondary" data-annotation-save>Save</button>
            <button type="button" class="button-primary" data-annotation-save-next>Save &amp; Next</button>
          </div>
        </fieldset>
      </form>
      <div class="annotation-feedback" data-annotation-feedback aria-live="polite" role="status">
        <span data-annotation-message>${event ? (hasExistingAnnotation ? "Editing saved annotation." : "Choose a category to begin.") : "Select an event to enable annotation controls."}</span>
        <button type="button" data-annotation-retry hidden>Try again</button>
      </div>
    </aside>`;
}

/** Dependency-free browser client for annotation creation and editing. */
export const REVIEW_ANNOTATION_CLIENT_SCRIPT = String.raw`
    (() => {
      const roots = document.querySelectorAll('[data-annotation-root]');

      const init = (root) => {
        const form = root.querySelector('[data-annotation-form]');
        const fieldset = form && form.querySelector('fieldset');
        const saveButton = root.querySelector('[data-annotation-save]');
        const saveNextButton = root.querySelector('[data-annotation-save-next]');
        const retryButton = root.querySelector('[data-annotation-retry]');
        const message = root.querySelector('[data-annotation-message]');
        const eventId = root.dataset.eventId || '';
        if (!form || !fieldset || !saveButton || !saveNextButton || !retryButton || !message || !eventId) return;

        let saving = false;
        let lastAction = 'save';
        const snapshot = () => {
          const selected = form.querySelector('input[name="category"]:checked');
          const confidence = form.querySelector('[name="confidence"]');
          const comment = form.querySelector('[name="comment"]');
          return JSON.stringify({
            category: selected ? selected.value : '',
            confidence: confidence ? confidence.value : '',
            comment: comment ? comment.value : ''
          });
        };
        let savedSnapshot = snapshot();

        const announceDirtyState = () => {
          const dirty = snapshot() !== savedSnapshot;
          root.dataset.annotationDirty = String(dirty);
          root.dispatchEvent(new CustomEvent('review:annotation-dirty-change', {
            bubbles: true, detail: { eventId, dirty }
          }));
        };

        const showState = (state, text, retry) => {
          root.dataset.annotationState = state;
          message.textContent = text;
          retryButton.hidden = !retry;
        };

        const setSaving = (value) => {
          saving = value;
          fieldset.disabled = value;
          saveButton.disabled = value;
          saveNextButton.disabled = value;
          saveButton.textContent = value && lastAction === 'save' ? 'Saving…' : 'Save';
          saveNextButton.textContent = value && lastAction === 'next' ? 'Saving…' : 'Save & Next';
        };

        const updateEventRow = (annotation) => {
          const row = [...document.querySelectorAll('[data-event-row]')]
            .find((candidate) => candidate.dataset.eventId === eventId);
          if (!row) return;
          const status = annotation.category === 'unclear' ? 'unclear' : 'reviewed';
          row.dataset.reviewStatus = status;
          row.classList.remove('status-unreviewed', 'status-reviewed', 'status-unclear');
          row.classList.add('status-' + status);
          const statusText = row.querySelector('.event-status');
          const selected = form.querySelector('input[name="category"]:checked');
          const label = selected ? selected.closest('label').querySelector('strong').textContent : annotation.category;
          if (statusText) statusText.lastChild.textContent = (status === 'unclear' ? 'Unclear' : 'Reviewed') + ' · ' + label;
        };

        const nextRow = () => {
          const rows = [...document.querySelectorAll('[data-event-row]')];
          const currentIndex = rows.findIndex((row) => row.dataset.eventId === eventId);
          const following = rows.slice(currentIndex < 0 ? 0 : currentIndex + 1);
          return following.find((row) => row.dataset.reviewStatus === 'unreviewed') || following[0] || null;
        };

        const save = async (action) => {
          if (saving) return;
          const category = form.querySelector('input[name="category"]:checked');
          if (!category) {
            showState('validation-error', 'Select a category before saving.', false);
            form.querySelector('input[name="category"]')?.focus();
            return;
          }
          const confidence = form.querySelector('[name="confidence"]');
          const comment = form.querySelector('[name="comment"]');
          lastAction = action;
          setSaving(true);
          showState('saving', action === 'next' ? 'Saving annotation and finding the next event…' : 'Saving annotation…', false);
          try {
            const response = await fetch('/api/pump-events/' + encodeURIComponent(eventId) + '/annotation', {
              method: 'PUT',
              headers: { accept: 'application/json', 'content-type': 'application/json' },
              body: JSON.stringify({
                category: category.value,
                confidence: confidence && confidence.value ? confidence.value : null,
                comment: comment && comment.value.trim() ? comment.value : null
              })
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(body && body.error && body.error.message ? body.error.message : 'Request failed with status ' + response.status);
            }
            savedSnapshot = snapshot();
            announceDirtyState();
            updateEventRow(body);
            root.dispatchEvent(new CustomEvent('review:annotation-saved', {
              bubbles: true, detail: { eventId, annotation: body, action }
            }));
            if (action === 'next') {
              const next = nextRow();
              if (!next) {
                showState('no-more', 'No more matching events.', false);
                return;
              }
              showState('success', 'Saved. Opening the next event…', false);
              const navigationEvent = new CustomEvent('review:navigate-request', {
                cancelable: true,
                detail: { href: next.href, focusOnArrival: true }
              });
              if (document.dispatchEvent(navigationEvent)) window.location.assign(next.href);
              return;
            }
            showState('success', 'Annotation saved.', false);
          } catch (error) {
            showState('error', error instanceof Error ? error.message : 'Could not save annotation.', true);
          } finally {
            setSaving(false);
          }
        };

        form.addEventListener('submit', (event) => {
          event.preventDefault();
          save('save');
        });
        saveNextButton.addEventListener('click', () => save('next'));
        retryButton.addEventListener('click', () => save(lastAction));
        root.addEventListener('review:annotation-save-request', (event) => {
          const action = event.detail && event.detail.action === 'next' ? 'next' : 'save';
          save(action);
        });
        form.addEventListener('input', announceDirtyState);
        form.addEventListener('change', announceDirtyState);
      };

      roots.forEach(init);
    })();`;
