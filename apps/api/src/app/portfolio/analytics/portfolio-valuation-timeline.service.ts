import { resolveExternalCashFlows } from '@ghostfolio/api/app/external-cash-flow/resolve-external-cash-flows';
import { WHERE_ACCOUNT_NOT_EXCLUDED } from '@ghostfolio/api/helper/account.helper';
import { WHERE_ACTIVITY_NOT_DRAFT } from '@ghostfolio/api/helper/activity.helper';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable } from '@nestjs/common';
import {
  Account,
  AccountBalance,
  AssetProfileSplit,
  ExternalCashFlow,
  Order,
  SymbolProfile
} from '@prisma/client';
import { Big } from 'big.js';

import { HistoricalValuationResolverService } from './historical-valuation-resolver.service';
import { PerformanceScopeResolver } from './performance-scope.resolver';
import type {
  CashReconciliationDiagnostic,
  HistoricalValueResolver,
  PortfolioValuationTimeline,
  ScopeExternalFlow,
  TimelineActivity,
  TimelineInputs,
  ValuationCoverageReason,
  ValuationHolding,
  ValuationPoint,
  ValuationSource
} from './valuation-timeline.types';
import {
  VALUATION_MAX_STALENESS_DAYS,
  VALUATION_METHODOLOGY_VERSION
} from './valuation-timeline.types';

const DAY_IN_MILLISECONDS = 86_400_000;
const RECONCILIATION_TOLERANCE = new Big('0.00000001');

type OrderWithProfile = Order & { SymbolProfile: SymbolProfile };

@Injectable()
export class PortfolioValuationTimelineService {
  public constructor(
    private readonly historicalResolver: HistoricalValuationResolverService,
    private readonly performanceScopeResolver: PerformanceScopeResolver,
    private readonly prismaService: PrismaService
  ) {}

