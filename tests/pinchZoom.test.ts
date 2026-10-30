import { describe, expect, test } from "bun:test";
import { PINCH_STEP_THRESHOLD, createPinchAccumulator } from "../src/lib/pinchZoom";

describe("createPinchAccumulator", () => {
  test("reports nothing until enough movement has added up", () => {
    const accumulate = createPinchAccumulator();
    expect(accumulate(PINCH_STEP_THRESHOLD - 1)).toBe(0);
    expect(accumulate(1)).toBe(1);
  });

  test("zooms out on negative movement", () => {
    const accumulate = createPinchAccumulator();
    expect(accumulate(-PINCH_STEP_THRESHOLD)).toBe(-1);
  });

  test("keeps the remainder for the next call", () => {
    const accumulate = createPinchAccumulator();
    expect(accumulate(PINCH_STEP_THRESHOLD * 2.5)).toBe(2);
    expect(accumulate(PINCH_STEP_THRESHOLD * 0.5)).toBe(1);
  });

  test("a slow pinch makes steps as surely as a fast one", () => {
    const accumulate = createPinchAccumulator();
    let total = 0;
    for (let i = 0; i < 100; i++) total += accumulate(PINCH_STEP_THRESHOLD / 10);
    expect(total).toBe(10);
  });
});
