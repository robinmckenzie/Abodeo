import { describe, expect, it } from "vitest";
import { classifyPersonInput, commonJobTitles } from "./people-quick-add";

describe("local quick-add classification", () => {
  it.each(commonJobTitles)("recognises the entire title %s regardless of case", title => {
    expect(classifyPersonInput(` ${title.toLowerCase()} `)).toEqual({ name: "", jobTitle: title.toLowerCase() });
  });
  it.each(["Andrew Dawson", "Bob the plumber", "Sarah, architect", "Unknown text", "x".repeat(100)])("preserves all unrecognised text: %s", input => {
    expect(classifyPersonInput(input)).toEqual({ name: input, jobTitle: "" });
  });
});
