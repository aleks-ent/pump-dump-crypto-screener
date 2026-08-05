import { describe, expect, it } from "vitest";
import {
  findNextReviewEventId,
  renderReviewAnnotation,
  REVIEW_ANNOTATION_CLIENT_SCRIPT,
} from "./review-annotation-client.js";

describe("review annotation client", () => {
  it("renders enabled six-category controls with high confidence by default", () => {
    const html = renderReviewAnnotation({ id: "event-101" });

    expect(html).toContain('data-annotation-state="ready"');
    expect(html).not.toContain("<fieldset disabled>");
    expect(html.match(/type="radio"/g)).toHaveLength(6);
    expect(html).toContain('value="high" selected');
    expect(html).toContain('maxlength="4000"');
    expect(html).toContain("Save &amp; Next");
    expect(html).toContain("data-annotation-retry");
  });

  it("renders and safely escapes an existing annotation for editing", () => {
    const html = renderReviewAnnotation({
      id: 'event-<unsafe>"',
      category: "wick_spike",
      confidence: null,
      comment: '<script>alert("no")</script>',
    });

    expect(html).toContain('data-event-id="event-&lt;unsafe&gt;&quot;"');
    expect(html).toContain('value="wick_spike" checked');
    expect(html).toContain('<option value="" selected>Not specified</option>');
    expect(html).toContain("&lt;script&gt;alert(&quot;no&quot;)&lt;/script&gt;");
    expect(html).toContain("Editing saved annotation.");
    expect(html).not.toContain('<script>alert("no")</script>');
  });

  it("disables the panel until an event is selected", () => {
    const html = renderReviewAnnotation(null);

    expect(html).toContain('data-annotation-state="disabled"');
    expect(html).toContain("<fieldset disabled>");
    expect(html).toContain("Select an event to enable annotation controls.");
  });

  it("prefers the next unreviewed matching event and does not wrap", () => {
    const events = [
      { id: "one", status: "unreviewed" as const },
      { id: "two", status: "reviewed" as const },
      { id: "three", status: "unreviewed" as const },
      { id: "four", status: "unclear" as const },
    ];

    expect(findNextReviewEventId(events, "one")).toBe("three");
    expect(findNextReviewEventId(events, "three")).toBe("four");
    expect(findNextReviewEventId(events, "four")).toBeNull();
  });

  it("ships a valid guarded PUT client with recovery and integration hooks", () => {
    expect(() => new Function(REVIEW_ANNOTATION_CLIENT_SCRIPT)).not.toThrow();
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("if (saving) return");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("method: 'PUT'");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("encodeURIComponent(eventId) + '/annotation'");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("Select a category before saving.");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("No more matching events.");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("retryButton.addEventListener('click'");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("review:annotation-saved");
    expect(REVIEW_ANNOTATION_CLIENT_SCRIPT).toContain("review:annotation-dirty-change");
  });
});
