export type CustomDateRangeEndMode = 'FIXED' | 'TODAY';

export interface CustomDateRangeSelection {
  from?: string;
  savedRangeId?: string;
  to?: string;
}

export interface SavedCustomDateRange {
  endMode: CustomDateRangeEndMode;
  from: string;
  id: string;
  name: string;
  to?: string;
}

export interface ResolvedCustomDateRange {
  cacheIdentity: string;
  endDate: Date;
  from: string;
  startDate: Date;
  to: string;
}
