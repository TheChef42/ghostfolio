import { isRestrictedView } from '@ghostfolio/common/permissions';
import { hasScope, scopes } from '@ghostfolio/common/scopes';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { ExternalCashFlow } from '@prisma/client';
import { map } from 'rxjs/operators';

type ResponseData =
  | ExternalCashFlow
  | { items: ExternalCashFlow[]; count?: number; transferGroupId?: string };

@Injectable()
export class ExternalCashFlowResponseInterceptor implements NestInterceptor {
  public intercept(context: ExecutionContext, next: CallHandler<ResponseData>) {
    const { impersonation, user } = context
      .switchToHttp()
      .getRequest<RequestWithUser>();
    const restricted =
      !hasScope(impersonation?.scopes, scopes.portfolioReadValues) ||
      isRestrictedView(user) ||
      user?.settings?.settings?.viewMode === 'ZEN' ||
      impersonation?.userSettings?.viewMode === 'ZEN';
    const serialize = (flow: ExternalCashFlow) => ({
      id: flow.id,
      accountId: flow.accountId,
      date: flow.date.toISOString(),
      amount: restricted ? null : flow.amount.toFixed(),
      currency: flow.currency,
      type: flow.type,
      transferGroupId: flow.transferGroupId,
      source: restricted ? null : flow.source,
      comment: restricted ? null : flow.comment,
      createdAt: flow.createdAt.toISOString(),
      updatedAt: flow.updatedAt.toISOString()
    });
    return next
      .handle()
      .pipe(
        map((data) =>
          'items' in data
            ? { ...data, items: data.items.map(serialize) }
            : serialize(data)
        )
      );
  }
}
