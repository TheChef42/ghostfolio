import { ConflictException } from '@nestjs/common';
import { ExternalCashFlow } from '@prisma/client';
import { Big } from 'big.js';

import { validateTransferPair } from './transfer.helper';

/** Input must contain complete transfer groups, including counterparts outside
 * the date interval. No cross-currency summation or valuation takes place here. */
export function resolveExternalCashFlows({
  flows,
  userId,
  accountIds,
  from,
  to
}: {
  flows: ExternalCashFlow[];
  userId: string;
  accountIds: string[];
  from?: Date;
  to?: Date;
}) {
  if (from && to && from > to) {
    throw new ConflictException('Invalid date interval');
  }
  const scope = new Set(accountIds);
  const ids = new Set<string>();
  const groups = new Map<string, ExternalCashFlow[]>();
  for (const flow of flows) {
    if (
      flow.userId !== userId ||
      ids.has(flow.id) ||
      !flow.amount.isFinite() ||
      !flow.amount.greaterThan(0)
    ) {
      throw new ConflictException('Invalid cash-flow data');
    }
    ids.add(flow.id);
    if (flow.transferGroupId) {
      const group = groups.get(flow.transferGroupId) ?? [];
      group.push(flow);
      groups.set(flow.transferGroupId, group);
    } else if (!['DEPOSIT', 'WITHDRAWAL'].includes(flow.type)) {
      throw new ConflictException('Missing transfer group');
    }
  }
  const internalIds = new Set<string>();
  for (const group of groups.values()) {
    const { outgoing, incoming } = validateTransferPair(group, userId);
    if (scope.has(outgoing.accountId) && scope.has(incoming.accountId)) {
      internalIds.add(outgoing.id);
      internalIds.add(incoming.id);
    }
  }
  return flows
    .filter(
      (flow) =>
        scope.has(flow.accountId) &&
        !internalIds.has(flow.id) &&
        (!from || flow.date >= from) &&
        (!to || flow.date <= to)
    )
    .sort(
      (a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id)
    )
    .map((flow) => ({
      id: flow.id,
      accountId: flow.accountId,
      date: flow.date,
      currency: flow.currency,
      transferGroupId: flow.transferGroupId,
      amount: new Big(flow.amount.toFixed())
        .mul(['WITHDRAWAL', 'TRANSFER_OUT'].includes(flow.type) ? -1 : 1)
        .toFixed()
    }));
}
