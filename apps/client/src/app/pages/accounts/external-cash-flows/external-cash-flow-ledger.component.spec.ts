import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';

import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';

import { GfExternalCashFlowLedgerComponent } from './external-cash-flow-ledger.component';

describe('GfExternalCashFlowLedgerComponent', () => {
  const flow = {
    id: 'flow-id',
    accountId: 'account-a',
    amount: '123456789012345678.123456789012345678',
    comment: 'Capital funding',
    createdAt: '2026-09-28T10:00:00.000Z',
    currency: 'DKK',
    date: '2026-09-28T00:00:00.000Z',
    source: 'Bank',
    transferGroupId: null,
    type: 'DEPOSIT' as const,
    updatedAt: '2026-09-28T10:00:00.000Z'
  };
  let dataService: Record<string, jest.Mock>;
  let dialog: { open: jest.Mock };
  let notifications: { alert: jest.Mock; confirm: jest.Mock };

  function create(response = of({ count: 1, items: [flow] })) {
    dataService.fetchExternalCashFlows.mockReturnValue(response);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [GfExternalCashFlowLedgerComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DataService, useValue: dataService },
        { provide: MatDialog, useValue: dialog },
        { provide: NotificationService, useValue: notifications }
      ]
    });
    const fixture = TestBed.createComponent(GfExternalCashFlowLedgerComponent);
    fixture.componentRef.setInput('accounts', [
      { id: 'account-a', name: 'Broker A', currency: 'DKK' },
      { id: 'account-b', name: 'Broker B', currency: 'EUR' }
    ]);
    fixture.componentRef.setInput('locale', 'en-US');
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    dataService = {
      deleteExternalCashFlow: jest.fn(() => of({})),
      deleteExternalCashFlowTransfer: jest.fn(() => of({})),
      fetchExternalCashFlows: jest.fn(),
      fetchExternalCashFlowTransfer: jest.fn(() => of({})),
      fetchInfo: jest.fn(() => ({ currencies: ['DKK', 'EUR'] }))
    };
    dialog = {
      open: jest.fn(() => ({ afterClosed: () => of(false) }))
    };
    notifications = {
      alert: jest.fn(),
      confirm: jest.fn(({ confirmFn }) => confirmFn())
    };
  });

  it('renders owned flows with exact native amount, account and metadata', () => {
    const fixture = create();
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Broker A');
    expect(text).toContain('123,456,789,012,345,678.123456789012345678');
    expect(text).toContain('DKK');
    expect(text).toContain('Bank');
    expect(text).toContain('Capital funding');
  });

  it('renders loading, empty and error states', () => {
    const pending = new Subject<never>();
    const loading = create(pending);
    expect(loading.nativeElement.textContent).toContain(
      'Loading external cash flows'
    );

    const empty = create(of({ count: 0, items: [] }));
    expect(empty.nativeElement.textContent).toContain('No external cash flows');

    const error = create(throwError(() => new Error('network')));
    expect(error.nativeElement.textContent).toContain(
      'External cash flows could not be loaded'
    );
  });

  it('sends account/date filters and non-duplicating page offsets', () => {
    const fixture = create();
    const component = fixture.componentInstance as any;
    dataService.fetchExternalCashFlows.mockClear();
    component.accountFilter.setValue('account-a');
    component.fromFilter.setValue('2026-01-01');
    component.toFilter.setValue('2026-12-31');

    component.applyFilters();
    component.onChangePage({ pageIndex: 1 });

    expect(dataService.fetchExternalCashFlows).toHaveBeenNthCalledWith(1, {
      accounts: ['account-a'],
      from: '2026-01-01',
      skip: 0,
      take: 100,
      to: '2026-12-31'
    });
    expect(dataService.fetchExternalCashFlows).toHaveBeenNthCalledWith(2, {
      accounts: ['account-a'],
      from: '2026-01-01',
      skip: 100,
      take: 100,
      to: '2026-12-31'
    });
  });

  it('does not expose mutation controls in read-only context', () => {
    const fixture = create();
    const text = fixture.nativeElement.textContent;

    expect(text).not.toContain('Add cash flow');
    expect(text).not.toContain('Edit');
    expect(text).not.toContain('Delete');
  });

  it('does not render redacted amount, source or comment', () => {
    const redacted = {
      ...flow,
      amount: null,
      comment: null,
      source: null
    };
    const fixture = create(of({ count: 1, items: [redacted] }));
    const text = fixture.nativeElement.textContent;

    expect(text).toContain('Hidden');
    expect(text).not.toContain(flow.amount);
    expect(text).not.toContain(flow.source);
    expect(text).not.toContain(flow.comment);
  });

  it('deletes transfer legs only through the paired endpoint', () => {
    const transfer = {
      ...flow,
      id: 'out-id',
      transferGroupId: 'group-id',
      type: 'TRANSFER_OUT' as const
    };
    const fixture = create(of({ count: 1, items: [transfer] }));
    const component = fixture.componentInstance as any;

    component.onDelete(transfer);

    expect(dataService.deleteExternalCashFlowTransfer).toHaveBeenCalledWith(
      'group-id'
    );
    expect(dataService.deleteExternalCashFlow).not.toHaveBeenCalled();
  });

  it('loads the complete pair before opening transfer edit', () => {
    const transfer = {
      ...flow,
      transferGroupId: 'group-id',
      type: 'TRANSFER_OUT' as const
    };
    const pair = { transferGroupId: 'group-id', items: [transfer] };
    dataService.fetchExternalCashFlowTransfer.mockReturnValue(of(pair));
    const fixture = create(of({ count: 1, items: [transfer] }));
    const component = fixture.componentInstance as any;

    component.onEdit(transfer);

    expect(dataService.fetchExternalCashFlowTransfer).toHaveBeenCalledWith(
      'group-id'
    );
    expect(dialog.open).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        data: expect.objectContaining({
          mode: 'transfer-edit',
          transfer: pair
        })
      })
    );
  });
});
