import { DataSource, ExternalCashFlowType, Prisma, Type } from '@prisma/client';

import { PerformanceScopeResolver } from './performance-scope.resolver';
import { PortfolioValuationTimelineService } from './portfolio-valuation-timeline.service';
import type {
  HistoricalValueResolver,
  TimelineActivity,
  TimelineInputs,
  ValuationSource
} from './valuation-timeline.types';

const userId = 'user';
const from = '2024-01-01';
const to = '2024-01-02';
const openingDate = new Date('2023-12-31T00:00:00.000Z');

function source(date: string, value = '1', sourceDate = date): ValuationSource {
  return {
    requestedDate: date,
    sourceDate,
    stalenessDays:
      (Date.parse(`${date}T00:00:00.000Z`) -
        Date.parse(`${sourceDate}T00:00:00.000Z`)) /
      86_400_000,
    value
  };
}

function resolver({
  missingFx = false,
  missingPrice = false,
  priceSourceDate,
  priceValue = '40'
}: {
  missingFx?: boolean;
  missingPrice?: boolean;
  priceSourceDate?: string;
  priceValue?: string;
} = {}): HistoricalValueResolver {
  return {
    resolveFx: async ({ date }) => (missingFx ? null : source(date)),
    resolvePrice: async ({ date }) =>
      missingPrice ? null : source(date, priceValue, priceSourceDate ?? date)
  };
}

function activity(
  type: Type,
  date: string,
  overrides: Partial<TimelineActivity> = {}
): TimelineActivity {
  return {
    accountId: 'a',
    assetId: 'asset',
    currency: 'DKK',
    dataSource: DataSource.YAHOO,
    date: new Date(`${date}T12:00:00.000Z`),
    fee: '0',
    id: `${type}-${date}`,
    quantity: '1',
    symbol: 'TEST',
    type,
    unitPrice: '40',
    ...overrides
  };
}

function flow(
  type: ExternalCashFlowType,
  amount: string,
  accountId: string,
  date = from,
  transferGroupId: string | null = null
) {
  return {
    accountId,
    amount: new Prisma.Decimal(amount),
    comment: null,
    createdAt: new Date(),
    currency: 'DKK',
    date: new Date(`${date}T00:00:00.000Z`),
    id: `${type}-${accountId}-${date}`,
    source: null,
    transferGroupId,
    type,
    updatedAt: new Date(),
    userId
  };
}

function inputs(overrides: Partial<TimelineInputs> = {}): TimelineInputs {
  return {
    accounts: [{ currency: 'DKK', id: 'a' }],
    activities: [],
    balances: [
      {
        accountId: 'a',
        date: openingDate,
        value: 100
      }
    ],
    externalCashFlows: [],
    ...overrides
  };
}

