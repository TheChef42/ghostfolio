import { ExternalCashFlowType } from '@prisma/client';

export interface ExternalCashFlowItem {
  accountId: string;
  amount: string | null;
  comment: string | null;
  createdAt: string;
  currency: string;
  date: string;
  id: string;
  source: string | null;
  transferGroupId: string | null;
  type: ExternalCashFlowType;
  updatedAt: string;
}

export interface ExternalCashFlowsResponse {
  count: number;
  items: ExternalCashFlowItem[];
}

export interface ExternalCashFlowMutation {
  accountId: string;
  amount: string;
  comment?: string | null;
  currency: string;
  date: string;
  source?: string | null;
  type: 'DEPOSIT' | 'WITHDRAWAL';
}

export interface ExternalCashFlowTransferMutation {
  comment?: string | null;
  from: ExternalCashFlowTransferLeg;
  source?: string | null;
  to: ExternalCashFlowTransferLeg;
}

export interface ExternalCashFlowTransferLeg {
  accountId: string;
  amount: string;
  currency: string;
  date: string;
}

export interface ExternalCashFlowTransferResponse {
  items: ExternalCashFlowItem[];
  transferGroupId: string;
}
