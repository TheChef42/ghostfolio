import { ConflictException } from '@nestjs/common';
import { ExternalCashFlow } from '@prisma/client';

export function validateTransferPair(
  flows: ExternalCashFlow[],
  userId: string
) {
  const outgoing = flows.find(({ type }) => type === 'TRANSFER_OUT');
  const incoming = flows.find(({ type }) => type === 'TRANSFER_IN');
  if (
    flows.length !== 2 ||
    !outgoing ||
    !incoming ||
    !outgoing.transferGroupId ||
    outgoing.transferGroupId !== incoming.transferGroupId ||
    flows.some(
      (flow) =>
        flow.userId !== userId ||
        !flow.amount.isFinite() ||
        !flow.amount.greaterThan(0)
    ) ||
    outgoing.accountId === incoming.accountId ||
    outgoing.date > incoming.date ||
    (outgoing.currency === incoming.currency &&
      !outgoing.amount.equals(incoming.amount))
  ) {
    throw new ConflictException('Invalid or incomplete transfer pair');
  }
  return { incoming, outgoing };
}
