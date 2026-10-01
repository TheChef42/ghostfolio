import { OverlayContainer } from '@angular/cdk/overlay';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';

import { GfAnalyticsInfoComponent } from './analytics-info.component';

jest.mock('@ionic/angular/standalone', () => ({ IonIcon: class {} }));

describe('GfAnalyticsInfoComponent', () => {
  let fixture: ComponentFixture<GfAnalyticsInfoComponent>;
  let overlayContainer: OverlayContainer;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GfAnalyticsInfoComponent]
    })
      .overrideComponent(GfAnalyticsInfoComponent, {
        set: {
          imports: [MatButtonModule, MatMenuModule],
          schemas: [CUSTOM_ELEMENTS_SCHEMA]
        }
      })
      .compileComponents();

    fixture = TestBed.createComponent(GfAnalyticsInfoComponent);
    overlayContainer = TestBed.inject(OverlayContainer);
    fixture.componentRef.setInput('accessibleLabel', 'About XIRR');
    fixture.componentRef.setInput(
      'text',
      'Short periods can produce extreme annualized values.'
    );
    fixture.detectChanges();
  });

  afterEach(() => {
    overlayContainer.getContainerElement().innerHTML = '';
  });

  it('opens explanatory copy from an accessible click target', () => {
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button'
    )!;
    expect(button.getAttribute('aria-label')).toBe('About XIRR');

    button.click();
    fixture.detectChanges();

    expect(overlayContainer.getContainerElement().textContent).toContain(
      'Short periods can produce extreme annualized values.'
    );
  });
});
