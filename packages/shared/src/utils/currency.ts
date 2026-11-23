export const DEFAULT_FX_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 84,
  EUR: 91,
  GBP: 107,
  SGD: 63,
  AED: 22.9,
  CAD: 60.5,
  AUD: 55
};

export type SalaryPeriod = 'year' | 'month' | 'hour';

export function annualizeSalary(amount: number, period: SalaryPeriod = 'year'): number {
  if (!Number.isFinite(amount) || amount < 0) return 0;
  if (period === 'month') return amount * 12;
  if (period === 'hour') return amount * 2000;
  return amount;
}

export function toInrLpa(
  amount: number,
  currency: string = 'INR',
  period: SalaryPeriod = 'year',
  fxRates: Record<string, number> = DEFAULT_FX_TO_INR
): number {
  const normalizedCurrency = currency.trim().toUpperCase();
  const rate = fxRates[normalizedCurrency];
  if (!rate || !Number.isFinite(amount) || amount < 0) return 0;
  const annualLocal = annualizeSalary(amount, period);
  const annualInr = annualLocal * rate;
  return Math.round((annualInr / 100_000) * 100) / 100;
}

export function formatLpa(lpa: number | null | undefined): string {
  if (lpa === null || lpa === undefined || !Number.isFinite(lpa)) return '—';
  return `${lpa % 1 === 0 ? lpa.toFixed(0) : lpa.toFixed(1)} LPA`;
}

export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency: string = 'INR',
  lpaMin?: number | null,
  lpaMax?: number | null
): string {
  const cur = currency.toUpperCase();
  if (cur === 'INR' && (lpaMin != null || lpaMax != null)) {
    if (lpaMin != null && lpaMax != null) return `${formatLpa(lpaMin)} – ${formatLpa(lpaMax)}`;
    return lpaMin != null ? `>= ${formatLpa(lpaMin)}` : `<= ${formatLpa(lpaMax)}`;
  }
  if (min == null && max == null) return 'Not disclosed';
  const fmt = (val: number) =>
    new Intl.NumberFormat(cur === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency: cur,
      maximumFractionDigits: 0
    }).format(val);
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  return min != null ? `From ${fmt(min)}` : `Up to ${fmt(max!)}`;
}
