import {
  type AnalyticsChartMode,
  GfBenchmarkComparatorComponent
} from '@ghostfolio/client/components/benchmark-comparator/benchmark-comparator.component';
import { DEFAULT_DATE_RANGE } from '@ghostfolio/common/config';
import {
  AnalyticsBenchmarkResponse,
  AnalyticsCashFlowMatchedResponse,
  AnalyticsCoverageReason,
  AnalyticsModifiedDietzResponse,
  AnalyticsTwrBenchmarkResponse,
  AnalyticsTwrResponse,
  AnalyticsXirrResponse,
  Filter,
  LineChartItem,
  User
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';
import { GfValueComponent } from '@ghostfolio/ui/value';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  Input,
  OnChanges,
  output
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { SymbolProfile } from '@prisma/client';
import {
  catchError,
  forkJoin,
  Observable,
  of,
  Subject,
  switchMap,
  tap
} from 'rxjs';

import { GfAnalyticsInfoComponent } from './analytics-info/analytics-info.component';

interface RequestResult<T> {
  data: T | null;
  failed: boolean;
}

interface CoverageGroup {
  label: string;
  messages: string[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    GfBenchmarkComparatorComponent,
    GfAnalyticsInfoComponent,
    GfValueComponent,
    MatCardModule,
    MatExpansionModule
  ],
  selector: 'gf-analytics-overview',
  styleUrls: ['./analytics-overview.component.scss'],
  templateUrl: './analytics-overview.component.html'
})
export class GfAnalyticsOverviewComponent implements OnChanges {
  @Input() public benchmark?: Partial<SymbolProfile>;
  @Input() public benchmarks: Partial<SymbolProfile>[] = [];
  @Input() public filters: Filter[] = [];
  @Input() public user: User;

  public readonly benchmarkChanged = output<string>();

  protected advancedLoaded = false;
  protected readonly benchmarkHelp = $localize`A benchmark is a reference, not a target. Its period return uses the same selected interval as your portfolio. Depending on the selected instrument, the data can be total return, price only, or an unknown basis.`;
  protected benchmarkApiFailed = false;
  protected benchmarkResult: AnalyticsTwrBenchmarkResponse | null = null;
  protected cashFlowMatchedResult: AnalyticsCashFlowMatchedResponse | null =
    null;
  protected chartMode: AnalyticsChartMode = 'PERFORMANCE';
  protected readonly cashFlowMatchedHelp = $localize`Shows what the same deposits and withdrawals, made on the same dates, would be worth in the benchmark. It is an economic comparison and does not reproduce real-world trading costs or taxes.`;
  protected readonly dataQualityHelp = $localize`Historical analytics can be unavailable when cash balances, prices, or exchange rates are missing or too old. The messages below identify the affected data.`;
  protected isLoadingAdvanced = false;
  protected isLoadingBenchmark = false;
  protected isLoadingPerformance = false;
  protected modifiedDietzResult: AnalyticsModifiedDietzResponse | null = null;
  protected readonly modifiedDietzHelp = $localize`Modified Dietz is a money-weighted approximation that weights external cash flows by time. It is a period return, not an annualized return, and is commonly used as an institutional fallback when exact cash-flow timing is unavailable.`;
  protected performanceApiFailed = false;
  protected twrResult: AnalyticsTwrResponse | null = null;
  protected readonly twrHelp = $localize`Time-weighted return neutralizes deposits and withdrawals to show investment performance over the selected period. It is suited to benchmark comparison, but it does not reflect the timing of your personal cash flows.`;
  protected readonly xirrHelp = $localize`XIRR is a money-weighted annualized return that reflects the size and timing of your deposits and withdrawals. It represents your investor experience. Short periods can produce extreme annualized values.`;
  protected xirrResult: AnalyticsXirrResponse | null = null;

  private readonly advancedRefresh = new Subject<void>();
  private readonly benchmarkRefresh = new Subject<void>();
  private readonly cashFlowMatchedRefresh = new Subject<void>();
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private lastBenchmarkRequestKey: string | undefined;
  private lastPortfolioRequestKey: string | undefined;
  private readonly performanceRefresh = new Subject<void>();

