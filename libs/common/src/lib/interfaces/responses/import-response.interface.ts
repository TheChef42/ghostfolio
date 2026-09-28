import { Activity } from '@ghostfolio/common/interfaces';

export interface ImportResponse {
  activities: Activity[];
  externalCashFlows?: {
    created: number;
    skipped: number;
    version: 1;
  };
}
