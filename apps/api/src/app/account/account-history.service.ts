import {
  AccountEconomicRecord,
  getEarliestEconomicRecord,
  getInceptionConflict,
  toAccountingDate
} from '@ghostfolio/api/helper/account-history.helper';
import { WHERE_ACTIVITY_NOT_DRAFT } from '@ghostfolio/api/helper/activity.helper';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { getUtcAccountingDate } from '@ghostfolio/common/custom-date-range-helper';

import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class AccountHistoryService {
  public constructor(private readonly prismaService: PrismaService) {}

  public async validateInceptionDate({
    accountId,
    inceptionDate,
    userId
  }: {
    accountId?: string;
    inceptionDate: Date | null | undefined;
    userId: string;
  }) {
    if (!inceptionDate) return;

    const inception = toAccountingDate(inceptionDate);
    if (inception > getUtcAccountingDate()) {
      throw new BadRequestException(
        'Account start date cannot be in the future'
      );
    }
    if (!accountId) return;

    const earliest = await this.getEarliestEconomicRecord({
      accountId,
      userId
    });
    const conflict = getInceptionConflict({
      inceptionDate,
      records: earliest ? [earliest] : []
    });
    if (conflict) {
      throw new BadRequestException(
        `Account start date cannot be later than existing account history on ${toAccountingDate(conflict.date)}`
      );
    }
  }

  public async getEarliestEconomicRecord({
    accountId,
    userId
  }: {
    accountId: string;
    userId: string;
  }) {
    const [activity, balance, externalCashFlow] = await Promise.all([
      this.prismaService.order.findFirst({
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: { date: true },
        where: {
          accountId,
          userId,
          AND: [WHERE_ACTIVITY_NOT_DRAFT]
        }
      }),
      this.prismaService.accountBalance.findFirst({
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: { date: true },
        where: { accountId, userId }
      }),
      this.prismaService.externalCashFlow.findFirst({
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        select: { date: true },
        where: { accountId, userId }
      })
    ]);
    const records: AccountEconomicRecord[] = [];
    if (activity) records.push({ date: activity.date, type: 'ACTIVITY' });
    if (balance) records.push({ date: balance.date, type: 'ACCOUNT_BALANCE' });
    if (externalCashFlow)
      records.push({
        date: externalCashFlow.date,
        type: 'EXTERNAL_CASH_FLOW'
      });
    return getEarliestEconomicRecord(records);
  }
}
