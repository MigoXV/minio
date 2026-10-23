import { clampRange, zoomRange, preciseTime } from "./analysisView";
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
