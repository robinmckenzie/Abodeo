// Add titles here without changing the whole-input classification rule.
export const commonJobTitles = [
  "Electrician", "Plumber", "Interior Designer", "Architect", "Builder", "Gardener",
] as const;

export function classifyPersonInput(input: string) {
  const value = input.trim();
  return commonJobTitles.some(title => title.toLowerCase() === value.toLowerCase())
    ? { name: "", jobTitle: value }
    : { name: input, jobTitle: "" };
}
