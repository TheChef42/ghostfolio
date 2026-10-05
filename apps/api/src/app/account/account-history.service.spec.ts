import { BadRequestException } from '@nestjs/common';

import { AccountHistoryService } from './account-history.service';

function fixture({
  activity,
  balance,
  externalCashFlow
}: {
  activity?: string;
  balance?: string;
  externalCashFlow?: string;
} = {}) {
  const prisma = {
    accountBalance: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          balance ? { date: new Date(`${balance}T00:00:00.000Z`) } : null
        )
    },
    externalCashFlow: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          externalCashFlow
            ? { date: new Date(`${externalCashFlow}T00:00:00.000Z`) }
            : null
        )
    },
    order: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          activity ? { date: new Date(`${activity}T00:00:00.000Z`) } : null
        )
    }
  };
  return {
    prisma,
    service: new AccountHistoryService(prisma as never)
  };
}

describe('AccountHistoryService', () => {
  it.each([
    ['activity', { activity: '2025-06-01' }],
    ['external cash flow', { externalCashFlow: '2025-06-01' }],
    ['account balance', { balance: '2025-06-01' }]
  ])('rejects inception after the earliest %s', async (_label, history) => {
    const { service } = fixture(history);

    await expect(
      service.validateInceptionDate({
        accountId: 'account',
        inceptionDate: new Date('2025-07-01T00:00:00.000Z'),
        userId: 'user'
      })
    ).rejects.toThrow(
      'Account start date cannot be later than existing account history on 2025-06-01'
    );
  });

  it.each(['2025-05-01', '2025-06-01'])(
    'accepts inception %s relative to the first economic record',
    async (inceptionDate) => {
      const { service } = fixture({ activity: '2025-06-01' });

      await expect(
        service.validateInceptionDate({
          accountId: 'account',
          inceptionDate: new Date(`${inceptionDate}T00:00:00.000Z`),
          userId: 'user'
        })
      ).resolves.toBeUndefined();
    }
  );

  it('accepts null without consulting economic records', async () => {
    const { prisma, service } = fixture();

    await expect(
      service.validateInceptionDate({
        accountId: 'account',
        inceptionDate: null,
        userId: 'user'
      })
    ).resolves.toBeUndefined();
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });

  it('uses economic dates rather than account metadata dates', async () => {
    const { service } = fixture();

    await expect(
      service.validateInceptionDate({
        accountId: 'account',
        inceptionDate: new Date('2025-06-01T00:00:00.000Z'),
        userId: 'user'
      })
    ).resolves.toBeUndefined();
  });

  it('rejects a future inception date', async () => {
    const { service } = fixture();

    await expect(
      service.validateInceptionDate({
        inceptionDate: new Date('2999-01-01T00:00:00.000Z'),
        userId: 'user'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
