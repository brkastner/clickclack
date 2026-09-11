export type HeroImageInput = {
  viewportWidth: number;
  viewportHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
  positionX: number;
  positionY: number;
  originX: number;
  originY: number;
  offsetX: number;
};

/** Scale the whole source, preserving the former viewport-relative pan/origin. */
export function heroImageGeometry(input: HeroImageInput) {
  const { viewportWidth: w, viewportHeight: h, naturalWidth, naturalHeight, scale } = input;
  if (
    ![w, h, naturalWidth, naturalHeight, scale].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null;
  const cover = Math.max(w / naturalWidth, h / naturalHeight);
  const width = naturalWidth * cover;
  const height = naturalHeight * cover;
  return {
    width: width * scale,
    height: height * scale,
    left:
      (w - width) * input.positionX * scale +
      w * input.originX * (1 - scale) +
      (w * input.offsetX) / 100,
    top: (h - height) * input.positionY * scale + h * input.originY * (1 - scale),
  };
}
