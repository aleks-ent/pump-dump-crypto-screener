import { describe, expect, it } from "vitest";
import {
  renderReviewKeyboardUi,
  resolveReviewKeyboardShortcut,
  REVIEW_KEYBOARD_CLIENT_SCRIPT,
} from "./review-keyboard-client.js";

const browsing = { editing: false, textarea: false, ctrlOrMeta: false };

describe("review keyboard client", () => {
  it("maps the complete review shortcut set", () => {
    for (let key = 1; key <= 6; key += 1) {
      expect(resolveReviewKeyboardShortcut(String(key), browsing)).toEqual({
        type: "category",
        index: key - 1,
      });
    }
    expect(resolveReviewKeyboardShortcut("Enter", browsing)).toEqual({
      type: "save-next",
    });
    expect(
      resolveReviewKeyboardShortcut("Enter", {
        ...browsing,
        ctrlOrMeta: true,
      }),
    ).toEqual({ type: "save" });
    expect(resolveReviewKeyboardShortcut("j", browsing)).toEqual({
      type: "next-event",
    });
    expect(resolveReviewKeyboardShortcut("ArrowDown", browsing)).toEqual({
      type: "next-event",
    });
    expect(resolveReviewKeyboardShortcut("K", browsing)).toEqual({
      type: "previous-event",
    });
    expect(resolveReviewKeyboardShortcut("ArrowUp", browsing)).toEqual({
      type: "previous-event",
    });
    expect(resolveReviewKeyboardShortcut("c", browsing)).toEqual({
      type: "focus-comment",
    });
    expect(resolveReviewKeyboardShortcut("Escape", browsing)).toEqual({
      type: "escape",
    });
  });

  it("suppresses shortcuts while editing except textarea save and Escape", () => {
    const input = { editing: true, textarea: false, ctrlOrMeta: false };
    const textarea = { editing: true, textarea: true, ctrlOrMeta: false };

    expect(resolveReviewKeyboardShortcut("1", input)).toBeNull();
    expect(resolveReviewKeyboardShortcut("j", input)).toBeNull();
    expect(resolveReviewKeyboardShortcut("Enter", textarea)).toBeNull();
    expect(
      resolveReviewKeyboardShortcut("Enter", {
        ...textarea,
        ctrlOrMeta: true,
      }),
    ).toEqual({ type: "save" });
    expect(resolveReviewKeyboardShortcut("Escape", textarea)).toEqual({
      type: "escape",
    });
  });

  it("renders visible help and an accessible unsaved-changes dialog", () => {
    const html = renderReviewKeyboardUi();

    expect(html).toContain("Keyboard shortcuts");
    expect(html).toContain('aria-controls="review-shortcut-help"');
    expect(html).toContain("Ctrl/⌘");
    expect(html).toContain('data-unsaved-dialog');
    expect(html).toContain('aria-labelledby="unsaved-dialog-title"');
    expect(html).toContain("Save and continue");
    expect(html).toContain("Discard");
    expect(html).toContain("Cancel");
  });

  it("ships guarded navigation, save continuation, and unload protection", () => {
    expect(() => new Function(REVIEW_KEYBOARD_CLIENT_SCRIPT)).not.toThrow();
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("review:annotation-save-request");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("review:annotation-saved");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("review:navigate-request");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("dialog.showModal()");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("beforeunload");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("[contenteditable]");
    expect(REVIEW_KEYBOARD_CLIENT_SCRIPT).toContain("review:restore-keyboard-focus");
  });
});
