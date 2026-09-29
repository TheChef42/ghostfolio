import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { DEFAULT_CURRENCY } from '@ghostfolio/common/config';

import { Injectable } from '@nestjs/common';
import { DataSource, MarketDataState } from '@prisma/client';
import { Big } from 'big.js';

import type {
  HistoricalValueResolver,
  ValuationSource
} from './valuation-timeline.types';

const DAY_IN_MILLISECONDS = 86_400_000;

@Injectable()
export class HistoricalValuationResolverService implements HistoricalValueResolver {
  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService
  ) {}

  public async resolveFx({
    date,
    fromCurrency,
    toCurrency
  }: {
    date: string;
    fromCurrency: string;
    toCurrency: string;
  }): Promise<ValuationSource | null> {
    if (fromCurrency === toCurrency) {
      return this.source({ date, sourceDate: date, value: '1' });
    }

    const dataSource = this.dataProviderService.getDataSourceForExchangeRates();
    const direct = await this.resolveMarketData({
      dataSource,
      date,
      symbol: `${fromCurrency}${toCurrency}`
    });

    if (direct) {
      return direct;
    }

    const inverse = await this.resolveMarketData({
      dataSource,
      date,
      symbol: `${toCurrency}${fromCurrency}`
    });

    if (inverse && !new Big(inverse.value).eq(0)) {
      return { ...inverse, value: new Big(1).div(inverse.value).toFixed() };
    }

    if (fromCurrency === DEFAULT_CURRENCY || toCurrency === DEFAULT_CURRENCY) {
      return null;
    }

    const [fromBase, baseTo] = await Promise.all([
      this.resolveFx({
        date,
        fromCurrency,
        toCurrency: DEFAULT_CURRENCY
      }),
      this.resolveFx({
        date,
        fromCurrency: DEFAULT_CURRENCY,
        toCurrency
      })
    ]);

    if (!fromBase || !baseTo) {
      return null;
    }

    const sourceDate =
      fromBase.sourceDate < baseTo.sourceDate
        ? fromBase.sourceDate
        : baseTo.sourceDate;

    return this.source({
      date,
      sourceDate,
      value: new Big(fromBase.value).mul(baseTo.value).toFixed()
    });
  }

  public resolvePrice({
    dataSource,
    date,
    symbol
  }: {
    dataSource: DataSource;
    date: string;
    symbol: string;
  }) {
    return this.resolveMarketData({ dataSource, date, symbol });
  }

  private async resolveMarketData({
    dataSource,
    date,
    symbol
  }: {
    dataSource: DataSource;
    date: string;
    symbol: string;
  }): Promise<ValuationSource | null> {
    const [item] = await this.marketDataService.marketDataItems({
      orderBy: { date: 'desc' },
      take: 1,
      where: {
        dataSource,
        date: { lte: new Date(`${date}T23:59:59.999Z`) },
        isCarriedForward: false,
        state: MarketDataState.CLOSE,
        symbol
      }
    });

    if (!item || !Number.isFinite(item.marketPrice) || item.marketPrice <= 0) {
      return null;
    }

    return this.source({
      date,
      sourceDate: item.date.toISOString().slice(0, 10),
      value: item.marketPrice.toString()
    });
  }

  private source({
    date,
    sourceDate,
    value
  }: {
    date: string;
    sourceDate: string;
    value: string;
  }): ValuationSource {
    return {
      requestedDate: date,
      sourceDate,
      stalenessDays: Math.round(
        (Date.parse(`${date}T00:00:00.000Z`) -
          Date.parse(`${sourceDate}T00:00:00.000Z`)) /
          DAY_IN_MILLISECONDS
      ),
      value
    };
  }
}
