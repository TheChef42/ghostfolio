import {
  ExternalCashFlowMutation,
  ExternalCashFlowTransferMutation
} from '@ghostfolio/common/interfaces';
import { DataService } from '@ghostfolio/ui/services';

import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';

import { ExternalCashFlowDialogParams } from './interfaces';

const AMOUNT_PATTERN =
  /^(?=.*[1-9])(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?(?![\s\S])/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'h-100' },
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule
  ],
  selector: 'gf-external-cash-flow-dialog',
  styleUrls: ['./external-cash-flow-dialog.scss'],
  templateUrl: './external-cash-flow-dialog.html'
})
export class GfExternalCashFlowDialogComponent {
  protected readonly data =
    inject<ExternalCashFlowDialogParams>(MAT_DIALOG_DATA);
  protected errorMessage: string | undefined;
  protected isSubmitting = false;

  protected readonly isTransfer = this.data.mode.startsWith('transfer');
  protected readonly isUpdate = this.data.mode.endsWith('edit');

  protected readonly ordinaryForm = new FormGroup({
    accountId: new FormControl(this.data.flow?.accountId ?? '', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    amount: new FormControl(this.data.flow?.amount ?? '', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(AMOUNT_PATTERN)]
    }),
    comment: new FormControl(this.data.flow?.comment ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(2000)]
    }),
    currency: new FormControl(this.data.flow?.currency ?? '', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    date: new FormControl(this.accountingDate(this.data.flow?.date), {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(DATE_PATTERN)]
    }),
    source: new FormControl(this.data.flow?.source ?? '', {
      nonNullable: true,
      validators: [Validators.maxLength(255)]
    }),
    type: new FormControl<'DEPOSIT' | 'WITHDRAWAL'>(
      this.data.flow?.type === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'DEPOSIT',
      {
        nonNullable: true,
        validators: [
          Validators.required,
          Validators.pattern(/^(DEPOSIT|WITHDRAWAL)$/)
        ]
      }
    )
  });

  protected readonly transferForm = this.createTransferForm();

  private readonly dataService = inject(DataService);
  private readonly dialogRef =
    inject<MatDialogRef<GfExternalCashFlowDialogComponent>>(MatDialogRef);

  protected onAccountChanged(side: 'from' | 'to') {
    const accountId = this.transferForm.controls[`${side}AccountId`].value;
    const account = this.data.accounts.find(({ id }) => id === accountId);

    if (account) {
      this.transferForm.controls[`${side}Currency`].setValue(account.currency);
    }

    this.transferForm.updateValueAndValidity();
  }

  protected onCancel() {
    this.dialogRef.close();
  }

  protected onSubmit() {
    const form = this.isTransfer ? this.transferForm : this.ordinaryForm;

    form.markAllAsTouched();
    if (form.invalid || this.isSubmitting) {
      return;
    }

    this.errorMessage = undefined;
    this.isSubmitting = true;

    const request$ = this.isTransfer
      ? this.submitTransfer()
      : this.submitOrdinary();

    request$.subscribe({
      error: (error: HttpErrorResponse) => {
        this.errorMessage = this.errorForStatus(error.status);
        this.isSubmitting = false;
      },
      next: () => this.dialogRef.close(true)
    });
  }

  private accountingDate(value?: string) {
    return value?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  }

  private createTransferForm() {
    const outgoing = this.data.transfer?.items.find(
      ({ type }) => type === 'TRANSFER_OUT'
    );
    const incoming = this.data.transfer?.items.find(
      ({ type }) => type === 'TRANSFER_IN'
    );

    return new FormGroup(
      {
        comment: new FormControl(outgoing?.comment ?? incoming?.comment ?? '', {
          nonNullable: true,
          validators: [Validators.maxLength(2000)]
        }),
        fromAccountId: new FormControl(outgoing?.accountId ?? '', {
          nonNullable: true,
          validators: [Validators.required]
        }),
        fromAmount: new FormControl(outgoing?.amount ?? '', {
          nonNullable: true,
          validators: [Validators.required, Validators.pattern(AMOUNT_PATTERN)]
        }),
        fromCurrency: new FormControl(outgoing?.currency ?? '', {
          nonNullable: true,
          validators: [Validators.required]
        }),
        fromDate: new FormControl(this.accountingDate(outgoing?.date), {
          nonNullable: true,
          validators: [Validators.required, Validators.pattern(DATE_PATTERN)]
        }),
        source: new FormControl(outgoing?.source ?? incoming?.source ?? '', {
          nonNullable: true,
          validators: [Validators.maxLength(255)]
        }),
        toAccountId: new FormControl(incoming?.accountId ?? '', {
          nonNullable: true,
          validators: [Validators.required]
        }),
        toAmount: new FormControl(incoming?.amount ?? '', {
          nonNullable: true,
          validators: [Validators.required, Validators.pattern(AMOUNT_PATTERN)]
        }),
        toCurrency: new FormControl(incoming?.currency ?? '', {
          nonNullable: true,
          validators: [Validators.required]
        }),
        toDate: new FormControl(this.accountingDate(incoming?.date), {
          nonNullable: true,
          validators: [Validators.required, Validators.pattern(DATE_PATTERN)]
        })
      },
      { validators: [this.transferValidator()] }
    );
  }

  private emptyToNull(value: string) {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private errorForStatus(status: number) {
    if (status === 400) {
      return $localize`The cash flow is invalid. Review the highlighted fields.`;
    }

    if (status === 404) {
      return $localize`An account or cash flow is no longer available. Reload and try again.`;
    }

    if (status === 409) {
      return $localize`The cash flow changed or conflicts with the ledger. Reload and try again.`;
    }

    return $localize`The cash flow could not be saved. Please try again.`;
  }

  private submitOrdinary(): Observable<unknown> {
    const value = this.ordinaryForm.getRawValue();
    const mutation: ExternalCashFlowMutation = {
      accountId: value.accountId,
      amount: value.amount,
      comment: this.emptyToNull(value.comment),
      currency: value.currency,
      date: value.date,
      source: this.emptyToNull(value.source),
      type: value.type
    };

    return this.isUpdate && this.data.flow
      ? this.dataService.patchExternalCashFlow(this.data.flow.id, mutation)
      : this.dataService.postExternalCashFlow(mutation);
  }

  private submitTransfer(): Observable<unknown> {
    const value = this.transferForm.getRawValue();
    const mutation: ExternalCashFlowTransferMutation = {
      comment: this.emptyToNull(value.comment),
      from: {
        accountId: value.fromAccountId,
        amount: value.fromAmount,
        currency: value.fromCurrency,
        date: value.fromDate
      },
      source: this.emptyToNull(value.source),
      to: {
        accountId: value.toAccountId,
        amount: value.toAmount,
        currency: value.toCurrency,
        date: value.toDate
      }
    };

    return this.isUpdate && this.data.transfer
      ? this.dataService.putExternalCashFlowTransfer(
          this.data.transfer.transferGroupId,
          mutation
        )
      : this.dataService.postExternalCashFlowTransfer(mutation);
  }

  private transferValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
      const value = control.value;

      if (value.fromAccountId && value.fromAccountId === value.toAccountId) {
        return { sameAccount: true };
      }

      if (value.fromDate && value.toDate && value.toDate < value.fromDate) {
        return { receiptBeforeDeparture: true };
      }

      if (
        value.fromCurrency &&
        value.fromCurrency === value.toCurrency &&
        value.fromAmount &&
        value.toAmount &&
        value.fromAmount !== value.toAmount
      ) {
        return { sameCurrencyPrincipalMismatch: true };
      }

      return null;
    };
  }
}
