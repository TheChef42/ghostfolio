import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class PerformanceScopeResolver {
  public resolve({
    accessibleAccountIds,
    defaultAccountIds = accessibleAccountIds,
    requestedAccountIds
  }: {
    accessibleAccountIds: string[];
    defaultAccountIds?: string[];
    requestedAccountIds?: string[];
  }) {
    const accessible = new Set(accessibleAccountIds);
    const requested = [...new Set(requestedAccountIds ?? [])].sort();

    if (requested.some((accountId) => !accessible.has(accountId))) {
      throw new BadRequestException(
        'The requested account scope is not available'
      );
    }

    const accountIds = (
      requested.length > 0 ? requested : [...defaultAccountIds]
    )
      .filter((accountId, index, items) => items.indexOf(accountId) === index)
      .sort();

    return {
      accountIds,
      identity: accountIds.join(','),
      type:
        requested.length > 0
          ? ('ACCOUNT_SUBSET' as const)
          : ('WHOLE_PORTFOLIO' as const)
    };
  }
}
