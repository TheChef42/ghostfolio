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
  | 'ACCOUNT_INCEPTION_CONFLICT'
  | 'MALFORMED_TRANSFER_PAIR'
  | 'MISSING_FX'
  | 'MISSING_OPENING_CASH'
  | 'MISSING_OPENING_HOLDINGS'
  | 'MISSING_PRICE'
  | 'STALE_FX'
  | 'STALE_PRICE'
  | 'UNSUPPORTED_ASSET'
  | 'UNSUPPORTED_LIABILITY_OR_SHORT';

export interface ValuationCoverageReason {
  adjustment?: string;
  accountId?: string;
  accountName?: string;
  assetId?: string;
  code: ValuationCoverageReasonCode;
  currency?: string;
  dataSource?: DataSource;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  difference?: string;
  expected?: string;
  message: string;
  openingCashDate?: string;
  openingCashSource?: OpeningCashDiagnostic['source'];
  reconstructed?: string;
  severity?: 'ERROR' | 'INFO' | 'WARNING';
  sourceDate?: string;
  symbol?: string;
  targetCurrency?: string;
  tolerance?: string;
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
  difference: string;
  observed: string;
  reconstructed: string;
  residual: string;
  status: 'MATCH' | 'MISMATCH';
  tolerance: string;
}

export interface OpeningCashDiagnostic {
  accountId: string;
  currency: string;
  date: string;
  source:
    | 'ACCOUNT_BALANCE'
    | 'ACCOUNT_NOT_YET_IN_EXISTENCE'
    | 'INFERRED_ZERO_FIRST_FUNDING';
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
  openingCash: OpeningCashDiagnostic[];
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
  accounts: (Pick<Account, 'currency' | 'id'> & {
    inceptionDate?: Date | null;
    name?: string | null;
  })[];
  activities: TimelineActivity[];
  balances: Pick<AccountBalance, 'accountId' | 'date' | 'value'>[];
  externalCashFlows: ExternalCashFlow[];
}

export interface HistoricalValueResolver {
  getRevision?(): number;
  prepare?(input: {
    baseCurrency: string;
    currencies: string[];
    from: string;
    prices: { dataSource: DataSource; symbol: string }[];
    to: string;
  }): Promise<HistoricalValueResolver>;
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
