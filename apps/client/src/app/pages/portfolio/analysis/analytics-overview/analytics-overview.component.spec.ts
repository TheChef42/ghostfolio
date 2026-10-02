import {
  AnalyticsModifiedDietzResponse,
  AnalyticsTwrBenchmarkResponse,
  AnalyticsTwrResponse,
  AnalyticsXirrResponse,
  User
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DataSource } from '@prisma/client';
import { of, Subject } from 'rxjs';

import { GfAnalyticsOverviewComponent } from './analytics-overview.component';

jest.mock(
  '@ghostfolio/client/components/benchmark-comparator/benchmark-comparator.component',
  () => ({ GfBenchmarkComparatorComponent: class {} })
);
jest.mock('@ionic/angular/standalone', () => ({ IonIcon: class {} }));
jest.mock('@ghostfolio/ui/value', () => ({ GfValueComponent: class {} }));

const coverage = { reasons: [], status: 'COMPLETE' as const };
const interval = {
  from: '2026-01-01',
  openingDate: '2025-12-31',
  to: '2026-06-30'
};
const scope = {
  accountIds: ['account-1'],
  identity: 'account-1',
  type: 'ACCOUNT_SUBSET' as const
};
const twr = (overrides: Partial<AnalyticsTwrResponse> = {}) =>
  ({
    baseCurrency: 'DKK',
    closingValue: '120',
    coverage,
    interval,
    method: 'TWR',
    methodologyVersion: 'phase-6-v1',
    openingValue: '100',
    periodReturn: '0.2',
    reason: null,
    scope,
    segmentCount: 1,
    series: [
      {
        boundary: 'SEGMENT_START',
        chainFactor: '1',
        date: '2025-12-31',
        externalFlow: '0',
        indexLevel: '1',
        portfolioValue: '100',
        segmentId: 1,
        subperiodReturn: null
      },
      {
        boundary: 'CONTINUE',
        chainFactor: '1.2',
        date: '2026-06-30',
        externalFlow: '0',
        indexLevel: '1.2',
        portfolioValue: '120',
        segmentId: 1,
        subperiodReturn: '0.2'
      }
    ],
    ...overrides
  }) as AnalyticsTwrResponse;
const xirr = (overrides: Partial<AnalyticsXirrResponse> = {}) =>
  ({
    annualizedReturn: 0.24,
    baseCurrency: 'DKK',
    closingValue: '120',
    coverage,
    interval,
    method: 'XIRR',
    methodologyVersion: 'phase-5-v1',
    openingValue: '100',
    reason: null,
    rootCount: 1,
    scheduleEntryCount: 2,
    scope,
    signChangeCount: 1,
    ...overrides
  }) as AnalyticsXirrResponse;
const benchmarkResult = (
  basis: NonNullable<
    AnalyticsTwrBenchmarkResponse['benchmark']
  >['basis'] = 'TOTAL_RETURN'
) =>
  ({
    baseCurrency: 'DKK',
    benchmark: {
      basis,
      currency: 'USD',
      dataSource: DataSource.YAHOO,
      id: 'benchmark-1',
      name: 'Global Index',
      symbol: 'IDX'
    },
    benchmarkCoverage: coverage,
    benchmarkPeriodReturn: '0.1',
    interval,
    methodologyVersion: 'phase-7-v1',
    mode: 'TWR',
    portfolioCoverage: coverage,
    portfolioPeriodReturn: '0.2',
    reason: null,
    scope,
    series: [
      {
        benchmarkIndex: '1',
        benchmarkValue: '100',
        date: '2025-12-31',
        portfolioIndex: '1',
        portfolioValue: '100',
        priceSourceDate: '2025-12-31',
        priceStalenessDays: 0
      },
      {
        benchmarkIndex: '1.1',
        benchmarkValue: '110',
        date: '2026-06-30',
        portfolioIndex: '1.2',
        portfolioValue: '120',
        priceSourceDate: '2026-06-30',
        priceStalenessDays: 0
      }
    ]
  }) as AnalyticsTwrBenchmarkResponse;

