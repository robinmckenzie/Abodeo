// A reordered task's slide to its new place.
export const slideTiming = {
  duration: 250,
  easing: "cubic-bezier(0.33, 1, 0.68, 1)",
};

// How long a whole reorder takes, from the first slide starting to the last
// ending, when a task moves one place: one task makes way, and the moved
// task follows after a wait.
const onePlaceDuration = 310;

// Each further place adds this fraction of the time the place before it
// added, so that a reorder takes longer the further a task moves, but never
// twice as long as moving it one place.
const extraPlaceRatio = 0.81;

// The wait between one task's slide starting and the next, when a task moves
// the given number of places, so that the whole reorder takes
// 2x - x * ratio^(places - 1), where x is the time for one place.
export function calculateSlideStagger(places: number) {
  if (places < 1) return 0;
  const total = onePlaceDuration * (2 - extraPlaceRatio ** (places - 1));
  return (total - slideTiming.duration) / places;
}
