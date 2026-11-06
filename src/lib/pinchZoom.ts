/**
 * How much pinch (or ctrl+wheel) movement makes up one zoom step. A trackpad
 * pinch arrives as a stream of small deltas, so a step has to be earned over
 * several events or the text would jump by a size on every tick.
 */
export const PINCH_STEP_THRESHOLD = 30;

/**
 * Collects zoom movement - positive to zoom in, negative to zoom out - and
 * reports whole steps once enough of it has added up. What has not yet made a
 * step is kept for the next call, so a slow pinch zooms as surely as a fast one.
 */
export function createPinchAccumulator(threshold = PINCH_STEP_THRESHOLD) {
  let pending = 0;
  return (amount: number) => {
    pending += amount;
    const steps = Math.trunc(pending / threshold);
    pending -= steps * threshold;
    return steps;
  };
}
