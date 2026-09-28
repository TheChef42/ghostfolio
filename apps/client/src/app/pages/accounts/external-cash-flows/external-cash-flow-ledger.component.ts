import { ConfirmationDialogType } from '@ghostfolio/common/enums';
import { ExternalCashFlowItem } from '@ghostfolio/common/interfaces';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';

import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  inject,
  Input,
  OnChanges
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { Observable } from 'rxjs';

import { GfExternalCashFlowDialogComponent } from './external-cash-flow-dialog.component';
import {
  ExternalCashFlowAccount,
  ExternalCashFlowDialogParams
} from './interfaces';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
    ReactiveFormsModule
  ],
  selector: 'gf-external-cash-flow-ledger',
  styleUrls: ['./external-cash-flow-ledger.scss'],
  templateUrl: './external-cash-flow-ledger.html'
})
export class GfExternalCashFlowLedgerComponent implements OnChanges {
  @Input() public accounts: ExternalCashFlowAccount[] = [];
  @Input() public canCreate = false;
  @Input() public canDelete = false;
  @Input() public canUpdate = false;
  @Input() public locale = 'en-US';

  protected readonly accountFilter = new FormControl('', { nonNullable: true });
  protected readonly displayedColumns = [
    'date',
    'type',
    'account',
    'amount',
    'metadata',
    'actions'
  ];
  protected errorMessage: string | undefined;
  protected readonly fromFilter = new FormControl('', { nonNullable: true });
  protected items: ExternalCashFlowItem[] = [];
  protected isLoading = true;
  protected pageIndex = 0;
  protected readonly pageSize = 100;
  protected totalItems = 0;
  protected readonly toFilter = new FormControl('', { nonNullable: true });

  private initialized = false;
  private readonly changeDetectorRef = inject(ChangeDetectorRef);
  private readonly dataService = inject(DataService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly notificationService = inject(NotificationService);

  public ngOnChanges() {
    if (!this.initialized && this.accounts.length) {
      this.initialized = true;
      this.fetch();
    }
  }

  protected accountName(accountId: string) {
    return (
      this.accounts.find(({ id }) => id === accountId)?.name ??
      $localize`Hidden account`
    );
  }

  protected applyFilters() {
    this.pageIndex = 0;
    this.fetch();
  }

  protected counterpart(flow: ExternalCashFlowItem) {
    const counterpart = this.items.find(
      ({ id, transferGroupId }) =>
        id !== flow.id && transferGroupId === flow.transferGroupId
    );

    return counterpart
      ? this.accountName(counterpart.accountId)
      : $localize`linked account`;
  }

  protected formatAmount(amount: string | null) {
    if (amount === null) {
      return $localize`Hidden`;
    }

    const [integer, fraction] = amount.split('.');
    const parts = new Intl.NumberFormat(this.locale).formatToParts(1000.1);
    const group = parts.find(({ type }) => type === 'group')?.value ?? ',';
    const decimal = parts.find(({ type }) => type === 'decimal')?.value ?? '.';
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);

    return fraction ? `${grouped}${decimal}${fraction}` : grouped;
  }

  protected formatDate(date: string) {
    return new Intl.DateTimeFormat(this.locale, {
      dateStyle: 'medium',
      timeZone: 'UTC'
    }).format(new Date(`${date.slice(0, 10)}T00:00:00.000Z`));
  }

  protected onChangePage({ pageIndex }: PageEvent) {
    this.pageIndex = pageIndex;
    this.fetch();
  }

  protected onCreateOrdinary() {
    this.openDialog({ mode: 'ordinary-create' });
  }

  protected onCreateTransfer() {
    this.openDialog({ mode: 'transfer-create' });
  }

  protected onDelete(flow: ExternalCashFlowItem) {
    const isTransfer = !!flow.transferGroupId;

    this.notificationService.confirm({
      confirmLabel: $localize`Delete`,
      confirmType: ConfirmationDialogType.Warn,
      message: isTransfer
        ? $localize`Both linked transfer legs will be deleted.`
        : $localize`This external cash flow will be deleted.`,
      title: isTransfer
        ? $localize`Delete transfer?`
        : $localize`Delete external cash flow?`,
      confirmFn: () => {
        const request$: Observable<unknown> = isTransfer
          ? this.dataService.deleteExternalCashFlowTransfer(
              flow.transferGroupId!
            )
          : this.dataService.deleteExternalCashFlow(flow.id);

        request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          error: () =>
            this.notificationService.alert({
              title: $localize`The cash flow could not be deleted. Reload and try again.`
            }),
          next: () => this.fetch()
        });
      }
    });
  }

  protected onEdit(flow: ExternalCashFlowItem) {
    if (!flow.transferGroupId) {
      this.openDialog({ flow, mode: 'ordinary-edit' });
      return;
    }

    this.dataService
      .fetchExternalCashFlowTransfer(flow.transferGroupId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () =>
          this.notificationService.alert({
            title: $localize`The linked transfer could not be loaded. Reload and try again.`
          }),
        next: (transfer) => this.openDialog({ mode: 'transfer-edit', transfer })
      });
  }

  protected typeLabel(type: ExternalCashFlowItem['type']) {
    const labels: Record<ExternalCashFlowItem['type'], string> = {
      DEPOSIT: $localize`Deposit`,
      TRANSFER_IN: $localize`Transfer in`,
      TRANSFER_OUT: $localize`Transfer out`,
      WITHDRAWAL: $localize`Withdrawal`
    };
    return labels[type];
  }

  private fetch() {
    this.errorMessage = undefined;
    this.isLoading = true;
    this.changeDetectorRef.markForCheck();

    this.dataService
      .fetchExternalCashFlows({
        accounts: this.accountFilter.value
          ? [this.accountFilter.value]
          : undefined,
        from: this.fromFilter.value || undefined,
        skip: this.pageIndex * this.pageSize,
        take: this.pageSize,
        to: this.toFilter.value || undefined
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        error: () => {
          this.errorMessage = $localize`External cash flows could not be loaded.`;
          this.items = [];
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
        },
        next: ({ count, items }) => {
          this.items = items;
          this.totalItems = count;
          this.isLoading = false;
          this.changeDetectorRef.markForCheck();
        }
      });
  }

  private openDialog({
    flow,
    mode,
    transfer
  }: Pick<ExternalCashFlowDialogParams, 'flow' | 'mode' | 'transfer'>) {
    const dialogRef = this.dialog.open<
      GfExternalCashFlowDialogComponent,
      ExternalCashFlowDialogParams,
      boolean
    >(GfExternalCashFlowDialogComponent, {
      autoFocus: 'first-tabbable',
      data: {
        accounts: this.accounts,
        currencies: this.dataService.fetchInfo().currencies,
        flow,
        mode,
        transfer
      },
      maxWidth: '60rem',
      width: '96vw'
    });

    dialogRef
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((saved) => {
        if (saved) {
          this.fetch();
        }
      });
  }
}
