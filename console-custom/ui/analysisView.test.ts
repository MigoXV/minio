import {
  clampRange,
  zoomRange,
  preciseTime,
  frequencyToAxis,
  frequencyAtHeight,
  frequencyTicks,
} from "./analysisView";
test("reverse drag and out-of-range coordinates stay within audio", () => {
  expect(clampRange(5, 3, 12)).toEqual([3, 5]);
  expect(clampRange(-1, 20, 12)).toEqual([0, 12]);
});
test("zoom keeps pointer anchored and clamps to full duration", () => {
  expect(zoomRange([0, 12], 6, 0.5, 12)).toEqual([3, 9]);
  expect(zoomRange([3, 5], 4, 10, 12)).toEqual([0, 12]);
  expect(zoomRange([0, 12], 0, 0.5, 12)).toEqual([0, 6]);
  expect(zoomRange([0, 12], 12, 0.5, 12)).toEqual([6, 12]);
});
test("millisecond cursor time remains unambiguous across minutes", () => {
  expect(preciseTime(64.125)).toBe("01:04.125");
  expect(preciseTime(NaN)).toBe("00:00.000");
});

test("log frequency mapping is invertible and compresses the first 100 Hz", () => {
  const limit = frequencyToAxis(8000);
  expect(frequencyToAxis(100)).toBeCloseTo(0.1);
  expect(frequencyToAxis(200) - frequencyToAxis(100)).toBeCloseTo(1);
  for (const hz of [0, 50, 100, 200, 500, 1000, 4000, 8000]) {
    expect(
      frequencyAtHeight(1 - frequencyToAxis(hz) / limit, 8000),
    ).toBeCloseTo(hz);
  }
});

test("frequency ticks follow the actual limit, end at zero and omit the crowded 100 Hz label", () => {
  const ticks = frequencyTicks(5500);
  expect(ticks[0]).toEqual({ hz: 5500, top: 0 });
  expect(ticks[ticks.length - 1]).toEqual({ hz: 0, top: 100 });
  expect(ticks.some(({ hz }) => hz === 100 || hz > 5500)).toBe(false);
  expect(frequencyAtHeight(0, 50)).toBeCloseTo(50);
});
