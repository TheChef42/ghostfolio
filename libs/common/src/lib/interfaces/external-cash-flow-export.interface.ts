import { ExternalCashFlowType } from '@prisma/client';

export interface ExternalCashFlowExportItem {
  accountId: string;
  amount: string;
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

export interface ExternalCashFlowExportIssue {
  selectedFlowIds: string[];
  reason: 'COUNTERPART_OUTSIDE_EXPORT_SCOPE' | 'MALFORMED_TRANSFER_PAIR';
  transferGroupId: string;
}

export interface ExternalCashFlowExportSection {
  incompleteTransferGroups?: ExternalCashFlowExportIssue[];
  items: ExternalCashFlowExportItem[];
  version: 1;
}
