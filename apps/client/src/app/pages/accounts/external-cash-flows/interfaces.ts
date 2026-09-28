import {
  ExternalCashFlowItem,
  ExternalCashFlowTransferResponse
} from '@ghostfolio/common/interfaces';

export interface ExternalCashFlowAccount {
  currency: string;
  id: string;
  name: string;
}

export type ExternalCashFlowDialogMode =
  'ordinary-create' | 'ordinary-edit' | 'transfer-create' | 'transfer-edit';

export interface ExternalCashFlowDialogParams {
  accounts: ExternalCashFlowAccount[];
  currencies: string[];
  flow?: ExternalCashFlowItem;
  mode: ExternalCashFlowDialogMode;
  transfer?: ExternalCashFlowTransferResponse;
}
