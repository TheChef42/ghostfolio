import { DataSource } from '@prisma/client';

import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import { BenchmarkHistoricalValuationAdapter } from './benchmark-historical-valuation.adapter';

const timeline = {
  baseCurrency: 'DKK',
  timeline: [{ date: '2024-01-06' }, { date: '2024-01-07' }]
} as PortfolioValuationTimeline;

describe('BenchmarkHistoricalValuationAdapter', () => {
  const profile = {
    currency: 'USD',
    dataSource: DataSource.YAHOO,
    id: 'benchmark',
    name: 'Index',
    symbol: 'IDX'
  };

  it('resolves supported prices and FX once per calendar date', async () => {
    const historicalResolver = {
      resolveFx: jest.fn(async ({ date }) => ({
        requestedDate: date,
        sourceDate: '2024-01-05',
        stalenessDays: date === '2024-01-06' ? 1 : 2,
        value: '7'
      })),
      resolvePrice: jest.fn(async ({ date }) => ({
        requestedDate: date,
        sourceDate: '2024-01-05',
        stalenessDays: date === '2024-01-06' ? 1 : 2,
        value: '10'
      }))
    };
    const adapter = new BenchmarkHistoricalValuationAdapter(
      { isBenchmark: jest.fn().mockResolvedValue(true) } as never,
      historicalResolver as never,
      { getSymbolProfiles: jest.fn().mockResolvedValue([profile]) } as never
    );

    const result = await adapter.prepare({
      basis: 'TOTAL_RETURN',
      dataSource: DataSource.YAHOO,
      symbol: 'IDX',
      timeline
    });
    expect(result.coverage.status).toBe('COMPLETE');
    expect(result.benchmark).toMatchObject({
      basis: 'TOTAL_RETURN',
      currency: 'USD',
      id: 'benchmark'
    });
    expect(result.points).toEqual([
      expect.objectContaining({
        date: '2024-01-06',
        priceInBaseCurrency: '70'
      }),
      expect.objectContaining({
        date: '2024-01-07',
        priceInBaseCurrency: '70'
      })
    ]);
    expect(historicalResolver.resolvePrice).toHaveBeenCalledTimes(2);
    expect(historicalResolver.resolveFx).toHaveBeenCalledTimes(2);
  });

  it('marks the basis unknown without guessing or blocking valid data', async () => {
    const source = async ({ date }: { date: string }) => ({
      requestedDate: date,
      sourceDate: date,
      stalenessDays: 0,
      value: '1'
    });
    const adapter = new BenchmarkHistoricalValuationAdapter(
      { isBenchmark: jest.fn().mockResolvedValue(true) } as never,
      { resolveFx: source, resolvePrice: source } as never,
      { getSymbolProfiles: jest.fn().mockResolvedValue([profile]) } as never
    );
    const result = await adapter.prepare({
      dataSource: DataSource.YAHOO,
      symbol: 'IDX',
      timeline
    });
    expect(result.benchmark?.basis).toBe('UNKNOWN');
    expect(result.coverage).toMatchObject({
      reasons: [
        expect.objectContaining({
          code: 'UNKNOWN_RETURN_BASIS',
          severity: 'WARNING'
        })
      ],
      status: 'COMPLETE'
    });
  });

  it('rejects an instrument outside configured Ghostfolio benchmarks', async () => {
    const adapter = new BenchmarkHistoricalValuationAdapter(
      { isBenchmark: jest.fn().mockResolvedValue(false) } as never,
      {} as never,
      { getSymbolProfiles: jest.fn().mockResolvedValue([profile]) } as never
    );
    const result = await adapter.prepare({
      dataSource: DataSource.YAHOO,
      symbol: 'IDX',
      timeline
    });
    expect(result).toMatchObject({
      benchmark: null,
      coverage: {
        reasons: [expect.objectContaining({ code: 'UNSUPPORTED_BENCHMARK' })],
        status: 'UNAVAILABLE'
      }
    });
  });

  it('reports missing and stale historical inputs without a current fallback', async () => {
    const adapter = new BenchmarkHistoricalValuationAdapter(
      { isBenchmark: jest.fn().mockResolvedValue(true) } as never,
      {
        resolveFx: jest.fn().mockResolvedValue(null),
        resolvePrice: jest.fn(async ({ date }) => ({
          requestedDate: date,
          sourceDate: '2023-12-01',
          stalenessDays: 36,
          value: '10'
        }))
      } as never,
      { getSymbolProfiles: jest.fn().mockResolvedValue([profile]) } as never
    );
    const result = await adapter.prepare({
      dataSource: DataSource.YAHOO,
      symbol: 'IDX',
      timeline
    });
    expect(result.coverage.status).toBe('INCOMPLETE');
    expect(result.coverage.reasons.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['STALE_BENCHMARK_PRICE', 'MISSING_BENCHMARK_FX'])
    );
  });
});