  public constructor() {
    this.performanceRefresh
      .pipe(
        tap(() => {
          this.isLoadingPerformance = true;
          this.performanceApiFailed = false;
        }),
        switchMap(() => {
          const input = this.requestInput();
          return forkJoin({
            twr: this.safe<AnalyticsTwrResponse>(
              this.dataService.fetchAnalyticsPerformance({
                ...input,
                method: 'TWR'
              })
            ),
            xirr: this.safe<AnalyticsXirrResponse>(
              this.dataService.fetchAnalyticsPerformance({
                ...input,
                method: 'XIRR'
              })
            )
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ twr, xirr }) => {
        this.twrResult = twr.data;
        this.xirrResult = xirr.data;
        this.performanceApiFailed = twr.failed || xirr.failed;
        this.isLoadingPerformance = false;
        this.changeDetectorRef.markForCheck();
      });

    this.benchmarkRefresh
      .pipe(
        tap(() => {
          this.isLoadingBenchmark = Boolean(this.benchmark);
          this.benchmarkApiFailed = false;
        }),
        switchMap(() => {
          const input = this.requestInput();
          return this.benchmark?.dataSource && this.benchmark.symbol
            ? this.safe<AnalyticsBenchmarkResponse>(
                this.dataService.fetchAnalyticsBenchmark({
                  ...input,
                  benchmark: {
                    dataSource: this.benchmark.dataSource,
                    symbol: this.benchmark.symbol
                  },
                  mode: 'TWR'
                })
              )
            : of<RequestResult<AnalyticsBenchmarkResponse>>({
                data: null,
                failed: false
              });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((benchmark) => {
        this.benchmarkResult =
          benchmark.data?.mode === 'TWR' ? benchmark.data : null;
        this.benchmarkApiFailed = benchmark.failed;
        this.isLoadingBenchmark = false;
        this.changeDetectorRef.markForCheck();
      });

    this.advancedRefresh
      .pipe(
        tap(() => (this.isLoadingAdvanced = true)),
        switchMap(() => {
          const input = this.requestInput();
          const benchmarkRequest =
            this.benchmark?.dataSource && this.benchmark.symbol
              ? this.safe<AnalyticsBenchmarkResponse>(
                  this.dataService.fetchAnalyticsBenchmark({
                    ...input,
                    benchmark: {
                      dataSource: this.benchmark.dataSource,
                      symbol: this.benchmark.symbol
                    },
                    mode: 'CASH_FLOW_MATCHED'
                  })
                )
              : of<RequestResult<AnalyticsBenchmarkResponse>>({
                  data: null,
                  failed: false
                });

          return forkJoin({
            benchmark: benchmarkRequest,
            dietz: this.safe<AnalyticsModifiedDietzResponse>(
              this.dataService.fetchAnalyticsPerformance({
                ...input,
                method: 'MODIFIED_DIETZ'
              })
            )
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ benchmark, dietz }) => {
        this.modifiedDietzResult = dietz.data;
        this.cashFlowMatchedResult =
          benchmark.data?.mode === 'CASH_FLOW_MATCHED' ? benchmark.data : null;
        this.isLoadingAdvanced = false;
        this.changeDetectorRef.markForCheck();
      });

    this.cashFlowMatchedRefresh
      .pipe(
        tap(() => (this.isLoadingAdvanced = true)),
        switchMap(() => {
          const input = this.requestInput();
          return this.benchmark?.dataSource && this.benchmark.symbol
            ? this.safe<AnalyticsBenchmarkResponse>(
                this.dataService.fetchAnalyticsBenchmark({
                  ...input,
                  benchmark: {
                    dataSource: this.benchmark.dataSource,
                    symbol: this.benchmark.symbol
                  },
                  mode: 'CASH_FLOW_MATCHED'
                })
              )
            : of<RequestResult<AnalyticsBenchmarkResponse>>({
                data: null,
                failed: false
              });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((benchmark) => {
        this.cashFlowMatchedResult =
          benchmark.data?.mode === 'CASH_FLOW_MATCHED' ? benchmark.data : null;
        this.isLoadingAdvanced = false;
        this.changeDetectorRef.markForCheck();
      });
  }

  public ngOnChanges() {
    if (!this.user) {
      return;
    }
    const portfolioRequestKey = this.portfolioRequestKey();
    const benchmarkRequestKey = this.benchmarkRequestKey(portfolioRequestKey);
    const portfolioChanged =
      portfolioRequestKey !== this.lastPortfolioRequestKey;
    const benchmarkChanged =
      benchmarkRequestKey !== this.lastBenchmarkRequestKey;
    this.lastPortfolioRequestKey = portfolioRequestKey;
    this.lastBenchmarkRequestKey = benchmarkRequestKey;

    if (portfolioChanged) {
      this.performanceRefresh.next();
      this.benchmarkRefresh.next();
      if (this.advancedLoaded) {
        this.advancedRefresh.next();
      }
    } else if (benchmarkChanged) {
      this.benchmarkRefresh.next();
      if (this.advancedLoaded) {
        this.cashFlowMatchedRefresh.next();
      }
    }
  }

  protected asNumber(value: number | string | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  protected get benchmarkChartItems(): LineChartItem[] {
    if (this.chartMode === 'TOTAL_VALUE') {
      return (this.twrResult?.series ?? []).map(
        ({ date, investedCapital }) => ({
          date,
          value: Number(investedCapital)
        })
      );
    }
    if (this.chartMode !== 'PERFORMANCE') return [];
    return (this.benchmarkResult?.series ?? [])
      .filter(({ benchmarkIndex }) => benchmarkIndex !== null)
      .map(({ benchmarkIndex, date }) => ({
        date,
        value: Number(benchmarkIndex) - 1
      }));
  }

  protected get benchmarkWarning(): string | null {
    const basis = this.benchmarkResult?.benchmark?.basis;
    if (basis === 'PRICE_ONLY') {
      return $localize`This benchmark may not include dividends.`;
    }
    if (basis === 'UNKNOWN') {
      return $localize`The benchmark return basis could not be confirmed.`;
    }
    return null;
  }

  protected get chartBenchmarkLabel() {
    return this.chartMode === 'TOTAL_VALUE'
      ? $localize`Invested capital`
      : (this.benchmark?.name ??
          this.benchmark?.symbol ??
          $localize`Benchmark`);
  }

  protected get chartHelp() {
    switch (this.chartMode) {
      case 'GAIN_LOSS':
        return $localize`Cumulative gain or loss in your base currency. External deposits and withdrawals are excluded.`;
      case 'TOTAL_VALUE':
        return $localize`Total holdings and checkpoint-aware cash. Invested capital is the opening portfolio value plus cumulative net external contributions.`;
      default:
        return $localize`Time-weighted return. External deposits and withdrawals are excluded from performance.`;
    }
  }

  protected get chartPortfolioLabel() {
    switch (this.chartMode) {
      case 'GAIN_LOSS':
        return $localize`Gain / loss`;
      case 'TOTAL_VALUE':
        return $localize`Total value`;
      default:
        return $localize`Portfolio`;
    }
  }

  protected get coverageMessages(): string[] {
    if (!this.twrResult) {
      return [];
    }
    const messages = [
      ...this.coverageGroups,
      ...this.coverageWarningGroups
    ].flatMap(({ messages }) => messages);
    return messages.length || !this.twrResult.reason
      ? messages
      : [this.reasonMessage(this.twrResult.reason)];
  }

  protected get coverageGroups(): CoverageGroup[] {
    if (!this.twrResult) {
      return [];
    }
    const groups = this.groupCoverageReasons(
      this.twrResult.coverage.reasons.filter(
        ({ severity }) => (severity ?? 'ERROR') === 'ERROR'
      )
    );
    if (groups.length || !this.twrResult.reason) {
      return groups;
    }
    return [
      {
        label: this.coverageCategory(this.twrResult.reason),
        messages: [this.reasonMessage(this.twrResult.reason)]
      }
    ];
  }

  protected get coverageWarningGroups(): CoverageGroup[] {
    return this.groupCoverageReasons(
      (this.twrResult?.coverage.reasons ?? []).filter(
        ({ severity }) => severity === 'WARNING'
      )
    );
  }

  protected get coverageInformationMessages(): string[] {
    const messages = (this.twrResult?.coverage.reasons ?? [])
      .map((reason) => this.openingCashInformationMessage(reason))
      .filter((message): message is string => Boolean(message));

    return [...new Set(messages)];
  }

  protected get benchmarkCoverageMessages(): string[] {
    if (!this.benchmarkResult) {
      return [];
    }
    const reasons = this.benchmarkResult.benchmarkCoverage.reasons.filter(
      ({ code }) => code !== 'UNKNOWN_RETURN_BASIS'
    );
    if (!reasons.length && this.benchmarkResult.reason) {
      return [this.reasonMessage(this.benchmarkResult.reason)];
    }
    return this.groupCoverageReasons(reasons, true).flatMap(
      ({ messages }) => messages
    );
  }

  protected get benchmarkCoverageGroups(): CoverageGroup[] {
    if (!this.benchmarkResult) {
      return [];
    }
    const reasons = this.benchmarkResult.benchmarkCoverage.reasons.filter(
      ({ code }) => code !== 'UNKNOWN_RETURN_BASIS'
    );
    if (!reasons.length && this.benchmarkResult.reason) {
      return [
        {
          label: $localize`Benchmark`,
          messages: [this.reasonMessage(this.benchmarkResult.reason)]
        }
      ];
    }
    return this.groupCoverageReasons(reasons, true);
  }

  protected get periodLabel(): string {
    const interval = this.twrResult?.interval;
    if (!interval) {
      return '—';
    }
    try {
      const formatter = new Intl.DateTimeFormat(this.user.settings.locale, {
        dateStyle: 'medium',
        timeZone: 'UTC'
      });
      return `${formatter.format(new Date(`${interval.from}T00:00:00Z`))} – ${formatter.format(new Date(`${interval.to}T00:00:00Z`))}`;
    } catch {
      return `${interval.from} – ${interval.to}`;
    }
  }

  protected get portfolioChartItems(): LineChartItem[] {
    const series = this.twrResult?.series ?? [];
    return series.flatMap((point, index) => {
      if (this.chartMode === 'GAIN_LOSS') {
        return [{ date: point.date, value: Number(point.cumulativeGainLoss) }];
      }
      if (this.chartMode === 'TOTAL_VALUE') {
        return [{ date: point.date, value: Number(point.portfolioValue) }];
      }
      return point.indexLevel === null
        ? []
        : [
            {
              date: point.date,
              value:
                index === 0
                  ? 0
                  : index === series.length - 1 &&
                      this.twrResult?.periodReturn != null
                    ? Number(this.twrResult.periodReturn)
                    : Number(point.indexLevel) - 1
            }
          ];
    });
  }

  protected onChangeChartMode(chartMode: AnalyticsChartMode) {
    this.chartMode = chartMode;
  }

  protected onAdvancedOpened() {
    if (!this.advancedLoaded) {
      this.advancedLoaded = true;
      this.advancedRefresh.next();
    }
  }

  protected onChangeBenchmark(symbolProfileId: string) {
    this.benchmarkChanged.emit(symbolProfileId);
  }

  protected reasonMessage(code: string | null | undefined): string {
    switch (code) {
      case 'MISSING_OPENING_CASH':
      case 'MISSING_OPENING_VALUE':
        return $localize`Historical cash balance is missing for the start of this period.`;
      case 'MISSING_PRICE':
      case 'MISSING_BENCHMARK_PRICE':
        return $localize`Historical price data is missing.`;
      case 'MISSING_FX':
      case 'MISSING_BENCHMARK_FX':
        return $localize`Historical exchange-rate data is missing.`;
      case 'CASH_RECONCILIATION_MISMATCH':
        return $localize`Recorded cash does not fully match reconstructed transactions.`;
      case 'UNFUNDED_SEGMENT_BREAK':
        return $localize`Performance cannot be linked across a period with no invested capital.`;
      case 'BENCHMARK_SIMULATION_EXHAUSTED':
        return $localize`The simulated benchmark could not fund a withdrawal without going negative.`;
      case 'ONE_SIGN_ONLY':
      case 'NO_VALID_ROOT':
      case 'ROOT_UNIQUENESS_NOT_ESTABLISHED':
      case 'MULTIPLE_ROOTS':
        return $localize`Your annualized return is not available for these cash flows.`;
      case 'ZERO_OR_NEGATIVE_CAPITAL':
        return $localize`Performance is unavailable because invested capital is zero or negative.`;
      case 'STALE_PRICE':
      case 'STALE_BENCHMARK_PRICE':
        return $localize`Historical price data is too old for part of this period.`;
      case 'STALE_FX':
      case 'STALE_BENCHMARK_FX':
        return $localize`Historical exchange-rate data is too old for part of this period.`;
      default:
        return $localize`The result is unavailable because historical data is incomplete.`;
    }
  }

  private requestInput() {
    return {
      baseCurrency: this.user.settings.baseCurrency,
      customDateRange: this.user.settings.customDateRange,
      filters: this.filters.filter(({ type }) => type === 'ACCOUNT'),
      range: this.user.settings.dateRange ?? DEFAULT_DATE_RANGE
    };
  }

  private benchmarkRequestKey(portfolioRequestKey: string) {
    return JSON.stringify({
      benchmark: this.benchmark?.dataSource
        ? `${this.benchmark.dataSource}:${this.benchmark.symbol ?? ''}`
        : null,
      portfolioRequestKey
    });
  }

  private portfolioRequestKey() {
    const input = this.requestInput();
    return JSON.stringify({
      accountIds: [
        ...new Set(input.filters.map(({ id }) => id).filter(Boolean))
      ].sort(),
      baseCurrency: input.baseCurrency,
      customDateRange: input.customDateRange,
      range: input.range
    });
  }

  private safe<T>(request: Observable<unknown>): Observable<RequestResult<T>> {
    return request.pipe(
      switchMap((data) => of({ data: data as T, failed: false })),
      catchError(() => of({ data: null, failed: true }))
    );
  }

  private coverageCategory(code: string, benchmark = false) {
    if (benchmark || code.includes('BENCHMARK')) return $localize`Benchmark`;
    if (code.includes('PRICE')) return $localize`Prices`;
    if (code.includes('FX')) return $localize`FX`;
    if (code.includes('INCEPTION') || code.includes('OPENING'))
      return $localize`Opening history`;
    if (code.includes('RANGE')) return $localize`Range`;
    return $localize`Cash`;
  }

  private coverageReasonMessage(reason: AnalyticsCoverageReason) {
    const date = this.coverageDateLabel(reason);
    const dateSuffix = date ? ` — ${date}` : '';
    const benchmarkSymbol = this.benchmarkResult?.benchmark?.symbol;
    switch (reason.code) {
      case 'MISSING_PRICE':
        return `Historical price missing for ${reason.symbol ?? 'security'}${dateSuffix}.`;
      case 'STALE_PRICE':
        return `Historical price for ${reason.symbol ?? 'security'} is too old${dateSuffix}${reason.sourceDate ? ` (nearest allowed prior close: ${this.formatAccountingDate(reason.sourceDate)})` : ''}.`;
      case 'MISSING_BENCHMARK_PRICE':
        return `Historical benchmark price missing for ${benchmarkSymbol ?? 'benchmark'}${dateSuffix}.`;
      case 'STALE_BENCHMARK_PRICE':
        return `Historical benchmark price for ${benchmarkSymbol ?? 'benchmark'} is too old${dateSuffix}${reason.sourceDate ? ` (prior close: ${this.formatAccountingDate(reason.sourceDate)})` : ''}.`;
      case 'MISSING_FX':
      case 'STALE_FX': {
        const pair = [reason.currency, reason.targetCurrency]
          .filter(Boolean)
          .join('/');
        return `Historical exchange rate${pair ? ` ${pair}` : ''} ${reason.code === 'MISSING_FX' ? 'is missing' : 'is too old'}${dateSuffix}.`;
      }
      case 'MISSING_BENCHMARK_FX':
      case 'STALE_BENCHMARK_FX':
        return `Historical benchmark exchange rate ${reason.code === 'MISSING_BENCHMARK_FX' ? 'is missing' : 'is too old'}${dateSuffix}.`;
      case 'MISSING_OPENING_CASH':
      case 'MISSING_OPENING_HOLDINGS':
      case 'MISSING_OPENING_VALUE':
        return `Opening history is missing for ${reason.accountName ?? 'the selected account'}${dateSuffix}.`;
      case 'ACCOUNT_INCEPTION_CONFLICT':
        return `Existing account history predates the configured account start date for ${reason.accountName ?? 'the selected account'}${dateSuffix}.`;
      case 'CASH_RECONCILIATION_MISMATCH': {
        const account = reason.accountName ?? $localize`Selected account`;
        return $localize`${account}:accountName:${dateSuffix}:dateSuffix:. Recorded cash: ${this.formatMoney(reason.expected, reason.currency)}:recordedCash:. Reconstructed cash: ${this.formatMoney(reason.reconstructed, reason.currency)}:reconstructedCash:. Checkpoint adjustment: ${this.formatMoney(reason.adjustment, reason.currency)}:checkpointAdjustment:. Allowed tolerance: ${this.formatMoney(reason.tolerance, reason.currency)}:allowedTolerance:. Cash was reset to the recorded checkpoint for subsequent calculations.`;
      }
      default:
        return this.reasonMessage(reason.code);
    }
  }

  private coverageDateLabel(reason: AnalyticsCoverageReason) {
    const from = reason.dateFrom ?? reason.date;
    const to = reason.dateTo ?? reason.date;
    if (!from) return '';
    const formattedFrom = this.formatAccountingDate(from);
    return to && to !== from
      ? `${formattedFrom} – ${this.formatAccountingDate(to)}`
      : formattedFrom;
  }

  private formatAccountingDate(date: string) {
    try {
      return new Intl.DateTimeFormat(this.user.settings.locale, {
        dateStyle: 'medium',
        timeZone: 'UTC'
      }).format(new Date(`${date}T00:00:00Z`));
    } catch {
      return date;
    }
  }

  private formatMoney(value?: string, currency?: string) {
    if (!value || !currency) return value ?? '—';
    const amount = Number(value);
    if (!Number.isFinite(amount)) return `${value} ${currency}`;
    try {
      const currencyOptions = new Intl.NumberFormat('en', {
        currency,
        style: 'currency'
      }).resolvedOptions();
      const formatted = new Intl.NumberFormat(this.user.settings.locale, {
        maximumFractionDigits: currencyOptions.maximumFractionDigits,
        minimumFractionDigits: currencyOptions.minimumFractionDigits
      }).format(amount);
      return `${formatted} ${currency}`;
    } catch {
      return `${value} ${currency}`;
    }
  }

  private openingCashInformationMessage(reason: AnalyticsCoverageReason) {
    if (!reason.openingCashSource) return null;
    const date = reason.openingCashDate
      ? this.formatAccountingDate(reason.openingCashDate)
      : null;
    switch (reason.openingCashSource) {
      case 'ACCOUNT_NOT_YET_IN_EXISTENCE':
        return `Opening cash is not required before the account start date.${date ? ` This account is treated as nonexistent before ${date}.` : ''}`;
      case 'INFERRED_ZERO_FIRST_FUNDING':
        return `Opening cash inferred as ${this.formatMoney('0', reason.currency)} at the first external funding event${date ? ` on ${date}` : ''}.`;
      case 'ACCOUNT_BALANCE':
        return `Opening cash is based on the recorded account balance${date ? ` on ${date}` : ''}.`;
    }
  }

  private groupCoverageReasons(
    reasons: AnalyticsCoverageReason[],
    benchmark = false
  ): CoverageGroup[] {
    const groups = new Map<string, string[]>();
    for (const reason of reasons) {
      const label = this.coverageCategory(reason.code, benchmark);
      const messages = groups.get(label) ?? [];
      const message = this.coverageReasonMessage(reason);
      if (!messages.includes(message)) messages.push(message);
      groups.set(label, messages);
    }
    return [...groups].map(([label, messages]) => ({ label, messages }));
  }
}
