import { fitWithin, MAX_IMAGE_EDGE } from "./imageResize";

describe("fitWithin", () => {
  it("leaves an image smaller than the cap untouched", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image by its long edge", () => {
    expect(fitWithin(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait image by its long edge", () => {
    expect(fitWithin(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("rounds to whole pixels", () => {
    // 3000x2001 → scale 0.5333…; height must not come back fractional.
    const { width, height } = fitWithin(3000, 2001, 1600);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
    expect(width).toBe(1600);
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const { width, height } = fitWithin(5000, 3, 1600);
    expect(width).toBe(1600);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("handles an exactly-at-cap image as a no-op", () => {
    expect(fitWithin(MAX_IMAGE_EDGE, 900, MAX_IMAGE_EDGE)).toEqual({
      width: MAX_IMAGE_EDGE,
      height: 900,
    });
  });
});
