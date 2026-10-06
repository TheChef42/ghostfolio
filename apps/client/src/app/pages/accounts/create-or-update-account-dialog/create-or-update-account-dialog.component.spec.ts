import { ImpersonationStorageService } from '@ghostfolio/client/services/impersonation-storage.service';
import { UserService } from '@ghostfolio/client/services/user/user.service';
import { User } from '@ghostfolio/common/interfaces';
import { NotificationService } from '@ghostfolio/ui/notifications';
import { DataService } from '@ghostfolio/ui/services';

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import 'reflect-metadata';
import { of, throwError } from 'rxjs';

import { GfCreateOrUpdateAccountDialogComponent } from './create-or-update-account-dialog.component';

jest.mock('@ghostfolio/client/services/user/user.service', () => ({
  UserService: class {}
}));
jest.mock('@ghostfolio/ui/currency-selector', () => ({
  GfCurrencySelectorComponent: class {}
}));
jest.mock('@ghostfolio/ui/entity-logo', () => ({
  GfEntityLogoComponent: class {}
}));
jest.mock('@ghostfolio/ui/notifications', () => ({
  NotificationService: class {}
}));
jest.mock('@ghostfolio/ui/tags-selector', () => ({
  GfTagsSelectorComponent: class {}
}));

describe('GfCreateOrUpdateAccountDialogComponent', () => {
  let component: GfCreateOrUpdateAccountDialogComponent;
  let fixture: ComponentFixture<GfCreateOrUpdateAccountDialogComponent>;
  let dataService: {
    fetchInfo: jest.Mock;
    fetchPlatforms: jest.Mock;
    postAccount: jest.Mock;
    putAccount: jest.Mock;
  };
  let dialogRef: { close: jest.Mock };
  let notificationService: { alert: jest.Mock };

  beforeEach(async () => {
    dataService = {
      fetchInfo: jest.fn().mockReturnValue({ currencies: ['DKK'] }),
      fetchPlatforms: jest.fn().mockReturnValue(of({ platforms: [] })),
      postAccount: jest.fn().mockReturnValue(of({})),
      putAccount: jest.fn().mockReturnValue(of({}))
    };
    dialogRef = { close: jest.fn() };
    notificationService = { alert: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [GfCreateOrUpdateAccountDialogComponent],
      providers: [
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            account: {
              balance: 100,
              comment: null,
              currency: 'DKK',
              id: 'account-1',
              inceptionDate: '2025-01-01',
              name: 'Broker account',
              platformId: null,
              tags: []
            },
            user: { id: 'user', permissions: [], tags: [] } as unknown as User
          }
        },
        { provide: DataService, useValue: dataService },
        {
          provide: ImpersonationStorageService,
          useValue: { getId: jest.fn().mockReturnValue(null) }
        },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: NotificationService, useValue: notificationService },
        {
          provide: UserService,
          useValue: { get: jest.fn().mockReturnValue(of({})) }
        }
      ]
    })
      .overrideComponent(GfCreateOrUpdateAccountDialogComponent, {
        set: {
          imports: [ReactiveFormsModule],
          template: `
            <form [formGroup]="accountForm">
              <input formControlName="inceptionDate" />
              @if (inceptionDateError) {
                <span>{{ inceptionDateError }}</span>
              }
            </form>
          `
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GfCreateOrUpdateAccountDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('closes only after a successful account save', async () => {
    await (component as any).onSubmit();

    expect(dataService.putAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'account-1',
        inceptionDate: '2025-01-01'
      })
    );
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('shows an account-start validation message inline and keeps the dialog open', async () => {
    const message =
      'Account start date cannot be later than existing account history on 2025-09-30';
    dataService.putAccount.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            error: { message },
            status: 400
          })
      )
    );

    await (component as any).onSubmit();
    fixture.detectChanges();

    expect(
      (component as any).accountForm.get('inceptionDate').hasError('server')
    ).toBe(true);
    expect(fixture.nativeElement.textContent).toContain(message);
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(notificationService.alert).not.toHaveBeenCalled();
  });
});