describe('PortfolioValuationTimelineService', () => {
  const service = new PortfolioValuationTimelineService(
    null as never,
    new PerformanceScopeResolver(),
    null as never
  );

  async function build(
    fixture: TimelineInputs,
    historicalResolver: HistoricalValueResolver = resolver(),
    accountIds = fixture.accounts.map(({ id }) => id),
    scopeType: 'ACCOUNT_SUBSET' | 'WHOLE_PORTFOLIO' = 'WHOLE_PORTFOLIO',
    interval = { from, to }
  ) {
    return service.buildTimeline({
      baseCurrency: 'DKK',
      from: interval.from,
      inputs: fixture,
      resolver: historicalResolver,
      scope: {
        accountIds,
        identity: [...accountIds].sort().join(','),
        type: scopeType
      },
      to: interval.to,
      userId
    });
  }

  it('values a flat cash portfolio without a flow', async () => {
    const result = await build(inputs());
    expect(result.opening.totalValueInBaseCurrency).toBe('100');
    expect(result.closing.totalValueInBaseCurrency).toBe('100');
    expect(result.coverage.status).toBe('COMPLETE');
  });

  it.each([
    [ExternalCashFlowType.DEPOSIT, '50', '150'],
    [ExternalCashFlowType.WITHDRAWAL, '40', '60']
  ])('applies %s once as external capital', async (type, amount, closing) => {
    const result = await build(
      inputs({ externalCashFlows: [flow(type, amount, 'a')] })
    );
    expect(result.opening.totalValueInBaseCurrency).toBe('100');
    expect(result.closing.totalValueInBaseCurrency).toBe(closing);
    expect(result.externalFlows).toHaveLength(1);
  });

  it('keeps a complete same-currency transfer neutral at total scope', async () => {
    const transfer = [
      flow(ExternalCashFlowType.TRANSFER_OUT, '174200', 'a', from, 'pair'),
      flow(ExternalCashFlowType.TRANSFER_IN, '174200', 'b', from, 'pair')
    ];
    const result = await build(
      inputs({
        accounts: [
          { currency: 'DKK', id: 'a' },
          { currency: 'DKK', id: 'b' }
        ],
        balances: [
          { accountId: 'a', date: openingDate, value: 200000 },
          { accountId: 'b', date: openingDate, value: 0 }
        ],
        externalCashFlows: transfer
      })
    );
    expect(result.externalFlows).toEqual([]);
    expect(result.closing.totalValueInBaseCurrency).toBe('200000');
  });

  it.each([
    ['a', '-174200'],
    ['b', '174200']
  ])(
    'treats the included %s transfer leg as a scope flow',
    async (accountId, amount) => {
      const transfer = [
        flow(ExternalCashFlowType.TRANSFER_OUT, '174200', 'a', from, 'pair'),
        flow(ExternalCashFlowType.TRANSFER_IN, '174200', 'b', from, 'pair')
      ];
      const result = await build(
        inputs({
          accounts: [{ currency: 'DKK', id: accountId }],
          balances: [{ accountId, date: openingDate, value: 200000 }],
          externalCashFlows: transfer
        }),
        resolver(),
        [accountId],
        'ACCOUNT_SUBSET'
      );
      expect(result.externalFlows[0].signedAmount).toBe(amount);
    }
  );

  it('nets a cross-currency transfer by group identity at total scope', async () => {
    const transfer = [
      flow(ExternalCashFlowType.TRANSFER_OUT, '100', 'a', from, 'fx-pair'),
      {
        ...flow(ExternalCashFlowType.TRANSFER_IN, '14', 'b', from, 'fx-pair'),
        currency: 'EUR'
      }
    ];
    const result = await build(
      inputs({
        accounts: [
          { currency: 'DKK', id: 'a' },
          { currency: 'EUR', id: 'b' }
        ],
        balances: [
          { accountId: 'a', date: openingDate, value: 100 },
          { accountId: 'b', date: openingDate, value: 0 }
        ],
        externalCashFlows: transfer
      })
    );
    expect(result.externalFlows).toEqual([]);
  });

  it.each([
    [Type.DIVIDEND, '110'],
    [Type.FEE, '90']
  ])('treats %s as cash, not external capital', async (type, expected) => {
    const result = await build(
      inputs({
        activities: [
          activity(Type.BUY, '2023-12-30'),
          activity(type, from, { quantity: '1', unitPrice: '10' })
        ],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      })
    );
    expect(result.closing.totalValueInBaseCurrency).toBe(expected);
    expect(result.externalFlows).toEqual([]);
  });

  it('moves value from cash to holdings for a BUY', async () => {
    const result = await build(
      inputs({ activities: [activity(Type.BUY, from)] })
    );
    expect(result.closing.cashValueInBaseCurrency).toBe('60');
    expect(result.closing.holdingsValueInBaseCurrency).toBe('40');
    expect(result.closing.totalValueInBaseCurrency).toBe('100');
  });

  it('moves value from holdings to cash for a SELL', async () => {
    const result = await build(
      inputs({
        activities: [
          activity(Type.BUY, '2023-12-30'),
          activity(Type.SELL, from)
        ],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      })
    );
    expect(result.closing.cashValueInBaseCurrency).toBe('100');
    expect(result.closing.holdingsValueInBaseCurrency).toBe('0');
  });

  it('marks missing opening cash unavailable instead of assuming zero', async () => {
    const result = await build(inputs({ balances: [] }));
    expect(result.coverage.status).toBe('UNAVAILABLE');
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_OPENING_CASH' })
      ])
    );
  });

  it('infers zero opening cash when explicit funding is the first economic event', async () => {
    const result = await build(
      inputs({
        balances: [],
        externalCashFlows: [
          flow(ExternalCashFlowType.DEPOSIT, '100', 'a', from)
        ]
      })
    );

    expect(result.opening.cashValueInBaseCurrency).toBe('0');
    expect(result.closing.cashValueInBaseCurrency).toBe('100');
    expect(result.coverage.status).toBe('COMPLETE');
    expect(result.openingCash).toContainEqual({
      accountId: 'a',
      currency: 'DKK',
      date: from,
      source: 'INFERRED_ZERO_FIRST_FUNDING'
    });
  });

  it('treats an account as nonexistent before its inception date', async () => {
    const result = await build(
      inputs({
        accounts: [
          {
            currency: 'EUR',
            id: 'a',
            inceptionDate: new Date('2024-01-02T00:00:00.000Z')
          }
        ],
        balances: []
      }),
      resolver({ missingFx: true })
    );

    expect(result.opening.totalValueInBaseCurrency).toBe('0');
    expect(result.coverage.status).toBe('COMPLETE');
    expect(result.coverage.reasons).toEqual([]);
    expect(result.openingCash).toContainEqual({
      accountId: 'a',
      currency: 'EUR',
      date: '2024-01-02',
      source: 'ACCOUNT_NOT_YET_IN_EXISTENCE'
    });
  });

  it('accepts first funding on the inception date without an opening checkpoint', async () => {
    const result = await build(
      inputs({
        accounts: [
          {
            currency: 'DKK',
            id: 'a',
            inceptionDate: new Date(`${from}T00:00:00.000Z`)
          }
        ],
        balances: [],
        externalCashFlows: [
          flow(ExternalCashFlowType.DEPOSIT, '200000', 'a', from)
        ]
      })
    );

    expect(result.opening.totalValueInBaseCurrency).toBe('0');
    expect(result.closing.totalValueInBaseCurrency).toBe('200000');
    expect(result.coverage.status).toBe('COMPLETE');
  });

  it('keeps the whole-portfolio range while a newer account contributes zero', async () => {
    const result = await build(
      inputs({
        accounts: [
          { currency: 'DKK', id: 'a' },
          {
            currency: 'EUR',
            id: 'b',
            inceptionDate: new Date('2024-01-02T00:00:00.000Z')
          }
        ],
        balances: [{ accountId: 'a', date: openingDate, value: 100 }]
      }),
      resolver({ missingFx: true })
    );

    expect(result.interval.from).toBe(from);
    expect(result.opening.totalValueInBaseCurrency).toBe('100');
    expect(result.coverage.status).toBe('COMPLETE');
  });

  it('does not fabricate holdings for the first SELL after inception', async () => {
    const result = await build(
      inputs({
        accounts: [
          {
            currency: 'DKK',
            id: 'a',
            inceptionDate: new Date(`${from}T00:00:00.000Z`)
          }
        ],
        activities: [activity(Type.SELL, from)],
        balances: []
      })
    );

    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'UNSUPPORTED_LIABILITY_OR_SHORT' })
      ])
    );
    expect(result.closing.totalValueInBaseCurrency).toBeNull();
  });

  it('reports missing holding history for a first dividend after inception', async () => {
    const result = await build(
      inputs({
        accounts: [
          {
            currency: 'DKK',
            id: 'a',
            inceptionDate: new Date(`${from}T00:00:00.000Z`)
          }
        ],
        activities: [activity(Type.DIVIDEND, from)],
        balances: []
      })
    );

    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_OPENING_HOLDINGS' })
      ])
    );
  });

  it('reports impossible stored history before inception explicitly', async () => {
    const result = await build(
      inputs({
        accounts: [
          {
            currency: 'DKK',
            id: 'a',
            inceptionDate: new Date('2024-01-02T00:00:00.000Z')
          }
        ],
        balances: [
          {
            accountId: 'a',
            date: new Date('2024-01-01T00:00:00.000Z'),
            value: 100
          }
        ]
      })
    );

    expect(result.coverage.reasons).toContainEqual(
      expect.objectContaining({ code: 'ACCOUNT_INCEPTION_CONFLICT' })
    );
    expect(result.opening.totalValueInBaseCurrency).toBe('0');
  });

  it('keeps opening cash missing when earlier economic history is ambiguous', async () => {
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2023-12-30')],
        balances: [],
        externalCashFlows: [
          flow(ExternalCashFlowType.DEPOSIT, '100', 'a', from)
        ]
      })
    );

    expect(result.opening.cashValueInBaseCurrency).toBeNull();
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'MISSING_OPENING_CASH' })
      ])
    );
    expect(result.openingCash).toEqual([]);
  });

  it('does not omit an asset with a missing historical price', async () => {
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2023-12-30')],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      }),
      resolver({ missingPrice: true })
    );
    expect(result.opening.holdings[0].valueInBaseCurrency).toBeNull();
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_PRICE',
          dataSource: DataSource.YAHOO,
          symbol: 'TEST'
        })
      ])
    );
  });

  it('compacts repeated daily coverage failures into an actionable range', async () => {
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2023-12-30')],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      }),
      resolver({ missingPrice: true })
    );
    const priceReasons = result.coverage.reasons.filter(
      ({ code }) => code === 'MISSING_PRICE'
    );

    expect(priceReasons).toEqual([
      expect.objectContaining({
        dateFrom: '2023-12-31',
        dateTo: '2024-01-02',
        symbol: 'TEST'
      })
    ]);
  });

  it('does not require FX for a zero-valued foreign holding', async () => {
    const resolveFx = jest.fn(async () => null);
    const result = await build(
      inputs({
        activities: [
          activity(Type.BUY, '2023-12-30', {
            currency: 'EUR',
            unitPrice: '0'
          })
        ]
      }),
      { resolveFx, resolvePrice: async ({ date }) => source(date, '0') }
    );

    expect(resolveFx).not.toHaveBeenCalled();
    expect(result.coverage.reasons).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MISSING_FX' })])
    );
  });

  it('requires FX for a nonzero foreign holding', async () => {
    const resolveFx = jest.fn(async () => null);
    const result = await build(
      inputs({
        activities: [
          activity(Type.BUY, '2023-12-30', {
            currency: 'EUR'
          })
        ]
      }),
      { resolveFx, resolvePrice: async ({ date }) => source(date, '40') }
    );

    expect(resolveFx).toHaveBeenCalled();
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'MISSING_FX',
          currency: 'EUR',
          targetCurrency: 'DKK'
        })
      ])
    );
  });

  it('does not fall back to current FX when historical FX is missing', async () => {
    const result = await build(
      inputs({
        accounts: [{ currency: 'EUR', id: 'a' }]
      }),
      resolver({ missingFx: true })
    );
    expect(result.opening.cashValueInBaseCurrency).toBeNull();
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MISSING_FX' })])
    );
  });

  it('uses a prior non-trading-day close and exposes its source date', async () => {
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2023-12-30')],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      }),
      resolver({ priceSourceDate: '2023-12-29' })
    );
    expect(result.opening.holdings[0].price).toEqual(
      expect.objectContaining({ sourceDate: '2023-12-29', stalenessDays: 2 })
    );
  });

  it('rejects an arbitrarily stale prior close', async () => {
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2023-12-30')],
        balances: [{ accountId: 'a', date: openingDate, value: 60 }]
      }),
      resolver({ priceSourceDate: '2023-12-01' })
    );
    expect(result.opening.holdings[0].valueInBaseCurrency).toBeNull();
    expect(result.coverage.reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'STALE_PRICE' })])
    );
  });

  it('reports a later balance mismatch without inventing a contribution', async () => {
    const result = await build(
      inputs({
        balances: [
          { accountId: 'a', date: openingDate, value: 100 },
          {
            accountId: 'a',
            date: new Date(`${from}T00:00:00.000Z`),
            value: 90
          }
        ]
      })
    );
    expect(result.reconciliations[0]).toEqual(
      expect.objectContaining({ residual: '-10', status: 'MISMATCH' })
    );
    expect(result.timeline[1]).toEqual(
      expect.objectContaining({
        cashValueInBaseCurrency: '90',
        totalValueInBaseCurrency: '90'
      })
    );
    expect(result.coverage).toEqual(
      expect.objectContaining({ status: 'COMPLETE' })
    );
    expect(result.coverage.reasons).toContainEqual(
      expect.objectContaining({
        adjustment: '-10',
        code: 'CASH_RECONCILIATION_MISMATCH',
        severity: 'WARNING'
      })
    );
    expect(result.externalFlows).toEqual([]);
  });

  it.each([
    ['100.013', '0.013', 'MATCH', 'COMPLETE'],
    ['100.05', '0.05', 'MATCH', 'COMPLETE'],
    ['100.051', '0.051', 'MISMATCH', 'COMPLETE'],
    ['101.64', '1.64', 'MISMATCH', 'COMPLETE']
  ] as const)(
    'reconciles DKK checkpoint %s at the five-minor-unit boundary',
    async (checkpoint, difference, reconciliationStatus, coverageStatus) => {
      const result = await build(
        inputs({
          balances: [
            { accountId: 'a', date: openingDate, value: 100 },
            {
              accountId: 'a',
              date: new Date(`${from}T00:00:00.000Z`),
              value: Number(checkpoint)
            }
          ]
        })
      );

      expect(result.reconciliations[0]).toEqual(
        expect.objectContaining({
          difference,
          status: reconciliationStatus,
          tolerance: '0.05'
        })
      );
      expect(result.coverage.status).toBe(coverageStatus);
      if (reconciliationStatus === 'MISMATCH') {
        expect(result.coverage.reasons).toContainEqual(
          expect.objectContaining({
            code: 'CASH_RECONCILIATION_MISMATCH',
            difference,
            expected: checkpoint,
            reconstructed: '100',
            severity: 'WARNING',
            tolerance: '0.05'
          })
        );
      }
    }
  );

  it('includes account and opening provenance in a cash mismatch diagnostic', async () => {
    const result = await build(
      inputs({
        accounts: [{ currency: 'DKK', id: 'a', name: 'Broker cash' }],
        balances: [
          { accountId: 'a', date: openingDate, value: 100 },
          {
            accountId: 'a',
            date: new Date(`${from}T00:00:00.000Z`),
            value: 90
          }
        ]
      })
    );

    expect(result.coverage.reasons).toContainEqual(
      expect.objectContaining({
        accountName: 'Broker cash',
        adjustment: '-10',
        code: 'CASH_RECONCILIATION_MISMATCH',
        date: from,
        difference: '10',
        expected: '90',
        openingCashDate: '2023-12-31',
        openingCashSource: 'ACCOUNT_BALANCE',
        reconstructed: '100',
        severity: 'WARNING',
        tolerance: '0.05'
      })
    );
  });

  it('accepts a one-cent native residual after EUR cash conversion', async () => {
    const convertedFlow = {
      ...flow(ExternalCashFlowType.DEPOSIT, '16.35', 'a', from),
      currency: 'EUR'
    };
    const result = await build(
      inputs({
        balances: [
          { accountId: 'a', date: openingDate, value: 0 },
          {
            accountId: 'a',
            date: new Date(`${from}T00:00:00.000Z`),
            value: 122.22
          }
        ],
        externalCashFlows: [convertedFlow]
      }),
      {
        resolveFx: async ({ date, fromCurrency }) =>
          source(date, fromCurrency === 'EUR' ? '7.475' : '1'),
        resolvePrice: async ({ date }) => source(date, '40')
      }
    );

    expect(result.reconciliations[0]).toEqual(
      expect.objectContaining({
        difference: '0.00375',
        status: 'MATCH',
        tolerance: '0.05'
      })
    );
    expect(result.coverage.status).toBe('COMPLETE');
  });

  it('subtracts the Nordnet fee activities exactly once before reconciling cash', async () => {
    const feeAmounts = [
      ['2025-04-08', '19.59'],
      ['2025-04-08', '78.35'],
      ['2025-07-09', '19.80'],
      ['2025-07-09', '79.20'],
      ['2025-07-31', '0.01'],
      ['2025-07-31', '0.01']
    ] as const;
    const result = await build(
      inputs({
        activities: feeAmounts.map(([date, fee], index) =>
          activity(Type.FEE, date, {
            fee,
            id: `fee-${index}`,
            quantity: '0',
            unitPrice: '0'
          })
        ),
        balances: [
          {
            accountId: 'a',
            date: new Date('2025-04-07T00:00:00.000Z'),
            value: 1603.4369195
          },
          {
            accountId: 'a',
            date: new Date('2025-09-30T00:00:00.000Z'),
            value: 1403.4
          }
        ]
      }),
      resolver(),
      ['a'],
      'ACCOUNT_SUBSET',
      { from: '2025-04-08', to: '2025-09-30' }
    );

    expect(result.reconciliations[0]).toEqual(
      expect.objectContaining({
        difference: '3.0769195',
        observed: '1403.4',
        reconstructed: '1406.4769195',
        residual: '-3.0769195',
        status: 'MISMATCH'
      })
    );
  });

  it('requires prices only after a late acquisition in a one-year interval', async () => {
    const resolvePrice = jest.fn(async ({ date }) => source(date, '40'));
    const result = await build(
      inputs({
        activities: [activity(Type.BUY, '2024-12-25')],
        balances: [
          {
            accountId: 'a',
            date: new Date('2023-12-31T00:00:00.000Z'),
            value: 100
          }
        ]
      }),
      {
        resolveFx: async ({ date }) => source(date),
        resolvePrice
      },
      ['a'],
      'ACCOUNT_SUBSET',
      { from: '2024-01-01', to: '2024-12-31' }
    );

    expect(result.coverage.status).toBe('COMPLETE');
    expect(resolvePrice).toHaveBeenCalled();
    expect(
      resolvePrice.mock.calls.every(([request]) => request.date >= '2024-12-25')
    ).toBe(true);
  });

  it('does not require a price after complete liquidation', async () => {
    const resolvePrice = jest.fn(async ({ date }) => source(date, '40'));
    await build(
      inputs({
        activities: [
          activity(Type.BUY, '2024-01-01'),
          activity(Type.SELL, '2024-01-02')
        ]
      }),
      {
        resolveFx: async ({ date }) => source(date),
        resolvePrice
      },
      ['a'],
      'ACCOUNT_SUBSET',
      { from: '2024-01-01', to: '2024-01-04' }
    );

    expect(resolvePrice.mock.calls.map(([request]) => request.date)).toEqual([
      '2024-01-01'
    ]);
  });

  it('requires prices only within separate holding episodes after re-entry', async () => {
    const resolvePrice = jest.fn(async ({ date }) => source(date, '40'));
    await build(
      inputs({
        activities: [
          activity(Type.BUY, '2024-01-01'),
          activity(Type.SELL, '2024-01-02'),
          activity(Type.BUY, '2024-01-04')
        ]
      }),
      {
        resolveFx: async ({ date }) => source(date),
        resolvePrice
      },
      ['a'],
      'ACCOUNT_SUBSET',
      { from: '2024-01-01', to: '2024-01-05' }
    );

    expect(resolvePrice.mock.calls.map(([request]) => request.date)).toEqual([
      '2024-01-01',
      '2024-01-04',
      '2024-01-05'
    ]);
  });

  it('does not inherit missing prices from an excluded account', async () => {
    const resolvePrice = jest.fn(async () => null);
    const result = await build(
      inputs({
        activities: [
          activity(Type.BUY, from, { accountId: 'excluded', assetId: 'x' })
        ]
      }),
      {
        resolveFx: async ({ date }) => source(date),
        resolvePrice
      },
      ['a'],
      'ACCOUNT_SUBSET'
    );

    expect(resolvePrice).not.toHaveBeenCalled();
    expect(result.coverage.status).toBe('COMPLETE');
  });

  it('keeps the economic opening before the inclusive from-date flow', async () => {
    const result = await build(
      inputs({
        externalCashFlows: [flow(ExternalCashFlowType.DEPOSIT, '50', 'a', from)]
      })
    );
    expect(result.interval.openingDate).toBe('2023-12-31');
    expect(result.opening.totalValueInBaseCurrency).toBe('100');
    expect(result.timeline[1].totalValueInBaseCurrency).toBe('150');
  });
});
