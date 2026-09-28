import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ImportActivitiesService } from './import-activities.service';

jest.mock('uuid', () => ({
  v4: () => '11111111-1111-4111-8111-111111111111'
}));

describe('ImportActivitiesService external cash flows', () => {
  let http: HttpTestingController;
  let service: ImportActivitiesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ImportActivitiesService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(ImportActivitiesService);
  });

  afterEach(() => http.verify());

  it('preserves the optional externalCashFlows section in dry-run preview', async () => {
    const externalCashFlows = {
      version: 1 as const,
      items: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          accountId: '22222222-2222-4222-8222-222222222222',
          amount: '123.000000000000000001',
          comment: null,
          createdAt: '2026-09-28T10:00:00.000Z',
          currency: 'DKK',
          date: '2026-09-28',
          source: null,
          transferGroupId: null,
          type: 'DEPOSIT' as const,
          updatedAt: '2026-09-28T10:00:00.000Z'
        }
      ]
    };
    const promise = service.importJson({
      activities: [],
      externalCashFlows,
      isDryRun: true
    });
    const request = http.expectOne('/api/v1/import?dryRun=true');

    expect(request.request.body.externalCashFlows).toEqual(externalCashFlows);
    request.flush({
      activities: [],
      externalCashFlows: { created: 1, skipped: 0, version: 1 }
    });

    await expect(promise).resolves.toEqual({
      activities: [],
      externalCashFlows: { created: 1, skipped: 0, version: 1 }
    });
  });

  it('keeps legacy import requests free of the optional section', async () => {
    const promise = service.importJson({ activities: [], isDryRun: true });
    const request = http.expectOne('/api/v1/import?dryRun=true');

    expect(request.request.body.externalCashFlows).toBeUndefined();
    request.flush({ activities: [] });

    await expect(promise).resolves.toEqual({ activities: [] });
  });
});
