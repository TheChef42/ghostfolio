import type {
  Account,
  AccountBalance,
  DataSource,
  ExternalCashFlow,
  Type
} from '@prisma/client';

export const VALUATION_METHODOLOGY_VERSION = 'phase-4a-v1';
export const VALUATION_MAX_STALENESS_DAYS = 7;

export type ValuationCoverageStatus = 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';

export type ValuationCoverageReasonCode =
  | 'CASH_RECONCILIATION_MISMATCH'
  | 'MALFORMED_TRANSFER_PAIR'
  | 'MISSING_FX'
  | 'MISSING_OPENING_CASH'
  | 'MISSING_PRICE'
  | 'STALE_FX'
  | 'STALE_PRICE'
  | 'UNSUPPORTED_ASSET'
  | 'UNSUPPORTED_LIABILITY_OR_SHORT';

export interface ValuationCoverageReason {
  accountId?: string;
  assetId?: string;
  code: ValuationCoverageReasonCode;
  currency?: string;
  date?: string;
  message: string;
  sourceDate?: string;
}

export interface ValuationSource {
  requestedDate: string;
  sourceDate: string;
  stalenessDays: number;
  value: string;
}

export interface ValuationHolding {
  assetId: string;
  currency: string;
  dataSource: DataSource;
  fx: ValuationSource | null;
  price: ValuationSource | null;
  quantity: string;
  symbol: string;
  valueInBaseCurrency: string | null;
}

export interface ValuationPoint {
  cashValueInBaseCurrency: string | null;
  date: string;
  holdings: ValuationHolding[];
  holdingsValueInBaseCurrency: string | null;
  kind: 'OPENING' | 'DAILY' | 'CLOSING';
  totalValueInBaseCurrency: string | null;
}

export interface ScopeExternalFlow {
  accountId: string;
  amountInBaseCurrency: string | null;
  currency: string;
  date: string;
  fx: ValuationSource | null;
  signedAmount: string;
  transferGroupId: string | null;
  type: ExternalCashFlow['type'];
}

export interface CashReconciliationDiagnostic {
  accountId: string;
  currency: string;
  date: string;
  observed: string;
  reconstructed: string;
  residual: string;
  status: 'MATCH' | 'MISMATCH';
}

export interface PortfolioValuationTimeline {
  accountingConvention: {
    activityTiming: 'END_OF_DAY';
    opening: 'CLOSE_BEFORE_FROM';
    timezone: 'UTC';
  };
  baseCurrency: string;
  closing: ValuationPoint;
  coverage: {
    reasons: ValuationCoverageReason[];
    status: ValuationCoverageStatus;
  };
  externalFlows: ScopeExternalFlow[];
  interval: {
    from: string;
    openingDate: string;
    to: string;
  };
  methodologyVersion: typeof VALUATION_METHODOLOGY_VERSION;
  opening: ValuationPoint;
  reconciliations: CashReconciliationDiagnostic[];
  scope: {
    accountIds: string[];
    identity: string;
    type: 'ACCOUNT_SUBSET' | 'WHOLE_PORTFOLIO';
  };
  timeline: ValuationPoint[];
}

export interface TimelineActivity {
  accountId: string | null;
  assetId: string;
  currency: string;
  dataSource: DataSource;
  date: Date;
  fee: string;
  id: string;
  quantity: string;
  symbol: string;
  type: Type;
  unitPrice: string;
}

export interface TimelineInputs {
  accounts: Pick<Account, 'currency' | 'id'>[];
  activities: TimelineActivity[];
  balances: Pick<AccountBalance, 'accountId' | 'date' | 'value'>[];
  externalCashFlows: ExternalCashFlow[];
}

export interface HistoricalValueResolver {
  resolveFx(input: {
    date: string;
    fromCurrency: string;
    toCurrency: string;
  }): Promise<ValuationSource | null>;
  resolvePrice(input: {
    dataSource: DataSource;
    date: string;
    symbol: string;
  }): Promise<ValuationSource | null>;
}
