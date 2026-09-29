import { DataSource, ExternalCashFlowType, Prisma, Type } from '@prisma/client';

import { PerformanceScopeResolver } from '../performance-scope.resolver';
import { PortfolioValuationTimelineService } from '../portfolio-valuation-timeline.service';
import type { HistoricalValueResolver } from '../valuation-timeline.types';
import { ModifiedDietzCalculator } from './modified-dietz.calculator';

describe('Modified Dietz with the Phase 4A golden timeline', () => {
  it('combines holdings, cash, deposit, buy, dividend and fee', async () => {
    const valuationService = new PortfolioValuationTimelineService(
      null as never,
      new PerformanceScopeResolver(),
      null as never
    );
    const resolver: HistoricalValueResolver = {
      resolveFx: async ({ date }) => ({
        requestedDate: date,
        sourceDate: date,
        stalenessDays: 0,
        value: '1'
      }),
      resolvePrice: async ({ date }) => ({
        requestedDate: date,
        sourceDate: date,
        stalenessDays: 0,
        value: '40'
      })
    };
    const activity = (
      id: string,
      type: Type,
      date: string,
      unitPrice: string
    ) => ({
      accountId: 'a',
      assetId: 'asset',
      currency: 'DKK',
      dataSource: DataSource.YAHOO,
      date: new Date(`${date}T12:00:00.000Z`),
      fee: '0',
      id,
      quantity: '1',
      symbol: 'TEST',
      type,
      unitPrice
    });
    const timeline = await valuationService.buildTimeline({
      baseCurrency: 'DKK',
      from: '2024-01-01',
      inputs: {
        accounts: [{ currency: 'DKK', id: 'a' }],
        activities: [
          activity('opening-buy', Type.BUY, '2023-12-30', '40'),
          activity('range-buy', Type.BUY, '2024-01-01', '40'),
          activity('dividend', Type.DIVIDEND, '2024-01-02', '10'),
          activity('fee', Type.FEE, '2024-01-02', '5')
        ],
        balances: [
          {
            accountId: 'a',
            date: new Date('2023-12-31T00:00:00.000Z'),
            value: 60
          }
        ],
        externalCashFlows: [
          {
            accountId: 'a',
            amount: new Prisma.Decimal('50'),
            comment: null,
            createdAt: new Date('2024-01-01T00:00:00.000Z'),
            currency: 'DKK',
            date: new Date('2024-01-01T00:00:00.000Z'),
            id: 'deposit',
            source: null,
            transferGroupId: null,
            type: ExternalCashFlowType.DEPOSIT,
            updatedAt: new Date('2024-01-01T00:00:00.000Z'),
            userId: 'user'
          }
        ]
      },
      resolver,
      scope: {
        accountIds: ['a'],
        identity: 'a',
        type: 'WHOLE_PORTFOLIO'
      },
      to: '2024-01-02',
      userId: 'user'
    });

    const result = new ModifiedDietzCalculator().calculate(timeline);

    expect(timeline.opening.totalValueInBaseCurrency).toBe('100');
    expect(timeline.closing.totalValueInBaseCurrency).toBe('155');
    expect(result).toEqual(
      expect.objectContaining({
        absoluteResult: '5',
        effectiveCapital: '125',
        periodReturn: '0.04',
        totalExternalFlow: '50',
        weightedExternalFlow: '25'
      })
    );
  });
});
