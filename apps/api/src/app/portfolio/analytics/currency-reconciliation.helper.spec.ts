import { getCurrencyReconciliationTolerance } from './currency-reconciliation.helper';

describe('getCurrencyReconciliationTolerance', () => {
  it('uses one native minor unit for ordinary two-decimal currencies', () => {
    expect(getCurrencyReconciliationTolerance('DKK').toFixed()).toBe('0.01');
    expect(getCurrencyReconciliationTolerance('EUR').toFixed()).toBe('0.01');
  });

  it('uses currency fraction metadata instead of a scattered fixed epsilon', () => {
    expect(getCurrencyReconciliationTolerance('JPY').toFixed()).toBe('1');
  });

  it('falls back deterministically for an unknown currency', () => {
    expect(getCurrencyReconciliationTolerance('').toFixed()).toBe('0.01');
  });
});
