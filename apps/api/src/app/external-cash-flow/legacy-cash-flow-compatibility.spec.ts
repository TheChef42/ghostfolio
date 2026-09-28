import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { ActivitiesService } from '@ghostfolio/api/app/activities/activities.service';
import { ExportService } from '@ghostfolio/api/app/export/export.service';
import { ExternalCashFlowService } from '@ghostfolio/api/app/external-cash-flow/external-cash-flow.service';
import type { ImportDataDto } from '@ghostfolio/api/app/import/import-data.dto';
import { ImportService } from '@ghostfolio/api/app/import/import.service';
import { PlatformService } from '@ghostfolio/api/app/platform/platform.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { DataGatheringService } from '@ghostfolio/api/services/queues/data-gathering/data-gathering.service';
import { SymbolProfileService } from '@ghostfolio/api/services/symbol-profile/symbol-profile.service';
import { TagService } from '@ghostfolio/api/services/tag/tag.service';
import { getAssetProfileIdentifier } from '@ghostfolio/common/helper';
import { getPermissions } from '@ghostfolio/common/permissions';
import { UserWithSettings } from '@ghostfolio/common/types';
import { PerformanceCalculationType } from '@ghostfolio/common/types/performance-calculation-type.type';

import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('legacy import/export compatibility with the cash-flow foundation', () => {
  const fixtureDir = resolve(__dirname, '../../../../../test/import/ok');
  const fixtures = readdirSync(fixtureDir).filter((file) =>
    file.endsWith('.json')
  );
  let importer: ImportService;
  let exporter: ExportService;
  let module: TestingModule;
  const accounts = {
    accounts: jest.fn().mockResolvedValue([]),
    getAccounts: jest.fn().mockResolvedValue([])
  };
  const activities = {
    getActivities: jest.fn().mockResolvedValue({ activities: [] })
  };
  const externalCashFlows = {
    exportSection: jest.fn().mockResolvedValue(undefined),
    importSection: jest.fn(),
    validateImportSection: jest.fn()
  };
  const user = {
    id: 'synthetic-legacy-owner',
    permissions: getPermissions('ADMIN'),
    settings: { settings: { baseCurrency: 'EUR' } }
  } as UserWithSettings;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        ImportService,
        ExportService,
        { provide: ExternalCashFlowService, useValue: externalCashFlows },
        { provide: AccountService, useValue: accounts },
        { provide: ActivitiesService, useValue: activities },
        { provide: ApiService, useValue: {} },
        {
          provide: ConfigurationService,
          useValue: {
            get: (key: string) =>
              key === 'MAX_ACTIVITIES_TO_IMPORT'
                ? 10000
                : key === 'DATA_SOURCES_GHOSTFOLIO_DATA_PROVIDER'
                  ? []
                  : false
          }
        },
        {
          provide: DataGatheringService,
          useValue: { gatherSymbols: jest.fn() }
        },
        {
          provide: DataProviderService,
          useValue: {
            getDataSourceForImport: () => DataSource.YAHOO,
            getDataProvider: () => ({
              getAssetProfile: async ({ symbol }: { symbol: string }) => ({
                symbol
              })
            }),
            validateActivities: async ({
              activitiesDto
            }: {
              activitiesDto: ImportDataDto['activities'];
            }) =>
              Object.fromEntries(
                activitiesDto.map((activity) => [
                  getAssetProfileIdentifier({
                    dataSource: activity.dataSource,
                    symbol: activity.symbol
                  }),
                  {
                    id: activity.symbol,
                    symbol: activity.symbol,
                    dataSource: activity.dataSource,
                    currency: activity.currency
                  }
                ])
              )
          }
        },
        {
          provide: ExchangeRateDataService,
          useValue: { toCurrencyAtDate: async (amount: number) => amount }
        },
        {
          provide: MarketDataService,
          useValue: { marketDataItems: async () => [] }
        },
        {
          provide: PlatformService,
          useValue: { getPlatforms: async () => [] }
        },
        { provide: PortfolioService, useValue: {} },
        {
          provide: SymbolProfileService,
          useValue: {
            getSymbolProfiles: async () => [],
            getCustomSymbolProfilesByNames: async () => []
          }
        },
        { provide: TagService, useValue: { getTagsForUser: async () => [] } }
      ]
    }).compile();
    importer = module.get(ImportService);
    exporter = module.get(ExportService);
  });
  afterAll(async () => module?.close());
  beforeEach(() => {
    accounts.accounts.mockResolvedValue([]);
    accounts.getAccounts.mockResolvedValue([]);
    activities.getActivities.mockResolvedValue({ activities: [] });
    externalCashFlows.exportSection.mockResolvedValue(undefined);
  });

  // Broker/provider network and FX lookup are stubbed. The real existing import
  // mapping, duplicate detection and preview path are exercised, not replaced.
  it.each(fixtures)(
    'still previews accepted legacy JSON fixture %s',
    async (file) => {
      const fixture = JSON.parse(
        readFileSync(resolve(fixtureDir, file), 'utf8')
      ) as ImportDataDto;
      const result = await importer.import({
        accountsWithBalancesDto: fixture.accounts ?? [],
        activitiesDto: fixture.activities,
        assetProfilesWithMarketDataDto: fixture.assetProfiles ?? [],
        platformsDto: fixture.platforms ?? [],
        tagsDto: fixture.tags ?? [],
        user,
        isDryRun: true
      });
      expect(result).toHaveLength(fixture.activities.length);
      expect(result.every(({ error }) => !error)).toBe(true);
    }
  );

  it('retains the exact legacy export sections and numeric activity/balance fields', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    accounts.accounts.mockResolvedValue([
      {
        id: accountId,
        currency: 'EUR',
        name: 'Synthetic',
        comment: null,
        platformId: null,
        tags: [],
        balances: [{ date: new Date('2026-01-01Z'), value: 500 }]
      }
    ]);
    activities.getActivities.mockResolvedValue({
      activities: [
        {
          id: 'activity',
          accountId,
          assetProfile: {
            id: 'asset',
            symbol: 'TEST',
            dataSource: 'YAHOO',
            currency: 'EUR',
            userId: null
          },
          tags: [],
          date: new Date('2026-01-02Z'),
          currency: 'EUR',
          quantity: 2,
          unitPrice: 10,
          fee: 1,
          type: 'BUY',
          comment: null
        }
      ]
    });
    const result = await exporter.export({
      userId: user.id,
      userSettings: {
        baseCurrency: 'EUR',
        performanceCalculationType: PerformanceCalculationType.ROAI
      }
    });
    expect(Object.keys(result).sort()).toEqual([
      'accounts',
      'activities',
      'assetProfiles',
      'meta',
      'platforms',
      'tags',
      'user'
    ]);
    expect(result.accounts[0].balances[0].value).toBe(500);
    expect(result.activities[0]).toMatchObject({
      fee: 1,
      quantity: 2,
      unitPrice: 10,
      currency: 'EUR',
      date: '2026-01-02T00:00:00.000Z'
    });
    expect(result).not.toHaveProperty('externalCashFlows');
    activities.getActivities.mockResolvedValue({ activities: [] });
    accounts.accounts.mockResolvedValue([]);
    const preview = await importer.import({
      accountsWithBalancesDto: result.accounts,
      activitiesDto: result.activities,
      assetProfilesWithMarketDataDto:
        result.assetProfiles as ImportDataDto['assetProfiles'],
      platformsDto: result.platforms,
      tagsDto: result.tags,
      user,
      isDryRun: true
    });
    expect(preview).toHaveLength(1);
    expect(preview[0].error).toBeFalsy();
  });

  it('keeps a flow-only account in a filtered export', async () => {
    const accountId = '11111111-1111-4111-8111-111111111111';
    accounts.accounts.mockResolvedValue([
      {
        id: accountId,
        balances: [],
        comment: null,
        currency: 'EUR',
        name: 'Flow only',
        platform: null,
        platformId: null,
        tags: []
      }
    ]);
    externalCashFlows.exportSection.mockResolvedValue({
      version: 1,
      items: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          accountId,
          amount: '1',
          comment: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          currency: 'EUR',
          date: '2026-01-01',
          source: null,
          transferGroupId: null,
          type: 'DEPOSIT',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    });
    const result = await exporter.export({
      filters: [{ id: accountId, type: 'ACCOUNT' }],
      userId: user.id,
      userSettings: {
        baseCurrency: 'EUR',
        performanceCalculationType: PerformanceCalculationType.ROAI
      }
    });
    expect(result.accounts.map(({ id }) => id)).toEqual([accountId]);
    expect(result.externalCashFlows?.items).toHaveLength(1);
  });

  it('passes the existing account-import remapping into cash-flow import', async () => {
    const sourceAccountId = '11111111-1111-4111-8111-111111111111';
    const targetAccountId = '22222222-2222-4222-8222-222222222222';
    const targetAccount = {
      id: targetAccountId,
      userId: user.id,
      currency: 'EUR',
      name: 'Reusable'
    };
    accounts.accounts
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([targetAccount]);
    accounts.getAccounts.mockResolvedValue([targetAccount]);
    externalCashFlows.importSection.mockResolvedValue({
      created: 1,
      skipped: 0,
      version: 1
    });
    const externalCashFlow = {
      id: '33333333-3333-4333-8333-333333333333',
      accountId: sourceAccountId,
      amount: '1',
      comment: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      currency: 'EUR',
      date: '2026-01-01',
      source: null,
      transferGroupId: null,
      type: 'DEPOSIT' as const,
      updatedAt: '2026-01-01T00:00:00.000Z'
    };
    const result = await importer.importData({
      isDryRun: false,
      user,
      importData: {
        accounts: [
          {
            id: sourceAccountId,
            balances: [],
            currency: 'EUR',
            name: 'Reusable',
            platformId: null
          }
        ],
        activities: [],
        externalCashFlows: { version: 1, items: [externalCashFlow] }
      }
    });
    expect(result.externalCashFlows).toEqual({
      created: 1,
      skipped: 0,
      version: 1
    });
    expect(externalCashFlows.importSection).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        accountIdMapping: { [sourceAccountId]: targetAccountId },
        ownedAccountIds: [targetAccountId]
      })
    );
  });
});