describe('GfAnalyticsOverviewComponent', () => {
  let component: GfAnalyticsOverviewComponent;
  let fixture: ComponentFixture<GfAnalyticsOverviewComponent>;
  let dataService: {
    fetchAnalyticsBenchmark: jest.Mock;
    fetchAnalyticsPerformance: jest.Mock;
  };
  const benchmark = {
    currency: 'USD',
    dataSource: DataSource.YAHOO,
    id: 'benchmark-1',
    name: 'Global Index',
    symbol: 'IDX'
  };
  const user = {
    settings: {
      baseCurrency: 'DKK',
      colorScheme: 'light',
      customDateRange: { from: '2026-01-01', to: '2026-06-30' },
      dateRange: 'custom',
      locale: 'en-US'
    }
  } as User;

  beforeEach(async () => {
    dataService = {
      fetchAnalyticsBenchmark: jest.fn().mockReturnValue(of(benchmarkResult())),
      fetchAnalyticsPerformance: jest.fn(({ method }) => {
        if (method === 'TWR') {
          return of(twr());
        }
        if (method === 'XIRR') {
          return of(xirr());
        }
        return of({
          absoluteResult: '20',
          baseCurrency: 'DKK',
          closingValue: '120',
          coverage,
          effectiveCapital: '100',
          interval,
          method: 'MODIFIED_DIETZ',
          openingValue: '100',
          periodReturn: '0.2',
          reason: null,
          scope,
          totalExternalFlow: '0'
        } as AnalyticsModifiedDietzResponse);
      })
    };
    await TestBed.configureTestingModule({
      imports: [GfAnalyticsOverviewComponent],
      providers: [{ provide: DataService, useValue: dataService }]
    })
      .overrideComponent(GfAnalyticsOverviewComponent, {
        set: {
          imports: [],
          schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }
      })
      .compileComponents();
    fixture = TestBed.createComponent(GfAnalyticsOverviewComponent);
    component = fixture.componentInstance;
  });

  function initialize({ withBenchmark = true } = {}) {
    fixture.componentRef.setInput('user', user);
    fixture.componentRef.setInput('filters', [
      { id: 'account-1', type: 'ACCOUNT' },
      { id: 'ignored-tag', type: 'TAG' }
    ]);
    fixture.componentRef.setInput(
      'benchmarks',
      withBenchmark ? [benchmark] : []
    );
    if (withBenchmark) {
      fixture.componentRef.setInput('benchmark', benchmark);
    }
    fixture.detectChanges();
    fixture.detectChanges();
  }

  it('presents TWR first and labels XIRR as annualized', () => {
    initialize();
    const text = fixture.nativeElement.textContent;
    expect(text.indexOf('Portfolio return (TWR)')).toBeLessThan(
      text.indexOf('Your annualized return (XIRR)')
    );
    expect(text).toContain('Portfolio return (TWR)');
    expect(text).toContain('Your annualized return (XIRR)');
    expect(text).toContain('Period return');
    expect(text).toContain('annualized return');
  });

  it('provides independent accessible explanations for each return concept', () => {
    initialize();
    const controls = Array.from(
      fixture.nativeElement.querySelectorAll('gf-analytics-info')
    ) as (HTMLElement & { text: string })[];
    const labels = controls.map((control) =>
      control.getAttribute('accessibleLabel')
    );

    expect(labels).toEqual(
      expect.arrayContaining([
        'About Portfolio return (TWR)',
        'About Your annualized return (XIRR)',
        'About benchmark return',
        'About Modified Dietz',
        'About cash-flow-matched benchmark'
      ])
    );
    expect(controls[1].text).toContain(
      'Short periods can produce extreme annualized values'
    );
    expect(controls[2].text).toContain('price only');
    expect(controls[0].text).not.toBe(controls[1].text);
  });

  it('keeps Modified Dietz and cash-flow matching in advanced analysis', () => {
    initialize();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Advanced analysis');
    expect(text).toContain('Modified Dietz');
    expect(text).toContain('Cash-flow-matched benchmark');
    expect(
      dataService.fetchAnalyticsPerformance.mock.calls.some(
        ([input]) => input.method === 'MODIFIED_DIETZ'
      )
    ).toBe(false);

    (component as any).onAdvancedOpened();
    expect(dataService.fetchAnalyticsPerformance).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'MODIFIED_DIETZ' })
    );
    expect(dataService.fetchAnalyticsBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'CASH_FLOW_MATCHED' })
    );
  });

  it('propagates one range and account-only scope to every default request', () => {
    initialize();
    for (const [input] of dataService.fetchAnalyticsPerformance.mock.calls) {
      expect(input).toMatchObject({
        customDateRange: { from: '2026-01-01', to: '2026-06-30' },
        filters: [{ id: 'account-1', type: 'ACCOUNT' }],
        range: 'custom'
      });
    }
    expect(dataService.fetchAnalyticsBenchmark).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ id: 'account-1', type: 'ACCOUNT' }],
        mode: 'TWR',
        range: 'custom'
      })
    );
  });

  it('issues each initial analytics request only once', () => {
    initialize();
    expect(
      dataService.fetchAnalyticsPerformance.mock.calls.filter(
        ([input]) => input.method === 'TWR'
      )
    ).toHaveLength(1);
    expect(
      dataService.fetchAnalyticsPerformance.mock.calls.filter(
        ([input]) => input.method === 'XIRR'
      )
    ).toHaveLength(1);
    expect(dataService.fetchAnalyticsBenchmark).toHaveBeenCalledTimes(1);
  });

  it('does not refetch for an equivalent account scope or unrelated filter order', () => {
    initialize();
    dataService.fetchAnalyticsPerformance.mockClear();
    dataService.fetchAnalyticsBenchmark.mockClear();

    fixture.componentRef.setInput('filters', [
      { id: 'another-ignored-tag', type: 'TAG' },
      { id: 'account-1', type: 'ACCOUNT' },
      { id: 'account-1', type: 'ACCOUNT' }
    ]);
    fixture.detectChanges();

    expect(dataService.fetchAnalyticsPerformance).not.toHaveBeenCalled();
    expect(dataService.fetchAnalyticsBenchmark).not.toHaveBeenCalled();
  });

  it('changes benchmark without refetching portfolio metrics', () => {
    initialize();
    (component as any).onAdvancedOpened();
    dataService.fetchAnalyticsPerformance.mockClear();
    dataService.fetchAnalyticsBenchmark.mockClear();

    fixture.componentRef.setInput('benchmark', {
      ...benchmark,
      id: 'benchmark-2',
      symbol: 'OTHER'
    });
    fixture.detectChanges();

    expect(dataService.fetchAnalyticsPerformance).not.toHaveBeenCalled();
    expect(
      dataService.fetchAnalyticsBenchmark.mock.calls.map(
        ([input]) => input.mode
      )
    ).toEqual(['TWR', 'CASH_FLOW_MATCHED']);
  });

  it('renders aligned benchmark TWR data and an unknown-basis note', () => {
    dataService.fetchAnalyticsBenchmark.mockReturnValue(
      of(benchmarkResult('UNKNOWN'))
    );
    initialize();
    expect((component as any).portfolioChartItems).toEqual([
      { date: '2025-12-31', value: 0 },
      { date: '2026-06-30', value: expect.closeTo(0.2) }
    ]);
    expect((component as any).benchmarkChartItems).toEqual([
      { date: '2025-12-31', value: 0 },
      { date: '2026-06-30', value: expect.closeTo(0.1) }
    ]);
    expect((component as any).benchmarkWarning).toContain(
      'could not be confirmed'
    );
  });

  it('adds no data-quality warning for complete coverage', () => {
    initialize();
    expect((component as any).coverageMessages).toEqual([]);
  });

  it('shows an understandable warning for incomplete coverage', () => {
    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      of(
        method === 'TWR'
          ? twr({
              coverage: {
                reasons: [
                  {
                    code: 'MISSING_PRICE',
                    dateFrom: '2026-03-15',
                    dateTo: '2026-03-18',
                    message: 'technical message',
                    symbol: 'XYZ'
                  }
                ],
                status: 'INCOMPLETE'
              },
              periodReturn: null,
              reason: 'INCOMPLETE_VALUATION_INPUT'
            })
          : xirr()
      )
    );
    initialize();
    expect(fixture.nativeElement.textContent).toContain('Why unavailable?');
    expect(fixture.nativeElement.textContent).toContain('Prices');
    expect(fixture.nativeElement.textContent).toContain(
      'Historical price missing for XYZ'
    );
    expect(fixture.nativeElement.textContent).toContain('Mar 15, 2026');
    expect(fixture.nativeElement.textContent).toContain('Mar 18, 2026');
    expect(fixture.nativeElement.textContent).not.toContain('MISSING_PRICE');
  });

  it('shows cash mismatch context without exposing raw backend objects', () => {
    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      of(
        method === 'TWR'
          ? twr({
              coverage: {
                reasons: [
                  {
                    accountName: 'Broker cash',
                    code: 'CASH_RECONCILIATION_MISMATCH',
                    currency: 'DKK',
                    date: '2026-04-01',
                    difference: '10',
                    expected: '90',
                    message: 'technical message',
                    openingCashDate: '2026-01-01',
                    openingCashSource: 'ACCOUNT_BALANCE',
                    reconstructed: '100',
                    tolerance: '0.01'
                  }
                ],
                status: 'INCOMPLETE'
              },
              periodReturn: null,
              reason: 'INCOMPLETE_VALUATION_INPUT'
            })
          : xirr()
      )
    );
    initialize();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Broker cash (DKK)');
    expect(text).toContain('recorded checkpoint cash 90');
    expect(text).toContain('reconstructed cash 100');
    expect(text).toContain('tolerance 0.01');
    expect(text).not.toContain('[object Object]');
  });

  it('displays the interval returned by the analytics backend', () => {
    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      of(
        method === 'TWR'
          ? twr({
              interval: {
                from: '2024-02-03',
                openingDate: '2024-02-02',
                to: '2024-07-08'
              }
            })
          : xirr()
      )
    );
    initialize();

    expect((component as any).periodLabel).toContain('Feb 3, 2024');
    expect((component as any).periodLabel).toContain('Jul 8, 2024');
  });

  it('shows an unavailable reason instead of a false zero', () => {
    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      of(
        method === 'TWR'
          ? twr({
              periodReturn: null,
              reason: 'UNFUNDED_SEGMENT_BREAK',
              series: []
            })
          : xirr()
      )
    );
    initialize();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('no invested capital');
    expect(text).not.toContain('0.00%');
  });

  it('shows a calm empty state when no benchmark is configured', () => {
    initialize({ withBenchmark: false });
    expect(fixture.nativeElement.textContent).toContain(
      'No benchmark is configured yet.'
    );
  });

  it('keeps the page structure visible while requests are loading', () => {
    dataService.fetchAnalyticsPerformance.mockReturnValue(new Subject());
    initialize({ withBenchmark: false });
    expect(fixture.nativeElement.textContent).toContain(
      'Portfolio performance'
    );
    expect(fixture.nativeElement.querySelector('.summary-grid')).not.toBeNull();
  });

  it('ignores stale responses after the selected range changes', () => {
    const firstTwr = new Subject<AnalyticsTwrResponse>();
    const firstXirr = new Subject<AnalyticsXirrResponse>();
    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      method === 'TWR' ? firstTwr : firstXirr
    );
    initialize({ withBenchmark: false });

    dataService.fetchAnalyticsPerformance.mockImplementation(({ method }) =>
      of(
        method === 'TWR'
          ? twr({ interval: { ...interval, from: '2026-03-01' } })
          : xirr({ interval: { ...interval, from: '2026-03-01' } })
      )
    );
    fixture.componentRef.setInput('user', {
      ...user,
      settings: {
        ...user.settings,
        customDateRange: { from: '2026-03-01', to: '2026-06-30' }
      }
    });
    fixture.detectChanges();

    firstTwr.next(twr());
    firstTwr.complete();
    firstXirr.next(xirr());
    firstXirr.complete();
    fixture.detectChanges();
    expect((component as any).twrResult.interval.from).toBe('2026-03-01');
  });

  it('uses responsive card columns suitable for narrow layouts', () => {
    initialize();
    const columns = fixture.nativeElement.querySelectorAll(
      '.summary-grid > .col-lg-3.col-md-6'
    );
    expect(columns).toHaveLength(4);
  });
});
