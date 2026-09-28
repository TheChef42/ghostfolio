import { DataService } from '@ghostfolio/ui/services';

import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { GfExternalCashFlowDialogComponent } from './external-cash-flow-dialog.component';
import { ExternalCashFlowDialogParams } from './interfaces';

describe('GfExternalCashFlowDialogComponent', () => {
  const accounts = [
    { id: 'account-a', name: 'Broker A', currency: 'DKK' },
    { id: 'account-b', name: 'Broker B', currency: 'DKK' }
  ];
  let dataService: Record<string, jest.Mock>;
  let dialogRef: { close: jest.Mock };

  function create(data: Partial<ExternalCashFlowDialogParams> = {}) {
    const params: ExternalCashFlowDialogParams = {
      accounts,
      currencies: ['DKK', 'EUR'],
      mode: 'ordinary-create',
      ...data
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GfExternalCashFlowDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DataService, useValue: dataService },
        { provide: MAT_DIALOG_DATA, useValue: params },
        { provide: MatDialogRef, useValue: dialogRef }
      ]
    });

    return TestBed.createComponent(GfExternalCashFlowDialogComponent);
  }

  beforeEach(() => {
    dataService = {
      patchExternalCashFlow: jest.fn(() => of({})),
      postExternalCashFlow: jest.fn(() => of({})),
      postExternalCashFlowTransfer: jest.fn(() => of({})),
      putExternalCashFlowTransfer: jest.fn(() => of({}))
    };
    dialogRef = { close: jest.fn() };
  });

  it.each(['DEPOSIT', 'WITHDRAWAL'] as const)(
    'submits an exact %s string payload',
    (type) => {
      const fixture = create();
      const component = fixture.componentInstance as any;
      component.ordinaryForm.setValue({
        accountId: 'account-a',
        amount: '999999999999999999.123456789012345678',
        comment: 'Long-term funding',
        currency: 'DKK',
        date: '2026-09-28',
        source: 'Bank',
        type
      });

      component.onSubmit();

      expect(dataService.postExternalCashFlow).toHaveBeenCalledWith({
        accountId: 'account-a',
        amount: '999999999999999999.123456789012345678',
        comment: 'Long-term funding',
        currency: 'DKK',
        date: '2026-09-28',
        source: 'Bank',
        type
      });
      expect(dialogRef.close).toHaveBeenCalledWith(true);
    }
  );

  it('edits an ordinary flow through the ordinary endpoint', () => {
    const fixture = create({
      mode: 'ordinary-edit',
      flow: {
        id: 'flow-id',
        accountId: 'account-a',
        amount: '12.340000000000000001',
        comment: null,
        createdAt: '2026-09-28T10:00:00.000Z',
        currency: 'DKK',
        date: '2026-09-28T00:00:00.000Z',
        source: null,
        transferGroupId: null,
        type: 'DEPOSIT',
        updatedAt: '2026-09-28T10:00:00.000Z'
      }
    });
    const component = fixture.componentInstance as any;

    component.onSubmit();

    expect(dataService.patchExternalCashFlow).toHaveBeenCalledWith(
      'flow-id',
      expect.objectContaining({ amount: '12.340000000000000001' })
    );
  });

  it('rejects transfer types in the ordinary form', () => {
    const fixture = create();
    const component = fixture.componentInstance as any;
    component.ordinaryForm.patchValue({
      accountId: 'account-a',
      amount: '1',
      currency: 'DKK',
      date: '2026-09-28',
      type: 'TRANSFER_IN'
    });

    component.onSubmit();

    expect(component.ordinaryForm.invalid).toBe(true);
    expect(dataService.postExternalCashFlow).not.toHaveBeenCalled();
  });

  it('validates account, chronology and same-currency transfer principals', () => {
    const fixture = create({ mode: 'transfer-create' });
    const component = fixture.componentInstance as any;
    const valid = {
      comment: '',
      fromAccountId: 'account-a',
      fromAmount: '100.000000000000000001',
      fromCurrency: 'DKK',
      fromDate: '2026-09-28',
      source: '',
      toAccountId: 'account-b',
      toAmount: '100.000000000000000001',
      toCurrency: 'DKK',
      toDate: '2026-09-29'
    };

    component.transferForm.setValue({ ...valid, toAccountId: 'account-a' });
    expect(component.transferForm.hasError('sameAccount')).toBe(true);

    component.transferForm.setValue({ ...valid, toDate: '2026-09-27' });
    expect(component.transferForm.hasError('receiptBeforeDeparture')).toBe(
      true
    );

    component.transferForm.setValue({ ...valid, toAmount: '99' });
    expect(
      component.transferForm.hasError('sameCurrencyPrincipalMismatch')
    ).toBe(true);

    component.transferForm.setValue({
      ...valid,
      toAmount: '91.234567890123456789',
      toCurrency: 'EUR'
    });
    expect(component.transferForm.valid).toBe(true);
  });

  it('creates both transfer legs without numeric coercion', () => {
    const fixture = create({ mode: 'transfer-create' });
    const component = fixture.componentInstance as any;
    component.transferForm.setValue({
      comment: 'Move broker',
      fromAccountId: 'account-a',
      fromAmount: '174200.000000000000000001',
      fromCurrency: 'DKK',
      fromDate: '2026-09-28',
      source: 'Broker transfer',
      toAccountId: 'account-b',
      toAmount: '23352.450000000000000009',
      toCurrency: 'EUR',
      toDate: '2026-09-30'
    });

    component.onSubmit();

    expect(dataService.postExternalCashFlowTransfer).toHaveBeenCalledWith({
      comment: 'Move broker',
      from: {
        accountId: 'account-a',
        amount: '174200.000000000000000001',
        currency: 'DKK',
        date: '2026-09-28'
      },
      source: 'Broker transfer',
      to: {
        accountId: 'account-b',
        amount: '23352.450000000000000009',
        currency: 'EUR',
        date: '2026-09-30'
      }
    });
  });

  it('edits a transfer through the paired endpoint', () => {
    const transfer = {
      transferGroupId: 'group-id',
      items: [
        {
          id: 'out',
          accountId: 'account-a',
          amount: '10',
          comment: null,
          createdAt: '2026-09-28T10:00:00.000Z',
          currency: 'DKK',
          date: '2026-09-28T00:00:00.000Z',
          source: null,
          transferGroupId: 'group-id',
          type: 'TRANSFER_OUT' as const,
          updatedAt: '2026-09-28T10:00:00.000Z'
        },
        {
          id: 'in',
          accountId: 'account-b',
          amount: '10',
          comment: null,
          createdAt: '2026-09-28T10:00:00.000Z',
          currency: 'DKK',
          date: '2026-09-29T00:00:00.000Z',
          source: null,
          transferGroupId: 'group-id',
          type: 'TRANSFER_IN' as const,
          updatedAt: '2026-09-28T10:00:00.000Z'
        }
      ]
    };
    const fixture = create({ mode: 'transfer-edit', transfer });
    const component = fixture.componentInstance as any;

    component.onSubmit();

    expect(dataService.putExternalCashFlowTransfer).toHaveBeenCalledWith(
      'group-id',
      expect.objectContaining({
        from: expect.objectContaining({ accountId: 'account-a' }),
        to: expect.objectContaining({ accountId: 'account-b' })
      })
    );
    expect(dataService.patchExternalCashFlow).not.toHaveBeenCalled();
  });
});
