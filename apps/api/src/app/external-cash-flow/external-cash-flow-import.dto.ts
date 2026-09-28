import { IsCurrencyCode } from '@ghostfolio/common/validators/is-currency-code';

import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  Equals,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested
} from 'class-validator';

import { CASH_FLOW_AMOUNT } from './external-cash-flow.dto';

const ACCOUNTING_DATE = /^\d{4}-\d{2}-\d{2}$/;
const AUDIT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class ExternalCashFlowImportItemDto {
  @IsUUID()
  accountId: string;

  @Matches(CASH_FLOW_AMOUNT)
  amount: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsDateString({ strict: true })
  @Matches(AUDIT_TIMESTAMP)
  createdAt: string;

  @IsString()
  @IsCurrencyCode()
  @Transform(({ value }) => (typeof value === 'string' ? value : null))
  currency: string;

  @Matches(ACCOUNTING_DATE)
  @IsDateString({ strict: true })
  date: string;

  @IsUUID()
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string | null;

  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  transferGroupId: string | null;

  @IsIn(['DEPOSIT', 'WITHDRAWAL', 'TRANSFER_IN', 'TRANSFER_OUT'])
  type: 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER_IN' | 'TRANSFER_OUT';

  @IsDateString({ strict: true })
  @Matches(AUDIT_TIMESTAMP)
  updatedAt: string;
}

export class ExternalCashFlowImportIssueDto {
  @ArrayUnique()
  @IsArray()
  @IsUUID(undefined, { each: true })
  selectedFlowIds: string[];

  @IsIn(['COUNTERPART_OUTSIDE_EXPORT_SCOPE', 'MALFORMED_TRANSFER_PAIR'])
  reason: 'COUNTERPART_OUTSIDE_EXPORT_SCOPE' | 'MALFORMED_TRANSFER_PAIR';

  @IsUUID()
  transferGroupId: string;
}

export class ExternalCashFlowImportSectionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalCashFlowImportIssueDto)
  incompleteTransferGroups?: ExternalCashFlowImportIssueDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExternalCashFlowImportItemDto)
  items: ExternalCashFlowImportItemDto[];

  @Equals(1)
  version: 1;
}
