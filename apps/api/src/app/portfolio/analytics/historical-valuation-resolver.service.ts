import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import {
  DEFAULT_CURRENCY,
  DERIVED_CURRENCIES
} from '@ghostfolio/common/config';

import { Injectable, Logger } from '@nestjs/common';
import { DataSource, MarketData, MarketDataState } from '@prisma/client';
import { Big } from 'big.js';

import {
  VALUATION_MAX_STALENESS_DAYS,
  type HistoricalValueResolver,
  type ValuationSource
} from './valuation-timeline.types';

const DAY_IN_MILLISECONDS = 86_400_000;

@Injectable()
export class HistoricalValuationResolverService implements HistoricalValueResolver {
  private readonly logger = new Logger(HistoricalValuationResolverService.name);

  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService
  ) {}

  public getRevision() {
    return this.marketDataService.getRevision?.() ?? 0;
  }

  public async resolveFx({
    date,
    fromCurrency,
    toCurrency
  }: {
    date: string;
    fromCurrency: string;
    toCurrency: string;
  }): Promise<ValuationSource | null> {
    const normalized = this.normalizeCurrencyPair({
      fromCurrency,
      toCurrency
    });
    const source = await this.resolveRootFx({
      date,
      fromCurrency: normalized.fromCurrency,
      toCurrency: normalized.toCurrency
    });

    return source
      ? {
          ...source,
          value: new Big(source.value).mul(normalized.factor).toFixed()
        }
      : null;
  }

  private async resolveRootFx({
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
      this.resolveRootFx({
        date,
        fromCurrency,
        toCurrency: DEFAULT_CURRENCY
      }),
      this.resolveRootFx({
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

  public async prepare({
    baseCurrency,
    currencies,
    from,
    prices,
    to
  }: {
    baseCurrency: string;
    currencies: string[];
    from: string;
    prices: { dataSource: DataSource; symbol: string }[];
    to: string;
  }): Promise<HistoricalValueResolver> {
    const startedAt = performance.now();
    const exchangeDataSource =
      this.dataProviderService.getDataSourceForExchangeRates();
    const identifiers = new Map<
      string,
      { dataSource: DataSource; symbol: string }
    >();
    const addIdentifier = (dataSource: DataSource, symbol: string) => {
      identifiers.set(this.key({ dataSource, symbol }), { dataSource, symbol });
    };
    const addCurrencyPair = (fromCurrency: string, toCurrency: string) => {
      fromCurrency = this.normalizeCurrency(fromCurrency).currency;
      toCurrency = this.normalizeCurrency(toCurrency).currency;
      if (fromCurrency === toCurrency) return;
      addIdentifier(exchangeDataSource, `${fromCurrency}${toCurrency}`);
      addIdentifier(exchangeDataSource, `${toCurrency}${fromCurrency}`);
    };

    for (const price of prices) {
      addIdentifier(price.dataSource, price.symbol);
    }
    for (const currency of new Set(currencies)) {
      if (currency === baseCurrency) continue;
      addCurrencyPair(currency, baseCurrency);
      if (currency !== DEFAULT_CURRENCY && baseCurrency !== DEFAULT_CURRENCY) {
        addCurrencyPair(currency, DEFAULT_CURRENCY);
        addCurrencyPair(DEFAULT_CURRENCY, baseCurrency);
      }
    }

    const requested = [...identifiers.values()];
    if (!requested.length) {
      return this;
    }
    const lowerBound = new Date(`${from}T00:00:00.000Z`);
    lowerBound.setUTCDate(
      lowerBound.getUTCDate() - VALUATION_MAX_STALENESS_DAYS
    );
    const upperBound = new Date(`${to}T23:59:59.999Z`);
    const whereIdentifiers = requested.map(({ dataSource, symbol }) => ({
      dataSource,
      symbol
    }));
    const [withinRange, previous] = await Promise.all([
      this.marketDataService.marketDataItems({
        orderBy: { date: 'asc' },
        where: {
          OR: whereIdentifiers,
          date: { gte: lowerBound, lte: upperBound },
          isCarriedForward: false,
          state: MarketDataState.CLOSE
        }
      }),
      Promise.all(
        requested.map(async ({ dataSource, symbol }) => {
          const [item] = await this.marketDataService.marketDataItems({
            orderBy: { date: 'desc' },
            take: 1,
            where: {
              dataSource,
              date: { lt: lowerBound },
              isCarriedForward: false,
              state: MarketDataState.CLOSE,
              symbol
            }
          });
          return item;
        })
      )
    ]);
    const series = new Map<string, MarketData[]>();
    for (const item of [...previous.filter(Boolean), ...withinRange]) {
      const key = this.key(item!);
      const items = series.get(key) ?? [];
      items.push(item!);
      series.set(key, items);
    }
    for (const items of series.values()) {
      items.sort((left, right) => left.date.getTime() - right.date.getTime());
    }
    this.logger.debug(
      `analytics.market-data identifiers=${requested.length} rows=${withinRange.length + previous.filter(Boolean).length} queryMs=${(performance.now() - startedAt).toFixed(1)}`
    );

    return this.fromSeries({ exchangeDataSource, series });
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

  private fromSeries({
    exchangeDataSource,
    series
  }: {
    exchangeDataSource: DataSource;
    series: Map<string, MarketData[]>;
  }): HistoricalValueResolver {
    const resolveMarketData = ({
      dataSource,
      date,
      symbol
    }: {
      dataSource: DataSource;
      date: string;
      symbol: string;
    }) => {
      const items = series.get(this.key({ dataSource, symbol })) ?? [];
      const requestedAt = Date.parse(`${date}T23:59:59.999Z`);
      let low = 0;
      let high = items.length - 1;
      let item: MarketData | undefined;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (items[middle].date.getTime() <= requestedAt) {
          item = items[middle];
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (
        !item ||
        !Number.isFinite(item.marketPrice) ||
        item.marketPrice <= 0
      ) {
        return null;
      }
      return this.source({
        date,
        sourceDate: item.date.toISOString().slice(0, 10),
        value: item.marketPrice.toString()
      });
    };
    const resolveRootFx = async ({
      date,
      fromCurrency,
      toCurrency
    }: {
      date: string;
      fromCurrency: string;
      toCurrency: string;
    }): Promise<ValuationSource | null> => {
      if (fromCurrency === toCurrency) {
        return this.source({ date, sourceDate: date, value: '1' });
      }
      const direct = resolveMarketData({
        dataSource: exchangeDataSource,
        date,
        symbol: `${fromCurrency}${toCurrency}`
      });
      if (direct) return direct;
      const inverse = resolveMarketData({
        dataSource: exchangeDataSource,
        date,
        symbol: `${toCurrency}${fromCurrency}`
      });
      if (inverse && !new Big(inverse.value).eq(0)) {
        return { ...inverse, value: new Big(1).div(inverse.value).toFixed() };
      }
      if (
        fromCurrency === DEFAULT_CURRENCY ||
        toCurrency === DEFAULT_CURRENCY
      ) {
        return null;
      }
      const [fromBase, baseTo] = await Promise.all([
        resolveRootFx({
          date,
          fromCurrency,
          toCurrency: DEFAULT_CURRENCY
        }),
        resolveRootFx({
          date,
          fromCurrency: DEFAULT_CURRENCY,
          toCurrency
        })
      ]);
      if (!fromBase || !baseTo) return null;
      return this.source({
        date,
        sourceDate:
          fromBase.sourceDate < baseTo.sourceDate
            ? fromBase.sourceDate
            : baseTo.sourceDate,
        value: new Big(fromBase.value).mul(baseTo.value).toFixed()
      });
    };
    const resolveFx: HistoricalValueResolver['resolveFx'] = async ({
      date,
      fromCurrency,
      toCurrency
    }) => {
      const normalized = this.normalizeCurrencyPair({
        fromCurrency,
        toCurrency
      });
      const source = await resolveRootFx({
        date,
        fromCurrency: normalized.fromCurrency,
        toCurrency: normalized.toCurrency
      });
      return source
        ? {
            ...source,
            value: new Big(source.value).mul(normalized.factor).toFixed()
          }
        : null;
    };

    return {
      resolveFx,
      resolvePrice: async ({ dataSource, date, symbol }) =>
        resolveMarketData({ dataSource, date, symbol })
    };
  }

  private key({
    dataSource,
    symbol
  }: {
    dataSource: DataSource;
    symbol: string;
  }) {
    return `${dataSource}\u0000${symbol}`;
  }

  private normalizeCurrency(currency: string) {
    const derived = DERIVED_CURRENCIES.find(
      ({ currency: derivedCurrency }) => derivedCurrency === currency
    );
    return derived
      ? {
          currency: derived.rootCurrency,
          factor: new Big(1).div(derived.factor)
        }
      : { currency, factor: new Big(1) };
  }

  private normalizeCurrencyPair({
    fromCurrency,
    toCurrency
  }: {
    fromCurrency: string;
    toCurrency: string;
  }) {
    const from = this.normalizeCurrency(fromCurrency);
    const to = this.normalizeCurrency(toCurrency);
    return {
      factor: from.factor.div(to.factor),
      fromCurrency: from.currency,
      toCurrency: to.currency
    };
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
