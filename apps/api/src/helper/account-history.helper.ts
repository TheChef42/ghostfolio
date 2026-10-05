import type {
  Account,
  AccountBalance,
  ExternalCashFlow,
  Order
} from '@prisma/client';
import { Big } from 'big.js';

export type AccountEconomicRecordType =
  'ACCOUNT_BALANCE' | 'ACTIVITY' | 'EXTERNAL_CASH_FLOW';

export interface AccountEconomicRecord {
  date: Date;
  type: AccountEconomicRecordType;
}

export function getEarliestEconomicRecord(
  records: AccountEconomicRecord[]
): AccountEconomicRecord | null {
  return (
    [...records].sort((left, right) => {
      const byDate = left.date.getTime() - right.date.getTime();
      return byDate || left.type.localeCompare(right.type);
    })[0] ?? null
  );
}

export function getInceptionConflict({
  inceptionDate,
  records
}: {
  inceptionDate: Date;
  records: AccountEconomicRecord[];
}) {
  const earliest = getEarliestEconomicRecord(records);
  return earliest && inceptionDate > earliest.date ? earliest : null;
}

export function resolveMaximumAccountHistoryStart({
  accounts,
  activities,
  balances,
  externalCashFlows,
  includeUnassignedActivities,
  to
}: {
  accounts: Pick<Account, 'id' | 'inceptionDate'>[];
  activities: Pick<Order, 'accountId' | 'date'>[];
  balances: Pick<AccountBalance, 'accountId' | 'date'>[];
  externalCashFlows: Pick<
    ExternalCashFlow,
    'accountId' | 'amount' | 'date' | 'transferGroupId'
  >[];
  includeUnassignedActivities: boolean;
  to: string;
}) {
  const accountIds = new Set(accounts.map(({ id }) => id));
  const selectedTransferLegs = new Map<string, number>();
  for (const flow of externalCashFlows) {
    if (flow.transferGroupId && accountIds.has(flow.accountId)) {
      selectedTransferLegs.set(
        flow.transferGroupId,
        (selectedTransferLegs.get(flow.transferGroupId) ?? 0) + 1
      );
    }
  }
  const dates = [
    ...accounts.flatMap(({ inceptionDate }) =>
      inceptionDate ? [toAccountingDate(inceptionDate)] : []
    ),
    ...activities
      .filter(
        ({ accountId }) =>
          (accountId === null && includeUnassignedActivities) ||
          (accountId !== null && accountIds.has(accountId))
      )
      .map(({ date }) => toAccountingDate(date)),
    ...balances
      .filter(({ accountId }) => accountIds.has(accountId))
      .map(({ date }) => shiftAccountingDate(toAccountingDate(date), 1)),
    ...externalCashFlows
      .filter(
        (flow) =>
          accountIds.has(flow.accountId) &&
          !new Big(flow.amount.toString()).eq(0) &&
          (!flow.transferGroupId ||
            selectedTransferLegs.get(flow.transferGroupId) === 1)
      )
      .map(({ date }) => toAccountingDate(date))
  ].filter((date) => date <= to);

  return dates.sort()[0] ?? to;
}

export function toAccountingDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shiftAccountingDate(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
