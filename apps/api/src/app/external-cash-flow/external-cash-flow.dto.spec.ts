import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import 'reflect-metadata';

import {
  CreateExternalCashFlowDto,
  GetExternalCashFlowsDto,
  TransferExternalCashFlowDto,
  UpdateExternalCashFlowDto
} from './external-cash-flow.dto';

describe('external cash-flow DTOs', () => {
  const valid = {
    accountId: '11111111-1111-4111-8111-111111111111',
    amount: '12.345',
    currency: 'EUR',
    date: '2026-01-01',
    type: 'DEPOSIT'
  };
  const errors = (data: object) =>
    validateSync(plainToInstance(CreateExternalCashFlowDto, data), {
      whitelist: true,
      forbidNonWhitelisted: true
    });
  it.each([
    '0',
    '0.0',
    '-1',
    '1e3',
    'NaN',
    'Infinity',
    '1\n',
    '1000000000000000000',
    '0.0000000000000000001',
    '',
    12.3,
    null
  ])('rejects non-positive or inexact/invalid magnitude %p', (amount) => {
    expect(errors({ ...valid, amount }).length).toBeGreaterThan(0);
  });
  it.each([
    '1',
    '0.000000000000000001',
    '999999999999999999.999999999999999999'
  ])('accepts decimal magnitude %s without float coercion', (amount) => {
    expect(errors({ ...valid, amount })).toEqual([]);
  });
  it.each(['NOTACURRENCY', '', null, 123])(
    'rejects unsupported currency %p',
    (currency) => {
      expect(errors({ ...valid, currency }).length).toBeGreaterThan(0);
    }
  );
  it.each(['2026-02-30', '2026-13-01', '2026-01-01T10:00:00Z', '01/02/2026'])(
    'rejects non-accounting date %s',
    (date) => {
      expect(errors({ ...valid, date }).length).toBeGreaterThan(0);
    }
  );
  it.each([
    'BUY',
    'SELL',
    'DIVIDEND',
    'INTEREST',
    'FEE',
    'TRANSFER_IN',
    'TRANSFER_OUT'
  ])('rejects %s through the ordinary endpoint', (type) => {
    expect(errors({ ...valid, type }).length).toBeGreaterThan(0);
  });
  it.each(['userId', 'transferGroupId', 'id'])(
    'rejects client supplied %s',
    (key) => {
      expect(
        errors({ ...valid, [key]: valid.accountId }).length
      ).toBeGreaterThan(0);
    }
  );
  it('limits comments and source', () => {
    expect(
      errors({ ...valid, source: 'x'.repeat(256) }).length
    ).toBeGreaterThan(0);
    expect(
      errors({ ...valid, comment: 'x'.repeat(2001) }).length
    ).toBeGreaterThan(0);
  });
  it('accepts partial updates but not null required fields', () => {
    expect(
      validateSync(
        plainToInstance(UpdateExternalCashFlowDto, { comment: null })
      )
    ).toEqual([]);
    expect(
      validateSync(plainToInstance(UpdateExternalCashFlowDto, { amount: null }))
        .length
    ).toBeGreaterThan(0);
  });
  it('requires both nested transfer legs', () => {
    expect(
      validateSync(plainToInstance(TransferExternalCashFlowDto, {})).length
    ).toBe(2);
  });
  it('caps pagination', () => {
    expect(
      validateSync(plainToInstance(GetExternalCashFlowsDto, { take: '501' }))
        .length
    ).toBeGreaterThan(0);
    expect(plainToInstance(GetExternalCashFlowsDto, {}).take).toBe(100);
  });
});
