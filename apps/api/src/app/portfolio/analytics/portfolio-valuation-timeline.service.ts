import { resolveExternalCashFlows } from '@ghostfolio/api/app/external-cash-flow/resolve-external-cash-flows';
import { PortfolioChangedEvent } from '@ghostfolio/api/events/portfolio-changed.event';
import {
  resolveMaximumAccountHistoryStart,
  toAccountingDate
} from '@ghostfolio/api/helper/account-history.helper';
import { WHERE_ACTIVITY_NOT_DRAFT } from '@ghostfolio/api/helper/activity.helper';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { TAG_ID_EXCLUDE_FROM_ANALYSIS } from '@ghostfolio/common/config';
import {
  getUtcAccountingDate,
  isIsoAccountingDate
} from '@ghostfolio/common/custom-date-range-helper';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  Account,
  AccountBalance,
  AssetProfileSplit,
  ExternalCashFlow,
  Order,
  SymbolProfile
} from '@prisma/client';
import { Big } from 'big.js';

import { getCurrencyReconciliationTolerance } from './currency-reconciliation.helper';
import { HistoricalValuationResolverService } from './historical-valuation-resolver.service';
import { PerformanceScopeResolver } from './performance-scope.resolver';
import type {
  CashReconciliationDiagnostic,
  HistoricalValueResolver,
  OpeningCashDiagnostic,
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
const TIMELINE_CACHE_MAX_ENTRIES = 8;
const TIMELINE_CACHE_TTL_MILLISECONDS = 30_000;
type OrderWithProfile = Order & { SymbolProfile: SymbolProfile };

interface TimelineCacheEntry {
  expiresAt: number;
  timeline: PortfolioValuationTimeline;
  userId: string;
}

@Injectable()
export class PortfolioValuationTimelineService {
  private readonly cache = new Map<string, TimelineCacheEntry>();
  private readonly generations = new Map<string, number>();
  private readonly inFlight = new Map<
    string,
    Promise<PortfolioValuationTimeline>
  >();
  private readonly logger = new Logger(PortfolioValuationTimelineService.name);
  private readonly reasonIdentities = new WeakMap<
    ValuationCoverageReason[],
    Set<string>
  >();

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
    from: string | null;
    to: string;
    userId: string;
  }): Promise<PortfolioValuationTimeline> {
    if (
      !isIsoAccountingDate(to) ||
      to > getUtcAccountingDate() ||
      (from !== null && (!isIsoAccountingDate(from) || from > to))
    ) {
      throw new BadRequestException('The resolved analytics range is invalid');
    }
    this.pruneCache();
    const generation = this.generations.get(userId) ?? 0;
    const marketDataRevision = this.historicalResolver.getRevision?.() ?? 0;
    const key = JSON.stringify({
      accountIds: [...new Set(requestedAccountIds ?? [])].sort(),
      baseCurrency,
      from,
      generation,
      marketDataRevision,
      methodologyVersion: VALUATION_METHODOLOGY_VERSION,
      timezone: 'UTC',
      to,
      userId
    });
    const cached = this.cache.get(key);
    if (cached) {
      this.logger.debug('analytics.timeline cache=HIT');
      return cached.timeline;
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      this.logger.debug('analytics.timeline cache=COALESCED');
      return existing;
    }

    this.logger.debug('analytics.timeline cache=MISS');
    const promise = this.loadTimeline({
      accountIds: requestedAccountIds,
      baseCurrency,
      from,
      to,
      userId
    })
      .then((timeline) => {
        if (
          (this.generations.get(userId) ?? 0) === generation &&
          (this.historicalResolver.getRevision?.() ?? 0) === marketDataRevision
        ) {
          this.cache.set(key, {
            expiresAt: Date.now() + TIMELINE_CACHE_TTL_MILLISECONDS,
            timeline,
            userId
          });
          this.limitCacheSize();
        }
        return timeline;
      })
      .finally(() => {
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      });
    this.inFlight.set(key, promise);
    return promise;
  }

  @OnEvent(PortfolioChangedEvent.getName())
  public handlePortfolioChanged(event: PortfolioChangedEvent) {
    this.invalidateForUser(event.getUserId());
  }

  public invalidateForUser(userId: string) {
    this.generations.set(userId, (this.generations.get(userId) ?? 0) + 1);
    for (const [key, entry] of this.cache) {
      if (entry.userId === userId) {
        this.cache.delete(key);
      }
    }
  }

  private async loadTimeline({
    accountIds: requestedAccountIds,
    baseCurrency,
    from,
    to,
    userId
  }: {
    accountIds?: string[];
    baseCurrency: string;
    from: string | null;
    to: string;
    userId: string;
  }): Promise<PortfolioValuationTimeline> {
    const totalStartedAt = performance.now();
    const databaseStartedAt = performance.now();
    const ownedAccounts = await this.prismaService.account.findMany({
      include: { tags: true },
      where: { userId }
    });
    const defaultAccounts = ownedAccounts.filter(
      ({ tags }) =>
        !tags?.some(({ tagId }) => tagId === TAG_ID_EXCLUDE_FROM_ANALYSIS)
    );
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
        // outside the selected account scope. Future flows cannot affect the
        // requested closing state and are intentionally excluded.
        where: { userId, date: { lte: closingDate } }
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
    const databaseMs = performance.now() - databaseStartedAt;
    const activities = this.normalizeActivities(orders, splits);
    const resolvedFrom =
      from ??
      resolveMaximumAccountHistoryStart({
        accounts,
        activities,
        balances,
        externalCashFlows: flows,
        includeUnassignedActivities: scope.type === 'WHOLE_PORTFOLIO',
        to
      });
    const scopedAccountIds = new Set(accounts.map(({ id }) => id));
    const inceptionByAccountId = new Map(
      accounts.flatMap(({ id, inceptionDate }) =>
        inceptionDate ? [[id, toAccountingDate(inceptionDate)]] : []
      )
    );
    const scopedActivities = activities.filter(({ accountId, date }) => {
      if (accountId === null) return scope.type === 'WHOLE_PORTFOLIO';
      return (
        scopedAccountIds.has(accountId) &&
        (!inceptionByAccountId.has(accountId) ||
          this.date(date) >= inceptionByAccountId.get(accountId)!)
      );
    });
    const requiredAssets = this.getRequiredAssets({
      activities: scopedActivities,
      from: resolvedFrom,
      to
    });
    const preparedResolver = this.historicalResolver.prepare
      ? await this.historicalResolver.prepare({
          baseCurrency,
          currencies: [
            ...accounts.map(({ currency }) => currency ?? baseCurrency),
            ...requiredAssets.map(({ currency }) => currency),
            ...flows
              .filter(({ accountId, date }) => {
                const inceptionDate = inceptionByAccountId.get(accountId);
                return (
                  scope.accountIds.includes(accountId) &&
                  (!inceptionDate || this.date(date) >= inceptionDate)
                );
              })
              .map(({ currency }) => currency)
          ],
          from: this.shiftDate(resolvedFrom, -1),
          prices: requiredAssets.map(({ dataSource, symbol }) => ({
            dataSource,
            symbol
          })),
          to
        })
      : this.historicalResolver;
    const buildStartedAt = performance.now();
    const timeline = await this.buildTimeline({
      baseCurrency,
      from: resolvedFrom,
      inputs: {
        accounts,
        activities,
        balances,
        externalCashFlows: flows
      },
      resolver: preparedResolver,
      scope,
      to,
      userId
    });
    this.logger.debug(
      `analytics.timeline accounts=${accounts.length} days=${timeline.timeline.length} activities=${orders.length} flows=${flows.length} symbols=${profileIds.length} dbMs=${databaseMs.toFixed(1)} buildMs=${(performance.now() - buildStartedAt).toFixed(1)} totalMs=${(performance.now() - totalStartedAt).toFixed(1)}`
    );
    return timeline;
  }

  private limitCacheSize() {
    while (this.cache.size > TIMELINE_CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }

  private getRequiredAssets({
    activities,
    from,
    to
  }: {
    activities: TimelineActivity[];
    from: string;
    to: string;
  }) {
    const quantities = new Map<string, Big>();
    const assets = new Map<string, TimelineActivity>();
    const required = new Set<string>();
    const byDate = this.groupBy(
      activities.filter(
        ({ date, type }) =>
          ['BUY', 'SELL'].includes(type) && this.date(date) <= to
      ),
      ({ date }) => this.date(date)
    );
    const openingDate = this.shiftDate(from, -1);

    const applyDate = (date: string) => {
      for (const activity of byDate.get(date) ?? []) {
        const sign = activity.type === 'BUY' ? 1 : -1;
        quantities.set(
          activity.assetId,
          (quantities.get(activity.assetId) ?? new Big(0)).plus(
            new Big(activity.quantity).mul(sign)
          )
        );
        assets.set(activity.assetId, activity);
      }
    };
    const markHeldAssets = () => {
      for (const [assetId, quantity] of quantities) {
        if (quantity.gt(0)) required.add(assetId);
      }
    };
    const dates = [...byDate.keys()].sort();
    for (const date of dates.filter((item) => item <= openingDate)) {
      applyDate(date);
    }
    markHeldAssets();
    for (const date of dates.filter((item) => item >= from)) {
      applyDate(date);
      markHeldAssets();
    }

    return [...required]
      .map((assetId) => assets.get(assetId)!)
      .sort((a, b) => a.assetId.localeCompare(b.assetId));
  }

  private pruneCache() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
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
    const openingCash: OpeningCashDiagnostic[] = [];
    const accountById = new Map(
      inputs.accounts.map((account) => [account.id, account])
    );
    const scopedAccountIds = new Set(accountById.keys());
    const inceptionByAccountId = new Map(
      inputs.accounts.flatMap(({ id, inceptionDate }) =>
        inceptionDate ? [[id, toAccountingDate(inceptionDate)]] : []
      )
    );
    const isBeforeInception = (accountId: string, date: Date) => {
      const inceptionDate = inceptionByAccountId.get(accountId);
      return Boolean(inceptionDate && this.date(date) < inceptionDate);
    };
    for (const activity of inputs.activities) {
      if (
        activity.accountId &&
        isBeforeInception(activity.accountId, activity.date)
      ) {
        this.addInceptionConflictReason({
          accountById,
          accountId: activity.accountId,
          date: activity.date,
          reasons,
          recordType: 'activity'
        });
      }
    }
    for (const balance of inputs.balances) {
      if (isBeforeInception(balance.accountId, balance.date)) {
        this.addInceptionConflictReason({
          accountById,
          accountId: balance.accountId,
          date: balance.date,
          reasons,
          recordType: 'account balance'
        });
      }
    }
    for (const flow of inputs.externalCashFlows) {
      if (
        scopedAccountIds.has(flow.accountId) &&
        isBeforeInception(flow.accountId, flow.date)
      ) {
        this.addInceptionConflictReason({
          accountById,
          accountId: flow.accountId,
          date: flow.date,
          reasons,
          recordType: 'external cash flow'
        });
      }
    }
    const timelineInputs: TimelineInputs = {
      accounts: inputs.accounts,
      activities: inputs.activities.filter(
        (activity) =>
          !activity.accountId ||
          !isBeforeInception(activity.accountId, activity.date)
      ),
      balances: inputs.balances.filter(
        (balance) => !isBeforeInception(balance.accountId, balance.date)
      ),
      externalCashFlows: inputs.externalCashFlows.filter(
        (flow) =>
          !scopedAccountIds.has(flow.accountId) ||
          !isBeforeInception(flow.accountId, flow.date)
      )
    };
    const scopedActivities = timelineInputs.activities.filter(
      ({ accountId }) =>
        (accountId === null && scope.type === 'WHOLE_PORTFOLIO') ||
        (accountId !== null && scopedAccountIds.has(accountId))
    );
    const quantities = new Map<string, Big>();
    const quantitiesByAccountAndAsset = new Map<string, Big>();
    const assetById = new Map<string, TimelineActivity>();
    const cash = new Map<string, Big | null>();
    const balanceByAccount = this.groupBy(
      timelineInputs.balances,
      ({ accountId }) => accountId
    );
    const activityByDate = this.groupBy(scopedActivities, ({ date }) =>
      this.date(date)
    );
    const flowByDate = this.groupBy(
      timelineInputs.externalCashFlows,
      ({ date }) => this.date(date)
    );
    const fxCache = new Map<string, Promise<ValuationSource | null>>();
    const priceCache = new Map<string, Promise<ValuationSource | null>>();
    const resolveFx = (currency: string, date: string) => {
      const key = `${currency}:${baseCurrency}:${date}`;
      if (!fxCache.has(key)) {
        fxCache.set(
          key,
          this.resolveFx({
            date,
            fromCurrency: currency,
            resolver,
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

    for (const activity of scopedActivities) {
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

    for (const activity of scopedActivities.filter(
      ({ date }) => this.date(date) <= openingDate
    )) {
      this.validateHoldingDependentActivity({
        activity,
        inceptionByAccountId,
        quantitiesByAccountAndAsset,
        reasons
      });
      this.applyHolding(activity, quantities, assetById, reasons);
      this.applyAccountHolding(activity, quantitiesByAccountAndAsset);
    }

    for (const account of timelineInputs.accounts) {
      const inceptionDate = inceptionByAccountId.get(account.id);
      if (inceptionDate && openingDate < inceptionDate) {
        cash.set(account.id, new Big(0));
        openingCash.push({
          accountId: account.id,
          currency: account.currency ?? baseCurrency,
          date: inceptionDate,
          source: 'ACCOUNT_NOT_YET_IN_EXISTENCE'
        });
        continue;
      }
      const anchor = (balanceByAccount.get(account.id) ?? [])
        .filter(({ date }) => this.date(date) <= openingDate)
        .at(-1);
      if (!anchor) {
        const firstFundingDate = this.getZeroOpeningFundingDate({
          accountId: account.id,
          from,
          inputs: timelineInputs
        });
        if (firstFundingDate) {
          cash.set(account.id, new Big(0));
          openingCash.push({
            accountId: account.id,
            currency: account.currency ?? baseCurrency,
            date: firstFundingDate,
            source: 'INFERRED_ZERO_FIRST_FUNDING'
          });
          continue;
        }
        cash.set(account.id, null);
        this.addReason(reasons, {
          accountId: account.id,
          accountName: account.name ?? undefined,
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
      openingCash.push({
        accountId: account.id,
        currency: account.currency ?? baseCurrency,
        date: anchorDate,
        source: 'ACCOUNT_BALANCE'
      });
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
          holdings.push({
            assetId,
            currency: asset.currency,
            dataSource: asset.dataSource,
            fx: null,
            price: null,
            quantity: quantity.toFixed(),
            symbol: asset.symbol,
            valueInBaseCurrency: null
          });
          continue;
        }
        const price = await resolvePrice(asset, date);
        const priceUsable = this.sourceIsUsable({
          date,
          diagnostic: {
            assetId,
            dataSource: asset.dataSource,
            symbol: asset.symbol
          },
          kind: 'PRICE',
          reasons,
          source: price
        });
        let fx: ValuationSource | null = null;
        let value: Big | null = null;
        if (priceUsable) {
          const nativeValue = quantity.mul(price!.value);
          if (nativeValue.eq(0)) {
            value = new Big(0);
          } else {
            fx = await resolveFx(asset.currency, date);
            const fxUsable = this.sourceIsUsable({
              date,
              diagnostic: {
                assetId,
                currency: asset.currency,
                dataSource: asset.dataSource,
                symbol: asset.symbol,
                targetCurrency: baseCurrency
              },
              kind: 'FX',
              reasons,
              source: fx
            });
            if (fxUsable) value = nativeValue.mul(fx!.value);
          }
        }
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
      for (const account of timelineInputs.accounts) {
        const accountCash = cash.get(account.id);
        if (!accountCash) {
          cashComplete = false;
          continue;
        }
        if (accountCash.eq(0)) {
          continue;
        }
        const currency = account.currency ?? baseCurrency;
        const fx = await resolveFx(currency, date);
        if (
          !this.sourceIsUsable({
            date,
            diagnostic: {
              accountId: account.id,
              accountName: account.name ?? undefined,
              currency,
              targetCurrency: baseCurrency
            },
            kind: 'FX',
            reasons,
            source: fx
          })
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
      for (const activity of activityByDate.get(date) ?? []) {
        this.validateHoldingDependentActivity({
          activity,
          inceptionByAccountId,
          quantitiesByAccountAndAsset,
          reasons
        });
        this.applyHolding(activity, quantities, assetById, reasons);
        this.applyAccountHolding(activity, quantitiesByAccountAndAsset);
      }
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
        inputs: timelineInputs,
        openingCash,
        reasons,
        reconciliations
      });
      timeline.push(await valuePoint(date, date === to ? 'CLOSING' : 'DAILY'));
    }
    const closing = timeline.at(-1)!;
    const externalFlows = await this.resolveScopeFlows({
      baseCurrency,
      flows: timelineInputs.externalCashFlows,
      from,
      reasons,
      resolver,
      scope,
      to,
      userId
    });
    const hasBlockingReason = reasons.some(
      ({ severity }) => (severity ?? 'ERROR') === 'ERROR'
    );
    const status =
      opening.totalValueInBaseCurrency === null ||
      closing.totalValueInBaseCurrency === null
        ? 'UNAVAILABLE'
        : hasBlockingReason
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
      coverage: { reasons: this.compactCoverageReasons(reasons), status },
      externalFlows,
      interval: { from, openingDate, to },
      methodologyVersion: VALUATION_METHODOLOGY_VERSION,
      opening,
      openingCash,
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
    accountById: Map<
      string,
      Pick<Account, 'currency' | 'id'> & { name?: string | null }
    >;
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
      if (delta.eq(0)) continue;
      const account = accountById.get(activity.accountId)!;
      const accountCurrency = account.currency ?? activity.currency;
      const fx = await this.resolveFx({
        date,
        fromCurrency: activity.currency,
        resolver,
        toCurrency: accountCurrency
      });
      if (
        !this.sourceIsUsable({
          date,
          diagnostic: {
            accountId: activity.accountId,
            accountName: account.name ?? undefined,
            assetId: activity.assetId,
            currency: activity.currency,
            dataSource: activity.dataSource,
            symbol: activity.symbol,
            targetCurrency: accountCurrency
          },
          kind: 'FX',
          reasons,
          source: fx
        })
      ) {
        cash.set(activity.accountId, null);
      } else {
        cash.set(activity.accountId, current.plus(delta.mul(fx!.value)));
      }
    }
    for (const flow of flowByDate.get(date) ?? []) {
      if (onlyAccountId && flow.accountId !== onlyAccountId) continue;
      if (!cash.has(flow.accountId)) continue;
      const current = cash.get(flow.accountId);
      if (!current) continue;
      if (new Big(flow.amount.toString()).eq(0)) continue;
      const account = accountById.get(flow.accountId)!;
      const accountCurrency = account.currency ?? flow.currency;
      const fx = await this.resolveFx({
        date,
        fromCurrency: flow.currency,
        resolver,
        toCurrency: accountCurrency
      });
      if (
        !this.sourceIsUsable({
          date,
          diagnostic: {
            accountId: flow.accountId,
            accountName: account.name ?? undefined,
            currency: flow.currency,
            targetCurrency: accountCurrency
          },
          kind: 'FX',
          reasons,
          source: fx
        })
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

  private addInceptionConflictReason({
    accountById,
    accountId,
    date,
    reasons,
    recordType
  }: {
    accountById: Map<
      string,
      Pick<Account, 'currency' | 'id'> & {
        inceptionDate?: Date | null;
        name?: string | null;
      }
    >;
    accountId: string;
    date: Date;
    reasons: ValuationCoverageReason[];
    recordType: string;
  }) {
    const account = accountById.get(accountId);
    this.addReason(reasons, {
      accountId,
      accountName: account?.name ?? undefined,
      code: 'ACCOUNT_INCEPTION_CONFLICT',
      date: this.date(date),
      message: `An ${recordType} exists before the account start date`
    });
  }

  private applyAccountHolding(
    activity: TimelineActivity,
    quantities: Map<string, Big>
  ) {
    if (!activity.accountId || !['BUY', 'SELL'].includes(activity.type)) return;
    const key = `${activity.accountId}:${activity.assetId}`;
    const sign = activity.type === 'BUY' ? 1 : -1;
    quantities.set(
      key,
      (quantities.get(key) ?? new Big(0)).plus(
        new Big(activity.quantity).mul(sign)
      )
    );
  }

  private validateHoldingDependentActivity({
    activity,
    inceptionByAccountId,
    quantitiesByAccountAndAsset,
    reasons
  }: {
    activity: TimelineActivity;
    inceptionByAccountId: Map<string, string>;
    quantitiesByAccountAndAsset: Map<string, Big>;
    reasons: ValuationCoverageReason[];
  }) {
    if (
      activity.type !== 'DIVIDEND' ||
      !activity.accountId ||
      !inceptionByAccountId.has(activity.accountId)
    ) {
      return;
    }
    const quantity = quantitiesByAccountAndAsset.get(
      `${activity.accountId}:${activity.assetId}`
    );
    if (quantity?.gt(0)) return;
    this.addReason(reasons, {
      accountId: activity.accountId,
      assetId: activity.assetId,
      code: 'MISSING_OPENING_HOLDINGS',
      date: this.date(activity.date),
      message:
        'A dividend exists without established holding history for this account',
      symbol: activity.symbol
    });
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
    openingCash,
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
    openingCash: OpeningCashDiagnostic[];
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
        const difference = residual.abs();
        const tolerance = getCurrencyReconciliationTolerance(
          account.currency ?? ''
        );
        const status = difference.lte(tolerance) ? 'MATCH' : 'MISMATCH';
        reconciliations.push({
          accountId: account.id,
          currency: account.currency ?? '',
          date,
          difference: difference.toFixed(),
          observed: observed.toFixed(),
          reconstructed: reconstructed.toFixed(),
          residual: residual.toFixed(),
          status,
          tolerance: tolerance.toFixed()
        });
        if (status === 'MISMATCH')
          this.addReason(reasons, {
            accountId: account.id,
            accountName: account.name ?? undefined,
            adjustment: residual.toFixed(),
            code: 'CASH_RECONCILIATION_MISMATCH',
            currency: account.currency ?? undefined,
            date,
            difference: difference.toFixed(),
            expected: observed.toFixed(),
            message:
              'Reconstructed cash exceeds the native-currency reconciliation tolerance',
            openingCashDate: openingCash.find(
              ({ accountId }) => accountId === account.id
            )?.date,
            openingCashSource: openingCash.find(
              ({ accountId }) => accountId === account.id
            )?.source,
            reconstructed: reconstructed.toFixed(),
            severity: 'WARNING',
            tolerance: tolerance.toFixed()
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
        if (new Big(flow.amount).eq(0)) {
          return {
            accountId: flow.accountId,
            amountInBaseCurrency: '0',
            currency: flow.currency,
            date,
            fx: null,
            signedAmount: flow.amount,
            transferGroupId: flow.transferGroupId,
            type: source.type
          };
        }
        const fx = await this.resolveFx({
          date,
          fromCurrency: flow.currency,
          resolver,
          toCurrency: baseCurrency
        });
        const usable = this.sourceIsUsable({
          date,
          diagnostic: {
            accountId: flow.accountId,
            currency: flow.currency,
            targetCurrency: baseCurrency
          },
          kind: 'FX',
          reasons,
          source: fx
        });
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

  private sourceIsUsable({
    date,
    diagnostic,
    kind,
    reasons,
    source
  }: {
    date: string;
    diagnostic: Omit<ValuationCoverageReason, 'code' | 'date' | 'message'>;
    kind: 'FX' | 'PRICE';
    reasons: ValuationCoverageReason[];
    source: ValuationSource | null;
  }) {
    if (!source) {
      this.addReason(reasons, {
        ...diagnostic,
        code: kind === 'FX' ? 'MISSING_FX' : 'MISSING_PRICE',
        date,
        message: `No eligible historical ${kind.toLowerCase()} exists on or before the requested date`
      });
      return false;
    }
    if (source.stalenessDays > VALUATION_MAX_STALENESS_DAYS) {
      this.addReason(reasons, {
        ...diagnostic,
        code: kind === 'FX' ? 'STALE_FX' : 'STALE_PRICE',
        date,
        sourceDate: source.sourceDate,
        message: `The latest prior ${kind.toLowerCase()} exceeds the ${VALUATION_MAX_STALENESS_DAYS}-day freshness limit`
      });
      return false;
    }
    return true;
  }

  private resolveFx({
    date,
    fromCurrency,
    resolver,
    toCurrency
  }: {
    date: string;
    fromCurrency: string;
    resolver: HistoricalValueResolver;
    toCurrency: string;
  }) {
    if (fromCurrency === toCurrency) {
      return Promise.resolve<ValuationSource>({
        requestedDate: date,
        sourceDate: date,
        stalenessDays: 0,
        value: '1'
      });
    }
    return resolver.resolveFx({ date, fromCurrency, toCurrency });
  }

  private getZeroOpeningFundingDate({
    accountId,
    from,
    inputs
  }: {
    accountId: string;
    from: string;
    inputs: TimelineInputs;
  }) {
    const events = [
      ...inputs.activities
        .filter((activity) => activity.accountId === accountId)
        .map((activity) => ({
          date: this.date(activity.date),
          funding: false
        })),
      ...inputs.balances
        .filter((balance) => balance.accountId === accountId)
        .map((balance) => ({ date: this.date(balance.date), funding: false })),
      ...inputs.externalCashFlows
        .filter((flow) => flow.accountId === accountId)
        .map((flow) => ({
          date: this.date(flow.date),
          funding: ['DEPOSIT', 'TRANSFER_IN'].includes(flow.type)
        }))
    ].sort((left, right) => left.date.localeCompare(right.date));

    const firstDate = events[0]?.date;
    return firstDate &&
      firstDate >= from &&
      events.some(({ date, funding }) => date === firstDate && funding)
      ? firstDate
      : null;
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
    const normalizedReason = {
      severity: 'ERROR' as const,
      ...reason
    };
    const identity = JSON.stringify(normalizedReason);
    let identities = this.reasonIdentities.get(reasons);
    if (!identities) {
      identities = new Set(reasons.map((item) => JSON.stringify(item)));
      this.reasonIdentities.set(reasons, identities);
    }
    if (!identities.has(identity)) {
      identities.add(identity);
      reasons.push(normalizedReason);
    }
  }

  private compactCoverageReasons(reasons: ValuationCoverageReason[]) {
    const compacted: ValuationCoverageReason[] = [];
    const active = new Map<string, ValuationCoverageReason>();
    const temporalCodes = new Set<ValuationCoverageReason['code']>([
      'MISSING_FX',
      'MISSING_PRICE',
      'STALE_FX',
      'STALE_PRICE'
    ]);

    for (const reason of reasons) {
      if (!reason.date || !temporalCodes.has(reason.code)) {
        compacted.push(reason);
        continue;
      }
      const identity = { ...reason };
      delete identity.date;
      delete identity.dateFrom;
      delete identity.dateTo;
      const key = JSON.stringify(identity);
      const previous = active.get(key);
      if (previous?.dateTo === this.shiftDate(reason.date, -1)) {
        previous.dateTo = reason.date;
        continue;
      }
      const grouped = {
        ...reason,
        dateFrom: reason.date,
        dateTo: reason.date
      };
      active.set(key, grouped);
      compacted.push(grouped);
    }

    return compacted;
  }

  private groupBy<T>(items: T[], key: (item: T) => string) {
    const result = new Map<string, T[]>();
    for (const item of items) {
      const itemKey = key(item);
      const group = result.get(itemKey);
      if (group) group.push(item);
      else result.set(itemKey, [item]);
    }
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
