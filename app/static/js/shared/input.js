export function normalizePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function clampInput(input) {
  const min = Number.parseInt(input.min, 10);
  const max = Number.parseInt(input.max, 10);
  let value = Number.parseInt(input.value, 10);

  if (Number.isNaN(value)) return;
  if (value < min) input.value = min;
  if (value > max) input.value = max;
}
