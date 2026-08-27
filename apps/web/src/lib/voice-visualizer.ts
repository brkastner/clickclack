export type SpectrumBarGeometry = {
  barWidth: number;
  gap: number;
};

export function spectrumBarGeometry(
  width: number,
  barCount: number,
  requestedGap: number,
): SpectrumBarGeometry {
  const safeWidth = Math.max(0, width);
  const safeCount = Math.max(1, Math.floor(barCount));
  const gap = Math.min(Math.max(0, requestedGap), safeWidth / (safeCount * 2));
  return {
    barWidth: Math.max(0, (safeWidth - gap * (safeCount - 1)) / safeCount),
    gap,
  };
}

export function spectrumBarLevel(
  frequencyData: Uint8Array,
  barIndex: number,
  barCount: number,
  minimumLevel = 0.04,
): number {
  const floor = Math.min(1, Math.max(0, minimumLevel));
  if (frequencyData.length === 0) return floor;

  const count = Math.max(1, Math.floor(barCount));
  const index = Math.min(count - 1, Math.max(0, Math.floor(barIndex)));
  const startRatio = index / count;
  const endRatio = (index + 1) / count;
  const start = Math.min(
    frequencyData.length - 1,
    Math.floor(startRatio * startRatio * frequencyData.length),
  );
  const end = Math.max(
    start + 1,
    Math.min(frequencyData.length, Math.floor(endRatio * endRatio * frequencyData.length)),
  );

  let total = 0;
  let peak = 0;
  for (let bin = start; bin < end; bin += 1) {
    const value = frequencyData[bin] ?? 0;
    total += value;
    peak = Math.max(peak, value);
  }
  const average = total / (end - start) / 255;
  const normalizedPeak = peak / 255;
  const energy = Math.min(1, average * 0.72 + normalizedPeak * 0.28);
  return floor + (1 - floor) * energy;
}

export function fillSpectrumBars(
  frequencyData: Uint8Array,
  target: Float32Array,
  minimumLevel = 0.04,
): Float32Array {
  for (let index = 0; index < target.length; index += 1) {
    target[index] = spectrumBarLevel(frequencyData, index, target.length, minimumLevel);
  }
  return target;
}
