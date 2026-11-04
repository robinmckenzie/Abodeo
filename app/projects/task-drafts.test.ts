import { describe, expect, it } from "vitest";

import { TaskDrafts } from "./task-drafts";

describe("TaskDrafts", () => {
  it("starts with no text", () => {
    const drafts = new TaskDrafts();
    expect(drafts.readText("kitchen")).toBe("");
    expect(drafts.hasUnaddedText()).toBe(false);
  });

  it("keeps typed text for a project", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", "Buy tiles");
    expect(drafts.readText("kitchen")).toBe("Buy tiles");
    expect(drafts.hasUnaddedText()).toBe(true);
  });

  it("keeps each project's text separately", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", "Buy tiles");
    drafts.keepText("garden", "Mow lawn");
    expect(drafts.readText("kitchen")).toBe("Buy tiles");
    expect(drafts.readText("garden")).toBe("Mow lawn");
    drafts.clearText("kitchen");
    expect(drafts.readText("kitchen")).toBe("");
    expect(drafts.readText("garden")).toBe("Mow lawn");
  });

  it("clears a project's text once its tasks are added", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", "Buy tiles");
    drafts.clearText("kitchen");
    expect(drafts.readText("kitchen")).toBe("");
    expect(drafts.hasUnaddedText()).toBe(false);
  });

  it("forgets text emptied by the person", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", "Buy tiles");
    drafts.keepText("kitchen", "");
    expect(drafts.hasUnaddedText()).toBe(false);
  });

  it("keeps blank text, but does not report it as lost on leaving", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", "  \n ");
    expect(drafts.readText("kitchen")).toBe("  \n ");
    expect(drafts.hasUnaddedText()).toBe(false);
  });

  it("reports text lost on leaving when any project has some", () => {
    const drafts = new TaskDrafts();
    drafts.keepText("kitchen", " ");
    drafts.keepText("garden", "Mow lawn");
    expect(drafts.hasUnaddedText()).toBe(true);
  });

  it("does not share text between stores", () => {
    new TaskDrafts().keepText("kitchen", "Buy tiles");
    expect(new TaskDrafts().hasUnaddedText()).toBe(false);
  });
});
