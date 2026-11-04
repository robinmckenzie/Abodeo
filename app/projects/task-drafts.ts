// Text typed into a project's add-task box but not yet added, by project. One
// store belongs to one Projects screen: it keeps the text while projects are
// closed and reopened, and goes with the Projects screen when the person moves
// to another screen, signs in or out, or reloads the page.
export class TaskDrafts {
  private readonly texts = new Map<string, string>();

  readText(projectId: string) {
    return this.texts.get(projectId) ?? "";
  }

  keepText(projectId: string, text: string) {
    if (text) this.texts.set(projectId, text);
    else this.texts.delete(projectId);
  }

  // Once the project's tasks are added, nothing is left to keep.
  clearText(projectId: string) {
    this.texts.delete(projectId);
  }

  // Whether any project holds text that is not blank, which leaving the
  // page would lose.
  hasUnaddedText() {
    return [...this.texts.values()].some((text) => text.trim() !== "");
  }
}
