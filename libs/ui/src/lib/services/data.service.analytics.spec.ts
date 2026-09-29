import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DataSource } from '@prisma/client';

import { DataService } from './data.service';

describe('DataService analytics API', () => {
  let httpTesting: HttpTestingController;
  let service: DataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, provideHttpClient(), provideHttpClientTesting()]
    });
    httpTesting = TestBed.inject(HttpTestingController);
    service = TestBed.inject(DataService);
  });

  afterEach(() => httpTesting.verify());

  it.each(['TWR', 'XIRR', 'MODIFIED_DIETZ'] as const)(
    'requests %s with the shared range and account scope',
    (method) => {
      service
        .fetchAnalyticsPerformance({
          baseCurrency: 'DKK',
          customDateRange: { from: '2026-01-01', to: '2026-06-30' },
          filters: [{ id: 'account-1', type: 'ACCOUNT' }],
          method,
          range: 'custom'
        })
        .subscribe();

      const request = httpTesting.expectOne(
        ({ url }) => url === '/api/v1/portfolio/analytics/performance'
      );
      expect(request.request.params.get('accounts')).toBe('account-1');
      expect(request.request.params.get('baseCurrency')).toBe('DKK');
      expect(request.request.params.get('from')).toBe('2026-01-01');
      expect(request.request.params.get('method')).toBe(method);
      expect(request.request.params.get('range')).toBe('custom');
      expect(request.request.params.get('to')).toBe('2026-06-30');
      request.flush({ method });
    }
  );

  it.each(['TWR', 'CASH_FLOW_MATCHED'] as const)(
    'requests benchmark mode %s with explicit identity',
    (mode) => {
      service
        .fetchAnalyticsBenchmark({
          benchmark: { dataSource: DataSource.YAHOO, symbol: 'IDX' },
          filters: [{ id: 'account-1', type: 'ACCOUNT' }],
          mode,
          range: 'ytd'
        })
        .subscribe();

      const request = httpTesting.expectOne(
        ({ url }) => url === '/api/v1/portfolio/analytics/benchmark'
      );
      expect(request.request.params.get('accounts')).toBe('account-1');
      expect(request.request.params.get('dataSource')).toBe(DataSource.YAHOO);
      expect(request.request.params.get('mode')).toBe(mode);
      expect(request.request.params.get('range')).toBe('ytd');
      expect(request.request.params.get('symbol')).toBe('IDX');
      request.flush({ mode });
    }
  );
});
