import { GfBenchmarkComparatorComponent } from '@ghostfolio/client/components/benchmark-comparator/benchmark-comparator.component';
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
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly performanceRefresh = new Subject<void>();

  public constructor() {
    this.performanceRefresh
      .pipe(
        tap(() => {
          this.isLoadingPerformance = true;
          this.isLoadingBenchmark = Boolean(this.benchmark);
          this.performanceApiFailed = false;
          this.benchmarkApiFailed = false;
        }),
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
                    mode: 'TWR'
                  })
                )
              : of<RequestResult<AnalyticsBenchmarkResponse>>({
                  data: null,
                  failed: false
                });

          return forkJoin({
            benchmark: benchmarkRequest,
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
      .subscribe(({ benchmark, twr, xirr }) => {
        this.twrResult = twr.data;
        this.xirrResult = xirr.data;
        this.benchmarkResult =
          benchmark.data?.mode === 'TWR' ? benchmark.data : null;
        this.performanceApiFailed = twr.failed || xirr.failed;
        this.benchmarkApiFailed = benchmark.failed;
        this.isLoadingPerformance = false;
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
  }

  public ngOnChanges() {
    if (!this.user) {
      return;
    }
    this.performanceRefresh.next();
    if (this.advancedLoaded) {
      this.advancedRefresh.next();
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

  protected get coverageMessages(): string[] {
    if (!this.twrResult || this.twrResult.coverage.status === 'COMPLETE') {
      return this.twrResult?.reason
        ? [this.reasonMessage(this.twrResult.reason)]
        : [];
    }
    return this.uniqueMessages(this.twrResult.coverage.reasons);
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
    return this.uniqueMessages(reasons);
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
    const comparison = this.benchmarkResult?.series;
    if (comparison?.length) {
      return comparison
        .filter(({ portfolioIndex }) => portfolioIndex !== null)
        .map(({ date, portfolioIndex }) => ({
          date,
          value: Number(portfolioIndex) - 1
        }));
    }
    return (this.twrResult?.series ?? [])
      .filter(({ indexLevel }) => indexLevel !== null)
      .map(({ date, indexLevel }) => ({
        date,
        value: Number(indexLevel) - 1
      }));
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

  private safe<T>(request: Observable<unknown>): Observable<RequestResult<T>> {
    return request.pipe(
      switchMap((data) => of({ data: data as T, failed: false })),
      catchError(() => of({ data: null, failed: true }))
    );
  }

  private uniqueMessages(reasons: AnalyticsCoverageReason[]) {
    return [...new Set(reasons.map(({ code }) => this.reasonMessage(code)))];
  }
}