  public async getTimeline({
    accountIds: requestedAccountIds,
    baseCurrency,
    from,
    to,
    userId
  }: {
    accountIds?: string[];
    baseCurrency: string;
    from: string;
    to: string;
    userId: string;
  }): Promise<PortfolioValuationTimeline> {
    const [ownedAccounts, defaultAccounts] = await Promise.all([
      this.prismaService.account.findMany({ where: { userId } }),
      this.prismaService.account.findMany({
        where: { userId, ...WHERE_ACCOUNT_NOT_EXCLUDED }
      })
    ]);
    const scope = this.performanceScopeResolver.resolve({
      accessibleAccountIds: ownedAccounts.map(({ id }) => id),
      defaultAccountIds: defaultAccounts.map(({ id }) => id),
      requestedAccountIds
    });
    const accounts = ownedAccounts.filter(({ id }) =>
      scope.accountIds.includes(id)
    );
    const closingDate = this.atEndOfDay(to);
    const includeUnassigned = scope.type === 'WHOLE_PORTFOLIO';
    const activityWhere = {
      userId,
      AND: [WHERE_ACTIVITY_NOT_DRAFT],
      date: { lte: closingDate },
      ...(includeUnassigned
        ? { OR: [{ accountId: { in: scope.accountIds } }, { accountId: null }] }
        : { accountId: { in: scope.accountIds } })
    };
    const [balances, flows, orders] = await Promise.all([
      this.prismaService.accountBalance.findMany({
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        where: {
          userId,
          accountId: { in: scope.accountIds },
          date: { lte: closingDate }
        }
      }),
      this.prismaService.externalCashFlow.findMany({
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        // Complete transfer groups are required even when the counterpart is
        // outside the requested interval.
        where: { userId }
      }),
      this.prismaService.order.findMany({
        include: { SymbolProfile: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
        where: activityWhere
      })
    ]);
    const profileIds = [
      ...new Set(orders.map(({ symbolProfileId }) => symbolProfileId))
    ];
    const splits = profileIds.length
      ? await this.prismaService.assetProfileSplit.findMany({
          orderBy: { date: 'asc' },
          where: { symbolProfileId: { in: profileIds } }
        })
      : [];

    return this.buildTimeline({
      baseCurrency,
      from,
      inputs: {
        accounts,
        activities: this.normalizeActivities(orders, splits),
        balances,
        externalCashFlows: flows
      },
      resolver: this.historicalResolver,
      scope,
      to,
      userId
    });
  }

  public async buildTimeline({
    baseCurrency,
    from,
    inputs,
    resolver,
    scope,
    to,
    userId
  }: {
    baseCurrency: string;
    from: string;
    inputs: TimelineInputs;
    resolver: HistoricalValueResolver;
    scope: {
      accountIds: string[];
      identity: string;
      type: 'ACCOUNT_SUBSET' | 'WHOLE_PORTFOLIO';
    };
    to: string;
    userId: string;
  }): Promise<PortfolioValuationTimeline> {
    const openingDate = this.shiftDate(from, -1);
    const reasons: ValuationCoverageReason[] = [];
    const reconciliations: CashReconciliationDiagnostic[] = [];
    const accountById = new Map(
      inputs.accounts.map((account) => [account.id, account])
    );
    const quantities = new Map<string, Big>();
    const assetById = new Map<string, TimelineActivity>();
    const cash = new Map<string, Big | null>();
    const balanceByAccount = this.groupBy(
      inputs.balances,
      ({ accountId }) => accountId
    );
    const activityByDate = this.groupBy(inputs.activities, ({ date }) =>
      this.date(date)
    );
    const flowByDate = this.groupBy(inputs.externalCashFlows, ({ date }) =>
      this.date(date)
    );
    const fxCache = new Map<string, Promise<ValuationSource | null>>();
    const priceCache = new Map<string, Promise<ValuationSource | null>>();
    const resolveFx = (currency: string, date: string) => {
      const key = `${currency}:${baseCurrency}:${date}`;
      if (!fxCache.has(key)) {
        fxCache.set(
          key,
          resolver.resolveFx({
            date,
            fromCurrency: currency,
            toCurrency: baseCurrency
          })
        );
      }
      return fxCache.get(key)!;
    };
    const resolvePrice = (activity: TimelineActivity, date: string) => {
      const key = `${activity.dataSource}:${activity.symbol}:${date}`;
      if (!priceCache.has(key)) {
        priceCache.set(
          key,
          resolver.resolvePrice({
            dataSource: activity.dataSource,
            date,
            symbol: activity.symbol
          })
        );
      }
      return priceCache.get(key)!;
    };

    for (const activity of inputs.activities) {
      if (!activity.accountId && this.activityCashDelta(activity)) {
        this.addReason(reasons, {
          assetId: activity.assetId,
          code: 'MISSING_OPENING_CASH',
          date: this.date(activity.date),
          message:
            'A cash-changing activity without an account cannot be assigned to reconstructed cash'
        });
      }
    }

    for (const activity of inputs.activities.filter(
      ({ date }) => this.date(date) <= openingDate
    )) {
      this.applyHolding(activity, quantities, assetById, reasons);
    }

    for (const account of inputs.accounts) {
      const anchor = (balanceByAccount.get(account.id) ?? [])
        .filter(({ date }) => this.date(date) <= openingDate)
        .at(-1);
      if (!anchor) {
        cash.set(account.id, null);
        this.addReason(reasons, {
          accountId: account.id,
          code: 'MISSING_OPENING_CASH',
          currency: account.currency ?? baseCurrency,
          date: openingDate,
          message:
            'No AccountBalance checkpoint exists at or before the opening boundary'
        });
        continue;
      }
      cash.set(account.id, new Big(anchor.value.toString()));
      const anchorDate = this.date(anchor.date);
      for (const date of this.dates(
        this.shiftDate(anchorDate, 1),
        openingDate
      )) {
        await this.applyCashEvents({
          accountById,
          activityByDate,
          cash,
          date,
          flowByDate,
          onlyAccountId: account.id,
          reasons,
          resolver
        });
      }
    }

    const valuePoint = async (date: string, kind: ValuationPoint['kind']) => {
      const holdings: ValuationHolding[] = [];
      let holdingsTotal = new Big(0);
      let holdingsComplete = true;
      for (const [assetId, quantity] of [...quantities.entries()].sort(
        ([a], [b]) => a.localeCompare(b)
      )) {
        if (quantity.eq(0)) continue;
        const asset = assetById.get(assetId)!;
        if (quantity.lt(0)) {
          holdingsComplete = false;
          this.addReason(reasons, {
            assetId,
            code: 'UNSUPPORTED_LIABILITY_OR_SHORT',
            date,
            message: 'Negative holdings are not valued by the Phase 4A timeline'
          });
        }
        const [price, fx] = await Promise.all([
          resolvePrice(asset, date),
          resolveFx(asset.currency, date)
        ]);
        const priceUsable = this.sourceIsUsable(
          price,
          'PRICE',
          assetId,
          date,
          reasons
        );
        const fxUsable = this.sourceIsUsable(
          fx,
          'FX',
          assetId,
          date,
          reasons,
          asset.currency
        );
        const value =
          quantity.gte(0) && priceUsable && fxUsable
            ? quantity.mul(price!.value).mul(fx!.value)
            : null;
        if (!value) holdingsComplete = false;
        else holdingsTotal = holdingsTotal.plus(value);
        holdings.push({
          assetId,
          currency: asset.currency,
          dataSource: asset.dataSource,
          fx,
          price,
          quantity: quantity.toFixed(),
          symbol: asset.symbol,
          valueInBaseCurrency: value?.toFixed() ?? null
        });
      }
      let cashTotal = new Big(0);
      let cashComplete = true;
      for (const account of inputs.accounts) {
        const accountCash = cash.get(account.id);
        if (!accountCash) {
          cashComplete = false;
          continue;
        }
        const currency = account.currency ?? baseCurrency;
        const fx = await resolveFx(currency, date);
        if (
          !this.sourceIsUsable(fx, 'FX', account.id, date, reasons, currency)
        ) {
          cashComplete = false;
        } else {
          cashTotal = cashTotal.plus(accountCash.mul(fx!.value));
        }
      }
      const total =
        holdingsComplete && cashComplete ? holdingsTotal.plus(cashTotal) : null;
      return {
        cashValueInBaseCurrency: cashComplete ? cashTotal.toFixed() : null,
        date,
        holdings,
        holdingsValueInBaseCurrency: holdingsComplete
          ? holdingsTotal.toFixed()
          : null,
        kind,
        totalValueInBaseCurrency: total?.toFixed() ?? null
      } satisfies ValuationPoint;
    };

    const opening = await valuePoint(openingDate, 'OPENING');
    const timeline: ValuationPoint[] = [opening];
    for (const date of this.dates(from, to)) {
      for (const activity of activityByDate.get(date) ?? [])
        this.applyHolding(activity, quantities, assetById, reasons);
      await this.applyCashEvents({
        accountById,
        activityByDate,
        cash,
        date,
        flowByDate,
        reasons,
        resolver
      });
      this.reconcileCash({
        balanceByAccount,
        cash,
        date,
        inputs,
        reasons,
        reconciliations
      });
      timeline.push(await valuePoint(date, date === to ? 'CLOSING' : 'DAILY'));
    }
    const closing = timeline.at(-1)!;
    const externalFlows = await this.resolveScopeFlows({
      baseCurrency,
      flows: inputs.externalCashFlows,
      from,
      reasons,
      resolver,
      scope,
      to,
      userId
    });
    const status =
      opening.totalValueInBaseCurrency === null ||
      closing.totalValueInBaseCurrency === null
        ? 'UNAVAILABLE'
        : reasons.length > 0
          ? 'INCOMPLETE'
          : 'COMPLETE';

    return {
      accountingConvention: {
        activityTiming: 'END_OF_DAY',
        opening: 'CLOSE_BEFORE_FROM',
        timezone: 'UTC'
      },
      baseCurrency,
      closing,
      coverage: { reasons, status },
      externalFlows,
      interval: { from, openingDate, to },
      methodologyVersion: VALUATION_METHODOLOGY_VERSION,
      opening,
      reconciliations,
      scope,
      timeline
    };
  }

  private async applyCashEvents({
    accountById,
    activityByDate,
    cash,
    date,
    flowByDate,
    onlyAccountId,
    reasons,
    resolver
  }: {
    accountById: Map<string, Pick<Account, 'currency' | 'id'>>;
    activityByDate: Map<string, TimelineActivity[]>;
    cash: Map<string, Big | null>;
    date: string;
    flowByDate: Map<string, ExternalCashFlow[]>;
    onlyAccountId?: string;
    reasons: ValuationCoverageReason[];
    resolver: HistoricalValueResolver;
  }) {
    for (const activity of activityByDate.get(date) ?? []) {
      if (onlyAccountId && activity.accountId !== onlyAccountId) continue;
      if (!activity.accountId || !cash.has(activity.accountId)) continue;
      const current = cash.get(activity.accountId);
      if (!current) continue;
      const delta = this.activityCashDelta(activity);
      if (!delta) continue;
      const account = accountById.get(activity.accountId)!;
      const accountCurrency = account.currency ?? activity.currency;
      const fx = await resolver.resolveFx({
        date,
        fromCurrency: activity.currency,
        toCurrency: accountCurrency
      });
      if (
        !this.sourceIsUsable(
          fx,
          'FX',
          activity.assetId,
          date,
          reasons,
          activity.currency
        )
      ) {
        cash.set(activity.accountId, null);
      } else cash.set(activity.accountId, current.plus(delta.mul(fx!.value)));
    }
    for (const flow of flowByDate.get(date) ?? []) {
      if (onlyAccountId && flow.accountId !== onlyAccountId) continue;
      if (!cash.has(flow.accountId)) continue;
      const current = cash.get(flow.accountId);
      if (!current) continue;
      const account = accountById.get(flow.accountId)!;
      const accountCurrency = account.currency ?? flow.currency;
      const fx = await resolver.resolveFx({
        date,
        fromCurrency: flow.currency,
        toCurrency: accountCurrency
      });
      if (
        !this.sourceIsUsable(
          fx,
          'FX',
          flow.accountId,
          date,
          reasons,
          flow.currency
        )
      ) {
        cash.set(flow.accountId, null);
      } else {
        const sign = ['WITHDRAWAL', 'TRANSFER_OUT'].includes(flow.type)
          ? -1
          : 1;
        cash.set(
          flow.accountId,
          current.plus(new Big(flow.amount.toFixed()).mul(sign).mul(fx!.value))
        );
      }
    }
  }

  private activityCashDelta(activity: TimelineActivity): Big | null {
    const value = new Big(activity.quantity).mul(activity.unitPrice);
    const fee = new Big(activity.fee);
    if (activity.type === 'BUY') return value.plus(fee).times(-1);
    if (activity.type === 'SELL') return value.minus(fee);
    if (activity.type === 'DIVIDEND' || activity.type === 'INTEREST')
      return value.minus(fee);
    if (activity.type === 'FEE') return value.plus(fee).times(-1);
    return null;
  }

  private applyHolding(
    activity: TimelineActivity,
    quantities: Map<string, Big>,
    assetById: Map<string, TimelineActivity>,
    reasons: ValuationCoverageReason[]
  ) {
    if (activity.type === 'LIABILITY') {
      this.addReason(reasons, {
        assetId: activity.assetId,
        code: 'UNSUPPORTED_LIABILITY_OR_SHORT',
        date: this.date(activity.date),
        message: 'Liability activities are outside the Phase 4A valuation scope'
      });
      return;
    }
    if (!['BUY', 'SELL'].includes(activity.type)) return;
    const sign = activity.type === 'BUY' ? 1 : -1;
    quantities.set(
      activity.assetId,
      (quantities.get(activity.assetId) ?? new Big(0)).plus(
        new Big(activity.quantity).mul(sign)
      )
    );
    assetById.set(activity.assetId, activity);
  }

  private reconcileCash({
    balanceByAccount,
    cash,
    date,
    inputs,
    reasons,
    reconciliations
  }: {
    balanceByAccount: Map<
      string,
      Pick<AccountBalance, 'accountId' | 'date' | 'value'>[]
    >;
    cash: Map<string, Big | null>;
    date: string;
    inputs: TimelineInputs;
    reasons: ValuationCoverageReason[];
    reconciliations: CashReconciliationDiagnostic[];
  }) {
    for (const account of inputs.accounts) {
      const checkpoint = (balanceByAccount.get(account.id) ?? []).find(
        (item) => this.date(item.date) === date
      );
      if (!checkpoint) continue;
      const observed = new Big(checkpoint.value.toString());
      const reconstructed = cash.get(account.id);
      if (reconstructed) {
        const residual = observed.minus(reconstructed);
        const status = residual.abs().lte(RECONCILIATION_TOLERANCE)
          ? 'MATCH'
          : 'MISMATCH';
        reconciliations.push({
          accountId: account.id,
          currency: account.currency ?? '',
          date,
          observed: observed.toFixed(),
          reconstructed: reconstructed.toFixed(),
          residual: residual.toFixed(),
          status
        });
        if (status === 'MISMATCH')
          this.addReason(reasons, {
            accountId: account.id,
            code: 'CASH_RECONCILIATION_MISMATCH',
            currency: account.currency ?? undefined,
            date,
            message:
              'Reconstructed cash does not match the recorded AccountBalance checkpoint'
          });
      }
      cash.set(account.id, observed);
    }
  }

  private async resolveScopeFlows({
    baseCurrency,
    flows,
    from,
    reasons,
    resolver,
    scope,
    to,
    userId
  }: {
    baseCurrency: string;
    flows: ExternalCashFlow[];
    from: string;
    reasons: ValuationCoverageReason[];
    resolver: HistoricalValueResolver;
    scope: { accountIds: string[] };
    to: string;
    userId: string;
  }): Promise<ScopeExternalFlow[]> {
    let resolved: ReturnType<typeof resolveExternalCashFlows> = [];
    try {
      resolved = resolveExternalCashFlows({
        accountIds: scope.accountIds,
        flows,
        from: this.atStartOfDay(from),
        to: this.atEndOfDay(to),
        userId
      });
    } catch {
      this.addReason(reasons, {
        code: 'MALFORMED_TRANSFER_PAIR',
        message: 'At least one transfer group is incomplete or inconsistent'
      });
      resolved = resolveExternalCashFlows({
        accountIds: scope.accountIds,
        flows: flows.filter(({ transferGroupId }) => !transferGroupId),
        from: this.atStartOfDay(from),
        to: this.atEndOfDay(to),
        userId
      });
    }
    return Promise.all(
      resolved.map(async (flow) => {
        const source = flows.find(({ id }) => id === flow.id)!;
        const date = this.date(flow.date);
        const fx = await resolver.resolveFx({
          date,
          fromCurrency: flow.currency,
          toCurrency: baseCurrency
        });
        const usable = this.sourceIsUsable(
          fx,
          'FX',
          flow.accountId,
          date,
          reasons,
          flow.currency
        );
        return {
          accountId: flow.accountId,
          amountInBaseCurrency: usable
            ? new Big(flow.amount).mul(fx!.value).toFixed()
            : null,
          currency: flow.currency,
          date,
          fx,
          signedAmount: flow.amount,
          transferGroupId: flow.transferGroupId,
          type: source.type
        };
      })
    );
  }

  private sourceIsUsable(
    source: ValuationSource | null,
    kind: 'FX' | 'PRICE',
    assetId: string,
    date: string,
    reasons: ValuationCoverageReason[],
    currency?: string
  ) {
    if (!source) {
      this.addReason(reasons, {
        assetId,
        code: kind === 'FX' ? 'MISSING_FX' : 'MISSING_PRICE',
        currency,
        date,
        message: `No eligible historical ${kind.toLowerCase()} exists on or before the requested date`
      });
      return false;
    }
    if (source.stalenessDays > VALUATION_MAX_STALENESS_DAYS) {
      this.addReason(reasons, {
        assetId,
        code: kind === 'FX' ? 'STALE_FX' : 'STALE_PRICE',
        currency,
        date,
        sourceDate: source.sourceDate,
        message: `The latest prior ${kind.toLowerCase()} exceeds the ${VALUATION_MAX_STALENESS_DAYS}-day freshness limit`
      });
      return false;
    }
    return true;
  }

  private normalizeActivities(
    orders: OrderWithProfile[],
    splits: AssetProfileSplit[]
  ): TimelineActivity[] {
    const splitsByProfile = this.groupBy(
      splits,
      ({ symbolProfileId }) => symbolProfileId
    );
    return orders.map((order) => {
      let numerator = new Big(1),
        denominator = new Big(1);
      for (const split of splitsByProfile.get(order.symbolProfileId) ?? []) {
        if (
          split.date > order.date &&
          split.numerator > 0 &&
          split.denominator > 0
        ) {
          numerator = numerator.mul(split.numerator);
          denominator = denominator.mul(split.denominator);
        }
      }
      return {
        accountId: order.accountId,
        assetId: order.symbolProfileId,
        currency: order.currency ?? order.SymbolProfile.currency,
        dataSource: order.SymbolProfile.dataSource,
        date: order.date,
        fee: order.fee.toString(),
        id: order.id,
        quantity: new Big(order.quantity.toString())
          .mul(numerator)
          .div(denominator)
          .toFixed(),
        symbol: order.SymbolProfile.symbol,
        type: order.type,
        unitPrice: new Big(order.unitPrice.toString())
          .mul(denominator)
          .div(numerator)
          .toFixed()
      };
    });
  }

  private addReason(
    reasons: ValuationCoverageReason[],
    reason: ValuationCoverageReason
  ) {
    const identity = JSON.stringify(reason);
    if (!reasons.some((item) => JSON.stringify(item) === identity))
      reasons.push(reason);
  }

  private groupBy<T>(items: T[], key: (item: T) => string) {
    const result = new Map<string, T[]>();
    for (const item of items)
      result.set(key(item), [...(result.get(key(item)) ?? []), item]);
    return result;
  }

  private date(date: Date) {
    return date.toISOString().slice(0, 10);
  }
  private atStartOfDay(date: string) {
    return new Date(`${date}T00:00:00.000Z`);
  }
  private atEndOfDay(date: string) {
    return new Date(`${date}T23:59:59.999Z`);
  }
  private shiftDate(date: string, days: number) {
    return new Date(
      Date.parse(`${date}T00:00:00.000Z`) + days * DAY_IN_MILLISECONDS
    )
      .toISOString()
      .slice(0, 10);
  }
  private dates(from: string, to: string) {
    if (from > to) return [];
    const result: string[] = [];
    for (let date = from; date <= to; date = this.shiftDate(date, 1))
      result.push(date);
    return result;
  }
}
