// What is said when a project is deleted, and how long a deleted project has
// left in the Bin (AD #62 Delete Projects).
import type { Project } from "./projects";
import { binPeriodMs } from "./projects-api";

const hourMs = 60 * 60 * 1000;
const dayMs = 24 * hourMs;

function count(amount: number, singular: string) {
  return `${amount} ${singular}${amount === 1 ? "" : "s"}`;
}

// The cooling-off period in words, such as "2 days".
export function describeBinPeriod() {
  return binPeriodMs % dayMs === 0
    ? count(binPeriodMs / dayMs, "day")
    : count(Math.round(binPeriodMs / hourMs), "hour");
}

// What will be lost with the project, as a list: its tasks and images, where
// it has any. Empty if it has neither.
export function listLosses(
  project: Pick<Project, "tasks">,
  imageCount: number,
) {
  const taskCount = project.tasks.length;
  const losses: string[] = [];
  if (taskCount > 0) losses.push(count(taskCount, "task"));
  if (imageCount > 0) losses.push(count(imageCount, "image"));
  return losses;
}

// What happens to the project's appointments, which stay in Google Calendar.
// Null when their number is not known, as on the Bin page, and then nothing
// is said of how many. Nothing is said if there are none.
export function describeAppointmentsKept(count: number | null) {
  if (count === 0) return null;
  const subject =
    count === null
      ? "Any appointments stay"
      : count === 1
        ? "Its appointment stays"
        : "Its appointments stay";
  return `${subject} in Google Calendar and ${count === 1 ? "is" : "are"} no longer shown in Abodeo.`;
}

export function isPastBinPeriod(deletedAt: string, nowMs: number) {
  return nowMs - Date.parse(deletedAt) >= binPeriodMs;
}

// How long a binned project can still be restored, or that it may be removed
// at any time once the cooling-off period has passed.
export function describeBinTimeLeft(deletedAt: string, nowMs: number) {
  if (isPastBinPeriod(deletedAt, nowMs)) {
    return "Past the cooling-off period, so it may be removed at any time";
  }
  const left = Date.parse(deletedAt) + binPeriodMs - nowMs;
  if (left >= dayMs) return `${count(Math.floor(left / dayMs), "day")} left`;
  if (left >= hourMs) return `${count(Math.floor(left / hourMs), "hour")} left`;
  return "Less than an hour left";
}
