import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { DataSource, MarketDataState } from '@prisma/client';

import { HistoricalValuationResolverService } from './historical-valuation-resolver.service';

describe('HistoricalValuationResolverService', () => {
  const dataProviderService = {
    getDataSourceForExchangeRates: () => DataSource.YAHOO
  } as DataProviderService;
  const marketDataItems = jest.fn();
  const service = new HistoricalValuationResolverService(dataProviderService, {
    marketDataItems
  } as unknown as MarketDataService);

  beforeEach(() => {
    marketDataItems.mockReset();
  });

  it('returns identity FX without reading market data', async () => {
    await expect(
      service.resolveFx({
        date: '2024-01-07',
        fromCurrency: 'DKK',
        toCurrency: 'DKK'
      })
    ).resolves.toEqual({
      requestedDate: '2024-01-07',
      sourceDate: '2024-01-07',
      stalenessDays: 0,
      value: '1'
    });
    expect(marketDataItems).not.toHaveBeenCalled();
  });

  it('uses the latest eligible prior close and exposes staleness', async () => {
    marketDataItems.mockResolvedValueOnce([
      {
        dataSource: DataSource.YAHOO,
        date: new Date('2024-01-05T00:00:00.000Z'),
        marketPrice: 100,
        state: MarketDataState.CLOSE,
        symbol: 'TEST'
      }
    ]);

    await expect(
      service.resolvePrice({
        dataSource: DataSource.YAHOO,
        date: '2024-01-07',
        symbol: 'TEST'
      })
    ).resolves.toEqual({
      requestedDate: '2024-01-07',
      sourceDate: '2024-01-05',
      stalenessDays: 2,
      value: '100'
    });
    expect(marketDataItems).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { date: 'desc' },
        take: 1,
        where: expect.objectContaining({
          date: { lte: new Date('2024-01-07T23:59:59.999Z') },
          isCarriedForward: false,
          state: MarketDataState.CLOSE
        })
      })
    );
  });

  it('inverts a historical reverse currency pair', async () => {
    marketDataItems.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        date: new Date('2024-01-02T00:00:00.000Z'),
        marketPrice: 0.5
      }
    ]);

    await expect(
      service.resolveFx({
        date: '2024-01-02',
        fromCurrency: 'EUR',
        toCurrency: 'DKK'
      })
    ).resolves.toEqual(
      expect.objectContaining({
        sourceDate: '2024-01-02',
        value: '2'
      })
    );
  });

  it('returns null instead of using a current FX fallback', async () => {
    marketDataItems.mockResolvedValue([]);

    await expect(
      service.resolveFx({
        date: '2024-01-02',
        fromCurrency: 'EUR',
        toCurrency: 'DKK'
      })
    ).resolves.toBeNull();
  });
});
