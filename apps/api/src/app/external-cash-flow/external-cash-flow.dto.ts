import { IsCurrencyCode } from '@ghostfolio/common/validators/is-currency-code';

import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested
} from 'class-validator';

// Decimal(36,18): no exponent, float coercion, rounding or zero magnitude.
export const CASH_FLOW_AMOUNT =
  /^(?=.*[1-9])(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?(?![\s\S])/;
const ACCOUNTING_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CashFlowLegDto {
  @IsUUID()
  accountId: string;

  @Matches(CASH_FLOW_AMOUNT)
  amount: string;

  @IsString()
  @IsCurrencyCode()
  @Transform(({ value }) => (typeof value === 'string' ? value : null))
  currency: string;

  @Matches(ACCOUNTING_DATE)
  @IsDateString({ strict: true })
  date: string;
}

export class CreateExternalCashFlowDto extends CashFlowLegDto {
  @IsIn(['DEPOSIT', 'WITHDRAWAL'])
  type: 'DEPOSIT' | 'WITHDRAWAL';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string | null;
}

export class UpdateExternalCashFlowDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  accountId?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(CASH_FLOW_AMOUNT)
  amount?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsCurrencyCode()
  @Transform(({ value }) => (typeof value === 'string' ? value : null))
  currency?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Matches(ACCOUNTING_DATE)
  @IsDateString({ strict: true })
  date?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['DEPOSIT', 'WITHDRAWAL'])
  type?: 'DEPOSIT' | 'WITHDRAWAL';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string | null;
}

// PUT replaces both legs; clients never supply ids, group ids or ownership.
export class TransferExternalCashFlowDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => CashFlowLegDto)
  from: CashFlowLegDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => CashFlowLegDto)
  to: CashFlowLegDto;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  source?: string | null;
}

export class GetExternalCashFlowsDto {
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value
  )
  accounts?: string[];

  @IsOptional()
  @Matches(ACCOUNTING_DATE)
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @Matches(ACCOUNTING_DATE)
  @IsDateString({ strict: true })
  to?: string;

  @IsInt()
  @Min(0)
  @Max(1000000)
  @Type(() => Number)
  skip: number = 0;

  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  take: number = 100;
}
