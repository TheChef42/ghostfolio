import { Big } from 'big.js';

const DEFAULT_CURRENCY_FRACTION_DIGITS = 2;

export function getCurrencyReconciliationTolerance(currency: string): Big {
  let fractionDigits = DEFAULT_CURRENCY_FRACTION_DIGITS;

  try {
    fractionDigits = new Intl.NumberFormat('en', {
      currency,
      style: 'currency'
    }).resolvedOptions().maximumFractionDigits;
  } catch {
    // Unknown or absent currencies use the documented two-decimal fallback.
  }

  return new Big(1).div(new Big(10).pow(fractionDigits));
}
