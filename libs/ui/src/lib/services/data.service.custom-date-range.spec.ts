import { HttpClient, HttpParams } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { DataService } from './data.service';

describe('DataService custom date range query state', () => {
  let service: DataService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DataService, { provide: HttpClient, useValue: {} }]
    });
    service = TestBed.inject(DataService);
  });

  it('serializes one-off dates as stable ISO query values', () => {
    const params = service.buildDateRangeQueryParams({
      customDateRange: { from: '2026-01-01', to: '2026-06-30' },
      params: new HttpParams(),
      range: 'custom'
    });

    expect(params.get('range')).toBe('custom');
    expect(params.get('from')).toBe('2026-01-01');
    expect(params.get('to')).toBe('2026-06-30');
    expect(params.has('savedRangeId')).toBe(false);
  });

  it('serializes a selected saved range by stable id', () => {
    const params = service.buildDateRangeQueryParams({
      customDateRange: {
        savedRangeId: '11111111-1111-4111-8111-111111111111'
      },
      params: new HttpParams(),
      range: 'custom'
    });

    expect(params.get('range')).toBe('custom');
    expect(params.get('savedRangeId')).toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(params.has('from')).toBe(false);
    expect(params.has('to')).toBe(false);
  });

  it('does not add custom values to an existing named range', () => {
    const params = service.buildDateRangeQueryParams({
      customDateRange: { from: '2026-01-01', to: '2026-06-30' },
      params: new HttpParams(),
      range: 'ytd'
    });

    expect(params.keys()).toEqual(['range']);
    expect(params.get('range')).toBe('ytd');
  });
});
