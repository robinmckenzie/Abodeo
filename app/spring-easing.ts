// A spring-like movement for CSS: it overshoots its target (the first
// bounce), swings back past it (the dip), overshoots again by less (the second
// bounce) and settles. Each amount is a fraction of the whole change, so 0.8
// on a change from 100% to 105% peaks at 109%.
export type Spring = {
  first: number;
  dip: number;
  second: number;
  // When the first bounce peaks, as a fraction of the duration. The dip, the
  // second bounce and the settling follow at equal intervals, as in a spring.
  peakAt: number;
};

// Progress through the movement at time t (0 to 1): 0 at the start, 1 at the
// target.
export function calculateSpringProgress(spring: Spring, t: number) {
  const { first, dip, second, peakAt } = spring;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t <= peakAt) return (1 + first) * Math.sin(((Math.PI / 2) * t) / peakAt);

  const step = (1 - peakAt) / 3;
  const extremes: [number, number][] = [
    [peakAt, 1 + first],
    [peakAt + step, 1 - dip],
    [peakAt + 2 * step, 1 + second],
    [1, 1],
  ];
  for (let i = 1; i < extremes.length; i++) {
    const [endTime, endValue] = extremes[i];
    if (t > endTime) continue;
    const [startTime, startValue] = extremes[i - 1];
    const s = (t - startTime) / (endTime - startTime);
    return (
      startValue + ((endValue - startValue) * (1 - Math.cos(Math.PI * s))) / 2
    );
  }
  return 1;
}

// The movement as a CSS linear() timing function.
export function buildSpringEasing(spring: Spring, samples = 40) {
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const value = Number(calculateSpringProgress(spring, t).toFixed(4));
    const percent = Number((t * 100).toFixed(1));
    points.push(i === 0 || i === samples ? `${value}` : `${value} ${percent}%`);
  }
  return `linear(${points.join(", ")})`;
}
