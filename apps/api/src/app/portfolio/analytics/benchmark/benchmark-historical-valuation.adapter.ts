import { BenchmarkService } from '@ghostfolio/api/services/benchmark/benchmark.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';

import { Injectable } from '@nestjs/common';
import type { DataSource } from '@prisma/client';
import { Big } from 'big.js';

import { HistoricalValuationResolverService } from '../historical-valuation-resolver.service';
import { VALUATION_MAX_STALENESS_DAYS } from '../valuation-timeline.types';
import type { PortfolioValuationTimeline } from '../valuation-timeline.types';
import type {
  BenchmarkCoverageReason,
  BenchmarkIdentity,
  BenchmarkReturnBasis,
  BenchmarkValuationPoint,
  PreparedBenchmarkTimeline
} from './benchmark.types';

@Injectable()
export class BenchmarkHistoricalValuationAdapter {
  public constructor(
    private readonly benchmarkService: BenchmarkService,
    private readonly historicalResolver: HistoricalValuationResolverService,
    private readonly symbolProfileService: SymbolProfileService
  ) {}

  public async prepare({
    basis = 'UNKNOWN',
    dataSource,
    symbol,
    timeline
  }: {
    basis?: BenchmarkReturnBasis;
    dataSource: DataSource;
    symbol: string;
    timeline: PortfolioValuationTimeline;
  }): Promise<PreparedBenchmarkTimeline> {
    const [profile] = await this.symbolProfileService.getSymbolProfiles([
      { dataSource, symbol }
    ]);
    if (!profile || !(await this.benchmarkService.isBenchmark(profile.id))) {
      return {
        baseCurrency: timeline.baseCurrency,
        benchmark: null,
        coverage: {
          reasons: [
            this.reason(
              'UNSUPPORTED_BENCHMARK',
              'The selected instrument is not a configured Ghostfolio benchmark.'
            )
          ],
          status: 'UNAVAILABLE'
        },
        points: []
      };
    }

    const benchmark: BenchmarkIdentity = {
      basis,
      currency: profile.currency!,
      dataSource,
      id: profile.id,
      name: profile.name ?? null,
      symbol
    };
    const reasons: BenchmarkCoverageReason[] = [];
    if (basis === 'UNKNOWN') {
      reasons.push({
        code: 'UNKNOWN_RETURN_BASIS',
        message: 'The instrument metadata does not declare a return basis.',
        severity: 'WARNING'
      });
    }

    const dates = [...new Set(timeline.timeline.map(({ date }) => date))];
    const points = await Promise.all(
      dates.map((date) => this.resolvePoint({ benchmark, date, timeline }))
    );
    for (const point of points) {
      this.collectReasons(point, reasons);
    }

    return {
      baseCurrency: timeline.baseCurrency,
      benchmark,
      coverage: {
        reasons,
        status: reasons.some(({ severity }) => severity === 'ERROR')
          ? 'INCOMPLETE'
          : 'COMPLETE'
      },
      points
    };
  }

  private async resolvePoint({
    benchmark,
    date,
    timeline
  }: {
    benchmark: BenchmarkIdentity;
    date: string;
    timeline: PortfolioValuationTimeline;
  }): Promise<BenchmarkValuationPoint> {
    const [nativePrice, fx] = await Promise.all([
      this.historicalResolver.resolvePrice({
        dataSource: benchmark.dataSource,
        date,
        symbol: benchmark.symbol
      }),
      this.historicalResolver.resolveFx({
        date,
        fromCurrency: benchmark.currency,
        toCurrency: timeline.baseCurrency
      })
    ]);
    let priceInBaseCurrency: string | null = null;
    if (nativePrice && fx) {
      try {
        const price = new Big(nativePrice.value).mul(fx.value);
        if (price.gt(0)) {
          priceInBaseCurrency = price.toString();
        }
      } catch {}
    }

    return { date, fx, nativePrice, priceInBaseCurrency };
  }

  private collectReasons(
    point: BenchmarkValuationPoint,
    reasons: BenchmarkCoverageReason[]
  ) {
    if (!point.nativePrice) {
      reasons.push(
        this.reason(
          'MISSING_BENCHMARK_PRICE',
          'No same-day or prior benchmark close is available.',
          point.date
        )
      );
    } else if (point.nativePrice.stalenessDays > VALUATION_MAX_STALENESS_DAYS) {
      reasons.push(
        this.reason(
          'STALE_BENCHMARK_PRICE',
          'The prior benchmark close exceeds the freshness limit.',
          point.date,
          point.nativePrice.sourceDate
        )
      );
    }
    if (!point.fx) {
      reasons.push(
        this.reason(
          'MISSING_BENCHMARK_FX',
          'No same-day or prior historical FX close is available.',
          point.date
        )
      );
    } else if (point.fx.stalenessDays > VALUATION_MAX_STALENESS_DAYS) {
      reasons.push(
        this.reason(
          'STALE_BENCHMARK_FX',
          'The prior FX close exceeds the freshness limit.',
          point.date,
          point.fx.sourceDate
        )
      );
    }
    if (point.nativePrice && point.fx && !point.priceInBaseCurrency) {
      reasons.push(
        this.reason(
          'INVALID_BENCHMARK_PRICE',
          'The converted benchmark price is not positive.',
          point.date
        )
      );
    }
  }

  private reason(
    code: BenchmarkCoverageReason['code'],
    message: string,
    date?: string,
    sourceDate?: string
  ): BenchmarkCoverageReason {
    return { code, date, message, severity: 'ERROR', sourceDate };
  }
}
