/** Mean with a normal 95% CI (shared by the V4 evaluation tools). */
export function meanCiOf(xs: number[]): { mean: number; lo: number; hi: number; n: number } {
  const n = xs.length;
  if (!n) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  const h = (1.96 * sd) / Math.sqrt(n);
  return { mean: m, lo: m - h, hi: m + h, n };
}
